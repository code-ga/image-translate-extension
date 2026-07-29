import type {
	CompleteMessageType,
	DomainPattern,
	OCRResult,
	ProgressMessageType,
} from "@/types";
import {
	startLiveObserver,
	startUrlPolling,
	stopLiveObserver,
} from "@/utils/dom-observer";
import { isUrlAllowed } from "@/utils/domain-matcher";
import { createElementState } from "@/utils/element-state";
import { processCanvas, processImage } from "@/utils/ocr-pipeline";
import {
	addOcrBoxes,
	clearOcrOverlays,
	getOrCreateOverlayContainer,
	removeOverlay,
	updateElementOverlayPosition,
} from "@/utils/overlay";

const imageState = createElementState<HTMLImageElement>();
const canvasState = createElementState<HTMLCanvasElement>();

function renderImageOverlay(img: HTMLImageElement, ocrData: OCRResult) {
	const currentSrc = img.currentSrc || img.src;

	if (
		imageState.processed.has(img) &&
		imageState.processed.get(img) === currentSrc
	) {
		const existingOverlay = imageState.overlayMap.get(img);
		if (existingOverlay) {
			clearOcrOverlays(existingOverlay);
			addOcrBoxes(
				existingOverlay,
				img.naturalWidth,
				img.naturalHeight,
				ocrData,
			);
			updateElementOverlayPosition(img, existingOverlay);
		}
		return;
	}

	const oldOverlay = imageState.overlayMap.get(img);
	if (oldOverlay) removeOverlay(oldOverlay);
	imageState.overlayMap.delete(img);

	imageState.processed.set(img, currentSrc);

	const container = getOrCreateOverlayContainer();
	const overlay = document.createElement("div");
	overlay.style.position = "absolute";
	overlay.style.pointerEvents = "none";

	addOcrBoxes(overlay, img.naturalWidth, img.naturalHeight, ocrData);
	container.appendChild(overlay);
	imageState.overlayMap.set(img, overlay);
	updateElementOverlayPosition(img, overlay);

	imageState.resizeObserver.observe(img);
	imageState.schedulePositionUpdate();
}

function renderCanvasOverlay(canvas: HTMLCanvasElement, ocrData: OCRResult) {
	const canvasKey = canvas.toDataURL();

	if (
		canvasState.processed.has(canvas) &&
		canvasState.processed.get(canvas) === canvasKey
	) {
		const existingOverlay = canvasState.overlayMap.get(canvas);
		if (existingOverlay) {
			clearOcrOverlays(existingOverlay);
			addOcrBoxes(existingOverlay, canvas.width, canvas.height, ocrData);
			updateElementOverlayPosition(canvas, existingOverlay);
		}
		return;
	}

	const oldOverlay = canvasState.overlayMap.get(canvas);
	if (oldOverlay) removeOverlay(oldOverlay);
	canvasState.overlayMap.delete(canvas);

	canvasState.processed.set(canvas, canvasKey);

	const container = getOrCreateOverlayContainer();
	const overlay = document.createElement("div");
	overlay.style.position = "absolute";
	overlay.style.pointerEvents = "none";

	addOcrBoxes(overlay, canvas.width, canvas.height, ocrData);
	container.appendChild(overlay);
	canvasState.overlayMap.set(canvas, overlay);
	updateElementOverlayPosition(canvas, overlay);

	canvasState.resizeObserver.observe(canvas);
	canvasState.schedulePositionUpdate();
}

function observeImageSrc(img: HTMLImageElement) {
	imageState.observeElementAttributes(img, ["src", "srcset"], () => {
		processNewImage(img);
	});
}

function observeCanvasSize(canvas: HTMLCanvasElement) {
	canvasState.observeElementAttributes(canvas, ["width", "height"], () => {
		processNewCanvas(canvas);
	});
}

function processNewImage(img: HTMLImageElement) {
	if (imageState.processingSet.has(img)) return;
	imageState.processingSet.add(img);
	processImage(
		img,
		(ocrData) => {
			renderImageOverlay(img, ocrData);
			observeImageSrc(img);
		},
		() => {
			imageState.processingSet.delete(img);
		},
	);
}

