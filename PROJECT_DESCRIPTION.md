# Image Translate Extension

A browser extension (WebExtension Manifest V3) that detects images and canvas elements on web pages, runs OCR on them using PaddleOCR via an offscreen document, and renders translation overlay boxes on the translated text.

## Architecture

### Entrypoints

| File | Role |
|---|---|
| `entrypoints/content.ts` | Content script — orchestrates OCR processing, overlay rendering, DOM observation, and auto-translation on page load/URL change. Tracks per-element OCR/translation state (`processingSet`, `processed`, `translated`, `errorMap`) and reports job lifecycle (`ocr/job-started`, `ocr/job-completed`, `ocr/job-failed`) to the background |
| `entrypoints/background.ts` | Service worker — batches OCR requests, **serves repeated images from a shared in-memory OCR cache**, maintains the **cross-tab OCR job registry** (`ocr/get-queue`), manages offscreen document, handles extension settings and context menus, forwards translation requests to offscreen |
| `entrypoints/popup/App.tsx` | Popup UI — polls image/canvas status from the content script on an interval, shows the image/canvas list with status badges, **renders the cross-tab "Processing queue" section from `ocr/get-queue`**, triggers batch translation, and manages the Settings tab. Communicates with the content script via the `ui/` message protocol and listens (via `browser.runtime.onMessage`) for `translate/progress` / `translate/complete` / `extension/error` events to stay in sync. |
| `entrypoints/offscreen/offscreen.ts` | Offscreen document — runs the PaddleOCR model engine and NLLB translation engine (Web Worker) |
| `entrypoints/offscreen/index.html` | HTML anchor for the offscreen document |

### Translation Engine (NEW)

| File | Role |
|---|---|
| `utils/translation/engine.ts` | Main thread facade — spawns/manages Web Worker, handles worker lifecycle, message routing, falls back gracefully if worker fails |
| `utils/translation/worker.ts` | Web Worker entry point — registers message handlers for `translate`, `warmup`, `dispose`, `status` |
| `utils/translation/cache.ts` | L1 memory Map + L2 IndexedDB persistent cache, SHA-256 key with model/engine version |
| `utils/translation/types.ts` | Core types: TranslationUnit, TranslationRequest/Response, TranslationError, ModelStatus, worker message types |
| `utils/translation/language-detector.ts` | Script-based detection + TinyLD fallback, maps Unicode scripts to NLLB codes |
| `utils/translation/google.ts` | Google Translate API client (free, no-key) for testing — maps NLLB ↔ Google language codes |

### Utilities

