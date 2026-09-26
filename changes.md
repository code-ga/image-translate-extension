# Changes

## [0.1.0] - 2026-09-21

First public release of Image Translate. This release packages the WXT + React Manifest V3 extension with automatic image/canvas detection, PaddleOCR in an offscreen document, NLLB-200 translation in a Web Worker, automatic source-language detection, hover translation popups, two-level caching, domain settings, context-menu actions, per-item error tracking, and Chrome/Chromium/Edge plus Firefox builds.

See `CHANGELOG.md` for the user-facing release notes and `README.md` for installation, permissions, usage, architecture, and limitations.

Validation for this release: `bun run compile`, `bun run build`, `bun run build:firefox`, `bun run zip`, and `bunx biome check .` pass.

## 2026-09-26 16:50:00 - Hosted Translation Provider + OCR Admission Control

### Diagnosed
- The `onnxruntime ... VerifyEachNodeIsAssignedToAnEp` warning is emitted **once per ORT session creation** and is benign on its own; it was a marker that the offscreen document was being torn down and re-initializing.
- Not a model-count problem: only 3 sessions ever exist (PaddleOCR detection + recognition, and the NLLB session in the worker), each created once and cached.
- It was concurrent inference plus memory pressure: `runBatchOcr` fanned out over up to `OCR_BATCH_SIZE` images with `Promise.allSettled` (6 concurrent pipelines), each running one detection `session.run()` plus one recognition `session.run()` **per detected box** (`strategy: "per-box"`), all against the *same two* ORT sessions — while NLLB-600M fp32 (~2.4 GB) held the same GPU. Concurrent `session.run()` on one WebGPU session is the known failure mode, and the SDK's own `resolveConcurrency()` returns 1 for accelerator EPs for exactly that reason.

### Added
- `src/translation/providers/google-translate.ts` — hosted provider using the free Google Translate endpoint (`translate_a/single`, `client=gtx`, no API key): `sl=auto`, 12 s timeout, 1 retry, max 5 requests in flight, plus `toGoogleLanguageCode()` (NLLB `vie_Latn` → `vi`, `zho_Hans` → `zh-CN`; unknown codes fall back to `vi`). Runs inside the translation worker, which inherits the extension's host permissions. Verified live: 5 mixed-language texts in ~2.1 s, URLs/numbers preserved.
- `TranslationProvider` (`"api" | "local"`) in `src/translation/types.ts`, carried on `TranslationRequest` and on the worker's `warmup`/`dispose`/`status` control payload.
- `ExtensionSettings.translationProvider` (default `"api"`) + a **Translation Engine** select in the popup Settings tab, so the two providers can be A/B'd without a reload.
- `TranslationErrorCode` gained `API_REQUEST_FAILED`.

### Changed
- `src/translation/model-manager.ts`: in `api` mode `loadModel()` short-circuits to READY and `translateTexts()` calls the hosted provider — the 600M pipeline is never created, so ~2.4 GB of weights never reach the GPU.
- `src/translation/engine.ts`: resolves the provider from settings per request; `api` mode honours the requested `targetLang` (the local model stays hard-wired to `vie_Latn`).
- `src/translation/scheduler.ts`: namespaces the L1/L2 cache per provider (`google-translate-api-v1` vs `nllb-200-distilled-600M-v1`) so switching engines cannot serve one engine's cached output to the other.
- `utils/ocr-batcher.ts`: replaced the unbounded `Promise.allSettled` fan-out with a bounded `OCR_CONCURRENCY` (1) pool, keeping per-item try/catch; restored the SDK's Web session defaults (`graphOptimizationLevel: "all"`, `enableCpuMemArena: true`, `enableMemPattern: true`) in place of the debug values `disabled`/`false`/`false`; dropped the duplicated `"gpu"`/`"webgpu"` EP pair and let the SDK probe an adapter itself; turned off SDK verbose logging (it dumped every region array per image).
- `entrypoints/offscreen/offscreen.ts`: the drain loop now dequeues **one job per dispatch**. Holding up to 6 OCR jobs in a single dispatch would have blocked every translation until the whole batch finished, defeating the weighted queue.
- `entrypoints/content.ts`: added a work admission scheduler — candidates are sorted by pixel area, the 5 largest start immediately, the rest are deferred to a tail queue that runs one element at a time whenever the page is otherwise idle; live-observer elements always use the tail queue; context-menu/popup actions still bypass it. Reuses `OCR_MIN_SIDE_PX` in place of the hardcoded `30`.
- `config/ocr-config.ts`: now `OCR_CONCURRENCY = 1`, `MAX_OCR_IMAGES_PER_PAGE = 5`, `OCR_MIN_SIDE_PX = 30`; `OCR_BATCH_SIZE` removed.

### Trade-offs accepted
- On pages with many images, everything below the 5 largest now completes later (they still run, one at a time).
- The `api` provider depends on an undocumented endpoint: a rate-limited or failing request degrades to the original untranslated text rather than silently loading the 2.4 GB model back onto the GPU.

### Validation
- `bun run compile` (tsc --noEmit) — 0 errors
- `bun run build` / `bun run build:firefox` — both succeed (`assets/worker-*.js`, 568 kB)
- `bunx biome check .` — exit 0, no diagnostics in any new or changed file
- Google endpoint checked live, including a non-Vietnamese target and language-code mapping edge cases