function processNewCanvas(canvas: HTMLCanvasElement) {
	if (canvasState.processingSet.has(canvas)) return;
	canvasState.processingSet.add(canvas);
	processCanvas(
		canvas,
		(ocrData) => {
			renderCanvasOverlay(canvas, ocrData);
			observeCanvasSize(canvas);
		},
		() => {
			canvasState.processingSet.delete(canvas);
		},
	);
}

function findImageBySrc(src: string): HTMLImageElement | null {
	for (const img of Array.from(document.images)) {
		if (img.currentSrc === src || img.src === src) return img;
	}
	return null;
}

function findCanvasByIndex(index: number): HTMLCanvasElement | null {
	const canvases = document.querySelectorAll("canvas");
	return canvases[index] || null;
}

function collectImageInfo() {
	const images: {
		src: string;
		currentSrc: string;
		width: number;
		height: number;
		status: string;
	}[] = [];

	for (const img of Array.from(document.images)) {
		const width = img.naturalWidth || img.width || 0;
		const height = img.naturalHeight || img.height || 0;
		if (width < 30 || height < 30) continue;
		const style = getComputedStyle(img);
		if (
			style.display === "none" ||
			style.visibility === "hidden" ||
			style.opacity === "0"
		)
			continue;
		images.push({
			src: img.src,
			currentSrc: img.currentSrc || img.src,
			width,
			height,
			status: imageState.processingSet.has(img)
				? "processing"
				: imageState.processed.has(img) &&
						imageState.processed.get(img) === (img.currentSrc || img.src)
					? "done"
					: "pending",
		});
	}

	return images;
}

async function sendOcrToHost(src: string, ocrData: OCRResult) {
	const img = findImageBySrc(src);
	if (!img) return;
	renderImageOverlay(img, ocrData);
}

async function removeOcrFromHost(src: string) {
	const img = findImageBySrc(src);
	if (!img) return;
	const overlay = imageState.overlayMap.get(img);
	if (overlay) clearOcrOverlays(overlay);
}

function requestSettings(): Promise<{
	enabled: boolean;
	enabledDomains: DomainPattern[];
}> {
	return new Promise((resolve) => {
		browser.runtime.sendMessage(
			{ type: "get-settings" },
			(response: { enabled: boolean; enabledDomains: DomainPattern[] }) => {
				resolve(response || { enabled: true, enabledDomains: [] });
			},
		);
	});
}

function getTranslateableImages(): HTMLImageElement[] {
	const results: HTMLImageElement[] = [];
	for (const img of Array.from(document.images)) {
		const width = img.naturalWidth || img.width || 0;
		const height = img.naturalHeight || img.height || 0;
		if (width < 30 || height < 30) continue;
		const style = getComputedStyle(img);
		if (
			style.display === "none" ||
			style.visibility === "hidden" ||
			style.opacity === "0"
		)
			continue;
		results.push(img);
	}
	return results;
}

function getTranslateableCanvases(): HTMLCanvasElement[] {
	const results: HTMLCanvasElement[] = [];
	for (const canvas of Array.from(document.querySelectorAll("canvas"))) {
		const width = canvas.width || 0;
		const height = canvas.height || 0;
		if (width < 30 || height < 30) continue;
		const style = getComputedStyle(canvas);
		if (
			style.display === "none" ||
			style.visibility === "hidden" ||
			style.opacity === "0"
		)
			continue;
		results.push(canvas);
	}
	return results;
}

async function autoTranslateIfAllowed() {
	const settings = await requestSettings();
	(
		window as unknown as { __extensionSettings: typeof settings }
	).__extensionSettings = settings;

	if (!settings.enabled) {
		stopLiveObserver(liveObserver);
		return;
	}

	const href = window.location.href;
	const isAllowed =
		settings.enabledDomains.length === 0 ||
		isUrlAllowed(href, settings.enabledDomains);

	if (!isAllowed) {
		stopLiveObserver(liveObserver);
		return;
	}

	for (const img of Array.from(getTranslateableImages())) {
		if (!imageState.processed.has(img)) {
			processNewImage(img);
		}
	}

	for (const canvas of Array.from(getTranslateableCanvases())) {
		if (!canvasState.processed.has(canvas)) {
			processNewCanvas(canvas);
		}
	}

	liveObserver = startLiveObserver(processNewImage, processNewCanvas);
}

let liveObserver: MutationObserver | null = null;

