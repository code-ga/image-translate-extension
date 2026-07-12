// content.js

import type { InternalMessageType, OCRResult } from "./types";

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

async function sendImageToBackground(img: HTMLImageElement | null) {
  if (!img || !(img instanceof HTMLImageElement)) return console.error("Image not found");

  try {
    let base64 = await tryCanvasBase64(img);
    if (base64) return sendOcrWithBase64(img, base64);

    const imageUrl = resolveBestImageUrl(img);
    base64 = await tryFetchBase64(imageUrl);
    if (base64) return sendOcrWithBase64(img, base64);

    const bgResponse = await chrome.runtime.sendMessage<InternalMessageType>({
      action: "PROCESS_OCR",
      fetchingType: "url",
      imageData: imageUrl,
      headers: {
        "User-Agent": navigator.userAgent,
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": navigator.language,
        "Referer": window.location.href,
      }
    });

    if (bgResponse && bgResponse.success) {
      renderOcrOverlays(img, bgResponse.ocrData);
    }
  } catch (error) {
    console.error("Failed to extract or pass image text:", error);
  }
}

function tryCanvasBase64(img: HTMLImageElement): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    try {
      const isCrossOrigin = new URL(img.srcset || img.src).origin !== window.location.origin;
      if (isCrossOrigin) {
        console.warn("Image is cross-origin, attempting to fetch and convert to base64 instead of using canvas.");
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
      console.error("Error occurred while trying to create base64 from canvas:", err);
      resolve(null);
    }
  });
}

function tryFetchBase64(src: string): Promise<string | null> {
  return fetch(src)
    .then(res => {
      if (!res.ok) throw new Error(res.statusText);
      return res.blob();
    })
    .then(blob => new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
    }))
    .catch((err) => {
      console.error("Error occurred while trying to fetch and convert image to base64:", err);
      return null;
    });
}

async function sendOcrWithBase64(img: HTMLImageElement, base64: string) {
  const bgResponse = await chrome.runtime.sendMessage<InternalMessageType>({
    action: "PROCESS_OCR",
    fetchingType: "base64",
    imageData: base64
  });

  if (bgResponse && bgResponse.success) {
    renderOcrOverlays(img, bgResponse.ocrData);
  }
}

function getOrCreateShadowHost(img: HTMLImageElement): HTMLElement {
  const src = img.currentSrc || img.src;

  // Reuse an existing shadow host for this image if we already created one.
  const existing = document.querySelector<HTMLElement>(`[data-ocr-host][data-ocr-src="${src}"]`);
  if (existing) return existing;

  const host = document.createElement("div");
  host.dataset.ocrHost = "";
  host.dataset.ocrSrc = src;
  host.style.position = "relative";
  host.style.display = "inline-block";
  host.className += img.className ? ` ${img.className}` : "";
  img.parentNode?.insertBefore(host, img);
  host.appendChild(img);
  host.attachShadow({ mode: "open" });

  return host;
}

function clearOcrOverlays(host: HTMLElement) {
  host.shadowRoot?.querySelectorAll("[data-ocr-overlay]").forEach(el => { el.remove() });
}

function renderOcrOverlays(img: HTMLImageElement, ocrData: OCRResult) {
  const host = getOrCreateShadowHost(img);
  const root = host.shadowRoot;
  if (!root) return;

  // Remove any previous OCR result before presenting the new one.
  clearOcrOverlays(host);

  const overlay = document.createElement("div");
  overlay.dataset.ocrOverlay = "";
  overlay.style.position = "absolute";
  overlay.style.top = "0"; overlay.style.left = "0";
  overlay.style.width = "100%"; overlay.style.height = "100%";
  overlay.style.pointerEvents = "none";

  ocrData.forEach(box => {
    const boxDiv = document.createElement("div");
    boxDiv.innerText = box.text;
    boxDiv.style.position = "absolute";
    // Assuming backend returns percentages:
    boxDiv.style.top = `${(box.top / img.naturalHeight) * 100}%`;
    boxDiv.style.left = `${(box.left / img.naturalWidth) * 100}%`;
    boxDiv.style.width = `${(box.width / img.naturalWidth) * 100}%`;
    boxDiv.style.height = `${(box.height / img.naturalHeight) * 100}%`;
    boxDiv.style.border = "2px dashed #00ff00";
    boxDiv.style.backgroundColor = "rgba(255, 255, 255, 1)";
    boxDiv.style.color = "#00ff00";
    // Additional styling for text visibility
    boxDiv.style.textAlign = "center";
    boxDiv.style.display = "flex";
    boxDiv.style.alignItems = "center";
    boxDiv.style.justifyContent = "center";
    boxDiv.style.fontSize = "auto";
    boxDiv.style.whiteSpace = "nowrap";
    boxDiv.style.textOverflow = "ellipsis";
    overlay.appendChild(boxDiv);
  });

  root.appendChild(overlay);
}

function sendOcrToHost(src: string, ocrData: OCRResult) {
  const host = document.querySelector<HTMLElement>(`[data-ocr-host][data-ocr-src="${src}"]`);
  if (!host) return;
  const img = host.querySelector("img");
  if (img instanceof HTMLImageElement) renderOcrOverlays(img, ocrData);
}

function removeOcrFromHost(src: string) {
  const host = document.querySelector<HTMLElement>(`[data-ocr-host][data-ocr-src="${src}"]`);
  if (host) clearOcrOverlays(host);
}

// Expose the data-attribute API so OCR can be pushed/cleared into a host by image src.
(window as unknown as {
  sendOcrToHost: typeof sendOcrToHost;
  removeOcrFromHost: typeof removeOcrFromHost;
}).sendOcrToHost = sendOcrToHost;
(window as unknown as { removeOcrFromHost: typeof removeOcrFromHost }).removeOcrFromHost = removeOcrFromHost;

chrome.runtime.onMessage.addListener(msg => {

  if (msg.type !== "translate")
    return;
  console.log("translate message received in content script", msg)
  const escapedUrl = msg.url.replace(/"/g, '\\"');
  document.querySelectorAll<HTMLImageElement>(`img[src="${escapedUrl}"], img[srcset~="${escapedUrl}"]`).forEach(img => {
    sendImageToBackground(img);
  });
});