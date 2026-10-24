import type {
	AppMessage,
	CanvasInfoWithStatus,
	ImageInfoWithStatus,
	OCRRegion,
	OcrJobCompletedMessage,
	OcrJobFailedMessage,
	OcrJobStartedMessage,
	TranslateCompleteMessage,
	TranslateProgressMessage,
	TranslateRegionsMessage,
} from "@/types";
import { startLiveObserver, startUrlPolling } from "@/utils/dom-observer";
import { createElementState } from "@/utils/element-state";
import {
	getExtensionSettings,
	isUrlAllowedInSettings,
} from "@/utils/extension-settings";
import { processCanvas, processImage } from "@/utils/ocr-pipeline";
import {
	addOcrBoxes,
	clearOcrOverlays,
	getOrCreateOverlayContainer,
	removeOverlay,
	updateElementOverlayPosition,
} from "@/utils/overlay";
import { showToast } from "@/utils/toast";
import { setDefaultTargetLang } from "@/utils/translation-popup";

const imageState = createElementState<HTMLImageElement>();
const canvasState = createElementState<HTMLCanvasElement>();

/**
 * Resolves the status shown in the popup.
 *
 * Priority: in-flight processing wins over errors, an error wins over a
 * finished job, and an element is only "done" once its translated overlay
 * has actually been painted.
 */
function resolveElementStatus(
	isProcessing: boolean,
	hasError: boolean,
	isTranslated: boolean,
	isProcessed: boolean,
): ImageInfoWithStatus["status"] {
	if (isProcessing) return "processing";
	if (hasError) return "error";
	if (isTranslated) return "done";
	if (isProcessed) return "processing";
	return "pending";
}

function renderImageOverlay(img: HTMLImageElement, ocrRegions: OCRRegion[]) {
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
				ocrRegions,
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

	addOcrBoxes(overlay, img.naturalWidth, img.naturalHeight, ocrRegions);
	container.appendChild(overlay);
	imageState.overlayMap.set(img, overlay);
	updateElementOverlayPosition(img, overlay);

	imageState.resizeObserver.observe(img);
	imageState.schedulePositionUpdate();
}

