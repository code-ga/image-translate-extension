# Image Translate Extension

A browser extension (WebExtension Manifest V3) that detects images and canvas elements on web pages, runs OCR on them using PaddleOCR via an offscreen document, and renders translation overlay boxes on the translated text.

## Architecture

### Entrypoints

| File | Role |
|---|---|
| `entrypoints/content.ts` | Content script — orchestrates OCR processing, overlay rendering, DOM observation, and auto-translation on page load/URL change |
| `entrypoints/background.ts` | Service worker — batches OCR requests, manages offscreen document, handles extension settings and context menus |
| `entrypoints/popup/App.tsx` | Popup UI — shows image list and triggers batch translation |
| `entrypoints/offscreen/offscreen.ts` | Offscreen document — runs the PaddleOCR model engine |
| `entrypoints/offscreen/index.html` | HTML anchor for the offscreen document |

### Utilities

| File | Role |
|---|---|
| `utils/overlay.ts` | Shared overlay DOM creation, positioning, box rendering, and container management |
| `utils/element-state.ts` | Generic element tracking (processing set, processed map, overlay map, mutation maps, resize observer) with lifecycle cleanup; now includes `resetAll()` for full state reset on URL change |
| `utils/ocr-pipeline.ts` | Image URL resolution (srcset), canvas-to-base64, fetch-to-base64, and sending OCR jobs to background via fire-and-forget messaging with `registerOcrResultListener()` for event-based result delivery |
| `utils/ocr-cache.ts` | OCR result caching in `browser.storage.local` with 7-day TTL — prevents re-OCR of previously processed images keyed by source URL |
| `utils/ocr-region-grouping.ts` | Spatial grouping of OCR word/line boxes into logical text regions using adjacency heuristics and convex hull |
| `utils/dom-observer.ts` | Live MutationObserver for new DOM nodes, SPA URL change polling, used by content script for auto-translation |
| `utils/asset-cache.ts` | IndexedDB asset caching, cache URL validation, fetch wrapper installation |
| `utils/ocr-batcher.ts` | PaddleOcrService model initialization, batch OCR execution, and region grouping |
| `utils/extension-settings.ts` | Centralized settings retrieval and domain permission checking; defines `ExtensionSettings` (including `targetLang`) with `DEFAULT_SETTINGS` defaults and `getExtensionSettings()` merge |
| `utils/domain-matcher.ts` | URL domain/pattern matching for extension enablement rules |
| `utils/constants.ts` | Shared constants (offscreen paths, message targets) |
| `utils/languages.ts` | Supported languages list (`SUPPORTED_LANGUAGES`), `DEFAULT_TARGET_LANG` ("vi"), and `Language` type used by the popup Settings UI and the hover translation popup language selector |
| `utils/popup-base.ts` | Shared popup base: z-index, font, border-radius, box-shadow constants, container creation, and keyframe animation injection |
| `utils/toast.ts` | Inline DOM toast notifications using shared popup base; debounce, dedup, auto-removal |
| `utils/translation-popup.ts` | Hover-activated translation popup for OCR overlay boxes; mouseenter on box shows popup with debounce, mouseleave on box or popup starts delayed close; race-condition-safe response updates. The popup renders the original OCR text, a target-language `<select>` (default taken from the cached extension setting), and a color-coded result area. Changing the select re-translates the same text with the new target language. Public API: `showTranslationPopup(anchor, text, onReady?)`, `dismissTranslationPopup()`, `cancelCloseDelay()`, `startCloseDelay(cb, ms?)`, `setDefaultTargetLang(lang)` |

### Config & Types

| File | Role |
|---|---|
| `config/ocr-config.ts` | OCR batch size, concurrency, and debounce timing |
| `types/index.ts` | All shared TypeScript types (Point, OCRBox, OCRRegion, OCRResult, message types, settings) |
| `wxt.config.ts` | WXT build configuration (manifest, permissions, CSP) |

## Feature Flow

