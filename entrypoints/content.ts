// content.js
import type {
  InternalMessageType,
  OCRResult,
  ProgressMessageType,
  CompleteMessageType,
  DomainPattern,
} from "@/types";
import { isUrlAllowed } from "@/utils/domain-matcher";
import ResizeObserverPolyfill from 'resize-observer-polyfill'

if (typeof window !== 'undefined' && !window.ResizeObserver) {
  window.ResizeObserver = ResizeObserverPolyfill;
}
// Pick the best URL to fetch for OCR, preferring the highest-quality srcset
// candidate. Candidates are scored by intrinsic width ("480w") or density
// ("2x"); the plain src/currentSrc is used as the fallback.
function resolveBestImageUrl(img: HTMLImageElement): string {
  const srcset = img.getAttribute("srcset");
  if (srcset) {
    const baseWidth = img.naturalWidth || img.width || 1;
    let bestUrl: string | null = null;
    let bestScore = -Infinity;

    for (const candidate of srcset.split(",")) {
      const trimmed = candidate.trim();
      if (!trimmed) continue;

      const match = trimmed.match(
        /^(\S+)\s*(?:(\d+)w|(\d*(?:\.\d+)?)x)?\s*$/i,
      );
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

async function sendImageToBackground(img: HTMLImageElement | null) {
  if (!img || !(img instanceof HTMLImageElement))
    return console.error("Image not found");
  if (processingImages.has(img)) return;
  processingImages.add(img);

  try {
    let base64 = await tryCanvasBase64(img);
    if (base64) {
      await sendOcrWithBase64(img, base64);
      return;
    }

    const imageUrl = resolveBestImageUrl(img);
    base64 = await tryFetchBase64(imageUrl);
    if (base64) {
      await sendOcrWithBase64(img, base64);
      return;
    }

    const bgResponse =
      await browser.runtime.sendMessage<InternalMessageType>({
        action: "PROCESS_OCR",
        fetchingType: "url",
        imageData: imageUrl,
        headers: {
          "User-Agent": navigator.userAgent,
          Accept:
            "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          "Accept-Language": navigator.language,
          Referer: window.location.href,
        },
      });

    if (bgResponse && bgResponse.success) {
      renderOcrOverlays(img, bgResponse.ocrData);
    }
  } catch (error) {
    console.error("Failed to extract or pass image text:", error);
  } finally {
    processingImages.delete(img);
  }
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

async function sendOcrWithBase64(img: HTMLImageElement, base64: string) {
  const bgResponse = await browser.runtime.sendMessage<InternalMessageType>({
    action: "PROCESS_OCR",
    fetchingType: "base64",
    imageData: base64,
  });

  if (bgResponse && bgResponse.success) {
    renderOcrOverlays(img, bgResponse.ocrData);
  }
}

// Strong (non-weak) maps so we can iterate and fully control cleanup.
const processedImages = new Map<HTMLImageElement, string>();
const imageOverlayMap = new Map<HTMLImageElement, HTMLElement>();
const imageMutationMap = new Map<HTMLImageElement, MutationObserver>();
const processingImages = new Set<HTMLImageElement>();

const processedCanvases = new Map<HTMLCanvasElement, string>();
const canvasOverlayMap = new Map<HTMLCanvasElement, HTMLElement>();
const canvasMutationMap = new Map<HTMLCanvasElement, MutationObserver>();
const processingCanvases = new Set<HTMLCanvasElement>();
const canvasResizeObserver = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const canvas = entry.target as HTMLCanvasElement;
    const overlay = canvasOverlayMap.get(canvas);
    if (overlay) updateCanvasOverlayPosition(canvas, overlay);
  }
});

// Re-position overlays when an image's rendered size changes for any reason
// (sidebar toggle, flex reflow, CSS scale), independent of window resize/scroll.
const imageResizeObserver = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const img = entry.target as HTMLImageElement;
    const overlay = imageOverlayMap.get(img);
    if (overlay) updateOverlayPosition(img, overlay);
  }
});

// Clean up all bookkeeping + DOM for an image (used when it leaves the DOM or
// when its src is swapped and we want to drop the stale overlay).
function resetImageState(img: HTMLImageElement) {
  const overlay = imageOverlayMap.get(img);
  if (overlay) overlay.remove();
  imageOverlayMap.delete(img);
  processedImages.delete(img);
  imageResizeObserver.unobserve(img);
  const mo = imageMutationMap.get(img);
  if (mo) {
    mo.disconnect();
    imageMutationMap.delete(img);
  }
}

