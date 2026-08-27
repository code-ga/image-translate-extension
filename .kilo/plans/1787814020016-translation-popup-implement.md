# Plan: Extract shared popup base + implement `translation-popup.ts`

## Goal
1. Extract a shared popup base (`utils/popup-base.ts`) from the common DOM/style patterns in `toast.ts`
2. Rewrite `toast.ts` and `translation-popup.ts` to use the base

## Current State
- `utils/toast.ts`: inline `style.cssText`, `z-index:2147483647`, dark theme colors, keyframe animation injection, auto-removal via `setTimeout`
- `utils/translation-popup.ts`: 3 empty stubs
- Both files duplicate: z-index, font stack, border-radius, box-shadow, keyframe injection pattern

## Shared base: `utils/popup-base.ts`

### Exports
1. `getOrCreateContainer(id: string): HTMLElement`
   - Returns existing element by id, or creates new `div` with:
     - `position:fixed; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:2147483647; overflow:hidden;`
     - (or top-right variant for toast — see below)

2. `injectPopupStyles(container: HTMLElement): HTMLStyleElement`
   - Creates `<style>` with `@keyframes ocr-toast-in` animation
   - Appends to container (idempotent — if style already exists, return it)
   - Returns the style element

3. `POPUP_Z_INDEX: string` — `"2147483647"`
4. `POPUP_FONT: string` — `"-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif"`
5. `POPUP_BORDER_RADIUS: string` — `"6px"`
6. `POPUP_BOX_SHADOW: string` — `"0 4px 12px rgba(0,0,0,0.4)"`
7. Color helpers:
   - `POPUP_COLORS` object with `error`, `warning`, `info`, `success` variants (bg, border, text)

### Container variants
- Toast container: `id="ocr-toast-container"`, `top:12px; right:12px; display:flex; flex-direction:column; gap:8px; max-width:360px;`
- Translation popup container: single-element positioned, no dedicated container needed (popup is `position:fixed` directly)

## Updated `utils/toast.ts`
- Import from `popup-base.ts`
- Use `getOrCreateContainer("ocr-toast-container")`
- Use `injectPopupStyles(container)`
- Use `POPUP_*` constants for inline styles
- Keep `showToast()` and `removeToast()` logic

## New `utils/translation-popup.ts`
- Import from `popup-base.ts`
- Module state: `currentPopup`, `debounceTimer`
- `showTranslationPopup(anchor, text)` — 300ms debounce, creates popup below anchor, returns element (no messaging)
- `updateTranslationPopup(popup, translation, error?)` — updates text content and color
- `dismissTranslationPopup()` — removes current popup
- Uses `POPUP_*` constants for styling

## Files to modify/create
1. **Create** `utils/popup-base.ts` — shared base
2. **Refactor** `utils/toast.ts` — use base
3. **Implement** `utils/translation-popup.ts` — full implementation

## Validation
- `bun run typecheck` — zero errors
- No runtime regressions in toast behavior