1. **Content script activation**: `content.ts` runs automatically on all pages via manifest `<all_urls>` match. On load, it calls `autoTranslateIfAllowed()` which checks extension settings and domain permissions, then processes all matching images/canvases. It also starts URL polling to detect SPA navigation and a live DOM observer for dynamically added elements
2. **Settings change handling**: The popup saves settings to `browser.storage.sync` and broadcasts a `settings/notify-changed` message to the background, which relays a `settings/changed` message to all content-script tabs. Each content script re-runs `autoTranslateIfAllowed()` AND calls `setDefaultTargetLang(settings.targetLang)` to cache the user's default target language for the hover translation popup. The content script also seeds this cache on load via `syncSettingsTargetLang()`.
3. **Target language selection**: Hovering an OCR overlay box opens the translation popup (`translation-popup.ts`), which shows the original OCR text and a target-language `<select>` pre-set to the cached default. Selecting a different language re-sends a `translate/text` message (with the chosen `targetLang`) to the background, which batches and runs `translateDynamic()`. The popup's choice is ephemeral and does not overwrite the global default configured in the popup Settings tab.
4. **User triggers translation**: Via popup (translating listed images/canvases) or context menu (`translate` message) — content script processes the specified elements on demand
5. **New element added**: `dom-observer.ts` → `handleAddedNodes()` → calls `processNewImage()` or `processNewCanvas()`
   6. **OCR cache check**: `ocr-cache.ts` — before OCR, checks `browser.storage.local` for cached results keyed by source URL (7-day TTL); cache hit skips OCR entirely
6. **OCR pipeline**: `ocr-pipeline.ts` tries canvas extraction first, then fetch, then URL-based background processing
7. **Background batch**: `background.ts` queues OCR requests, batches them, sends to offscreen document for PaddleOCR inference
8. **Region grouping**: `ocr-batcher.ts` converts raw PaddleOCR boxes to `OCRBox[]`, runs `groupOcrBoxesIntoRegions()` to produce `OCRRegion[]` with convex hull bounds and concatenated text
9. **Result callback**: OCR regions flow back via `onSuccess` callback → `renderImageOverlay()` / `renderCanvasOverlay()` flattens region boxes and creates DOM overlay
10. **Overlay positioning**: `element-state.ts` ResizeObserver + rAF-scheduled batch updates keep overlays aligned with their target elements
11. **Overlay hover popup**: `overlay.ts` attaches `mouseenter`/`mouseleave` to each `OCRBox` div; `mouseenter` shows the translation popup, `mouseleave` arms a delayed dismiss; the popup owns the translate request and language selector (`translation-popup.ts`)
12. **Host communication**: `window.sendOcrToHost` / `window.removeOcrFromHost` allow external scripts to trigger or clear overlays
13. **Asset caching**: `asset-cache.ts` intercepts fetch for model assets and caches them in IndexedDB, avoiding redundant downloads
14. **Batch OCR**: `ocr-batcher.ts` initializes PaddleOcrService and runs `model.batchRecognize()` on batches of image buffers
15. **Translation**: `background.ts` receives `translate/text` messages, de-duplicates and batches them per `srcLang:targetLang` key via `enqueueTranslation`/`flushTranslationBatch`, and runs `translateDynamic()` (HuggingFace `Xenova/opus-mt-<src>-<target>` transformer pipeline). Result returned to the popup via `sendResponse`.
16. **Extension settings**: `extension-settings.ts` centralizes settings retrieval (`enabled`, `enabledDomains`, `targetLang`) with `DEFAULT_SETTINGS` defaults and domain permission checking, eliminating duplication in `background.ts`
17. **Popup settings UI**: `entrypoints/popup/App.tsx` Settings tab renders a Default Target Language `<select>` bound to `SUPPORTED_LANGUAGES`; saving writes `targetLang` to `browser.storage.sync` and broadcasts `settings/notify-changed` so content scripts cache the new default

## Key Design Patterns

