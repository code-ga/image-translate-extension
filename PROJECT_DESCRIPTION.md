# Image Translate Extension

A browser extension (WebExtension Manifest V3) that detects images and canvas elements on web pages, runs OCR on them using PaddleOCR via an offscreen document, and renders translation overlay boxes on the translated text.

## Architecture

### Entrypoints

| File | Role |
|---|---|
| `entrypoints/content.ts` | Content script — orchestrates OCR processing, overlay rendering, DOM observation, and auto-translation on page load/URL change |
| `entrypoints/background.ts` | Service worker — batches OCR requests, manages the offscreen document, handles extension settings and context menus, and routes translation requests to the offscreen document |
| `entrypoints/popup/App.tsx` | Popup UI — polls image/canvas status from the content script on an interval, shows the image/canvas list with status badges, and manages the Settings tab. Communicates with the content script via the `ui/` message protocol and listens for `translate/progress`, `translate/complete`, and `extension/error` events to stay in sync. On-demand translation is triggered by the context menu; the popup currently displays and monitors status rather than sending a batch-translate command. |
| `entrypoints/offscreen/offscreen.ts` | Browser-like offscreen document — runs PaddleOCR and owns the translation engine, including its model Web Worker |
| `entrypoints/offscreen/index.html` | HTML anchor for the offscreen document |

### Translation Engine (NEW)

| File | Role |
|---|---|
| `src/translation/engine.ts` | Offscreen document facade — owns the model Web Worker, handles worker lifecycle/message routing, and maps translation results back to OCR regions |
| `src/translation/worker.ts` | Bundled Web Worker entry point — registers `translate`, `warmup`, `dispose`, and `status` handlers when loaded |
| `src/translation/model-manager.ts` | Model manager (inside worker) — state machine `UNAVAILABLE → DOWNLOADING → LOADING → READY ↔ INFERENCE → ERROR → READY`, lazy-loads `Xenova/nllb-200-distilled-600M`, WebGPU preferred with WASM fallback, idle unload after 5 min |
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

### Utilities

| File | Role |
|---|---|
| `utils/overlay.ts` | Shared overlay DOM creation, positioning, translated-region rendering, and container management |
| `utils/element-state.ts` | Generic element tracking (processing set, processed map, overlay map, mutation maps, resize observer, **error map**) with lifecycle cleanup; exposes `setError`/`getError`/`clearError` for per-element error tracking |
| `utils/ocr-pipeline.ts` | Image URL resolution (srcset), canvas-to-base64, fetch-to-base64, and sending OCR jobs to background |
| `utils/ocr-region-grouping.ts` | Spatial grouping of OCR word/line boxes into logical text regions using adjacency heuristics and convex hull |
| `utils/dom-observer.ts` | Live MutationObserver for new DOM nodes, SPA URL change polling, used by content script for auto-translation |
| `utils/asset-cache.ts` | IndexedDB asset caching, cache URL validation, fetch wrapper installation |
| `utils/ocr-batcher.ts` | PaddleOcrService model initialization, **per-item independent batch OCR execution via Promise.allSettled**, and region grouping |
| `utils/extension-settings.ts` | Centralized settings retrieval and domain permission checking; defines `ExtensionSettings` (including `targetLang`) with `DEFAULT_SETTINGS` defaults and `getExtensionSettings()` merge |
| `utils/domain-matcher.ts` | URL domain/pattern matching for extension enablement rules |
| `utils/constants.ts` | Shared constants (offscreen paths, message targets) |
| `utils/languages.ts` | Popup language list (`SUPPORTED_LANGUAGES`, 17 choices), `DEFAULT_TARGET_LANG` (`vi`), and lookup helpers. The current NLLB source map covers 15 of these choices; Turkish and Indonesian are exposed by the UI but are not mapped for automatic translation in 0.1.0. |
| `utils/popup-base.ts` | Shared popup base: z-index, font, border-radius, box-shadow constants, container creation, and keyframe animation injection |
| `utils/toast.ts` | Inline DOM toast notifications using shared popup base; debounce, dedup, auto-removal |
| `utils/translation-popup.ts` | Hover-activated translation popup for OCR overlay boxes; mouseenter on a box shows the popup after a debounce, mouseleave arms a delayed close, and responses update the result safely. The popup displays original, sentence, and optional word translations using the cached default target; it does not currently render a target-language selector. Public API: `showTranslationPopup(anchor, text, word, onReady?, existingTranslation?)`, `updateTranslationPopup(popup, translation?, error?)`, `dismissTranslationPopup()`, `cancelCloseDelay()`, `startCloseDelay(cb, ms?)`, and `setDefaultTargetLang(lang)`. |

