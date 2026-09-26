# Image Translate Extension

A browser extension (WebExtension Manifest V3) that detects images and canvas elements on web pages, runs OCR on them using PaddleOCR via an offscreen document, and renders translation overlay boxes on the translated text.

## Architecture

### Entrypoints

| File | Role |
|---|---|
| `entrypoints/content.ts` | Content script — orchestrates OCR processing, overlay rendering, DOM observation, and auto-translation on page load/URL change. Owns the work admission scheduler: the 5 largest candidates start immediately, the rest go to a tail queue that runs one at a time while the page is idle |
| `entrypoints/background.ts` | Service worker — thin port router: accepts long-lived ports from content scripts, forwards `queue/enqueue` jobs to the offscreen document over a shared port (with a `queue/ping`/`queue/ready` handshake and reconnect), routes `queue/result` responses back to the originating tab, manages the offscreen document lifecycle, and still handles settings broadcast / context menus / error broadcast via one-shot `runtime.onMessage` |
| `entrypoints/popup/App.tsx` | Popup UI — polls image/canvas status from the content script on an interval, shows the image/canvas list with status badges, and manages the Settings tab. Communicates with the content script via the `ui/` message protocol and listens for `translate/progress`, `translate/complete`, and `extension/error` events to stay in sync. On-demand translation is triggered by the context menu; the popup currently displays and monitors status rather than sending a batch-translate command. |
| `entrypoints/offscreen/offscreen.ts` | Offscreen document — accepts the background's long-lived port, answers the readiness handshake, enqueues every `queue/enqueue` request into the `PriorityQueue`, drains it serially (OCR in batches, translation one request at a time), runs PaddleOCR and owns the translation engine including its model Web Worker |
| `entrypoints/offscreen/index.html` | HTML anchor for the offscreen document |

### Translation Engine (NEW)

### Translation Providers

| File | Role |
|---|---|
| `src/translation/providers/google-translate.ts` | Hosted-provider client — calls the free Google Translate endpoint (`translate_a/single`, `client=gtx`, no API key) with `sl=auto`, a 12 s timeout, one retry, and at most 5 requests in flight. Exports `translateTextsWithGoogle(texts, targetLang)` and `toGoogleLanguageCode(code)`, which maps NLLB codes (`vie_Latn` → `vi`, `zho_Hans` → `zh-CN`) and allowlists plain 2-letter codes, falling back to `vi` for anything unknown. Runs inside the translation Web Worker, which inherits the extension's host permissions |

> **Provider selection**: `ExtensionSettings.translationProvider` (`"api" | "local"`, default `"api"`) is read per request by `src/translation/engine.ts` and carried on the worker request. In `api` mode `model-manager.ts` never calls `loadModel`, so the ~2.4 GB NLLB weights are never downloaded or made resident — that was the main GPU pressure behind extension-process crashes. `scheduler.ts` namespaces the L1/L2 cache per provider (`google-translate-api-v1` vs `nllb-200-distilled-600M-v1`) so switching engines never serves one engine's output to the other. Toggle it in the popup → Settings → Translation Engine.