- **Generic element tracking**: `createElementState<T>()` eliminates duplication between image and canvas state management
- **Callback-based OCR pipeline**: `processImage()` / `processCanvas()` accept `onSuccess` callbacks for decoupled result rendering
- **Overlay utilities**: Shared positioning, box creation, and container management in `overlay.ts` avoid duplicated CSS and DOM logic
- **Popup base**: `popup-base.ts` centralizes z-index, font, border-radius, box-shadow, color themes, and keyframe animation injection; `toast.ts` and `translation-popup.ts` both consume it to eliminate duplication
- **Observer lifecycle**: Every resize observer, mutation observer, and overlay DOM node is tracked and cleaned up on element removal or src change

## Notes & Future Work

- **`srcLang` is currently empty**: `translation-popup.ts` sends `srcLang: ""` with every `translate/text` request, which resolves to the model name `Xenova/opus-mt--<targetLang>`. A valid HuggingFace opus-mt model requires a concrete source language (e.g. `Xenova/opus-mt-en-vi`). Adding automatic source-language detection (e.g. via a language-classification model) and/or a source-language setting is needed for `translateDynamic()` to load the correct model. The target-language plumbing added here is in place and ready for that.
- **Settings broadcast repair**: The popup previously sent `notify-settings-changed`, which the background never matched (it listened for `settings/notify-changed`), so `settings/changed` was never relayed to content scripts. This has been corrected so settings now propagate live.
- **Popup status polling fix**: Popup was sending `{ type: "get-image-status" }` but content script handler expected `{ type: "ui/get-image-status" }` — message type mismatch caused popup to show empty lists. Fixed in `entrypoints/popup/App.tsx`.
- **SPA navigation reset**: `autoTranslateIfAllowed()` now calls `resetAll()` on element state before reprocessing, ensuring SPA navigation correctly re-OCRs images with changed sources instead of being blocked by stale `processingSet` entries.
- **Translation batching**: per-`srcLang:targetLang` batches mean each target language is translated by a separate model instance; the cache in `ocr-batcher.ts`/`translation.ts` keys loaded models by `<src>-<target>`.

## OCR reliability work — 2026-09-13

- **`entrypoints/content.ts`**: watches `src`, `srcset`, common lazy-image attributes, `style`, and image `load`/`error` events; keeps a generation token so stale OCR responses cannot overwrite a newer lazy-loaded source. A zero-region OCR result no longer marks the image as permanently processed, so a later source/load change can retry it. Error toasts and background error messages include the image source and processing stage.
- **`utils/ocr-pipeline.ts`**: resolves common lazy-image attributes, validates image readiness, logs canvas/fetch/runtime failures with source and dimensions, and never logs base64 payloads. Empty OCR results are valid results but remain retryable when the source changes.
- **`utils/element-state.ts`**: adds tracked event-listener cleanup so image source/load watchers are disconnected when an element is reset or removed.
- **`utils/dom-observer.ts`**: watches every added image, including initially tiny or unloaded lazy images; `content.ts` applies the size/visibility gate before OCR.
- **`entrypoints/background.ts`**: fetches URL images with `Promise.allSettled`, wraps every queued response so it is sent once, isolates fetch failures, and retries a failed whole-batch offscreen call item-by-item.
- **`utils/ocr-batcher.ts`**: decodes each buffer independently, preserves original indices, uses PaddleOCR `settle: true`, and falls back to per-image `recognize()` when a batch call rejects.
- **`entrypoints/offscreen/offscreen.ts`** and **`types/messages.ts`**: return typed, index-aligned per-item OCR results and safe error envelopes without `any` payloads.
- **Validation**: `bun run compile`, `bun run build`, Biome checks, and `git diff --check` pass. The production build still reports the existing FastText browser-externalization and large-chunk warnings.

### Future verification

- Manually test a lazy image that starts with a placeholder `src`, receives a real URL through `data-src`/`src`, and initially returns zero OCR boxes.
- Add browser-level tests for malformed base64, URL fetch failure, offscreen timeout, and mixed-success batches.

## OCR diagnostic logging — 2026-09-14