## 2026-09-25 17:05:00 - Priority Queue & Port-Based Message Lifecycle

### Fixed
- **"A listener indicated an asynchronous response … channel closed"**: OCR and translation no longer use one-shot `runtime.sendMessage` with an async `sendResponse`. Both now travel over long-lived `runtime.connect` ports (content → background → offscreen), which survive service-worker eviction and keep the worker alive from Chrome 114 onward.
- **Missing `status` worker handler**: `engine.ts#getStatus()` sent `{ type: "status" }`, which `src/translation/worker.ts` had no case for, so status lookups always failed. Added the `WORKER_API.status` case returning `getModelStatus()`.
- **Background OCR batching could interleave poorly**: OCR requests are now arbitrated by a shared queue in the offscreen document instead of an unbatched 80 ms debounce timer in the service worker.

### Added
- `src/queue/types.ts` — job and port protocol types (`JobType`, `JobPayload` = `ocr` / `translate-regions` / `translate-text`, `Job`, `JobResponse`, `ExtensionPort`, port names, `queue/enqueue`, `queue/ping`, `queue/ready`, `queue/result`).
- `src/queue/priority-queue.ts` — `PriorityQueue` with two FIFO buckets and a weighted-fair policy: translation first (priority 0), OCR second (priority 1), with one OCR dispatch forced after `MAX_TRANSLATION_BEFORE_OCR = 2` consecutive translations so a hover-popup flood can never starve page OCR. Supports `enqueue`/`dequeue`/`dequeueMany(max)`/`peekType`/`size`/`isEmpty`/`clear(reason)`.
- `utils/port-client.ts` — content-side port client with `requestJob(payload)`, lazy connect, auto-reconnect on disconnect, and a 180 s job timeout.
- `utils/image-fetch.ts` — `fetchImageAsBase64()`, moved out of the service worker so URL-based OCR images are resolved inside the offscreen document.
- `entrypoints/background.ts` port router: `onConnect` for `image-translate/content` ports, `jobId → contentPort` routing table, one shared `image-translate/offscreen` port with a `queue/ping`/`queue/ready` handshake and up to 5 reconnect attempts, plus `failPendingRoutes()` if the offscreen port drops.
- `entrypoints/offscreen/offscreen.ts` drain loop: enqueue on port message, drain with `queueMicrotask`, OCR dispatched in batches of `OCR_BATCH_SIZE`, translation one request at a time, results posted back as `queue/result`.

### Changed / Removed
- `entrypoints/offscreen/offscreen.ts` no longer registers a `runtime.onMessage` listener; `background.ts` keeps `onMessage` only for settings broadcast, error broadcast, and popup↔content traffic.
- `utils/ocr-pipeline.ts`, `entrypoints/content.ts` (`translateAndUpdateOverlay`) and `utils/translation-popup.ts` now call `requestJob()` instead of `browser.runtime.sendMessage`.
- `config/ocr-config.ts`: removed `OCR_BATCH_DEBOUNCE_MS` and the never-imported `MAX_CONCURRENT`; `OCR_BATCH_SIZE` is now read by the offscreen drain loop.
- `types/messages.ts`: `Message<>`'s default payload is `Record<string, never>` instead of `{}`; removed the now-dead `ProcessOcrMessage`, `BatchRunOcrMessage`, `BatchRunOcrResponse` (`results: any[]`), `TranslateTextMessage`, `TranslateRegionsMessage`, `OffscreenTranslate*Message` and the unused response aliases. Added `OcrInputItem` to `types/index.ts` so `utils/ocr-batcher.ts` and the queue share one item shape.

### Validation
- `bun run compile` (tsc --noEmit) — 0 errors
- `bun run build` / `bun run build:firefox` — both succeed, worker asset present in each output (`assets/worker-*.js`, 566 kB)
- `bunx biome check .` — exit 0, only the 16 pre-existing warnings (none in the new or changed files)
- `PriorityQueue` policy verified with an ad-hoc script: `t0,t1,o0..o3,t2,t3` for interleaved load, and `t0,t1,o0,t2..t9` when 10 translations are queued before the single OCR job

## 2026-09-22 23:29:45 - Translation Runtime Moved to Offscreen

- Removed `translationEngine` and `translateRegions` imports from `entrypoints/background.ts`; the service worker now forwards `offscreen/translate-text` and `offscreen/translate-regions` messages.
- Added offscreen translation handlers in `entrypoints/offscreen/offscreen.ts`; the browser-like offscreen document owns language detection, the translation engine, and its model worker.
- Replaced `import.meta.url` worker construction with Vite's `?worker` import in `src/translation/engine.ts`, and made `src/translation/worker.ts` register its message handlers when loaded.
- Added `TranslationBoxIndex` / `boxIndexes` to preserve OCR-to-translation mapping across worker structured-clone boundaries; `applyTranslationsToRegions()` now maps results into `OCRRegion.translation`.
- Updated `utils/overlay.ts` to render translated region text and pass cached translations to hover popups.
- Kept model loading lazy: startup creates the offscreen document but no longer warms up the model in the service worker.

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