// Detect when a website swaps an image's src/srcset on the *same* element so we
// can drop the stale overlay and re-run OCR instead of keeping A's text on B.
function observeImageSrc(img: HTMLImageElement) {
  if (imageMutationMap.has(img)) return;
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (
        record.attributeName === "src" ||
        record.attributeName === "srcset"
      ) {
        resetImageState(img);
        sendImageToBackground(img);
        break;
      }
    }
  });
  observer.observe(img, {
    attributes: true,
    attributeFilter: ["src", "srcset"],
  });
  imageMutationMap.set(img, observer);
}

function getOrCreateOverlayContainer(): HTMLElement {
  let container = document.getElementById("ocr-overlay-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "ocr-overlay-container";
    container.style.cssText =
      "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;overflow:hidden;";
    document.body.appendChild(container);
  }
  return container;
}

function updateOverlayPosition(
  img: HTMLImageElement,
  overlay: HTMLElement,
) {
  const rect = img.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    overlay.style.display = "none";
  } else {
    const style = getComputedStyle(img);
    overlay.style.display = "";
    overlay.style.top = `${rect.top}px`;
    overlay.style.left = `${rect.left}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
    overlay.style.transform = style.transform;
    overlay.style.transformOrigin = style.transformOrigin;
  }
}

let positionUpdateScheduled = false;

function schedulePositionUpdate() {
  if (positionUpdateScheduled) return;
  positionUpdateScheduled = true;
  requestAnimationFrame(() => {
    positionUpdateScheduled = false;
    const toRemove: HTMLImageElement[] = [];
    for (const [img, overlay] of imageOverlayMap.entries()) {
      if (!document.contains(img)) {
        toRemove.push(img);
      } else {
        updateOverlayPosition(img, overlay);
      }
    }
    toRemove.forEach((img) => {
      resetImageState(img);
    });
  });
}

function clearOcrOverlays(overlay: HTMLElement) {
  while (overlay.firstChild) {
    overlay.removeChild(overlay.firstChild);
  }
}

function addOcrBoxes(
  overlay: HTMLElement,
  img: HTMLImageElement,
  ocrData: OCRResult,
) {
  ocrData.forEach((box) => {
    const fontSize = Math.max(
      10,
      ((Math.min(box.height, box.width) * box.width) / img.naturalWidth) *
      0.7,
    );
    const boxDiv = document.createElement("div");
    boxDiv.style.pointerEvents = "auto";
    boxDiv.innerText = box.text;
    boxDiv.style.position = "absolute";
    boxDiv.style.top = `${(box.top / img.naturalHeight) * 100}%`;
    boxDiv.style.left = `${(box.left / img.naturalWidth) * 100}%`;
    boxDiv.style.width = `${(box.width / img.naturalWidth) * 100}%`;
    boxDiv.style.height = `${(box.height / img.naturalHeight) * 100}%`;
    boxDiv.style.border = "2px dashed #00ff00";
    boxDiv.style.backgroundColor = "rgba(255, 255, 255, 1)";
    boxDiv.style.color = "#00ff00";
    boxDiv.style.textAlign = "center";
    boxDiv.style.display = "flex";
    boxDiv.style.alignItems = "center";
    boxDiv.style.justifyContent = "center";
    boxDiv.style.fontSize = `${fontSize}px`;
    boxDiv.style.whiteSpace = "nowrap";
    boxDiv.style.textOverflow = "ellipsis";
    overlay.appendChild(boxDiv);
  });
}

function renderOcrOverlays(img: HTMLImageElement, ocrData: OCRResult) {
  const currentSrc = img.currentSrc || img.src;

  if (processedImages.has(img) && processedImages.get(img) === currentSrc) {
    const existingOverlay = imageOverlayMap.get(img);
    if (existingOverlay) {
      clearOcrOverlays(existingOverlay);
      addOcrBoxes(existingOverlay, img, ocrData);
      updateOverlayPosition(img, existingOverlay);
    }
    return;
  }

  // src changed (or first render): drop any stale overlay from the previous
  // image before creating a new one so we don't leak the old DOM node.
  const oldOverlay = imageOverlayMap.get(img);
  if (oldOverlay) oldOverlay.remove();
  imageOverlayMap.delete(img);

  processedImages.set(img, currentSrc);

  const container = getOrCreateOverlayContainer();
  const overlay = document.createElement("div");
  overlay.style.position = "absolute";
  overlay.style.pointerEvents = "none";

  addOcrBoxes(overlay, img, ocrData);
  container.appendChild(overlay);
  imageOverlayMap.set(img, overlay);
  updateOverlayPosition(img, overlay);

  imageResizeObserver.observe(img);
  observeImageSrc(img);
}

function findImageBySrc(src: string): HTMLImageElement | null {
  for (const img of document.images) {
    if (img.currentSrc === src || img.src === src) return img;
  }
  return null;
}

function sendOcrToHost(src: string, ocrData: OCRResult) {
  const img = findImageBySrc(src);
  if (!img) return;
  renderOcrOverlays(img, ocrData);
}

function removeOcrFromHost(src: string) {
  const img = findImageBySrc(src);
  if (!img) return;
  const overlay = imageOverlayMap.get(img);
  if (overlay) clearOcrOverlays(overlay);
}

function collectImageInfo(): {
  src: string;
  currentSrc: string;
  width: number;
  height: number;
  status: string;
}[] {
  const images: {
    src: string;
    currentSrc: string;
    width: number;
    height: number;
    status: string;
  }[] = [];
  for (const img of document.images) {
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
      status: processingImages.has(img)
        ? "processing"
        : processedImages.has(img) &&
          processedImages.get(img) === (img.currentSrc || img.src)
          ? "done"
          : "pending",
    });
  }
  return images;
}

async function handleTranslateImages(urls: string[]) {
  const total = urls.length;
  let successCount = 0;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const img = findImageBySrc(url);
    if (img) {
      if (processingImages.has(img)) continue;
      processingImages.add(img);
      try {
        await sendImageToBackground(img);
        successCount++;
      } catch (err) {
        console.error(`Failed to translate image ${url}:`, err);
      } finally {
        processingImages.delete(img);
      }
    }

    if (i < total - 1) {
      browser.runtime.sendMessage<ProgressMessageType>({
        type: "translate-images-progress",
        url,
        index: i + 1,
        total,
        success: img ? true : false,
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
      status: processingCanvases.has(canvas)
        ? "processing"
        : processedCanvases.has(canvas) &&
          processedCanvases.get(canvas) === canvas.toDataURL()
          ? "done"
          : "pending",
    });
  }
  return canvases;
}

async function sendCanvasToBackground(canvas: HTMLCanvasElement) {
  if (processingCanvases.has(canvas)) return;
  processingCanvases.add(canvas);
  try {
    const base64 = canvas.toDataURL("image/png");
    const bgResponse =
      await browser.runtime.sendMessage<InternalMessageType>({
        action: "PROCESS_OCR",
        fetchingType: "base64",
        imageData: base64,
      });
    if (bgResponse && bgResponse.success) {
      renderCanvasOcrOverlays(canvas, bgResponse.ocrData);
    }
  } catch (error) {
    console.error("Failed to translate canvas:", error);
  } finally {
    processingCanvases.delete(canvas);
  }
}

function resetCanvasState(canvas: HTMLCanvasElement) {
  const overlay = canvasOverlayMap.get(canvas);
  if (overlay) overlay.remove();
  canvasOverlayMap.delete(canvas);
  processedCanvases.delete(canvas);
  canvasResizeObserver.unobserve(canvas);
  const mo = canvasMutationMap.get(canvas);
  if (mo) {
    mo.disconnect();
    canvasMutationMap.delete(canvas);
  }
}

function observeCanvasSize(canvas: HTMLCanvasElement) {
  if (canvasMutationMap.has(canvas)) return;
  const observer = new MutationObserver(() => {
    resetCanvasState(canvas);
    sendCanvasToBackground(canvas);
  });
  observer.observe(canvas, {
    attributes: true,
    attributeFilter: ["width", "height"],
  });
  canvasMutationMap.set(canvas, observer);
}

function updateCanvasOverlayPosition(
  canvas: HTMLCanvasElement,
  overlay: HTMLElement,
) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    overlay.style.display = "none";
  } else {
    const style = getComputedStyle(canvas);
    overlay.style.display = "";
    overlay.style.top = `${rect.top}px`;
    overlay.style.left = `${rect.left}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
    overlay.style.transform = style.transform;
    overlay.style.transformOrigin = style.transformOrigin;
  }
}

