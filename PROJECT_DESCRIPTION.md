# Project Description

## Overview
This is a Chrome extension (Manifest V3) that automatically translates text inside images and canvases on web pages using PaddleOCR running in an offscreen document. It supports domain-based auto-translation, live page watching, and a dark-themed popup for managing allowed domains.

## Tech Stack
- Chrome Extension Manifest V3
- React + TypeScript + Vite
- PaddleOCR via `ppu-paddle-ocr` running in offscreen document
- Chrome APIs: `chrome.runtime`, `chrome.scripting`, `chrome.storage.sync`, `chrome.tabs`, `chrome.contextMenus`, `chrome.offscreen`

## File Responsibilities

### Entry Points
- **`src/main.tsx`** — React entry point that mounts `<App />` into the popup.
- **`public/offscreen.html`** — Host page for the offscreen document where PaddleOCR runs.
- **`public/manifest.json`** — Extension manifest declaring permissions, background service worker, offscreen document, CSP, and web-accessible resources.

### Background / Service Worker
- **`src/background.ts`**
  - Initializes the offscreen document on startup/install for OCR model caching.
  - Creates a context menu item "Xử lý phần tử này" on all contexts.
  - Handles context menu clicks: injects content script and sends `translate` message.
  - **Batch OCR hub**: listens for `PROCESS_OCR` messages from any tab; queues them with an `OCR_BATCH_SIZE` limit and `OCR_BATCH_DEBOUNCE_MS` debounce; dispatches a single `batch-run-ocr` message to the offscreen document. Uses `activeBatchCount` to ensure only one offscreen batch runs at a time globally, preventing service worker / offscreen overload across multiple tabs.
  - Resolves URL-type image fetches to base64 before batching to keep offscreen logic simple.
  - Maps settled batch results back to individual `sendResponse` callbacks for each originating tab.
  - Reads/writes settings from `chrome.storage.sync` via `get-settings` and `notify-settings-changed` to broadcast settings to all tabs.

### Content Script
- **`src/content.ts`**
  - Injected into active tab when popup opens or via background/context menu.
  - Core OCR flow: `sendImageToBackground(img)` tries canvas base64 first, then fetched base64, then URL fetch through background.
  - Renders OCR overlay boxes on images (`renderOcrOverlays`, `addOcrBoxes`) and canvases (`renderCanvasOcrOverlays`, `addOcrBoxesForCanvas`).
  - Maintains strong maps for processed images/canvases, overlays, mutation observers, and resize observers.
  - **Live translation**: on load (`autoTranslateIfAllowed`), requests settings from background, and if domain is allowed, auto-translates all existing images/canvases. Starts a `MutationObserver` on `documentElement` for newly added elements.
  - **No internal concurrency limit**: content script fires OCR requests immediately; global throttling is enforced by the service worker batch queue.
  - Tracks processing state via `processingImages` / `processingCanvases` Sets for popup status display.
  - Responds to popup messages: `get-images`, `get-image-status`, `get-canvases`, `get-canvas-status`, `translate-images`, `translate-canvases`, `settings-changed`.

### Offscreen OCR
- **`src/offscreen.ts`**
  - Runs in the offscreen document.
  - Loads the ONNX/PaddleOCR model on demand and caches the instance.
  - Listens for `batch-run-ocr` messages containing an array of image items.
  - Uses `model.batchRecognize()` with `concurrency: MAX_CONCURRENT` (2) and `settle: true` so one failed image doesn't abort the whole batch.
  - Transforms `PaddleOcrResult` into the extension's `OCRResult` shape and returns index-aligned results.

### Popup UI
- **`src/App.tsx`**
  - Three-tab interface: **Images**, **Canvases**, **Settings**.
  - **Images tab**: lists page images with live status badges (`pending`, `Translating...`, `Done`) and count badge on tab.
  - **Canvases tab**: lists page canvases with same status tracking.
  - **Settings tab**: current domain display, global enable toggle, quick add/remove current domain, manual domain input, clear all, and detection stats.
  - Polls content script every 1.5s for live status updates.
- **`src/App.css`** — Dark theme styles for popup, tabs, lists, badges, settings forms.
- **`src/index.css`** — Global CSS reset/base styles.

### Shared Config
- **`src/ocr-config.ts`** — Exports shared OCR constants: `MAX_CONCURRENT`, `OCR_BATCH_SIZE`, `OCR_BATCH_DEBOUNCE_MS`.