| File | Role |
|---|---|
| `src/translation/engine.ts` | Offscreen document facade — owns the model Web Worker, handles worker lifecycle/message routing, and maps translation results back to OCR regions |
| `src/translation/worker.ts` | Bundled Web Worker entry point — registers `translate`, `warmup`, `dispose`, and `status` handlers when loaded |
| `src/translation/model-manager.ts` | Model manager (inside worker) — state machine `UNAVAILABLE → DOWNLOADING → LOADING → READY ↔ INFERENCE → ERROR → READY`, lazy-loads `Xenova/nllb-200-distilled-600M`, WebGPU preferred with WASM fallback, idle unload after 5 min. In `api` mode `loadModel()`/`translateTexts()` short-circuit to the hosted provider, so no pipeline is ever created |
| `src/translation/scheduler.ts` | Translation scheduler (inside worker) — deduplicates identical texts, cache lookup (L1 memory → L2 IndexedDB), groups by source language, batches texts, calls model manager, and preserves OCR box indexes for overlay mapping |
| `src/translation/cache/translation-cache.ts` | L1 memory Map + L2 IndexedDB persistent cache, SHA-256 key with model/engine version |
| `src/translation/types.ts` | Core types: TranslationUnit, TranslationRequest/Response, LanguageDetectionResult, NllbLanguageCode, TranslationError, ModelStatus, ModelProgress, worker message types |
| `src/translation/language/language-map.ts` | Supported source language map (15 NLLB-mapped languages) → NLLB codes |
| `src/translation/language/script-detector.ts` | Unicode code point analysis → ScriptStats, identifies language from script (Hangul→kor, Hiragana/Katakana→jpn, etc.) |
| `src/translation/language/language-detector.ts` | TinyLD integration — wraps `detectAll()`, restricts to supported NLLB languages |
| `src/translation/language/language-resolver.ts` | Language resolution algorithm: filter useless OCR, script distribution, script-first detection, TinyLD fallback, confidence threshold (0.6), Vietnamese passthrough |
| `src/translation/preprocess/normalize.ts` | Text normalization: trim, collapse whitespace, normalize line breaks, remove OCR artifacts |
| `src/translation/preprocess/protect-tokens.ts` | Token protection for URLs, emails, numbers, percentages, currency, hex colors, file paths, code identifiers — replaces with `__TOKEN_N__` placeholders |
| `src/translation/preprocess/grouping.ts` | Groups OCR boxes into TranslationUnits by line proximity, reading order, enforces 800 char limit with sentence-boundary splitting, and records region/box indexes for result mapping |
| `src/translation/postprocess/normalize-output.ts` | Output normalization: trim, collapse whitespace, restore protected tokens |

### Job Queue

| File | Role |
|---|---|
| `src/queue/types.ts` | Queue + port protocol types: `JobType` (`"ocr"` \| `"translate"`), `JobPayload` (`ocr`, `translate-regions`, `translate-text`), `Job`, `JobResponse`, `ExtensionPort`, port names (`image-translate/content`, `image-translate/offscreen`), and the wire messages (`queue/enqueue`, `queue/ping`, `queue/ready`, `queue/result`) |
| `src/queue/priority-queue.ts` | `PriorityQueue` — two FIFO buckets (translate priority 0, OCR priority 1) with a weighted-fair `pickType()` policy: translation first, but after `MAX_TRANSLATION_BEFORE_OCR = 2` consecutive translation dispatches the next OCR dispatch is forced. API: `enqueue`, `dequeue`, `dequeueMany(max)` (one kind per call), `peekType`, `size`, `isEmpty`, `clear(reason)` |

### Utilities

