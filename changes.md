# Changes

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