function renderCanvasOverlay(
	canvas: HTMLCanvasElement,
	ocrRegions: OCRRegion[],
) {
	const canvasKey = readCanvasKey(canvas);

	if (
		canvasState.processed.has(canvas) &&
		canvasState.processed.get(canvas) === canvasKey
	) {
		const existingOverlay = canvasState.overlayMap.get(canvas);
		if (existingOverlay) {
			clearOcrOverlays(existingOverlay);
			addOcrBoxes(existingOverlay, canvas.width, canvas.height, ocrRegions);
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

	addOcrBoxes(overlay, canvas.width, canvas.height, ocrRegions);
	container.appendChild(overlay);
	canvasState.overlayMap.set(canvas, overlay);
	updateElementOverlayPosition(canvas, overlay);

	canvasState.resizeObserver.observe(canvas);
	canvasState.schedulePositionUpdate();
}

type TranslationOutcome = "translated" | "failed";

async function translateAndUpdateOverlay(
	ocrRegions: OCRRegion[],
	renderOverlay: (regions: OCRRegion[]) => void,
): Promise<TranslationOutcome> {
	try {
		console.log("[Content] sending translate/regions", {
			regionCount: ocrRegions.length,
		});
		const response = await browser.runtime.sendMessage({
			from: "content",
			to: "background",
			type: "translate/regions",
			regions: ocrRegions,
		} satisfies TranslateRegionsMessage);

		if (response?.success && response.regions) {
			console.log("[Content] translate/regions success", {
				regionCount: response.regions.length,
			});
			renderOverlay(response.regions);
			return "translated";
		}

		console.log("[Content] translate/regions failed", { response });
		return "failed";
	} catch (error) {
		console.error("[Content] Translation failed:", error);
		return "failed";
	}
}

function reportJobStarted(
	jobId: string | undefined,
	targetType: "image" | "canvas",
	target: string,
) {
	if (!jobId) return;
	browser.runtime
		.sendMessage({
			from: "content",
			to: "background",
			type: "ocr/job-started",
			jobId,
			targetType,
			target,
		} satisfies OcrJobStartedMessage)
		.catch(() => { });
}

function reportJobCompleted(jobId: string | undefined) {
	if (!jobId) return;
	browser.runtime
		.sendMessage({
			from: "content",
			to: "background",
			type: "ocr/job-completed",
			jobId,
		} satisfies OcrJobCompletedMessage)
		.catch(() => { });
}

function reportJobFailed(jobId: string | undefined, error?: string) {
	if (!jobId) return;
	browser.runtime
		.sendMessage({
			from: "content",
			to: "background",
			type: "ocr/job-failed",
			jobId,
			error,
		} satisfies OcrJobFailedMessage)
		.catch(() => { });
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

/**
 * Content key of a canvas. `toDataURL()` throws for canvases tainted by
 * cross-origin content, so fall back to an empty key in that case.
 */
function readCanvasKey(canvas: HTMLCanvasElement): string {
	try {
		return canvas.toDataURL();
	} catch {
		return "";
	}
}

function processNewImage(img: HTMLImageElement) {
	if (imageState.processingSet.has(img)) return;
	imageState.clearError(img);
	imageState.clearTranslated(img);
	imageState.processingSet.add(img);
	let translationStarted = false;
	processImage(
		img,
		(ocrData, jobId) => {
			translationStarted = true;
			renderImageOverlay(img, ocrData);
			observeImageSrc(img);
			reportJobStarted(jobId, "image", img.currentSrc || img.src);
			// Trigger translation after OCR completes. The element stays in the
			// processing set until the translated overlay has been painted.
			void settleImageAfterTranslation(img, ocrData, jobId);
		},
		() => {
			if (!translationStarted) {
				// OCR never produced a result — release the element.
				imageState.processingSet.delete(img);
			}
		},
		(error) => {
			const errorMsg = error instanceof Error ? error.message : error;
			imageState.processingSet.delete(img);
			imageState.setError(img, errorMsg);
			showToast(errorMsg, "error");
			browser.runtime
				.sendMessage({
					from: "content",
					to: "background",
					type: "extension/error",
					error: errorMsg,
				})
				.catch(() => { });
		},
	);
}

async function settleImageAfterTranslation(
	img: HTMLImageElement,
	ocrData: OCRRegion[],
	jobId: string | undefined,
) {
	const outcome = await translateAndUpdateOverlay(ocrData, (regions) =>
		renderImageOverlay(img, regions),
	);
	if (outcome === "translated") {
		if (document.contains(img)) {
			imageState.setTranslated(img, img.currentSrc || img.src);
		}
		reportJobCompleted(jobId);
	} else {
		if (document.contains(img)) {
			imageState.setError(img, "Translation failed");
		}
		reportJobFailed(jobId, "Translation failed");
	}
	imageState.processingSet.delete(img);
}

function processNewCanvas(canvas: HTMLCanvasElement) {
	if (canvasState.processingSet.has(canvas)) return;
	canvasState.clearError(canvas);
	canvasState.clearTranslated(canvas);
	canvasState.processingSet.add(canvas);
	let translationStarted = false;
	processCanvas(
		canvas,
		(ocrData, jobId) => {
			translationStarted = true;
			renderCanvasOverlay(canvas, ocrData);
			observeCanvasSize(canvas);
			reportJobStarted(
				jobId,
				"canvas",
				`canvas:${Array.from(document.querySelectorAll("canvas")).indexOf(canvas)}`,
			);
			// Trigger translation after OCR completes. The element stays in the
			// processing set until the translated overlay has been painted.
			void settleCanvasAfterTranslation(canvas, ocrData, jobId);
		},
		() => {
			if (!translationStarted) {
				// OCR never produced a result — release the element.
				canvasState.processingSet.delete(canvas);
			}
		},
		(error) => {
			const errorMsg = error instanceof Error ? error.message : error;
			canvasState.processingSet.delete(canvas);
			canvasState.setError(canvas, errorMsg);
			showToast(errorMsg, "error");
			browser.runtime
				.sendMessage({
					from: "content",
					to: "background",
					type: "extension/error",
					error: errorMsg,
				})
				.catch(() => { });
		},
	);
}

async function settleCanvasAfterTranslation(
	canvas: HTMLCanvasElement,
	ocrData: OCRRegion[],
	jobId: string | undefined,
) {
	const outcome = await translateAndUpdateOverlay(ocrData, (regions) =>
		renderCanvasOverlay(canvas, regions),
	);
	const attached = document.contains(canvas);
	if (outcome === "translated") {
		if (attached) {
			canvasState.setTranslated(canvas, readCanvasKey(canvas));
		}
		reportJobCompleted(jobId);
	} else {
		if (attached) {
			canvasState.setError(canvas, "Translation failed");
		}
		reportJobFailed(jobId, "Translation failed");
	}
	canvasState.processingSet.delete(canvas);
}

async function syncSettingsTargetLang() {
	try {
		const settings = await getExtensionSettings();
		setDefaultTargetLang(settings.targetLang || "vie_Latn");
	} catch {
		// keep previous default on failure
	}
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

let liveObserver: MutationObserver | null = null;

async function autoTranslateIfAllowed() {
	const settings = await getExtensionSettings();
	if (!settings.enabled) return;

	const tabUrl = window.location.href;
	if (!await isUrlAllowedInSettings(tabUrl)) return;

	if (liveObserver) {
		liveObserver.disconnect();
	}

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
		processNewImage(img);
	}

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
		processNewCanvas(canvas);
	}

	liveObserver = startLiveObserver(
		(img) => processNewImage(img),
		(canvas) => processNewCanvas(canvas),
	);
}

function collectImageInfo(): ImageInfoWithStatus[] {
	const images: ImageInfoWithStatus[] = [];

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
		const currentSrc = img.currentSrc || img.src;
		images.push({
			src: img.src,
			currentSrc,
			width,
			height,
			status: resolveElementStatus(
				imageState.processingSet.has(img),
				imageState.errorMap.has(img),
				imageState.hasTranslated(img, currentSrc),
				imageState.processed.has(img) &&
				imageState.processed.get(img) === currentSrc,
			),
		});
	}

	return images;
}

async function sendOcrToHost(src: string, ocrRegions: OCRRegion[]) {
	const img = findImageBySrc(src);
	if (!img) return;
	renderImageOverlay(img, ocrRegions);
	// Host-driven overlays are already final — mark them as translated so the
	// popup reports "Done" instead of "Translating...".
	imageState.setTranslated(img, img.currentSrc || img.src);
}

async function removeOcrFromHost(src: string) {
	const img = findImageBySrc(src);
	if (!img) return;
	const overlay = imageState.overlayMap.get(img);
	if (overlay) clearOcrOverlays(overlay);
}

interface ContextMenuContext {
	x: number;
	y: number;
	target: EventTarget | null;
	composedPath: EventTarget[];
}
export default defineContentScript({
	matches: ["<all_urls>"],
	allFrames: true,
	runAt: "document_idle",
	main() {
		console.log("Content script loaded for URL:", window.location.href);
		syncSettingsTargetLang();
		autoTranslateIfAllowed();

		const urlPolling = startUrlPolling(() => {
			autoTranslateIfAllowed();
		});
		urlPolling.start();

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
		window.addEventListener("resize", imageState.schedulePositionUpdate, true);
		window.addEventListener("scroll", canvasState.schedulePositionUpdate, true);
		window.addEventListener("resize", canvasState.schedulePositionUpdate, true);
		let currentContext: ContextMenuContext | null = null;

		document.addEventListener("contextmenu", (e) => {
			currentContext = {
				x: e.clientX,
				y: e.clientY,
				target: e.target,
				composedPath: e.composedPath(),
			};
		});

		browser.runtime.onMessage.addListener(
			(msg: AppMessage, _sender, sendResponse) => {
				switch (msg.type) {
					case "ui/get-images":
						sendResponse({
							type: "ui/images-list",
							images: collectImageInfo(),
						});
						return true;
					case "ui/get-image-status":
						sendResponse({
							type: "ui/image-status-list",
							images: collectImageInfo(),
						});
						return true;
					case "ui/get-canvases":
						sendResponse({
							type: "ui/canvas-list",
							canvases: collectCanvasInfo(),
						});
						return true;
					case "ui/get-canvas-status":
						sendResponse({
							type: "ui/canvas-status-list",
							canvases: collectCanvasInfo(),
						});
						return true;
					case "translate/images":
						handleTranslateImages(msg.urls, currentContext);
						return true;
					case "translate/canvases":
						handleTranslateCanvases(msg.indices);
						return true;
					case "settings/changed":
						autoTranslateIfAllowed();
						setDefaultTargetLang(msg.settings.targetLang || "vie_Latn");
						break;
					case "background/translate": {
						const escapedUrl = msg.url.replace(/"/g, '\\"');
						for (const img of Array.from(document.images)) {
							if (img.currentSrc === escapedUrl || img.src === escapedUrl) {
								processNewImage(img);
							}
						}
						break;
					}
				}
			},
		);
	},
});

async function handleTranslateImages(
	urls: string[],
	currentContext?: ContextMenuContext | null,
) {
	const total = urls.length;
	let successCount = 0;

	for (let i = 0; i < urls.length; i++) {
		const url = urls[i];
		const img = (() => {
			const contextElement = currentContext
				? (currentContext?.target ??
					document.elementsFromPoint(currentContext.x, currentContext.y)[0])
				: null;
			if (contextElement instanceof HTMLImageElement) {
				console.log(
					"we attempted to fetched context menu element",
					contextElement,
				);
				return contextElement;
			}
			return findImageBySrc(url);
		})();
		if (img) {
			processNewImage(img);
			successCount++;
		}

		if (i < total - 1) {
			browser.runtime.sendMessage({
				from: "content",
				to: "background",
				type: "translate/progress",
				url,
				index: i + 1,
				total,
				success: !!img,
				error: img ? undefined : "Image not found in DOM",
			} satisfies TranslateProgressMessage);
		} else {
			browser.runtime.sendMessage({
				from: "content",
				to: "background",
				type: "translate/complete",
				total,
				successCount,
			} satisfies TranslateCompleteMessage);
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
			browser.runtime.sendMessage({
				from: "content",
				to: "background",
				type: "translate/progress",
				url: `canvas:${index}`,
				index: i + 1,
				total,
				success: !!canvas,
				error: canvas ? undefined : "Canvas not found in DOM",
			} satisfies TranslateProgressMessage);
		} else {
			browser.runtime.sendMessage({
				from: "content",
				to: "background",
				type: "translate/complete",
				total,
				successCount,
			} satisfies TranslateCompleteMessage);
		}
	}
}

function collectCanvasInfo(): CanvasInfoWithStatus[] {
	const canvases: CanvasInfoWithStatus[] = [];

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
		const canvasKey = readCanvasKey(canvas);
		canvases.push({
			index: i,
			width,
			height,
			status: resolveElementStatus(
				canvasState.processingSet.has(canvas),
				canvasState.errorMap.has(canvas),
				canvasState.hasTranslated(canvas, canvasKey),
				canvasState.processed.has(canvas) &&
				canvasState.processed.get(canvas) === canvasKey,
			),
		});
	}

	return canvases;
}
