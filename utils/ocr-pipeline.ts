import ResizeObserverPolyfill from "resize-observer-polyfill";
import type { OCRRegion, OcrResultMessage, ProcessOcrMessage } from "@/types";

if (typeof window !== "undefined" && !window.ResizeObserver) {
	window.ResizeObserver = ResizeObserverPolyfill;
}

const LAZY_IMAGE_ATTRIBUTES = [
	"data-src",
	"data-original",
	"data-original-src",
	"data-lazy-src",
	"data-lazy-srcset",
	"data-srcset",
	"data-lazy-loaded-src",
	"data-full-src",
	"data-actual-src",
	"data-url",
	"data-image",
];

function getLazyImageUrl(img: HTMLImageElement): string | null {
	for (const attribute of LAZY_IMAGE_ATTRIBUTES) {
		const value = img.getAttribute(attribute)?.trim();
		if (value) return value;
	}
	return null;
}

function getErrorDetails(error: unknown) {
	if (error instanceof Error) {
		return {
			name: error.name,
			message: error.message,
			stack: error.stack,
		};
	}
	return { value: String(error) };
}

function resolveBestImageUrl(img: HTMLImageElement): string {
	const currentSrc = img.currentSrc || img.src;
	const lazyUrl = getLazyImageUrl(img);
	if (lazyUrl && (!currentSrc || !img.complete || img.naturalWidth === 0)) {
		return lazyUrl;
	}

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

	return currentSrc || lazyUrl || "";
}

function tryCanvasBase64(
	img: HTMLImageElement,
	source: string = resolveBestImageUrl(img),
): Promise<string | null> {
	return new Promise<string | null>((resolve) => {
		try {
			if (!source) {
				console.warn(
					"[image-translate] Skipping canvas extraction: image has no source",
					{
						source,
						naturalWidth: img.naturalWidth,
						naturalHeight: img.naturalHeight,
					},
				);
				return resolve(null);
			}
			let origin: string | null = null;
			try {
				origin = new URL(source, window.location.href).origin;
			} catch {
				origin = null;
			}
			const isCrossOrigin = Boolean(
				origin && origin !== window.location.origin,
			);
			if (isCrossOrigin) {
				console.warn(
					"[image-translate] Image is cross-origin; fetching it before OCR.",
					{ source, pageOrigin: window.location.origin },
				);
			}
			const canvas = document.createElement("canvas");
			canvas.width = img.naturalWidth || img.width;
			canvas.height = img.naturalHeight || img.height;
			if (canvas.width === 0 || canvas.height === 0) return resolve(null);
			const ctx = canvas.getContext("2d");
			if (!ctx) return resolve(null);
			ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
			const dataUrl = canvas.toDataURL("image/png");
			resolve(dataUrl);
		} catch (err) {
			console.error("[image-translate] Canvas image extraction failed", {
				source,
				naturalWidth: img.naturalWidth,
				naturalHeight: img.naturalHeight,
				error: getErrorDetails(err),
			});
			resolve(null);
		}
	});
}

function tryFetchBase64(src: string): Promise<string | null> {
	if (!src.trim()) return Promise.resolve(null);
	return fetch(src)
		.then((res) => {
			if (!res.ok) {
				throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
			}
			return res.blob();
		})
		.then(
			(blob) =>
				new Promise<string | null>((resolve) => {
					const reader = new FileReader();
					reader.onloadend = () => {
						if (typeof reader.result === "string") resolve(reader.result);
						else resolve(null);
					};
					reader.onerror = () => {
						console.error("[image-translate] FileReader failed", {
							source: src,
							error: getErrorDetails(reader.error),
						});
						resolve(null);
					};
					reader.readAsDataURL(blob);
				}),
		)
		.catch((err) => {
			console.error("[image-translate] Fetch image extraction failed", {
				source: src,
				error: getErrorDetails(err),
			});
			return null;
		});
}

const OCR_CONTENT_REQUEST_TIMEOUT_MS = 60_000;

const pendingOcrRequests = new Map<
	string,
	{
		onSuccess: (ocrRegions: OCRRegion[]) => void;
		onError: (error: string | Error) => void;
		timeout: ReturnType<typeof setTimeout>;
	}
>();

let requestIdCounter = 0;

function generateRequestId(): string {
	return `ocr-${Date.now()}-${++requestIdCounter}`;
}

function registerOcrResultListener(): void {
	browser.runtime.onMessage.addListener((msg: OcrResultMessage) => {
		if (msg.type !== "ocr/result") return;
		const request = pendingOcrRequests.get(msg.requestId);
		if (!request) return;
		clearTimeout(request.timeout);
		pendingOcrRequests.delete(msg.requestId);
		if (msg.success && Array.isArray(msg.ocrData)) {
			request.onSuccess(msg.ocrData);
		} else {
			request.onError(msg.error || "OCR processing failed");
		}
	});
}

function sendOcrWithBase64(
	base64: string,
	source: string,
	onSuccess: (ocrRegions: OCRRegion[]) => void,
	onError: (error: string | Error) => void,
) {
	const requestId = generateRequestId();
	const timeout = setTimeout(() => {
		const request = pendingOcrRequests.get(requestId);
		if (request) {
			pendingOcrRequests.delete(requestId);
			onError("OCR processing timed out");
		}
	}, OCR_CONTENT_REQUEST_TIMEOUT_MS);

	pendingOcrRequests.set(requestId, { onSuccess, onError, timeout });

	const base64Info = `${base64.length} bytes, prefix: ${base64.slice(0, 80)}`;
	console.info("[image-translate] Sending OCR with base64", {
		source,
		fetchingType: "base64",
		base64Info,
		requestId,
	});
	browser.runtime
		.sendMessage({
			from: "content",
			to: "background",
			type: "ocr/process",
			fetchingType: "base64",
			imageData: base64,
			requestId,
		} satisfies ProcessOcrMessage)
		.catch((error) => {
			const request = pendingOcrRequests.get(requestId);
			if (request) {
				pendingOcrRequests.delete(requestId);
				clearTimeout(request.timeout);
				onError(error instanceof Error ? error : "OCR request failed");
			}
		});
}