let canvasPositionUpdateScheduled = false;
function scheduleCanvasPositionUpdate() {
  if (canvasPositionUpdateScheduled) return;
  canvasPositionUpdateScheduled = true;
  requestAnimationFrame(() => {
    canvasPositionUpdateScheduled = false;
    const toRemove: HTMLCanvasElement[] = [];
    for (const [canvas, overlay] of canvasOverlayMap.entries()) {
      if (!document.contains(canvas)) {
        toRemove.push(canvas);
      } else {
        updateCanvasOverlayPosition(canvas, overlay);
      }
    }
    toRemove.forEach((canvas) => {
      resetCanvasState(canvas);
    });
  });
}

function addOcrBoxesForCanvas(
  overlay: HTMLElement,
  canvas: HTMLCanvasElement,
  ocrData: OCRResult,
) {
  ocrData.forEach((box) => {
    const fontSize = Math.max(
      10,
      ((Math.min(box.height, box.width) * box.width) / canvas.width) * 0.7,
    );
    const boxDiv = document.createElement("div");
    boxDiv.style.pointerEvents = "auto";
    boxDiv.innerText = box.text;
    boxDiv.style.position = "absolute";
    boxDiv.style.top = `${(box.top / canvas.height) * 100}%`;
    boxDiv.style.left = `${(box.left / canvas.width) * 100}%`;
    boxDiv.style.width = `${(box.width / canvas.width) * 100}%`;
    boxDiv.style.height = `${(box.height / canvas.height) * 100}%`;
    boxDiv.style.border = "2px dashed #00ff00";
    boxDiv.style.backgroundColor = "rgba(255, 255, 255, 1)";
    boxDiv.style.color = "#00ff00";
    boxDiv.style.textAlign = "center";
    boxDiv.style.display = "flex";
    boxDiv.style.alignItems = "center";
    boxDiv.style.justifyContent = "center";
    boxDiv.style.fontSize = `${fontSize}px`;
    boxDiv.style.whiteSpace = "nowrap";
    boxDiv.style.textOverflow = "ellipsis";
    overlay.appendChild(boxDiv);
  });
}

