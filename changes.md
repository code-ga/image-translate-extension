# Changes Log

## 2026-09-19 — Fixed popup "No images found" caused by message type mismatch

The popup never populated its image/canvas list because the response-type checks and progress-listener message types used the wrong (non-prefixed) values, and a single failing `browser.tabs.sendMessage` rejected the whole `Promise.all` poll.

**Modified**: `entrypoints/popup/App.tsx`, `entrypoints/background.ts`, `types/messages.ts`

**Key changes**:
- `entrypoints/popup/App.tsx`: `pollPageData` now checks the correct response types (`"ui/image-status-list"`, `"ui/canvas-status-list"`) matching what the content script sends (`content.ts`), so images/canvases populate correctly. Switched the parallel `browser.tabs.sendMessage` calls from `Promise.all` to `Promise.allSettled` so a missing/unreachable content script (e.g. `chrome://` pages, not-yet-loaded tabs) only clears state when both fail, preserving a successful result from one channel. Each fulfilled result is checked with `.status === "fulfilled"` plus the `type` guard before reading its payload.
- `entrypoints/popup/App.tsx`: Progress listener (`progressListener`) now matches the actual message types sent from content/background: `"translate/progress"` + `"translate/complete"` (replacing `"translate-images-progress"`/`"translate-images-complete"`) and `"extension/error"` (replacing `"extension-error"`), so the popup stays in sync with translate progress and errors.
- `entrypoints/popup/App.tsx`: Added `setImageErrorCount(0)` / `setCanvasErrorCount(0)` to the both-failed reset branch for consistency with the empty-state reset.
- `entrypoints/background.ts`: The `extension/error` handler now also calls `browser.runtime.sendMessage({ type: "extension/error", error })` in addition to the existing `tabs.sendMessage` broadcast, so the popup (an extension-page context unreachable via `tabs.sendMessage`) receives extension errors and displays them.
- `types/messages.ts`: `ImageStatusListResponse` and `CanvasStatusListResponse` status unions now include `"error"` to match `ImageInfoWithStatus` / `CanvasInfoWithStatus` in `types/index.ts`.

**Verification**:
- `bun run compile` (tsc --noEmit) — zero TypeScript errors
- `bunx biome check` on modified files — no new lint violations introduced (warning/error counts reduced vs. baseline; remaining `format`/`noExplicitAny`/`noUnusedImports` findings are pre-existing CRLF line-ending drift and untouched-code `any` usage)

---

## 2026-09-18 — Async independent OCR + per-item error tracking & popup error display

Fixed two critical issues: (1) OCR batch failures cascading — one image error caused entire batch to fail; (2) Popup "No images found" when OCR errors occurred — errored images disappeared because they reverted to "pending" status with no persistent error tracking.

**Modified**: `utils/ocr-batcher.ts`, `entrypoints/offscreen/offscreen.ts`, `types/index.ts`, `utils/element-state.ts`, `entrypoints/content.ts`, `entrypoints/popup/App.tsx`, `entrypoints/popup/App.css`

**Key changes**:
- `utils/ocr-batcher.ts`: Rewrote `runBatchOcr` to use `Promise.allSettled` with per-item try/catch. Each image's OCR call is now independent — `model.batchRecognize([buffer], ...)` is called per image, and failures are caught individually. Returns `RunBatchResultItem[]` where each item is either `{success: true, data: OCRRegion[]}` or `{success: false, error: string}`.
- `entrypoints/offscreen/offscreen.ts`: Defensive per-item error handling preserved; `runBatchOcr` no longer throws on individual failures.
- `types/index.ts`: Extended `ImageInfoWithStatus` and `CanvasInfoWithStatus` status union with `"error"`.
- `utils/element-state.ts`: Added `errorMap: Map<T, string>` with `setError(element, message)`, `getError(element)`, `clearError(element)` methods; `resetElementState` and `cleanup` now clear `errorMap`.
- `entrypoints/content.ts`: In `processNewImage`/`processNewCanvas`, call `clearError` before starting new OCR attempt; in error callback, call `setError` BEFORE `onComplete` to persist error through cleanup; `collectImageInfo`/`collectCanvasInfo` now check `errorMap` first (status precedence: processing → error → done → pending).
- `entrypoints/popup/App.tsx`: Added `imageErrorCount`/`canvasErrorCount` state; `pollPageData` counts `"error"` status items; tabs show error badges (`.tab-badge.error`); `getStatusLabel` returns "Error"; `getStatusClass` returns "status-error"; local `ImageInfo`/`CanvasInfo` types updated with `"error"` status.
- `entrypoints/popup/App.css`: Added `.status-error` (red background/border) and `.tab-badge.error` (red badge) styles.

