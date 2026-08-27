# Changes Log

## 2026-08-27 — Extracted shared popup base and implemented translation hover popup

**New file**: `utils/popup-base.ts`
**Modified**: `utils/toast.ts`, `utils/translation-popup.ts`, `utils/overlay.ts`

Extracted shared popup styling constants and container/keyframe utilities from `toast.ts` into a new `popup-base.ts` module. Refactored `toast.ts` to consume the base. Implemented `translation-popup.ts` with hover-activated translation popups for OCR overlay boxes, controlled by box and popup mouse events instead of timers.

**Key changes**:
- `utils/popup-base.ts`: Shared constants (`POPUP_Z_INDEX`, `POPUP_FONT`, `POPUP_BORDER_RADIUS`, `POPUP_BOX_SHADOW`, `POPUP_COLORS`), `getOrCreateContainer()` for fixed-position overlay containers, and `injectPopupStyles()` for idempotent `@keyframes ocr-toast-in` injection
- `utils/toast.ts`: Refactored to import from `popup-base.ts`; uses shared constants and `getOrCreateContainer`/`injectPopupStyles`; behavior unchanged
- `utils/translation-popup.ts`: Full hover lifecycle implementation — `showTranslationPopup()` with 300ms debounce and `onReady` callback, `updateTranslationPopup()` (race-condition-safe), `dismissTranslationPopup()` (clears debounce + close timers), `cancelCloseDelay()`, and `startCloseDelay()` for delayed dismissal
- `utils/overlay.ts`: OCR boxes now use `mouseenter`/`mouseleave` instead of focus; `mouseenter` shows the popup, triggers background translation via `translate/text`, and attaches popup-level `mouseenter`/`mouseleave` listeners; `mouseleave` on either the box or the popup starts a 1000ms close delay; moving from box to popup cancels the pending close

**Popup lifecycle**:
1. `mouseenter` on OCR box → cancel any pending close, start 300ms debounce to create popup
2. Popup created → shows original text; if no cached translation, sends `translate/text` to background; attaches `mouseenter`/`mouseleave` to popup itself
3. `mouseenter` on popup → cancels close delay
4. `mouseleave` on box or popup → starts 1000ms close delay
5. Close delay fires → `dismissTranslationPopup()` removes popup and clears all timers
6. If user mouses out before debounce completes → `dismissTranslationPopup()` cancels the pending popup creation

**Race condition handling**: `updateTranslationPopup` checks whether the provided popup element is still the `currentPopup` before mutating it. If the user mouses out before the background translation response arrives, `dismissTranslationPopup()` clears `currentPopup`, so the late response is silently dropped.

### Validation
- `bun run compile` passes with zero new type errors

---

## 2026-08-18 — Fixed empty enabled-domains list behavior

**Modified**: `entrypoints/background.ts`, `entrypoints/popup/App.tsx`

When the enabled domains list is empty, the extension should NOT translate any page. Previously, an empty list was treated as "allow all pages" in the context menu handler and popup UI.

**Key changes**:
- `entrypoints/background.ts`: Context menu now requires `enabledDomains.length > 0` before checking URL match
- `entrypoints/popup/App.tsx`: `isDomainAllowed` now returns `false` when the list is empty; updated UI text from "All domains translate when enabled" to "No domains configured"

### Validation
- `bun x tsc --noEmit` passes with no new type errors (only pre-existing `navigator.gpu` errors in `ocr-batcher.ts`)

---

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