Added diagnostic logging across the OCR pipeline to trace "OCR processing failed" errors:

- **`utils/ocr-pipeline.ts`**: logs base64 extraction success/failure with source, base64 size, and prefix. Distinguishes canvas extraction, fetch extraction, and URL fallback paths.
- **`utils/ocr-batcher.ts`**: logs image decoding (raw/encoded length, buffer size), model initialization (new vs cached, success/failure with error details), batch recognition (fulfilled/rejected counts), and individual retry attempts.
- **`entrypoints/background.ts`**: logs batch flush start, per-payload resolution details (fetchingType, data size, prefix), batch request completion (success/error), individual OCR results, and payload resolution summary (eligible/rejected counts).
- **`entrypoints/offscreen/offscreen.ts`**: logs error details (name, message, stack, stringified error) when `runBatchOcr` throws.

### Diagnosis — "OCR processing failed" error

**Root cause: GPU/WebGL execution provider failure in ONNX runtime, NOT CORS.** Evidence from console logs:

1. ONNX runtime: `removing requested execution provider "gpu" from session options because it is not available: backend not found`
2. ONNX runtime: `removing requested execution provider "webgl" from session options because it is not available: backend not found`
3. PaddleOCR: `executionProviders=["gpu","webgpu","webgl","wasm"] failed ... falling back to ["wasm"]`
4. After WASM fallback, OCR succeeds: `OCR model initialized successfully` → `OCR batch recognize completed` → `OCR batch finished`
5. The GPU→WebGL→WebGPU→WASM fallback chain adds latency; if it exceeds 30s (`OFFSCREEN_REQUEST_TIMEOUT_MS`), the request fails with "OCR processing failed" before WASM fallback completes

**Fix applied**: Changed `executionProviders` from `["gpu", "webgpu", "webgl", "wasm"]` to `["wasm"]` in `utils/ocr-batcher.ts`. GPU/WebGL are optional performance optimizations and should not block OCR processing when unavailable.

**Why it worked 1 week ago**: GPU or WebGL was previously available in the browser environment. After a browser update, driver change, or configuration change, these providers became unavailable.

## Communication timeout fix — 2026-09-16

**Problem**: `browser.runtime.sendMessage` from content script to background timed out during large OCR processing. Background OCR completed successfully (`OCR batch request completed {batchSize: 2/6, success: true}`) but content script never received the response, resulting in "OCR processing failed" errors for images from `cubari.moe` (cross-origin from `services.f-ck.me`).

**Root cause**: Chrome MV3 `sendMessage` has a timeout for pending responses. Long-running OCR processing exceeded this timeout, killing the pending request before `sendResponse` could be called.

**Fix**: Implemented fire-and-forget messaging pattern:
- **`types/messages.ts`**: Added `OcrResultMessage` type (`ocr/result`) with `requestId`, `success`, `ocrData`/`error`
- **`utils/ocr-pipeline.ts`**: Added `pendingOcrRequests` Map, `generateRequestId()`, `registerOcrResultListener()`. `sendOcrWithBase64()`/`sendOcrWithUrl()`/`processCanvas()` now send messages fire-and-forget (no `await`) and register one-time result listeners keyed by `requestId` with 60s timeout
- **`entrypoints/background.ts`**: Stores `sender.tab.id` in OCR batch items. `sendOcrResult()`/`sendOcrFailure()` now dispatch results via `browser.tabs.sendMessage(tabId, {type: "ocr/result", ...})` instead of `sendResponse`
- **`entrypoints/content.ts`**: Calls `registerOcrResultListener()` at startup to receive OCR results

### Flow
1. Content script sends `ocr/process` (fire-and-forget, includes `requestId`)
2. Background processes OCR, then sends `ocr/result` to content script's tab via `browser.tabs.sendMessage`
3. Content script listener matches `requestId`, resolves the pending request, calls `onSuccess`/`onError`
4. If no result within 60s, timeout fires and calls `onError("OCR processing timed out")`
