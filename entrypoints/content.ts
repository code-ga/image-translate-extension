import type {
	AppMessage,
	CanvasInfoWithStatus,
	ImageInfoWithStatus,
	OCRRegion,
	TranslateCompleteMessage,
	TranslateProgressMessage,
} from "@/types";
import { startLiveObserver, startUrlPolling } from "@/utils/dom-observer";
import { createElementState } from "@/utils/element-state";
import {
	getExtensionSettings,
	isUrlAllowedInSettings,
} from "@/utils/extension-settings";
import { getCachedOcr, storeCachedOcr } from "@/utils/ocr-cache";
import {
	processCanvas,
	processImage,
	registerOcrResultListener,
	resolveBestImageUrl,
} from "@/utils/ocr-pipeline";
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

function renderImageOverlay(
	img: HTMLImageElement,
	ocrRegions: OCRRegion[],
): boolean {
	const currentSrc = img.currentSrc || img.src;
	const oldOverlay = imageState.overlayMap.get(img);
	if (oldOverlay) removeOverlay(oldOverlay);
	imageState.overlayMap.delete(img);

	if (ocrRegions.length === 0) {
		imageState.processed.delete(img);
		imageState.resizeObserver.unobserve(img);
		return false;
	}

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
		return true;
	}

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
	return true;
}

function renderCanvasOverlay(
	canvas: HTMLCanvasElement,
	ocrRegions: OCRRegion[],
): boolean {
	const canvasKey = canvas.toDataURL();
	const oldOverlay = canvasState.overlayMap.get(canvas);
	if (oldOverlay) removeOverlay(oldOverlay);
	canvasState.overlayMap.delete(canvas);

	if (ocrRegions.length === 0) {
		canvasState.processed.delete(canvas);
		canvasState.resizeObserver.unobserve(canvas);
		return false;
	}

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
		return true;
	}

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
	return true;
}

const IMAGE_SOURCE_ATTRIBUTES = [
	"src",
	"srcset",
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
const imageGenerations = new WeakMap<HTMLImageElement, number>();

function getImageLogContext(img: HTMLImageElement, source: string) {
	return {
		source,
		currentSrc: img.currentSrc,
		src: img.src,
		complete: img.complete,
		naturalWidth: img.naturalWidth,
		naturalHeight: img.naturalHeight,
		page: window.location.href,
	};
}

function getErrorMessage(error: unknown, fallback: string): string {
	if (error instanceof Error && error.message) return error.message;
	if (typeof error === "string" && error) return error;
	return fallback;
}

function serializeError(error: unknown) {
	if (error instanceof Error) {
		return {
			name: error.name,
			message: error.message,
			stack: error.stack,
		};
	}
	return { value: String(error) };
}

function isImageCandidate(img: HTMLImageElement): boolean {
	const width = img.naturalWidth || img.width || 0;
	const height = img.naturalHeight || img.height || 0;
	if (width < 30 || height < 30) return false;
	const style = getComputedStyle(img);
	return (
		style.display !== "none" &&
		style.visibility !== "hidden" &&
		style.opacity !== "0"
	);
}

function watchImageSource(img: HTMLImageElement) {
	imageState.observeElementAttributes(img, IMAGE_SOURCE_ATTRIBUTES, () => {
		processNewImage(img);
	});
	imageState.observeElementEvents(img, ["load", "error"], (event) => {
		if (event.type === "error") {
			const source = resolveBestImageUrl(img);
			console.warn("[image-translate] Image load failed", {
				...getImageLogContext(img, source),
				error: { type: event.type, target: event.target },
			});
		}
		processNewImage(img);
	});
}

function isCurrentImageAttempt(
	img: HTMLImageElement,
	generation: number,
	source: string,
): boolean {
	return (
		imageGenerations.get(img) === generation &&
		resolveBestImageUrl(img) === source
	);
}

function reportImageError(
	img: HTMLImageElement,
	source: string,
	stage: string,
	error: unknown,
) {
	const message = getErrorMessage(error, "Image processing failed");
	const context = {
		...getImageLogContext(img, source),
		stage,
		error: serializeError(error),
	};
	console.error("[image-translate] Image processing failed", context);
	showToast(`OCR failed for ${source}: ${message}`, "error");
	browser.runtime
		.sendMessage({
			from: "content",
			to: "background",
			type: "extension/error",
			error: `OCR failed for ${source}: ${message}`,
			context,
		})
		.catch(() => {});
}

function observeImageSrc(img: HTMLImageElement) {
	watchImageSource(img);
}
async function processNewImage(img: HTMLImageElement) {
	watchImageSource(img);
	if (!isImageCandidate(img)) return;

	const source = resolveBestImageUrl(img);
	if (!source) {
		console.info("[image-translate] Waiting for an image source", {
			...getImageLogContext(img, source),
		});
		return;
	}
	if (imageState.processingSet.has(img)) return;

	const generation = (imageGenerations.get(img) || 0) + 1;
	imageGenerations.set(img, generation);
	imageState.processingSet.add(img);

	const cached = await getCachedOcr(source);
	if (cached) {
		imageState.processingSet.delete(img);
		console.info("[image-translate] OCR cache hit", {
			...getImageLogContext(img, source),
			generation,
		});
		if (isCurrentImageAttempt(img, generation, source)) {
			renderImageOverlay(img, cached);
			observeImageSrc(img);
		}
		return;
	}

	console.info("[image-translate] Processing image", {
		...getImageLogContext(img, source),
		generation,
	});

	processImage(
		img,
		(ocrData) => {
			if (!isCurrentImageAttempt(img, generation, source)) {
				console.warn("[image-translate] Ignoring stale OCR result", {
					...getImageLogContext(img, source),
					generation,
				});
				return;
			}
			const hasRegions = renderImageOverlay(img, ocrData);
			if (ocrData.length > 0) {
				storeCachedOcr(source, ocrData);
			}
			observeImageSrc(img);
			if (!hasRegions) {
				console.info("[image-translate] OCR found no text regions", {
					...getImageLogContext(img, source),
					generation,
				});
			}
		},
		(error) => {
			if (imageGenerations.get(img) === generation) {
				imageState.processingSet.delete(img);
			}
			if (!isCurrentImageAttempt(img, generation, source)) return;
			reportImageError(img, source, "ocr", error);
		},
	);
}

function observeCanvasSize(canvas: HTMLCanvasElement) {
	canvasState.observeElementAttributes(canvas, ["width", "height"], () => {
		processNewCanvas(canvas);
	});
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
		(error) => {
			const message = error instanceof Error ? error.message : String(error);
			const context = {
				width: canvas.width,
				height: canvas.height,
				stage: "canvas-ocr",
				error: serializeError(error),
			};
			console.error("[image-translate] Canvas processing failed", context);
			showToast(
				`OCR failed for canvas ${canvas.width}x${canvas.height}: ${message}`,
				"error",
			);
			browser.runtime
				.sendMessage({
					from: "content",
					to: "background",
					type: "extension/error",
					error: `OCR failed for canvas ${canvas.width}x${canvas.height}: ${message}`,
					context,
				})
				.catch(() => {});
		},
	);
}