| File | Role |
|---|---|
| `utils/overlay.ts` | Shared overlay DOM creation, positioning, translated-region rendering, and container management |
| `utils/element-state.ts` | Generic element tracking (processing set, processed map, overlay map, mutation maps, resize observer, **error map**) with lifecycle cleanup; exposes `setError`/`getError`/`clearError` for per-element error tracking |
| `utils/ocr-pipeline.ts` | Image URL resolution (srcset), canvas-to-base64, fetch-to-base64, and sending OCR jobs to the background port via `requestJob()` |
| `utils/ocr-region-grouping.ts` | Spatial grouping of OCR word/line boxes into logical text regions using adjacency heuristics and convex hull |
| `utils/dom-observer.ts` | Live MutationObserver for new DOM nodes, SPA URL change polling, used by content script for auto-translation |
| `utils/asset-cache.ts` | IndexedDB asset caching, cache URL validation, fetch wrapper installation |
| `utils/ocr-batcher.ts` | PaddleOcrService model initialization and **per-item independent OCR via a bounded `OCR_CONCURRENCY` pool** (default 1) with per-item try/catch, then region grouping. Session options use the SDK defaults (`graphOptimizationLevel: "all"`, CPU memory arena and mem pattern on) and leave `executionProviders` to the SDK's own WebGPU adapter probe |
| `utils/port-client.ts` | Content-side port client — lazily opens one long-lived `runtime.connect({ name: "image-translate/content" })` port to the background, exposes `requestJob(payload)` which enqueues a job and resolves with its `JobResponse`, auto-reconnects on disconnect (rejecting in-flight jobs), and times out after 180 s |
| `utils/image-fetch.ts` | `fetchImageAsBase64(url, headers)` — resolves remote images to base64 inside the offscreen document, which inherits the extension host permissions |
| `utils/extension-settings.ts` | Centralized settings retrieval and domain permission checking; defines `ExtensionSettings` (`enabled`, `enabledDomains`, `targetLang`, `translationProvider`) with `DEFAULT_SETTINGS` defaults and `getExtensionSettings()` merge. `translationProvider` defaults to `"api"` |
| `utils/domain-matcher.ts` | URL domain/pattern matching for extension enablement rules |
| `utils/constants.ts` | Shared constants (offscreen paths, message targets) |
| `utils/languages.ts` | Popup language list (`SUPPORTED_LANGUAGES`, 17 choices), `DEFAULT_TARGET_LANG` (`vi`), and lookup helpers. The current NLLB source map covers 15 of these choices; Turkish and Indonesian are exposed by the UI but are not mapped for automatic translation in 0.1.0. |
| `utils/popup-base.ts` | Shared popup base: z-index, font, border-radius, box-shadow constants, container creation, and keyframe animation injection |
| `utils/toast.ts` | Inline DOM toast notifications using shared popup base; debounce, dedup, auto-removal |
| `utils/translation-popup.ts` | Hover-activated translation popup for OCR overlay boxes; mouseenter on a box shows the popup after a debounce, mouseleave arms a delayed close, and responses update the result safely. The popup displays original, sentence, and optional word translations using the cached default target; it does not currently render a target-language selector. Public API: `showTranslationPopup(anchor, text, word, onReady?, existingTranslation?)`, `updateTranslationPopup(popup, translation?, error?)`, `dismissTranslationPopup()`, `cancelCloseDelay()`, `startCloseDelay(cb, ms?)`, and `setDefaultTargetLang(lang)`. |

### Config & Types

| File | Role |
|---|---|
| `config/ocr-config.ts` | OCR admission-control constants: `OCR_CONCURRENCY = 1` (simultaneous OCR pipelines on the shared ORT sessions), `MAX_OCR_IMAGES_PER_PAGE = 5` (largest-first up front), `OCR_MIN_SIDE_PX = 30`. The old `OCR_BATCH_SIZE` was dropped when the offscreen drain became strictly one job per dispatch |
| `types/index.ts` | All shared TypeScript types (Point, OCRBox, OCRRegion, OCRResult, OcrInputItem, message types, settings) |
| `wxt.config.ts` | WXT build configuration (manifest, permissions, CSP) |

## Feature Flow