| File | Role |
|---|---|
| `utils/overlay.ts` | Shared overlay DOM creation, positioning, box rendering, and container management |
| `utils/element-state.ts` | Generic element tracking (processing set, processed map, **translated map**, overlay map, mutation maps, resize observer, **error map**) with lifecycle cleanup; exposes `setError`/`getError`/`clearError` for per-element error tracking and `setTranslated`/`getTranslated`/`hasTranslated`/`clearTranslated` for "translated overlay actually painted" tracking |
| `utils/ocr-pipeline.ts` | Image URL resolution (srcset), canvas-to-base64, fetch-to-base64, and sending OCR jobs to background (carries `targetType`/`target` metadata and returns the background `jobId`) |
| `utils/ocr-region-grouping.ts` | Spatial grouping of OCR word/line boxes into logical text regions using adjacency heuristics and convex hull |
| `utils/ocr-cache.ts` | Shared in-memory **LRU OCR result cache** (`OcrCache` class: `get`/`set`/`has`/`delete`/`clear`/`size`, cap 100 entries) plus `hashImageData()` — SHA-256 key helper: URL items are keyed by URL hash, base64/canvas items by decoded content hash |
| `utils/dom-observer.ts` | Live MutationObserver for new DOM nodes, SPA URL change polling, used by content script for auto-translation |
| `utils/asset-cache.ts` | IndexedDB asset caching, cache URL validation, fetch wrapper installation |
| `utils/ocr-batcher.ts` | PaddleOcrService model initialization, **per-item independent batch OCR execution via Promise.allSettled**, and region grouping |
| `utils/extension-settings.ts` | Centralized settings retrieval and domain permission checking; defines `ExtensionSettings` (including `targetLang`) with `DEFAULT_SETTINGS` defaults and `getExtensionSettings()` merge |
| `utils/domain-matcher.ts` | URL domain/pattern matching for extension enablement rules |
| `utils/constants.ts` | Shared constants (offscreen paths, message targets) |
| `utils/languages.ts` | Supported languages list (`SUPPORTED_LANGUAGES`), `DEFAULT_TARGET_LANG` ("vie_Latn"), and `Language` type used by the popup Settings UI and the hover translation popup language selector. Codes use NLLB format (e.g. `eng_Latn`, `vie_Latn`, `zho_Hans`) |
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
3. **Target language selection**: Hovering an OCR overlay box opens the translation popup (`translation-popup.ts`), which shows the original OCR text and a target-language `<select>` pre-set to the cached default. Selecting a different language re-sends a `translate/text` message (with the chosen `targetLang`) to the background. The popup's choice is ephemeral and does not overwrite the global default configured in the popup Settings tab.
4. **User triggers translation**: Via popup (translating listed images/canvases) or context menu (`translate` message) — content script processes the specified elements on demand
5. **New element added**: `dom-observer.ts` → `handleAddedNodes()` → calls `processNewImage()` or `processNewCanvas()`
6. **OCR pipeline**: `ocr-pipeline.ts` tries canvas extraction first, then fetch, then URL-based background processing
7. **Background batch**: `background.ts` queues OCR requests, batches them, sends to offscreen document for PaddleOCR inference
8. **Region grouping**: `ocr-batcher.ts` converts raw PaddleOCR boxes to `OCRBox[]`, runs `groupOcrBoxesIntoRegions()` to produce `OCRRegion[]` with convex hull bounds and concatenated text
9. **Result callback**: OCR regions flow back via `onSuccess` callback → `renderImageOverlay()` / `renderCanvasOverlay()` flattens region boxes and creates DOM overlay
10. **Overlay positioning**: `element-state.ts` ResizeObserver + rAF-scheduled batch updates keep overlays aligned with their target elements
11. **Overlay hover popup**: `overlay.ts` attaches `mouseenter`/`mouseleave` to each `OCRBox` div; `mouseenter` shows the translation popup, `mouseleave` arms a delayed dismiss; the popup owns the translate request and language selector (`translation-popup.ts`)
12. **Host communication**: `window.sendOcrToHost` / `window.removeOcrFromHost` allow external scripts to trigger or clear overlays
13. **Asset caching**: `asset-cache.ts` intercepts fetch for model assets and caches them in IndexedDB, avoiding redundant downloads
14. **Batch OCR**: `ocr-batcher.ts` initializes PaddleOcrService and runs `model.batchRecognize()` on batches of image buffers
15. **Translation (NEW - NLLB-200)**: 
    - Content script sends `translate/regions` with `OCRRegion[]` to background after OCR completes
    - Background forwards to offscreen via `offscreen/translate-regions` message
    - Offscreen `translateEngine.translate()` groups regions into `TranslationUnit[]`, runs language detection per unit
    - Spawns/manages Web Worker (`utils/translation/worker.ts`) for translation
    - Worker: deduplicates texts, checks L1/L2 cache, groups by source language, batches, calls model
    - Model loads `Xenova/nllb-200-distilled-600M` (WebGPU → WASM fallback), translates to Vietnamese (`vie_Latn`)
    - Results with `cached` flag returned → offscreen → background → content script → overlay update
    - Popup `translate/text` requests also handled by same engine with auto-detection via `offscreen/translate-text`