### Config & Types

| File | Role |
|---|---|
| `config/ocr-config.ts` | OCR batch size, concurrency, and debounce timing |
| `types/index.ts` | All shared TypeScript types (Point, OCRBox, OCRRegion, OCRResult, message types, settings) |
| `wxt.config.ts` | WXT build configuration (manifest, permissions, CSP) |

## Feature Flow

1. **Content script activation**: `content.ts` runs automatically on all pages via manifest `<all_urls>` match. On load, it calls `autoTranslateIfAllowed()` which checks extension settings and domain permissions, then processes all matching images/canvases. It also starts URL polling to detect SPA navigation and a live DOM observer for dynamically added elements
2. **Settings change handling**: The popup saves settings to `browser.storage.sync` and broadcasts a `settings/notify-changed` message to the background, which relays a `settings/changed` message to all content-script tabs. Each content script re-runs `autoTranslateIfAllowed()` AND calls `setDefaultTargetLang(settings.targetLang)` to cache the user's default target language for the hover translation popup. The content script also seeds this cache on load via `syncSettingsTargetLang()`.
3. **Target language selection**: Hovering an OCR overlay box opens the translation popup (`translation-popup.ts`), which uses the cached default target from settings. The popup currently displays the original text and translation result but does not render a target-language selector; `translate/text` requests use the cached target.
4. **User triggers translation**: On-demand translation is triggered through the context menu (`background/translate`); the popup currently displays and monitors image/canvas status rather than sending a batch-translate request
5. **New element added**: `dom-observer.ts` → `handleAddedNodes()` → calls `processNewImage()` or `processNewCanvas()`
6. **OCR pipeline**: `ocr-pipeline.ts` tries canvas extraction first, then fetch, then URL-based background processing
7. **Background batch**: `background.ts` queues OCR requests, batches them, sends to offscreen document for PaddleOCR inference
8. **Region grouping**: `ocr-batcher.ts` converts raw PaddleOCR boxes to `OCRBox[]`, runs `groupOcrBoxesIntoRegions()` to produce `OCRRegion[]` with convex hull bounds and concatenated text
9. **Result callback**: OCR regions flow back via `onSuccess` callback → `renderImageOverlay()` / `renderCanvasOverlay()` creates region overlays; translated regions replace the original overlay text after the translation response
10. **Overlay positioning**: `element-state.ts` ResizeObserver + rAF-scheduled batch updates keep overlays aligned with their target elements
11. **Overlay hover popup**: `overlay.ts` attaches `mouseenter`/`mouseleave` to each translated region div; `mouseenter` shows the translation popup, `mouseleave` arms a delayed dismiss; the popup owns manual `translate/text` requests (`translation-popup.ts`)
12. **Host communication**: `window.sendOcrToHost(src, ocrRegions)` / `window.removeOcrFromHost(src)` allow external scripts to render or clear overlays. The legacy/planned spelling `removeOcrToHost` is not the current exported function name.
13. **Asset caching**: `asset-cache.ts` intercepts fetch for model assets and caches them in IndexedDB, avoiding redundant downloads
14. **Batch OCR**: `ocr-batcher.ts` initializes PaddleOcrService and runs `model.batchRecognize()` on batches of image buffers
15. **Translation (NEW - NLLB-200)**: 
    - Content script sends `translate/regions` with `OCRRegion[]` to background after OCR completes
    - Background ensures the offscreen document exists and forwards an internal `offscreen/translate-regions` request; it does not import or run the model
    - `entrypoints/offscreen/offscreen.ts` owns `translationEngine`; it groups regions into `TranslationUnit[]`, detects language, and creates a model Web Worker with Vite's `?worker` bundle
    - Worker scheduler: deduplicates texts, checks L1/L2 cache, groups by source language, batches, calls model manager, and returns `boxIndexes` for overlay mapping
    - Model manager loads `Xenova/nllb-200-distilled-600M` (WebGPU → WASM fallback), translates to Vietnamese (`vie_Latn`)
    - `applyTranslationsToRegions()` maps results to `OCRRegion.translation` and content re-renders the translated overlay; popup `translate/text` requests follow the same offscreen route