1. **Content script activation**: `content.ts` runs automatically on all pages via manifest `<all_urls>` match. On load, it calls `autoTranslateIfAllowed()` which checks extension settings and domain permissions, collects every eligible image/canvas, sorts them by pixel area, starts the 5 largest immediately and queues the rest in a tail pass that runs one element at a time whenever nothing else is in flight. It also starts URL polling to detect SPA navigation and a live DOM observer for dynamically added elements (observer-discovered elements always go through the tail queue)
2. **Settings change handling**: The popup saves settings to `browser.storage.sync` and broadcasts a `settings/notify-changed` message to the background, which relays a `settings/changed` message to all content-script tabs. Each content script re-runs `autoTranslateIfAllowed()` AND calls `setDefaultTargetLang(settings.targetLang)` to cache the user's default target language for the hover translation popup. The content script also seeds this cache on load via `syncSettingsTargetLang()`.
3. **Target language selection**: Hovering an OCR overlay box opens the translation popup (`translation-popup.ts`), which uses the cached default target from settings. The popup currently displays the original text and translation result but does not render a target-language selector; `translate/text` requests use the cached target.
4. **User triggers translation**: On-demand translation is triggered through the context menu (`background/translate`); the popup currently displays and monitors image/canvas status rather than sending a batch-translate request
5. **New element added**: `dom-observer.ts` → `handleAddedNodes()` → calls `processNewImage()` or `processNewCanvas()`
6. **OCR pipeline**: `ocr-pipeline.ts` tries canvas extraction first, then fetch, then URL-based processing; every route ends in `requestJob({ kind: "ocr", ... })`
7. **Port hop to the queue**: `port-client.ts` sends `queue/enqueue` over the content port; `background.ts` records `jobId → contentPort`, lazily connects to the offscreen document (`ensureOffscreenRunning` + `queue/ping`/`queue/ready` handshake, up to 5 attempts), and forwards the job. OCR images sent as URLs are fetched to base64 inside the offscreen document. One-shot `runtime.onMessage` traffic (settings, error broadcast) bypasses the queue and ports.
8. **Region grouping**: `ocr-batcher.ts` converts raw PaddleOCR boxes to `OCRBox[]`, runs `groupOcrBoxesIntoRegions()` to produce `OCRRegion[]` with convex hull bounds and concatenated text
9. **Result callback**: OCR regions flow back via `onSuccess` callback → `renderImageOverlay()` / `renderCanvasOverlay()` creates region overlays; translated regions replace the original overlay text after the translation response
10. **Overlay positioning**: `element-state.ts` ResizeObserver + rAF-scheduled batch updates keep overlays aligned with their target elements
11. **Overlay hover popup**: `overlay.ts` attaches `mouseenter`/`mouseleave` to each translated region div; `mouseenter` shows the translation popup, `mouseleave` arms a delayed dismiss; the popup owns manual `translate/text` requests (`translation-popup.ts`)
12. **Host communication**: `window.sendOcrToHost(src, ocrRegions)` / `window.removeOcrFromHost(src)` allow external scripts to render or clear overlays. The legacy/planned spelling `removeOcrToHost` is not the current exported function name.
13. **Asset caching**: `asset-cache.ts` intercepts fetch for model assets and caches them in IndexedDB, avoiding redundant downloads
14. **Batch OCR**: `ocr-batcher.ts` initializes PaddleOcrService and runs `model.batchRecognize()` on image buffers, at most `OCR_CONCURRENCY` at a time. The offscreen drain loop dequeues a single job per dispatch, so a hover-popup translation can run between two images instead of waiting for a whole OCR batch.
15. **Translation (NEW - NLLB-200)**: 
    - Content script calls `requestJob({ kind: "translate-regions", regions })` right after OCR succeeds; the hover popup calls `requestJob({ kind: "translate-text", ... })`
    - Both travel over the same content port → background port → offscreen queue; the offscreen document never receives a `runtime.sendMessage` from the background anymore
    - `PriorityQueue` gives translation priority over OCR but forces an OCR dispatch after 2 consecutive translation dispatches
    - `entrypoints/offscreen/offscreen.ts` drains the queue: OCR jobs are batched up to `OCR_BATCH_SIZE`, translation jobs run one at a time
    - `translationEngine` groups regions into `TranslationUnit[]`, detects language, and creates a model Web Worker with Vite's `?worker` bundle
    - Worker scheduler: deduplicates texts, checks L1/L2 cache, groups by source language, batches, calls model manager, and returns `boxIndexes` for overlay mapping
    - Model manager loads `Xenova/nllb-200-distilled-600M` (WebGPU → WASM fallback), translates to Vietnamese (`vie_Latn`)
    - `applyTranslationsToRegions()` maps results to `OCRRegion.translation` and content re-renders the translated overlay; the result travels back as `queue/result` and the background routes it to the waiting tab
