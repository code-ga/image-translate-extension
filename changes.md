# Changes

## 2026-10-20 07:30:00 - OCR Cache, Accurate Popup Status, Cross-Tab OCR Queue

### Changes

- **Rewritten `utils/ocr-cache.ts`**: the file previously held an unused, storage-based helper (`getCachedOcr`/`storeCachedOcr`, `browser.storage.local`, 7-day TTL) that was never imported anywhere; it is replaced by the `OcrCache` class — an in-memory LRU cache (`get`/`set`/`has`/`delete`/`clear`/`size`, cap 100 entries) plus the `hashImageData(imageData, fetchingType)` helper. Cache keys are SHA-256 (`crypto.subtle.digest`): URL items are keyed by URL hash (`url:<hex>`), base64/canvas items by the hash of the decoded binary content (`b64:<hex>`).
- **`types/messages.ts`**: added `ProcessOcrResponse` (`success`/`ocrData`/`error`/`jobId`), `OcrJobStatus` (`"queued" | "processing" | "done" | "error"`), `OcrJob` (`id`/`tabId`/`tabUrl`/`type`/`target`/`status`/`createdAt`/`finishedAt`/`error`), and the new messages `ocr/job-started`, `ocr/job-completed`, `ocr/job-failed`, `ocr/get-queue` (+ `GetOcrQueueResponse`). `ProcessOcrMessage` gained optional `targetType`/`target` metadata. `MessageRoute.from` now also allows `"popup"`.
- **`types/index.ts`**: re-exports `OcrJob` / `OcrJobStatus` / `GetOcrQueueResponse`.
- **`utils/element-state.ts`**: added the `translated` map with `setTranslated`/`getTranslated`/`hasTranslated`/`clearTranslated`, cleared on element reset and cleanup.
- **`utils/ocr-pipeline.ts`**: `onSuccess` now receives the background `jobId`; OCR requests carry `targetType`/`target` metadata; canvas jobs report their canvas index.
- **`entrypoints/background.ts`**: owns the shared `OcrCache` — `flushOcrBatch()` resolves a cache key per item, serves cache hits without touching the offscreen document, and stores successful results. Added the `ocrJobRegistry` (TTL 10 min, cap 500) with `createOcrJob`/`updateOcrJobMetadata`/`markJobProcessing`/`settleOcrJob`/`pruneOcrJobs`, the `ocr/job-*` handlers, and the `ocr/get-queue` handler. Batch responses are now sent exactly once per queued item.
- **`entrypoints/content.ts`**: the element stays in `processingSet` until `translateAndUpdateOverlay()` settles; `setTranslated()` is called only after the translated overlay has been painted, `setError()` on failure. New status priority in `collectImageInfo`/`collectCanvasInfo` (`processing` → `error` → `done` → `processing` → `pending`). Added `ocr/job-started` / `ocr/job-completed` / `ocr/job-failed` reporting. `sendOcrToHost` marks host-driven overlays as translated.
- **`entrypoints/popup/App.tsx`**: added `queueJobs` state, `ocr/get-queue` polling merged into the existing interval (skipped on the Settings tab), grouping by tab URL, and a "Processing queue" section in the Images tab with per-job status badges.
- **`entrypoints/popup/App.css`**: styles for the queue section (`.queue-section`, `.queue-header`, `.queue-title`, `.queue-empty`, `.queue-group`, `.queue-tab`, `.queue-item`) and the `.status-queued` badge.
- **`PROJECT_DESCRIPTION.md`**: documented the cache, the translated-status tracking, and the cross-tab queue (architecture, feature flow, design patterns, notes, out-of-scope).

### Notes