### Shared Types
- **`src/types.ts`**
  - `OCRResult`, `InternalMessageType` for background OCR.
  - `PopupMessageType`, `PopupResponseType`, `TranslateCommandType`, `ProgressMessageType`, `CompleteMessageType`.
  - `CanvasInfo`, `CanvasListResponse`, `CanvasTranslateCommand`.
  - `SettingsResponse`, `SettingsUpdate`, `NotifySettingsChanged`, `SettingsChanged`.

## Feature Flow

### Auto-Translation Flow
1. User opens Settings tab and adds a domain to `enabledDomains`.
2. User enables extension via global toggle.
3. Popup saves to `chrome.storage.sync` and sends `notify-settings-changed` to background.
4. Background broadcasts `settings-changed` to all open tabs.
5. Content script receives `settings-changed`, calls `autoTranslateIfAllowed()`.
6. `autoTranslateIfAllowed()` requests settings from background, checks current domain.
7. If allowed, iterates all visible images/canvases and sends `PROCESS_OCR` messages immediately.
8. Background batches these requests (max `OCR_BATCH_SIZE` per batch) and dispatches a single `batch-run-ocr` to the offscreen document.
9. Offscreen runs `model.batchRecognize()` with internal concurrency (`MAX_CONCURRENT = 2`) and returns index-aligned results.
10. Background maps batch results back to individual tabs, and content scripts render overlays.
11. MutationObserver on `documentElement` catches dynamically added images/canvases and sends `PROCESS_OCR` for them too.

### Manual Translation Flow (Context Menu)
1. User right-clicks an image and selects "Xử lý phần tử này".
2. Background reads settings, checks if current domain is allowed.
3. If allowed, injects content script and sends `translate` message.
4. Content script finds matching image and calls `sendImageToBackground`, which sends a `PROCESS_OCR` message back through background's batch queue.

### Live Watching Flow
- `MutationObserver` on `documentElement` watches for added nodes.
- New `<img>` or `<canvas>` elements trigger `sendImageToBackground` / `sendCanvasToBackground` immediately.
- `MutationObserver` on each image watches `src`/`srcset` changes; resets overlay and re-translates.
- `MutationObserver` on each canvas watches `width`/`height` attribute changes; resets and re-translates.
- `ResizeObserver` tracks render size changes for repositioning overlays.

### Popup Status Polling
- Popup sends `get-image-status` and `get-canvas-status` to content script every 1.5s.
- Content script returns arrays including `status` field derived from `processingImages`/`processingCanvases` and `processedImages`/`processedCanvases` maps.
- Popup renders badges: hidden for `pending`, orange pulsing `Translating...` for `processing`, green `Done` for completed.

## Settings Storage
Stored under `chrome.storage.sync` key `extensionSettings`:
```json
{
  "enabled": true,
  "enabledDomains": ["example.com", "sub.example.com"]
}
```
- Empty `enabledDomains` + `enabled = true` = auto-translate on all domains.
- `enabled = false` blocks all translation regardless of domain list.

## Future Improvements / Roadmap
- Add per-domain enable/disable toggle directly in the popup list.
- Persist processed state across navigations within same SPA.
- Add option to exclude specific images/canvases from auto-translation.
- Improve OCR overlay styling (theming, position locking).
- Consider moving from polling to long-lived connection for live status updates.
- Add option to adjust `OCR_BATCH_SIZE` and `OCR_BATCH_DEBOUNCE_MS` from popup settings based on device performance.

## Notes / Warnings
- Content script cannot directly access `chrome.storage` (no extension API in content scripts). Settings must be requested from background via `chrome.runtime.sendMessage`.
- `chrome.tabs.sendMessage` may throw if content script is not yet injected; popup handles this by injecting first and retrying.
- OCR processing is CPU/GPU intensive; global concurrency is throttled at the service worker level: `activeBatchCount` ensures only one offscreen batch runs at a time, and `batchRecognize` internal concurrency is capped at `MAX_CONCURRENT = 2`.
- `canvas.toDataURL()` does not work for cross-origin canvases without CORS; such canvases will fail silently.
- Overlays use `pointer-events: none` on container and `pointer-events: auto` on individual OCR boxes.
- Offscreen document reuses a single cached `PaddleOcrService` instance; `destroy()` was removed to avoid thrashing the model between batch items.

## Changelog
See `changes.md` for detailed change history.