16. **Extension settings**: `extension-settings.ts` centralizes settings retrieval (`enabled`, `enabledDomains`, `targetLang`) with `DEFAULT_SETTINGS` defaults and domain permission checking, eliminating duplication in `background.ts`
17. **Popup settings UI**: `entrypoints/popup/App.tsx` Settings tab renders a Default Target Language `<select>` bound to `SUPPORTED_LANGUAGES`; saving writes `targetLang` to `browser.storage.sync` and broadcasts `settings/notify-changed` so content scripts cache the new default
18. **Per-item independent OCR**: `ocr-batcher.ts` wraps each image's OCR call in its own try/catch via `Promise.allSettled`, so one image's failure cannot affect others in the same batch. Offscreen handler (`offscreen.ts`) preserves per-item results.
19. **Error tracking & popup display**: `element-state.ts` adds `errorMap` with `setError`/`getError`/`clearError`; `content.ts` marks failed images/canvases as "error" status before calling `onComplete`; `types/index.ts` extends `ImageInfoWithStatus`/`CanvasInfoWithStatus` with `"error"` status; popup (`App.tsx`) shows error badges on tabs, "Error" label in list items, and `.status-error` / `.tab-badge.error` styles.
20. **Shared OCR cache**: `background.ts` keeps a single `OcrCache` instance (LRU, 100 entries, memory only) in the service worker. Before an item is forwarded to the offscreen document, `flushOcrBatch()` computes a SHA-256 cache key (`utils/ocr-cache.ts`) and serves the result from the cache when present; successful OCR results are written back to the cache. Because the cache lives in the background, the same image opened in two tabs only runs PaddleOCR once. URL requests are keyed by URL hash (skips the re-fetch), base64/canvas requests by decoded content hash.
21. **Accurate "Done" status**: `element-state.ts` tracks a `translated` map keyed by the same content key as `processed` (image src / canvas snapshot). `content.ts` keeps the element in `processingSet` until `translateAndUpdateOverlay()` settles, and only calls `setTranslated()` after the translated overlay has been painted. `collectImageInfo`/`collectCanvasInfo` resolve the status with the priority: `processingSet` → "processing", `errorMap` → "error", `translated` → "done", `processed` (but not translated) → "processing" ("Translating..."), otherwise "pending". `sendOcrToHost` (host-driven overlays) marks the element translated immediately.
22. **Cross-tab OCR queue**: the background maintains `ocrJobRegistry: Map<jobId, OcrJob>` (TTL 10 min, cap 500 jobs). A job is created when `ocr/process` arrives (tab id/url taken from `sender.tab`), moves `queued → processing` when it is dispatched, and settles as `done`/`error` when the content script reports `ocr/job-completed` / `ocr/job-failed` (or when the background itself detects an OCR failure). The popup polls `ocr/get-queue` and renders the jobs grouped by tab URL with status badges inside the Images tab ("Processing queue" section).

## Key Design Patterns

- **Generic element tracking**: `createElementState<T>()` eliminates duplication between image and canvas state management
- **Callback-based OCR pipeline**: `processImage()` / `processCanvas()` accept `onSuccess` callbacks for decoupled result rendering
- **Overlay utilities**: Shared positioning, box creation, and container management in `overlay.ts` avoid duplicated CSS and DOM logic
- **Popup base**: `popup-base.ts` centralizes z-index, font, border-radius, box-shadow, color themes, and keyframe animation injection; `toast.ts` and `translation-popup.ts` both consume it to eliminate duplication
- **Observer lifecycle**: Every resize observer, mutation observer, and overlay DOM node is tracked and cleaned up on element removal or src change
- **Per-item OCR independence**: `ocr-batcher.ts` uses `Promise.allSettled` with per-item try/catch to ensure one image's OCR failure cannot cascade to other images in the batch
- **Persistent error state**: `element-state.ts` `errorMap` tracks per-element errors through the processing lifecycle; errors survive `onComplete` cleanup so the popup can display them via `collectImageInfo`/`collectCanvasInfo`
- **Shared OCR cache**: `utils/ocr-cache.ts` `OcrCache` is a generic LRU map owned by the background service worker; a SHA-256 content/URL key makes identical images share one OCR run across tabs. Cache is memory-only (a service worker restart clears it) and bounded at 100 entries
- **Translated-state tracking**: `element-state.ts` `translated` map only receives an entry once the translated overlay is painted, so "done" in the popup always means "the user can see the translation"
- **Cross-tab job registry**: the background is the single source of truth for OCR job state (`queued`/`processing`/`done`/`error`), which keeps the popup's queue correct even when the user switches tabs mid-run
- **Web Worker isolation**: Translation runs in a dedicated Web Worker (`src/translation/worker.ts`) to keep the UI responsive during model inference
- **Two-level caching**: L1 in-memory Map for instant hits, L2 IndexedDB for persistence across sessions, with SHA-256 keys including model/engine version for automatic invalidation
- **Token protection**: Numbers, URLs, currency, code identifiers preserved through translation via placeholder replacement
- **Graceful degradation**: Worker failure falls back to returning original text; low-confidence language detection returns original; per-unit errors don't block other units

## Notes & Future Work