export default defineContentScript({
	matches: ["*://*.google.com/*"],
	main() {
		autoTranslateIfAllowed();

		startUrlPolling(autoTranslateIfAllowed);

		(
			window as unknown as {
				sendOcrToHost: typeof sendOcrToHost;
				removeOcrFromHost: typeof removeOcrFromHost;
			}
		).sendOcrToHost = sendOcrToHost;
		(
			window as unknown as { removeOcrFromHost: typeof removeOcrFromHost }
		).removeOcrFromHost = removeOcrFromHost;

		window.addEventListener("scroll", imageState.schedulePositionUpdate, true);
		window.addEventListener("resize", imageState.schedulePositionUpdate);
		window.addEventListener("scroll", canvasState.schedulePositionUpdate, true);
		window.addEventListener("resize", canvasState.schedulePositionUpdate);

		browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
			if (msg.type === "get-images") {
				sendResponse({ type: "images-list", images: collectImageInfo() });
				return true;
			}

			if (msg.type === "get-image-status") {
				sendResponse({ type: "image-status-list", images: collectImageInfo() });
				return true;
			}

			if (msg.type === "get-canvases") {
				sendResponse({ type: "canvas-list", canvases: collectCanvasInfo() });
				return true;
			}

			if (msg.type === "get-canvas-status") {
				sendResponse({
					type: "canvas-status-list",
					canvases: collectCanvasInfo(),
				});
				return true;
			}

			if (msg.type === "translate-images") {
				handleTranslateImages(msg.urls);
				return true;
			}

			if (msg.type === "translate-canvases") {
				handleTranslateCanvases(msg.indices);
				return true;
			}

			if (msg.type === "settings-changed") {
				autoTranslateIfAllowed();
				return true;
			}

			if (msg.type !== "translate") return;
			console.log("translate message received in content script", msg);
			const escapedUrl = msg.url.replace(/"/g, '\\"');
			for (const img of Array.from(document.images)) {
				if (img.currentSrc === escapedUrl || img.src === escapedUrl) {
					processNewImage(img);
				}
			}
		});
	},
});

async function handleTranslateImages(urls: string[]) {
	const total = urls.length;
	let successCount = 0;

	for (let i = 0; i < urls.length; i++) {
		const url = urls[i];
		const img = findImageBySrc(url);
		if (img) {
			processNewImage(img);
			successCount++;
		}

		if (i < total - 1) {
			browser.runtime.sendMessage<ProgressMessageType>({
				type: "translate-images-progress",
				url,
				index: i + 1,
				total,
				success: !!img,
				error: img ? undefined : "Image not found in DOM",
			});
		} else {
			browser.runtime.sendMessage<CompleteMessageType>({
				type: "translate-images-complete",
				total,
				successCount,
			});
		}
	}
}

async function handleTranslateCanvases(indices: number[]) {
	const total = indices.length;
	let successCount = 0;

	for (let i = 0; i < indices.length; i++) {
		const index = indices[i];
		const canvas = findCanvasByIndex(index);
		if (canvas) {
			processNewCanvas(canvas);
			successCount++;
		}

		if (i < total - 1) {
			browser.runtime.sendMessage<ProgressMessageType>({
				type: "translate-images-progress",
				url: `canvas:${index}`,
				index: i + 1,
				total,
				success: !!canvas,
				error: canvas ? undefined : "Canvas not found in DOM",
			});
		} else {
			browser.runtime.sendMessage<CompleteMessageType>({
				type: "translate-images-complete",
				total,
				successCount,
			});
		}
	}
}

function collectCanvasInfo(): {
	index: number;
	width: number;
	height: number;
	status: string;
}[] {
	const canvases: {
		index: number;
		width: number;
		height: number;
		status: string;
	}[] = [];

	for (let i = 0; i < document.querySelectorAll("canvas").length; i++) {
		const canvas = document.querySelectorAll("canvas")[i];
		const width = canvas.width || 0;
		const height = canvas.height || 0;
		if (width < 30 || height < 30) continue;
		const style = getComputedStyle(canvas);
		if (
			style.display === "none" ||
			style.visibility === "hidden" ||
			style.opacity === "0"
		)
			continue;
		canvases.push({
			index: i,
			width,
			height,
			status: canvasState.processingSet.has(canvas)
				? "processing"
				: canvasState.processed.has(canvas) &&
						canvasState.processed.get(canvas) === canvas.toDataURL()
					? "done"
					: "pending",
		});
	}

	return canvases;
}