async function syncSettingsTargetLang() {
	try {
		const settings = await getExtensionSettings();
		setDefaultTargetLang(settings.targetLang || "vi");
	} catch (error) {
		console.error("[image-translate] Failed to sync target language", {
			error: serializeError(error),
		});
	}
}

function findImageBySrc(src: string): HTMLImageElement | null {
	for (const img of Array.from(document.images)) {
		if (
			img.currentSrc === src ||
			img.src === src ||
			IMAGE_SOURCE_ATTRIBUTES.some(
				(attribute) => img.getAttribute(attribute) === src,
			)
		)
			return img;
	}
	return null;
}

function findCanvasByIndex(index: number): HTMLCanvasElement | null {
	const canvases = document.querySelectorAll("canvas");
	return canvases[index] || null;
}

let liveObserver: MutationObserver | null = null;

function runAutoTranslate() {
	autoTranslateIfAllowed().catch((error) => {
		const message = error instanceof Error ? error.message : String(error);
		console.error("[image-translate] Auto-translate failed", {
			page: window.location.href,
			error: serializeError(error),
		});
		showToast(`Auto-translate failed: ${message}`, "error");
	});
}

async function autoTranslateIfAllowed() {
	const settings = await getExtensionSettings();
	if (!settings.enabled) return;

	const tabUrl = window.location.href;
	if (!isUrlAllowedInSettings(tabUrl)) return;

	if (liveObserver) {
		liveObserver.disconnect();
	}

	imageState.resetAll();
	canvasState.resetAll();

	const totalImages = Array.from(document.images).length;
	const eligibleImages = Array.from(document.images).filter((img) => {
		const w = img.naturalWidth || img.width || 0;
		const h = img.naturalHeight || img.height || 0;
		if (w < 30 || h < 30) return false;
		const s = getComputedStyle(img);
		return (
			s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0"
		);
	}).length;
	console.info("[image-translate] Auto-translate starting", {
		url: window.location.href,
		totalImages,
		eligibleImages,
	});

	for (const img of Array.from(document.images)) {
		watchImageSource(img);
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

	console.info("[image-translate] Auto-translate starting", {
		totalCanvases: document.querySelectorAll("canvas").length,
	});

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

async function sendOcrToHost(src: string, ocrRegions: OCRRegion[]) {
	const img = findImageBySrc(src);
	if (!img) return;
	renderImageOverlay(img, ocrRegions);
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
		registerOcrResultListener();
		runAutoTranslate();
		syncSettingsTargetLang();

		const urlPolling = startUrlPolling(() => {
			runAutoTranslate();
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
						runAutoTranslate();
						setDefaultTargetLang(msg.settings.targetLang || "vi");
						break;
					case "background/translate": {
						for (const img of Array.from(document.images)) {
							const lazySrc = img.getAttribute("data-src");
							if (
								img.currentSrc === msg.url ||
								img.src === msg.url ||
								lazySrc === msg.url
							) {
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
				console.info("[image-translate] Context menu image selected", {
					source: contextElement.currentSrc || contextElement.src,
				});
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
