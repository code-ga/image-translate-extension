# Changes Log

## 2026-08-18 — Restored auto-translate on page load and SPA navigation

**Modified**: `entrypoints/content.ts`

Restored automatic image and canvas translation that triggers when the page loads or the URL changes (including SPA navigation). The extension now checks settings and domain permissions and processes all matching images/canvases automatically.

**Key changes**:
- `entrypoints/content.ts`: Added `autoTranslateIfAllowed()` function that retrieves extension settings, verifies the current URL is allowed, and processes all images and canvases on the page
- Added URL polling via `startUrlPolling` to detect SPA navigation and URL changes, triggering `autoTranslateIfAllowed()` when the href changes
- Added `settings-changed` message handler that re-triggers auto-translation when the user updates settings in the popup
- Added live DOM observer (`startLiveObserver`) that automatically processes new images and canvases added to the DOM after initial load

### Validation
- `bun x tsc --noEmit` passes with no new type errors (only pre-existing `navigator.gpu` errors in `ocr-batcher.ts`)

---

## 2026-08-17 — Added OCR region grouping (convex hull + adjacency heuristics)

**New file**: `utils/ocr-region-grouping.ts`
**Modified**: `types/index.ts`, `utils/ocr-batcher.ts`, `utils/ocr-pipeline.ts`, `entrypoints/content.ts`, `utils/overlay.ts`

Added a post-processing stage between PaddleOCR raw output and downstream consumers that groups individual OCR word/line boxes into larger logical text regions (`OCRRegion[]`).

**Key changes**:
- `types/index.ts`: Added `Point`, `OCRBox`, `OCRRegion` types; `OCRResult` now aliases `OCRBox[]`
- `utils/ocr-region-grouping.ts`: Implements Andrew's monotone chain convex hull, adjacency heuristics (same-line and stacked-line detection with configurable ratios), connected component finding, reading-order sorting, and bounds computation
- `utils/ocr-batcher.ts`: Maps PaddleOCR output to `OCRBox[]` with 4-corner polygons, then calls `groupOcrBoxesIntoRegions()` before returning
- `utils/ocr-pipeline.ts`: Updated `onSuccess` callback types from `OCRResult` to `OCRRegion[]`
- `entrypoints/content.ts`: Updated render functions to accept `OCRRegion[]` and flatten `region.boxes` before passing to `addOcrBoxes`
- `utils/overlay.ts`: Updated `addOcrBoxes` parameter type from `OCRResult` to `OCRBox[]` with corrected property paths (`box.box.x/y/width/height`)

**Preserved behavior**: Overlay rendering logic unchanged; only data shape upstream. `batchRecognize()` call and success/error wrappers unchanged.

### Validation
- `bun x tsc --noEmit` passes with no new type errors (only pre-existing `navigator.gpu` type errors in `ocr-batcher.ts`)

---

## 2026-08-13 — Migrated content script from background-triggered to always-present

**Removed**: `utils/script-injection.ts` (no longer needed)

Changed the content script from being manually injected by `background.ts` on Google pages to running on all pages automatically via manifest `matches: ["<all_urls>"]`. The extension is now dormant until the user explicitly triggers translation from the popup or context menu.

**Key changes**:
- `entrypoints/content.ts`: `defineContentScript` matches changed to `<all_urls>`; removed `autoTranslateIfAllowed()`, `startUrlPolling`, `settings-changed` handler, and all dead code (`requestSettings`, `getTranslateableImages`, `getTranslateableCanvases`, `liveObserver`)
- `entrypoints/background.ts`: removed `injectContentScript` import, `isTabAllowed` function, and `tabs.onUpdated` listener; context menu handler now sends `sendMessage` directly (wrapped in `.catch`) for graceful handling on restricted pages
- `entrypoints/popup/App.tsx`: removed local `injectContentScript` callback and retry-injection pattern; `pollPageData` now catches `sendMessage` errors and resets state to empty instead of attempting injection

### Validation
- `bun run compile` passes (only pre-existing `ocr-batcher.ts` WebGPU type errors remain, unrelated to this change)
- `scripting` permission still needed for potential future use but no longer used for content script injection

---

## 2026-07-29 — Refactored content.ts, background.ts, and offscreen.ts into utility modules

### Phase 1: content.ts refactoring (see earlier entry)
`entrypoints/content.ts` was 935 lines with deeply tangled concerns and massive duplication between image and canvas handling paths.

**New files**: `utils/overlay.ts`, `utils/element-state.ts`, `utils/ocr-pipeline.ts`, `utils/dom-observer.ts`
**Result**: `content.ts` reduced from 935 → 469 lines as a thin orchestration layer.

### Phase 2: background.ts refactoring
`entrypoints/background.ts` (298 lines) had duplicated patterns for settings retrieval, domain checking, and content script injection across the context menu and `tabs.onUpdated` handlers.

**New files**: `utils/extension-settings.ts`, `utils/script-injection.ts`
**Result**: `background.ts` reduced from 298 → ~150 lines as a thin orchestration layer. Key improvements:
- `getExtensionSettings()` centralizes settings retrieval, eliminating the duplicated `browser.storage.sync.get` + extraction pattern
- `injectContentScript()` encapsulates the try/catch for content script injection
- `isTabAllowed()` combines URL checking with settings retrieval
- Two separate `onInstalled` listeners consolidated into one
- `fetchImageAsBase64` and `arrayBufferToBase64Legacy` remain as private helpers (not extracted since they're only used within `flushOcrBatch`)

### Phase 3: offscreen.ts refactoring
`entrypoints/offscreen/offscreen.ts` (286 lines) mixed asset caching, model initialization, fetch interception, and OCR batch processing into one file.

**New files**: `utils/asset-cache.ts`, `utils/ocr-batcher.ts`
**Result**: `offscreen.ts` reduced from 286 → ~30 lines as a thin message dispatch entry point. Key improvements:
- `asset-cache.ts` encapsulates IndexedDB operations (`getCachedAsset`, `storeCachedAsset`), cache URL validation (`isAssetCacheable`), and fetch wrapper installation (`installAssetFetchCache`)
- `ocr-batcher.ts` encapsulates PaddleOcrService initialization (`initOcrModel`), base64-to-ArrayBuffer conversion, and batch OCR execution (`runBatchOcr`)
- `offscreen.ts` now only handles the `browser.runtime.onMessage` listener entry point

### Reliability improvements (all phases)
- Unified cleanup lifecycle via `element-state.ts` — all observers and overlays are tracked and properly cleaned up
- `onComplete` callback pattern ensures `processingSet` is always cleaned up, even on OCR errors
- Centralized overlay positioning with debounced rAF scheduling prevents layout thrashing
- No duplicate processing — processing set check prevents concurrent OCR on the same element
- Centralized settings retrieval eliminates inconsistent settings reading patterns

### Type checking
All new and modified files pass `bun run compile` and `bunx biome check`. The only remaining warnings are pre-existing `any` types inherited from the original codebase.