**Verification**:
- `bun run compile` — zero TypeScript errors
- `bunx biome check` on modified files — no new lint violations (pre-existing `any` warnings in untouched code remain)

---

## 2026-08-28 — Default target language selection (popup settings + hover popup)

Added a user-configurable default target language plus per-translation language selection in the hover popup, and fixed the settings broadcast so language changes propagate live to content scripts.

**New file**: `utils/languages.ts`
**Modified**: `utils/extension-settings.ts`, `types/messages.ts`, `utils/translation-popup.ts`, `utils/overlay.ts`, `entrypoints/popup/App.tsx`, `entrypoints/popup/App.css`, `entrypoints/content.ts`

**Key changes**:
- `utils/languages.ts`: New shared module exporting `SUPPORTED_LANGUAGES` (17 common language codes/labels), `DEFAULT_TARGET_LANG` ("vi"), and `Language`/`getLanguageLabel`/`findLanguage` helpers. Consumed by both the popup Settings UI and the hover translation popup.
- `utils/extension-settings.ts`: `ExtensionSettings` now includes `targetLang: string` (default `"vi"`); `getExtensionSettings()` merges stored values over `DEFAULT_SETTINGS` so `targetLang` is always present for older stored settings.
- `types/messages.ts`: `NotifySettingsChangedMessage` and `SettingsChangedMessage` now carry `targetLang: string` in their `settings` payload.
- `utils/translation-popup.ts`: Rewritten so the hover popup is self-contained. It renders an "Original" header (OCR text), a target-language `<select>` pre-set to the cached default, and a color-coded result area. Translation is triggered internally via `requestTranslate` and re-runs on `<select>` change; race-condition-safe (late responses are dropped if the popup was dismissed). Adds `setDefaultTargetLang(lang)` (cache setter used by the content script) and keeps `dismissTranslationPopup`/`cancelCloseDelay`/`startCloseDelay`/`updateTranslationPopup`. The default target language is cached in the module and seeded by the content script; per-hover language choices are ephemeral and do not override the global default.
- `utils/overlay.ts`: Simplified the OCR box `mouseenter` handler — the inline `translate/text` send and `box.translation` branch moved into `translation-popup.ts`; the `onReady` callback now only wires popup-level open/close behavior. Removed the now-unused `updateTranslationPopup` import and unused `AppMessage` type import.
- `entrypoints/popup/App.tsx`: Added `targetLang` state + a "Default Target Language" `<select>` (bound to `SUPPORTED_LANGUAGES`) in the Settings tab; loaded/saved via `loadSettings`/`saveSettings`. **Bug fix**: the notify message type was `"notify-settings-changed"` (never matched the background's `"settings/notify-changed"` listener), so `settings/changed` was never broadcast to tabs — corrected to `"settings/notify-changed"` and `targetLang` is now included in the broadcast payload.
- `entrypoints/content.ts`: Added `syncSettingsTargetLang()` (seeds the cached default target language from storage on load) and a `settings/changed` handler update that calls `setDefaultTargetLang(msg.settings.targetLang)`. Removed two pre-existing unused imports (`ExtensionErrorMessage`, `OCRBox`).
- `entrypoints/popup/App.css`: Added `.lang-select` style for the Settings language dropdown.

**Data flow**:
1. User picks a default language in popup Settings → `saveSettings` writes `targetLang` to `browser.storage.sync` → sends `settings/notify-changed` (now matched) → background broadcasts `settings/changed` to all content-script tabs → each tab caches the new default via `setDefaultTargetLang`.
2. User hovers an OCR box → `overlay.ts` `mouseenter` → `showTranslationPopup(anchor, text, onReady)` builds the popup with the cached default language selected → `requestTranslate` sends `translate/text` (with the chosen `targetLang`) → `background.ts` `enqueueTranslation`/`flushTranslationBatch` → `translateDynamic` → result returned and rendered in the popup result area. Changing the `<select>` re-translates with the new language without leaving the popup.

**Backward compatibility**: Existing stored settings without `targetLang` fall back to `"vi"` via the `DEFAULT_SETTINGS` merge.

### Notes
- `srcLang` remains `""` in outgoing `translate/text` messages (pre-existing behavior). `translateDynamic` builds the model name `Xenova/opus-mt-<srcLang>-<targetLang>`, so a concrete source language is still required for the HF model to load; source-language detection is left for future work.

### Validation
- `bun run compile` (tsc --noEmit) passes with zero type errors.
- New/changed files introduce no new `biome` lint-rule violations (remaining `any`/`noBannedTypes` warnings in `App.tsx` and `types/messages.ts` are pre-existing on untouched code).

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