16. **Extension settings**: `extension-settings.ts` centralizes settings retrieval (`enabled`, `enabledDomains`, `targetLang`) with `DEFAULT_SETTINGS` defaults and domain permission checking, eliminating duplication in `background.ts`
17. **Popup settings UI**: `entrypoints/popup/App.tsx` Settings tab renders a Default Target Language `<select>` bound to `SUPPORTED_LANGUAGES`; saving writes `targetLang` to `browser.storage.sync` and broadcasts `settings/notify-changed` so content scripts cache the new default
18. **Per-item independent OCR**: `ocr-batcher.ts` wraps each image's OCR call in its own try/catch via `Promise.allSettled`, so one image's failure cannot affect others in the same batch. Offscreen handler (`offscreen.ts`) preserves per-item results.
19. **Error tracking & popup display**: `element-state.ts` adds `errorMap` with `setError`/`getError`/`clearError`; `content.ts` marks failed images/canvases as "error" status before calling `onComplete`; `types/index.ts` extends `ImageInfoWithStatus`/`CanvasInfoWithStatus` with `"error"` status; popup (`App.tsx`) shows error badges on tabs, "Error" label in list items, and `.status-error` / `.tab-badge.error` styles.

## Key Design Patterns

- **Generic element tracking**: `createElementState<T>()` eliminates duplication between image and canvas state management
- **Callback-based OCR pipeline**: `processImage()` / `processCanvas()` accept `onSuccess` callbacks for decoupled result rendering
- **Overlay utilities**: Shared positioning, box creation, and container management in `overlay.ts` avoid duplicated CSS and DOM logic
- **Popup base**: `popup-base.ts` centralizes z-index, font, border-radius, box-shadow, color themes, and keyframe animation injection; `toast.ts` and `translation-popup.ts` both consume it to eliminate duplication
- **Observer lifecycle**: Every resize observer, mutation observer, and overlay DOM node is tracked and cleaned up on element removal or src change
- **Per-item OCR independence**: `ocr-batcher.ts` uses `Promise.allSettled` with per-item try/catch to ensure one image's OCR failure cannot cascade to other images in the batch
- **Persistent error state**: `element-state.ts` `errorMap` tracks per-element errors through the processing lifecycle; errors survive `onComplete` cleanup so the popup can display them via `collectImageInfo`/`collectCanvasInfo`
- **Web Worker isolation**: Translation runs in a dedicated Web Worker (`src/translation/worker.ts`) created by the offscreen document, keeping both the page and service worker responsive during model inference
- **Two-level caching**: L1 in-memory Map for instant hits, L2 IndexedDB for persistence across sessions, with SHA-256 keys including model/engine version for automatic invalidation
- **Token protection**: Numbers, URLs, currency, code identifiers preserved through translation via placeholder replacement
- **Graceful degradation**: Worker failure falls back to returning original text; low-confidence language detection returns original; per-unit errors don't block other units

## Notes & Future Work

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