- **OCR cache + accurate popup status + cross-tab queue (2026-10-20)**: Three related fixes landed together. (1) `utils/ocr-cache.ts` was rewritten (it previously held an unused `browser.storage.local` based helper `getCachedOcr`/`storeCachedOcr` that was never imported) into a shared LRU OCR cache (100 entries, memory only) owned by the background service worker; `flushOcrBatch()` checks the cache before contacting the offscreen document and writes successful results back, so the same image in two tabs only runs PaddleOCR once. Cache keys are SHA-256: URL requests by URL hash, base64/canvas requests by decoded content hash. (2) `element-state.ts` gained a `translated` map; the content script keeps the element in `processingSet` until the translation settles and only marks it translated after the translated overlay is painted, so the popup shows "Translating..." instead of a premature "Done". (3) The background now owns an `ocrJobRegistry` (`OcrJob` = id/tabId/tabUrl/type/target/status/createdAt/finishedAt/error) with a 10-minute TTL and a 500-job cap; content scripts report `ocr/job-started` / `ocr/job-completed` / `ocr/job-failed` and the popup polls `ocr/get-queue` to render a "Processing queue" section grouped by tab URL. Note: the plan's message contract used `type: "image"|"canvas"` inside the `ocr/job-started` payload, which collides with the message discriminator `type` — the payload field is therefore named `targetType` (and `tabId`/`tabUrl` are optional, since the background derives them from `sender.tab`).
- **Google Translate API added for testing (2026-10-10)**: `utils/translation/google.ts` provides a free, no-key Google Translate API client. `engine.ts` now uses it instead of mock translations. Maps NLLB language codes to Google's format for all 33 supported languages. Falls back to original text on error. Suitable for testing only; rate limits apply.
- **Translation engine re-implemented in utils/ (2026-09-27)**: Moved from `src/translation/` to `utils/translation/` following project conventions. Single NLLB-200 distilled 600M model with automatic language detection handles 13+ source languages → Vietnamese. Runs in Web Worker with WebGPU/WASM, L1/L2 caching, and graceful degradation. Background now forwards translation requests to offscreen document.
- **Translation engine implemented (2026-09-20)**: Single NLLB-200 distilled 600M model with automatic language detection now handles 13+ source languages → Vietnamese. Replaces per-language opus-mt models. Runs in Web Worker with WebGPU/WASM, L1/L2 caching, token protection, and graceful degradation.
- **Popup↔content script message-type contract (2026-09-19)**: The popup's `pollPageData` and `progressListener` previously checked non-prefixed message types (`"image-status-list"`, `"translate-images-progress"`, `"extension-error"`) that never matched what the content script / background actually send (`"ui/image-status-list"`, `"translate/progress"`, `"extension/error"`), so the image/canvas lists always stayed empty ("No images found on this page"). Fixed in `App.tsx`: response checks now match the `ui/`-prefixed types and progress listener matches `translate/progress`/`translate/complete`/`extension/error`. `pollPageData` uses `Promise.allSettled` so a missing content script (browser-restricted URLs like `chrome://`/`about:`, not-yet-loaded tabs) only resets state when both polls fail — preserving a partial result. The background `extension/error` handler now relays errors via `runtime.sendMessage` (in addition to the existing `tabs.sendMessage` broadcast) so the popup, which lives in an extension-page context unreachable via `tabs.sendMessage`, also receives them. `types/messages.ts` `ImageStatusListResponse`/`CanvasStatusListResponse` status unions now include `"error"`.
- **Settings broadcast repair**: The popup previously sent `notify-settings-changed`, which the background never matched (it listened for `settings/notify-changed`), so `settings/changed` was never relayed to content scripts. This has been corrected so settings now propagate live.
- **Translation batching**: per-`srcLang:targetLang` batches mean each target language is translated by a separate model instance; the cache in `ocr-batcher.ts`/`translation.ts` keys loaded models by `<src>-<target>`.
- **Async independent OCR + error tracking (2026-09-18)**: Implemented per-item independent OCR in `ocr-batcher.ts` using `Promise.allSettled` with individual try/catch. Added `errorMap` to `element-state.ts` with `setError`/`getError`/`clearError` methods. Extended `ImageInfoWithStatus`/`CanvasInfoWithStatus` status union with `"error"`. Updated `content.ts` to mark failed elements as error before `onComplete` and include error status in `collectImageInfo`/`collectCanvasInfo`. Updated popup `App.tsx` with error count state, error badges on tabs, "Error" label, and CSS styles (`.status-error`, `.tab-badge.error`). This fixes the "No images found" popup issue when OCR fails on some images — errored images now remain visible with "Error" status instead of reverting to "pending".

## Out of Scope (MVP)

- Persistent OCR cache across browser restarts (the cache is in-memory only)
- Server-side translation fallback
- Per-language model selection
- User-facing language selection (target fixed to Vietnamese)
- Translation quality scoring / confidence
- LLM-based post-correction
- Full document layout analysis