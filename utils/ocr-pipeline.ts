import ResizeObserverPolyfill from "resize-observer-polyfill";
import type { InternalMessageType, OCRResult } from "@/types";

if (typeof window !== "undefined" && !window.ResizeObserver) {
	window.ResizeObserver = ResizeObserverPolyfill;
}

function resolveBestImageUrl(img: HTMLImageElement): string {
	const srcset = img.getAttribute("srcset");
	if (srcset) {
		const baseWidth = img.naturalWidth || img.width || 1;
		let bestUrl: string | null = null;
		let bestScore = -Infinity;

		for (const candidate of srcset.split(",")) {
			const trimmed = candidate.trim();
			if (!trimmed) continue;

			const match = trimmed.match(/^(\S+)\s*(?:(\d+)w|(\d*(?:\.\d+)?)x)?\s*$/i);
			if (!match) continue;

			const url = match[1];
			let score: number;
			if (match[2] !== undefined) {
				score = Number(match[2]);
			} else if (match[3] !== undefined && match[3] !== "") {
				score = Number(match[3]) * baseWidth;
			} else {
				score = baseWidth;
			}

			if (score > bestScore) {
				bestScore = score;
				bestUrl = url;
			}
		}

		if (bestUrl) return bestUrl;
	}

	return img.currentSrc || img.src;
}

function tryCanvasBase64(img: HTMLImageElement): Promise<string | null> {
	return new Promise<string | null>((resolve) => {
		try {
			const isCrossOrigin =
				new URL(resolveBestImageUrl(img)).origin !== window.location.origin;
			if (isCrossOrigin) {
				console.warn(
					"Image is cross-origin, attempting to fetch and convert to base64 instead of using canvas.",
				);
			}
			const canvas = document.createElement("canvas");
			canvas.width = img.naturalWidth || img.width;
			canvas.height = img.naturalHeight || img.height;
			const ctx = canvas.getContext("2d");
			if (!ctx) return resolve(null);
			ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
			const dataUrl = canvas.toDataURL("image/png");
			resolve(dataUrl);
		} catch (err) {
			console.error(
				"Error occurred while trying to create base64 from canvas:",
				err,
			);
			resolve(null);
		}
	});
}

function tryFetchBase64(src: string): Promise<string | null> {
	return fetch(src)
		.then((res) => {
			if (!res.ok) throw new Error(res.statusText);
			return res.blob();
		})
		.then(
			(blob) =>
				new Promise<string | null>((resolve) => {
					const reader = new FileReader();
					reader.readAsDataURL(blob);
					reader.onloadend = () => resolve(reader.result as string);
					reader.onerror = () => resolve(null);
				}),
		)
		.catch((err) => {
			console.error(
				"Error occurred while trying to fetch and convert image to base64:",
				err,
			);
			return null;
		});
}

async function sendOcrWithBase64(
	base64: string,
	onSuccess: (ocrData: OCRResult) => void,
) {
	const bgResponse = await browser.runtime.sendMessage<InternalMessageType>({
		action: "PROCESS_OCR",
		fetchingType: "base64",
		imageData: base64,
	});

	bgResponse?.success && onSuccess(bgResponse.ocrData);
}

async function sendOcrWithUrl(
	imageUrl: string,
	headers: Record<string, string>,
	onSuccess: (ocrData: OCRResult) => void,
) {
	const bgResponse = await browser.runtime.sendMessage<InternalMessageType>({
		action: "PROCESS_OCR",
		fetchingType: "url",
		imageData: imageUrl,
		headers,
	});

	bgResponse?.success && onSuccess(bgResponse.ocrData);
}

async function processImage(
	img: HTMLImageElement,
	onSuccess: (ocrData: OCRResult) => void,
	onComplete: () => void,
) {
	if (!img || !(img instanceof HTMLImageElement)) {
		console.error("Image not found");
		onComplete();
		return;
	}

	try {
		let base64 = await tryCanvasBase64(img);
		if (base64) {
			await sendOcrWithBase64(base64, onSuccess);
			onComplete();
			return;
		}

		const imageUrl = resolveBestImageUrl(img);
		base64 = await tryFetchBase64(imageUrl);
		if (base64) {
			await sendOcrWithBase64(base64, onSuccess);
			onComplete();
			return;
		}

		await sendOcrWithUrl(
			imageUrl,
			{
				"User-Agent": navigator.userAgent,
				Accept:
					"image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
				"Accept-Language": navigator.language,
				Referer: window.location.href,
			},
			onSuccess,
		);
		onComplete();
	} catch (error) {
		console.error("Failed to extract or pass image text:", error);
		onComplete();
	}
}

async function processCanvas(
	canvas: HTMLCanvasElement,
	onSuccess: (ocrData: OCRResult) => void,
	onComplete: () => void,
) {
	try {
		const base64 = canvas.toDataURL("image/png");
		const bgResponse = await browser.runtime.sendMessage<InternalMessageType>({
			action: "PROCESS_OCR",
			fetchingType: "base64",
			imageData: base64,
		});

		bgResponse?.success && onSuccess(bgResponse.ocrData);
	} catch (error) {
		console.error("Failed to translate canvas:", error);
	} finally {
		onComplete();
	}
}

export {
	processCanvas,
	processImage,
	resolveBestImageUrl,
	tryCanvasBase64,
	tryFetchBase64,
};