function renderCanvasOcrOverlays(
  canvas: HTMLCanvasElement,
  ocrData: OCRResult,
) {
  const canvasKey = canvas.toDataURL();

  if (
    processedCanvases.has(canvas) &&
    processedCanvases.get(canvas) === canvasKey
  ) {
    const existingOverlay = canvasOverlayMap.get(canvas);
    if (existingOverlay) {
      clearOcrOverlays(existingOverlay);
      addOcrBoxesForCanvas(existingOverlay, canvas, ocrData);
      updateCanvasOverlayPosition(canvas, existingOverlay);
    }
    return;
  }

  const oldOverlay = canvasOverlayMap.get(canvas);
  if (oldOverlay) oldOverlay.remove();
  canvasOverlayMap.delete(canvas);

  processedCanvases.set(canvas, canvasKey);

  const container = getOrCreateOverlayContainer();
  const overlay = document.createElement("div");
  overlay.style.position = "absolute";
  overlay.style.pointerEvents = "none";

  addOcrBoxesForCanvas(overlay, canvas, ocrData);
  container.appendChild(overlay);
  canvasOverlayMap.set(canvas, overlay);
  updateCanvasOverlayPosition(canvas, overlay);

  canvasResizeObserver.observe(canvas);
  observeCanvasSize(canvas);
}

function findCanvasByIndex(index: number): HTMLCanvasElement | null {
  const canvases = document.querySelectorAll("canvas");
  return canvases[index] || null;
}