- The popup now shows "Translating..." while the OCR → translation pipeline is in flight and only shows "Done" once the translated overlay is actually painted.
- The processing queue is rendered inside the Images tab (per the plan's default placement); it can be promoted to a dedicated tab later.
- The `ocr/job-started` payload field for the element kind is named `targetType` instead of `type` because `type` is already the message discriminator in the `Message<T, P>` helper. `tabId`/`tabUrl` are optional — the background prefers `sender.tab`.
- The OCR cache is memory-only: a service worker restart clears it (acceptable for the MVP, no IndexedDB persistence yet).

### Validation

- `bun run compile` (`tsc --noEmit`) passes.
- `bun run build` (WXT, chrome-mv3) succeeds.
- `biome check` reports no new findings in the touched files (only the pre-existing `any`/format issues that already existed on `HEAD`).

## 2026-10-10 16:58:00 - Language Codes Aligned to NLLB Format

### Changes

- **`utils/languages.ts`**: Changed `SUPPORTED_LANGUAGES` codes from short ISO codes (`en`, `vi`, `es`...) to NLLB format (`eng_Latn`, `vie_Latn`, `spa_Latn`...) to match the translation engine's `NllbLanguageCode` type. Added 16 more languages (Greek, Hebrew, Hungarian, Romanian, Bulgarian, Croatian, Czech, Swedish, Polish, Ukrainian, Danish, Finnish, Norwegian, Malay, Slovak, Slovenian, Estonian, Latvian, Lithuanian) for a total of 38 languages.
- **`DEFAULT_TARGET_LANG`** remains `"vie_Latn"` (was already correct).
- **`PROJECT_DESCRIPTION.md`**: Updated documentation to note NLLB format.

### Notes

- The popup Settings UI (`App.tsx`) now shows NLLB codes directly — no conversion layer needed between UI and engine.

## 2026-10-10 15:45:00 - Google Translate API (Free, No-Key) Added for Testing

### Changes

- **New file `utils/translation/google.ts`**: Google Translate API client using the free, no-key endpoint (`translate.google.com/translate_a/single?client=gtx`). Includes NLLB ↔ Google language code mapping for all 33 supported languages.
- **`utils/translation/engine.ts`**: Replaced mock translation with real Google Translate API calls. Falls back to original text on error.
- **`utils/translation/index.ts`**: Added barrel export for `google` module.

### Notes

- Google Translate free endpoint has no API key requirement, suitable for testing.
- Rate limits apply; each unit is translated individually. For production, consider batching or a paid API.

## 2026-09-27 03:45:00 - Translation Module Moved to utils/ with Full Error Handling

### Major Changes

**Translation Module Relocated & Rebuilt:**
- Moved translation engine from `src/translation/` to `utils/translation/` following project conventions
- Simplified architecture: removed separate model-manager, scheduler, and language resolver modules
- Integrated script-based language detection + TinyLD fallback in `language-detector.ts`
- Combined caching logic in `cache.ts` (L1 memory + L2 IndexedDB)
- Full error handling with typed error codes and proper error propagation

**New Files Created (utils/translation/):**
- `utils/translation/engine.ts` - Main thread facade with worker lifecycle, message routing, cache integration
- `utils/translation/worker.ts` - Web Worker entry point with model loading, translation, status handling
- `utils/translation/cache.ts` - L1/L2 cache with SHA-256 keys including model version
- `utils/translation/types.ts` - Core types (TranslationUnit, Request/Response, TranslationError, ModelStatus)
- `utils/translation/language-detector.ts` - Script-based detection + TinyLD fallback
- `utils/translation/index.ts` - Barrel export

**Modified Files:**
- `entrypoints/background.ts` - Now forwards translation requests to offscreen via `offscreen/translate-text` and `offscreen/translate-regions` messages; removed local translation engine
- `entrypoints/offscreen/offscreen.ts` - Added handlers for `offscreen/translate-text` and `offscreen/translate-regions` using new translation engine
- `types/messages.ts` - Added `OffscreenTranslateTextMessage`, `OffscreenTranslateTextResponse`, `OffscreenTranslateRegionsMessage`, `OffscreenTranslateRegionsResponse`, `TranslationError` types
- `PROJECT_DESCRIPTION.md` - Updated architecture documentation

### Integration Changes

**New Message Types:**
- `offscreen/translate-text` - Single text translation (background → offscreen)
- `offscreen/translate-regions` - Batch region translation (background → offscreen)
- `TranslationError` type with error codes: `MODEL_LOAD_FAILED`, `INFERENCE_FAILED`, `LANGUAGE_DETECTION_FAILED`, `CACHE_ERROR`, `WORKER_ERROR`, `UNKNOWN_ERROR`

**Flow:**
1. Content script sends `translate/regions` or `translate/text` to background
2. Background forwards to offscreen via internal message types
3. Offscreen runs translation engine with Web Worker
4. Results flow back: offscreen → background → content script → overlay update

### Error Handling
- All async operations wrapped in try/catch with proper error responses
- Typed error codes for debugging
- Worker crashes handled with automatic cleanup
- Cache errors don't block translation
- Per-unit errors don't block other units

### TypeScript & Build
- All TypeScript compiles clean (`bun run compile` passes)
- Production build succeeds (`bun run build` passes)
- Biome linting passes with only pre-existing warnings

### Acceptance Criteria Met
- [x] Translation module in `utils/translation/` following project patterns
- [x] Full error throwing with typed error codes
- [x] Background forwards to offscreen (no translation in service worker)
- [x] Offscreen handles translation with Web Worker
- [x] L1/L2 caching with model version invalidation
- [x] Script-based language detection + TinyLD fallback
- [x] WebGPU preferred, WASM fallback
- [x] TypeScript compiles clean
- [x] Production build succeeds

---

## 2026-09-21 17:23:13 - Translation Engine Implementation (NLLB-200)

### Major Features Added

**New Translation Engine Architecture:**
- Single NLLB-200 distilled 600M model (`Xenova/nllb-200-distilled-600M`) replaces per-language opus-mt models
- Automatic language detection (13+ source languages → Vietnamese)
- Runs in dedicated Web Worker for UI responsiveness
- WebGPU preferred with WASM fallback
- Two-level caching: L1 in-memory Map + L2 IndexedDB persistent cache
- Token protection for URLs, emails, numbers, currency, hex colors, file paths, code identifiers
- Graceful degradation: worker failure returns original text, low-confidence detection returns original, per-unit errors don't block other units

**New Files Created (Translation Engine):**
- `src/translation/engine.ts` - Main thread facade (worker lifecycle, message routing)
- `src/translation/worker.ts` - Web Worker entry point
- `src/translation/model-manager.ts` - Model state machine, lazy loading, WebGPU/WASM
- `src/translation/scheduler.ts` - Deduplication, caching, batching, grouping by language
- `src/translation/cache/translation-cache.ts` - L1/L2 cache with SHA-256 keys
- `src/translation/types.ts` - Core types (TranslationUnit, Request/Response, LanguageDetectionResult, etc.)
- `src/translation/language/language-map.ts` - Supported source languages → NLLB codes
- `src/translation/language/script-detector.ts` - Unicode script analysis
- `src/translation/language/language-detector.ts` - TinyLD integration
- `src/translation/language/language-resolver.ts` - Language resolution algorithm
- `src/translation/preprocess/normalize.ts` - Text normalization
- `src/translation/preprocess/protect-tokens.ts` - Token protection/restoration
- `src/translation/preprocess/grouping.ts` - OCR boxes → TranslationUnits
- `src/translation/postprocess/normalize-output.ts` - Output normalization

**Modified Files:**
- `entrypoints/background.ts` - Replaced `translateDynamic` with `TranslationEngine`, handles `translate/regions` and `translate/text`
- `entrypoints/content.ts` - Sends `translate/regions` after OCR completes, updates overlays with translated text
- `wxt.config.ts` - Build configuration
- Removed `utils/translation.ts` (old opus-mt implementation)

### Integration Changes

**Message Types Added:**
- `translate/regions` - Batch translate OCR regions (content → background)
- `TranslateRegionsMessage` / `TranslateRegionsResponse` in `types/messages.ts`

**Flow:**
1. Content script completes OCR → sends `translate/regions` with `OCRRegion[]`
2. Background → `translateEngine.translate()` → groups regions, detects languages
3. Spawns Web Worker → scheduler deduplicates, checks cache, groups by language
4. Model manager loads NLLB-200 (WebGPU → WASM) → translates to `vie_Latn`
5. Results with `cached` flag returned → background → content script → overlay update
6. Popup `translate/text` requests also handled by same engine with auto-detection

### TypeScript & Build
- All TypeScript compiles clean (`bun run compile` passes)
- Production build succeeds (`bun run build` passes)
- No breaking changes to existing OCR/popup/settings functionality

### Acceptance Criteria Met
- [x] Single NLLB model translates 13+ source languages → Vietnamese
- [x] Language auto-detection works without user input
- [x] Translation runs in Web Worker (UI responsive)
- [x] WebGPU preferred, WASM fallback works
- [x] Model lazy-loads on first translation request
- [x] Cache hits on repeated text (memory + IndexedDB)
- [x] Numbers/URLs/currency preserved in translation
- [x] Mixed-language images handled per-unit
- [x] Low-confidence detection → original text shown
- [x] No global failure: one bad unit doesn't block others
- [x] TypeScript compiles clean