16. **Extension settings**: `extension-settings.ts` centralizes settings retrieval (`enabled`, `enabledDomains`, `targetLang`) with `DEFAULT_SETTINGS` defaults and domain permission checking, eliminating duplication in `background.ts`
17. **Popup settings UI**: `entrypoints/popup/App.tsx` Settings tab renders a Default Target Language `<select>` bound to `SUPPORTED_LANGUAGES`; saving writes `targetLang` to `browser.storage.sync` and broadcasts `settings/notify-changed` so content scripts cache the new default
18. **Per-item independent OCR**: `ocr-batcher.ts` runs each image's OCR call in its own try/catch through a bounded concurrency pool, so one image's failure cannot affect others in the same batch and no two pipelines compete for the same ORT session. Offscreen handler (`offscreen.ts`) preserves per-item results.
19. **Error tracking & popup display**: `element-state.ts` adds `errorMap` with `setError`/`getError`/`clearError`; `content.ts` marks failed images/canvases as "error" status before calling `onComplete`; `types/index.ts` extends `ImageInfoWithStatus`/`CanvasInfoWithStatus` with `"error"` status; popup (`App.tsx`) shows error badges on tabs, "Error" label in list items, and `.status-error` / `.tab-badge.error` styles.

## Key Design Patterns

- **Generic element tracking**: `createElementState<T>()` eliminates duplication between image and canvas state management
- **Callback-based OCR pipeline**: `processImage()` / `processCanvas()` accept `onSuccess` callbacks for decoupled result rendering
- **Overlay utilities**: Shared positioning, box creation, and container management in `overlay.ts` avoid duplicated CSS and DOM logic
- **Popup base**: `popup-base.ts` centralizes z-index, font, border-radius, box-shadow, color themes, and keyframe animation injection; `toast.ts` and `translation-popup.ts` both consume it to eliminate duplication
- **Observer lifecycle**: Every resize observer, mutation observer, and overlay DOM node is tracked and cleaned up on element removal or src change
- **Per-item OCR independence**: `ocr-batcher.ts` uses a bounded concurrency pool with per-item try/catch, so one image's OCR failure cannot cascade and only `OCR_CONCURRENCY` pipelines touch the shared ORT sessions at once
- **Persistent error state**: `element-state.ts` `errorMap` tracks per-element errors through the processing lifecycle; errors survive `onComplete` cleanup so the popup can display them via `collectImageInfo`/`collectCanvasInfo`
- **Web Worker isolation**: Translation runs in a dedicated Web Worker (`src/translation/worker.ts`) created by the offscreen document, keeping both the page and service worker responsive during model inference
- **Port-based job lifecycle (2026-09-25)**: OCR and translation use long-lived `runtime.connect` ports (content → background → offscreen) instead of one-shot `runtime.sendMessage` + async `sendResponse`. This removes the "A listener indicated an asynchronous response … channel closed" failure caused by the MV3 service worker being evicted mid-request, and an open port keeps the worker alive from Chrome 114 onward
- **Shared priority queue (2026-09-25)**: `src/queue/priority-queue.ts` lives in the offscreen document (the only long-lived context that owns both OCR and translation) and arbitrates with a weighted-fair policy — translation first, one forced OCR dispatch after `MAX_TRANSLATION_BEFORE_OCR = 2` translations — so a hover-popup translation flood can never starve page OCR
- **Crash triage → hosted translation + OCR admission control (2026-09-26)**: The `VerifyEachNodeIsAssignedToAnEp` warning is emitted once per ORT session creation and is itself benign, but it marked the point where the offscreen document was re-initializing. Root cause of the reload loop was resource pressure, not model count: `runBatchOcr` fanned out over up to 6 images with `Promise.allSettled` (the SDK's own `resolveConcurrency()` returns 1 for accelerator EPs precisely because concurrent `session.run()` on one WebGPU session is unsafe), and NLLB-600M in fp32 (~2.4 GB) ran on the same GPU at the same time. Fixes: (a) `translationProvider: "api"` default, which keeps the model off the GPU entirely; (b) `OCR_CONCURRENCY = 1` bounded pool instead of the unbounded fan-out; (c) ORT session options restored to the SDK's Web defaults (`graphOptimizationLevel: "all"`, memory arena + mem pattern on) instead of the debug values `disabled`/`false`/`false`, and the duplicated `"gpu"`/`"webgpu"` EP pair replaced by the SDK's adapter probe; (d) the content script now starts only the 5 largest images and defers the rest to a one-at-a-time tail queue; (e) SDK verbose logging turned off (it was dumping full region arrays per image). Trade-off accepted: on a page with many images, smaller ones finish noticeably later.
- **Two-level caching**: L1 in-memory Map for instant hits, L2 IndexedDB for persistence across sessions, with SHA-256 keys including model/engine version for automatic invalidation
- **Token protection**: Numbers, URLs, currency, code identifiers preserved through translation via placeholder replacement
- **Graceful degradation**: Worker failure falls back to returning original text; low-confidence language detection returns original; per-unit errors don't block other units

## Notes & Future Work

- **Priority queue + port lifecycle fix (2026-09-25)**: Replaced the fire-and-forget `runtime.sendMessage` pipeline (which logged "A listener indicated an asynchronous response … channel closed" whenever the MV3 worker was evicted before `sendResponse`) with long-lived ports. `utils/port-client.ts` (content) → `background.ts` (`onConnect` router, `jobId → contentPort` map, shared offscreen port with `queue/ping`/`queue/ready` handshake and 5-attempt reconnect) → `offscreen.ts` (port listener + drain loop). Scheduling moved out of the background debounce timer into `PriorityQueue` inside the offscreen document. Removed as a consequence: `ocr/process`, `translate/text`, `translate/regions`, `offscreen/batch-run-ocr`, `offscreen/translate-text` and `offscreen/translate-regions` message types (plus their `any[]` response types), `OCR_BATCH_DEBOUNCE_MS`, and the never-imported `MAX_CONCURRENT`. `runtime.onMessage` now only carries settings broadcast, error broadcast and popup↔content `ui/*` traffic.
- **Missing worker `status` handler fixed (2026-09-25)**: `engine.ts#getStatus()` posts `{ type: "status" }`, but the `worker.ts` switch had no such case and answered with an error, so `translationEngine.getStatus()` always rejected. Added the `WORKER_API.status` case returning `getModelStatus()`; the now-exhaustive `default` branch was rewritten to avoid a `never` access.
- **Future queue work**: no unit-test runner exists in the repo, so `PriorityQueue` is currently verified by ad-hoc scripts only; queue depth/metrics are not exposed to the popup, the queue does not survive an extension reload, and `MAX_TRANSLATION_BEFORE_OCR` is a hard-coded constant rather than a setting.
- **Known limitation — hosted provider (2026-09-26)**: the Google endpoint is undocumented and unauthenticated, so it can rate-limit or change without notice; a failing request degrades to the original untranslated text (`INFERENCE_FAILED`) rather than falling back to the on-device model, which would reintroduce the GPU pressure this change removes. If it becomes unreliable, swap `src/translation/providers/google-translate.ts` for a keyed provider — the `TranslationProvider` seam is already in place. Also note `MAX_OCR_IMAGES_PER_PAGE` is a heuristic on pixel area, not text density, and tail items still run (one at a time), so a very image-heavy page still eventually processes everything.
- **Translation engine implemented (2026-09-20)**: Single NLLB-200 distilled 600M model with automatic language detection now handles 15 NLLB-mapped source languages → Vietnamese. Replaces per-language opus-mt models. Runs in Web Worker with WebGPU/WASM, L1/L2 caching, token protection, and graceful degradation.
- **Translation runtime moved to offscreen (2026-09-22)**: The service worker no longer imports the translation engine or creates a `Worker`. The offscreen document owns the engine and bundled model worker; background only ensures the offscreen document exists and forwards internal translation messages. `TranslationResult.boxIndexes` preserves OCR mapping across structured-clone boundaries, and overlays render `OCRRegion.translation`.
- **Popup↔content script message-type contract (2026-09-19)**: The popup's `pollPageData` and `progressListener` previously checked non-prefixed message types (`"image-status-list"`, `"translate-images-progress"`, `"extension-error"`) that never matched what the content script / background actually send (`"ui/image-status-list"`, `"translate/progress"`, `"extension/error"`), so the image/canvas lists always stayed empty ("No images found on this page"). Fixed in `App.tsx`: response checks now match the `ui/`-prefixed types and progress listener matches `translate/progress`/`translate/complete`/`extension/error`. `pollPageData` uses `Promise.allSettled` so a missing content script (browser-restricted URLs like `chrome://`/`about:`, not-yet-loaded tabs) only resets state when both polls fail — preserving a partial result. The background `extension/error` handler now relays errors via `runtime.sendMessage` (in addition to the existing `tabs.sendMessage` broadcast) so the popup, which lives in an extension-page context unreachable via `tabs.sendMessage`, also receives them. `types/messages.ts` `ImageStatusListResponse`/`CanvasStatusListResponse` status unions now include `"error"`.
- **Settings broadcast repair**: The popup previously sent `notify-settings-changed`, which the background never matched (it listened for `settings/notify-changed`), so `settings/changed` was never relayed to content scripts. This has been corrected so settings now propagate live.
- **Translation batching**: per-`srcLang:targetLang` batches mean each target language is translated by a separate model instance; the cache in `ocr-batcher.ts`/`translation.ts` keys loaded models by `<src>-<target>`.
- **Async independent OCR + error tracking (2026-09-18)**: Implemented per-item independent OCR in `ocr-batcher.ts` using `Promise.allSettled` with individual try/catch. Added `errorMap` to `element-state.ts` with `setError`/`getError`/`clearError` methods. Extended `ImageInfoWithStatus`/`CanvasInfoWithStatus` status union with `"error"`. Updated `content.ts` to mark failed elements as error before `onComplete` and include error status in `collectImageInfo`/`collectCanvasInfo`. Updated popup `App.tsx` with error count state, error badges on tabs, "Error" label, and CSS styles (`.status-error`, `.tab-badge.error`). This fixes the "No images found" popup issue when OCR fails on some images — errored images now remain visible with "Error" status instead of reverting to "pending".

## Out of Scope (MVP)

- Server-side translation fallback
- Per-language model selection
- Automatic target language fixed to Vietnamese (`TARGET_LANGUAGE` overrides request targets); the popup settings UI stores `targetLang`, but the 0.1.0 engine does not honor alternate targets
- Translation quality scoring / confidence
- LLM-based post-correction
- Full document layout analysis

## Release Documentation (0.1.0)

- `README.md` is the user-facing guide for features, languages, screenshots, installation, permissions, usage, settings, architecture, development, limitations, and attribution.
- `CHANGELOG.md` follows Keep a Changelog and records the first public release as `0.1.0` on 2026-09-21.
- `changes.md` retains the detailed development history and now begins with a concise `0.1.0` release summary.
- `package.json` identifies the project as `image-translate`, version `0.1.0`, with a user-facing description; WXT uses these values in the generated manifest.
- Release validation: `bun run compile`, `bun run build`, `bun run build:firefox`, `bun run zip`, and `bunx biome check .` pass.
- Future release work: add real screenshots under `docs/screenshots/`, publish to browser stores, add a license, map all popup language choices to NLLB source/target codes, implement the hover popup target selector, and expose an actual popup batch-translate action if required.