async function handleTranslateCanvases(indices: number[]) {
  const total = indices.length;
  let successCount = 0;

  for (let i = 0; i < indices.length; i++) {
    const index = indices[i];
    const canvas = findCanvasByIndex(index);
    if (canvas) {
      if (processingCanvases.has(canvas)) continue;
      processingCanvases.add(canvas);
      try {
        await sendCanvasToBackground(canvas);
        successCount++;
      } catch (err) {
        console.error(`Failed to translate canvas ${index}:`, err);
      } finally {
        processingCanvases.delete(canvas);
      }
    }

    if (i < total - 1) {
      browser.runtime.sendMessage<ProgressMessageType>({
        type: "translate-images-progress",
        url: `canvas:${index}`,
        index: i + 1,
        total,
        success: canvas ? true : false,
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

let liveObserver: MutationObserver | null = null;
function handleAddedNodes(node: Node) {
  if (node instanceof HTMLImageElement) {
    const width = node.naturalWidth || node.width || 0;
    const height = node.naturalHeight || node.height || 0;
    if (width >= 30 && height >= 30) {
      const style = getComputedStyle(node);
      if (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0"
      ) {
        if (!processedImages.has(node)) {
          sendImageToBackground(node);
        }
      }
    }
  } else if (node instanceof HTMLCanvasElement) {
    const width = node.width || 0;
    const height = node.height || 0;
    if (width >= 30 && height >= 30) {
      if (!processedCanvases.has(node)) {
        sendCanvasToBackground(node);
      }
    }
  } else if (node instanceof Element) {
    for (const img of node.querySelectorAll("img")) {
      const width = img.naturalWidth || img.width || 0;
      const height = img.naturalHeight || img.height || 0;
      if (width >= 30 && height >= 30) {
        const style = getComputedStyle(img);
        if (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          style.opacity !== "0"
        ) {
          if (!processedImages.has(img)) {
            sendImageToBackground(img);
          }
        }
      }
    }
    for (const canvas of node.querySelectorAll("canvas")) {
      const width = canvas.width || 0;
      const height = canvas.height || 0;
      if (width >= 30 && height >= 30) {
        if (!processedCanvases.has(canvas)) {
          sendCanvasToBackground(canvas);
        }
      }
    }
  }
}

function startLiveObserver() {
  if (liveObserver) return;
  liveObserver = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        handleAddedNodes(node);
      }
    }
  });
  liveObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

function stopLiveObserver() {
  if (liveObserver) {
    liveObserver.disconnect();
    liveObserver = null;
  }
}

function requestSettings(): Promise<{
  enabled: boolean;
  enabledDomains: DomainPattern[];
}> {
  return new Promise((resolve) => {
    browser.runtime.sendMessage(
      { type: "get-settings" },
      (response: any) => {
        resolve(response || { enabled: true, enabledDomains: [] });
      },
    );
  });
}

async function autoTranslateIfAllowed() {
  const settings = await requestSettings();
  (
    window as unknown as { __extensionSettings: typeof settings }
  ).__extensionSettings = settings;

  if (!settings.enabled) {
    stopLiveObserver();
    return;
  }

  const href = window.location.href;
  const isAllowed =
    settings.enabledDomains.length === 0 ||
    isUrlAllowed(href, settings.enabledDomains);

  if (!isAllowed) {
    stopLiveObserver();
    return;
  }

  for (const img of document.images) {
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
    if (!processedImages.has(img)) {
      sendImageToBackground(img);
    }
  }

  for (const canvas of document.querySelectorAll("canvas")) {
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
    if (!processedCanvases.has(canvas)) {
      sendCanvasToBackground(canvas);
    }
  }

  startLiveObserver();
}


export default defineContentScript({
  matches: ["*://*.google.com/*"],
  main() {
    autoTranslateIfAllowed();

    // SPA URL polling: detect pushState / hash changes and re-run auto-translate
    let __lastHref = window.location.href;
    let __urlPollIntervalId: number | null = null;
    function startUrlPolling() {
      if (__urlPollIntervalId !== null) return;
      __urlPollIntervalId = window.setInterval(() => {
        try {
          const current = window.location.href;
          if (current !== __lastHref) {
            __lastHref = current;
            // debounce briefly to avoid thrash when multiple changes happen quickly
            setTimeout(() => autoTranslateIfAllowed(), 50);
          }
        } catch (e) {
          // ignore
        }
      }, 500);
    }

    startUrlPolling();
    (
      window as unknown as {
        sendOcrToHost: typeof sendOcrToHost;
        removeOcrFromHost: typeof removeOcrFromHost;
      }
    ).sendOcrToHost = sendOcrToHost;
    (
      window as unknown as { removeOcrFromHost: typeof removeOcrFromHost }
    ).removeOcrFromHost = removeOcrFromHost;

    window.addEventListener("scroll", schedulePositionUpdate, true);
    window.addEventListener("resize", schedulePositionUpdate);
    window.addEventListener("scroll", scheduleCanvasPositionUpdate, true);
    window.addEventListener("resize", scheduleCanvasPositionUpdate);

    browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.type === "get-images") {
        const images = collectImageInfo();
        sendResponse({ type: "images-list", images });
        return true;
      }

      if (msg.type === "get-image-status") {
        const images = collectImageInfo();
        sendResponse({ type: "image-status-list", images });
        return true;
      }

      if (msg.type === "get-canvases") {
        const canvases = collectCanvasInfo();
        sendResponse({ type: "canvas-list", canvases });
        return true;
      }

      if (msg.type === "get-canvas-status") {
        const canvases = collectCanvasInfo();
        sendResponse({ type: "canvas-status-list", canvases });
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
      Array.from(document.images)
        .filter(
          (img) => img.currentSrc === escapedUrl || img.src === escapedUrl,
        )
        .forEach((img) => {
          sendImageToBackground(img);
        });
    });
  },
});