function sendOcrWithUrl(
	imageUrl: string,
	headers: Record<string, string>,
	source: string,
	onSuccess: (ocrRegions: OCRRegion[]) => void,
	onError: (error: string | Error) => void,
) {
	const requestId = generateRequestId();
	const timeout = setTimeout(() => {
		const request = pendingOcrRequests.get(requestId);
		if (request) {
			pendingOcrRequests.delete(requestId);
			onError("OCR processing timed out");
		}
	}, OCR_CONTENT_REQUEST_TIMEOUT_MS);

	pendingOcrRequests.set(requestId, { onSuccess, onError, timeout });

	console.info("[image-translate] Sending OCR with URL", {
		source,
		fetchingType: "url",
		imageUrl,
		requestId,
	});
	browser.runtime
		.sendMessage({
			from: "content",
			to: "background",
			type: "ocr/process",
			fetchingType: "url",
			imageData: imageUrl,
			headers,
			requestId,
		} satisfies ProcessOcrMessage)
		.catch((error) => {
			const request = pendingOcrRequests.get(requestId);
			if (request) {
				pendingOcrRequests.delete(requestId);
				clearTimeout(request.timeout);
				onError(error instanceof Error ? error : "OCR request failed");
			}
		});
}

async function processImage(
	img: HTMLImageElement,
	onSuccess: (ocrRegions: OCRRegion[]) => void,
	onError: (error: string | Error) => void,
) {
	if (!img || !(img instanceof HTMLImageElement)) {
		const error = new Error("Image element is not available");
		console.error("[image-translate] Image processing failed", {
			error: getErrorDetails(error),
		});
		onError(error);
		return;
	}

	const source = resolveBestImageUrl(img);
	if (!source) {
		const error = new Error("Image has no source URL");
		console.warn("[image-translate] Image processing skipped", {
			source,
			error: getErrorDetails(error),
		});
		onError(error);
		return;
	}

	try {
		console.info("[image-translate] Image OCR started", {
			source,
			complete: img.complete,
			naturalWidth: img.naturalWidth,
			naturalHeight: img.naturalHeight,
		});
		let base64 = await tryCanvasBase64(img, source);
		if (base64) {
			console.info("[image-translate] Canvas extraction succeeded", {
				source,
				base64Length: base64.length,
				base64Prefix: base64.slice(0, 80),
			});
			sendOcrWithBase64(base64, source, onSuccess, onError);
			return;
		}
		console.warn("[image-translate] Canvas extraction failed", { source });

		base64 = await tryFetchBase64(source);
		if (base64) {
			console.info("[image-translate] Fetch extraction succeeded", {
				source,
				base64Length: base64.length,
				base64Prefix: base64.slice(0, 80),
			});
			sendOcrWithBase64(base64, source, onSuccess, onError);
			return;
		}
		console.warn(
			"[image-translate] Fetch extraction failed, falling back to URL",
			{ source },
		);

		sendOcrWithUrl(
			source,
			{
				"User-Agent": navigator.userAgent,
				Accept:
					"image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
				"Accept-Language": navigator.language,
				Referer: window.location.href,
			},
			source,
			onSuccess,
			onError,
		);
	} catch (error) {
		console.error("[image-translate] Image OCR pipeline failed", {
			source,
			error: getErrorDetails(error),
		});
		onError(error instanceof Error ? error : "Image OCR pipeline failed");
	}
}

function processCanvas(
	canvas: HTMLCanvasElement,
	onSuccess: (ocrRegions: OCRRegion[]) => void,
	onComplete: () => void,
	onError: (error: string | Error) => void,
) {
	const source = `canvas:${canvas.width}x${canvas.height}`;
	try {
		const base64 = canvas.toDataURL("image/png");
		const requestId = generateRequestId();
		const timeout = setTimeout(() => {
			const request = pendingOcrRequests.get(requestId);
			if (request) {
				pendingOcrRequests.delete(requestId);
				onError("OCR processing timed out");
				onComplete();
			}
		}, OCR_CONTENT_REQUEST_TIMEOUT_MS);

		pendingOcrRequests.set(requestId, {
			onSuccess: (data) => {
				onSuccess(data);
				onComplete();
			},
			onError: (err) => {
				onError(err);
				onComplete();
			},
			timeout,
		});

		browser.runtime
			.sendMessage({
				from: "content",
				to: "background",
				type: "ocr/process",
				fetchingType: "base64",
				imageData: base64,
				requestId,
			} satisfies ProcessOcrMessage)
			.catch((error) => {
				const request = pendingOcrRequests.get(requestId);
				if (request) {
					pendingOcrRequests.delete(requestId);
					clearTimeout(timeout);
					onError(
						error instanceof Error ? error : "Canvas OCR pipeline failed",
					);
					onComplete();
				}
			});
	} catch (error) {
		console.error("[image-translate] Canvas OCR pipeline failed", {
			source,
			error: getErrorDetails(error),
		});
		onError(error instanceof Error ? error : "Canvas OCR pipeline failed");
		onComplete();
	}
}

export {
	processCanvas,
	processImage,
	registerOcrResultListener,
	resolveBestImageUrl,
	tryCanvasBase64,
	tryFetchBase64,
};
