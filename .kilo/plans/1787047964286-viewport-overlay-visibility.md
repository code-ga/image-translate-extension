# Viewport Overlay Visibility Plan

## Goal
Overlay boxes should only be visible/rendered when their bound image or canvas element intersects the browser viewport. When scrolled out of view, overlays should be hidden (`display: none`). When scrolled back into view, overlays should reappear.

## Current Behavior
- `updateElementOverlayPosition()` in `utils/overlay.ts` hides overlays only when the element has zero width/height (`rect.width === 0 || rect.height === 0`).
- `schedulePositionUpdate()` in `utils/element-state.ts` runs on scroll/resize via rAF, updating all overlay positions. It also removes overlays for elements no longer in the DOM.
- There is **no viewport intersection check** — overlays are positioned and shown even when their target element is completely scrolled off-screen.

## Target Behavior
- When an element's bounding rect does **not intersect** the viewport, its overlay should have `display: none`.
- When an element's bounding rect **does intersect** the viewport, its overlay should be positioned normally.
- The existing rAF-based `schedulePositionUpdate()` loop (triggered by scroll/resize) will naturally re-evaluate visibility, so overlays reappear when scrolled back into view.

## Implementation Steps

### 1. Add viewport intersection helper in `utils/overlay.ts`
Add a small pure function that checks whether a `DOMRect` intersects the viewport:
```typescript
function rectIntersectsViewport(rect: DOMRect): boolean {
  return !(
    rect.right < 0 ||
    rect.left > window.innerWidth ||
    rect.bottom < 0 ||
    rect.top > window.innerHeight
  );
}
```
Place it near `updateElementOverlayPosition()`.

### 2. Modify `updateElementOverlayPosition()` in `utils/overlay.ts`
Change the visibility condition from zero-dimensions-only to zero-dimensions OR out-of-viewport:
```typescript
if (rect.width === 0 || rect.height === 0 || !rectIntersectsViewport(rect)) {
  overlay.style.display = "none";
} else {
  overlay.style.display = "";
  // existing positioning logic
}
```
No other files need changes — `renderImageOverlay()`, `renderCanvasOverlay()`, and `schedulePositionUpdate()` all call `updateElementOverlayPosition()`, so the new check applies everywhere automatically.

### 3. Edge cases handled implicitly
- **Element removed from DOM**: `schedulePositionUpdate()` already checks `document.contains()` and calls `resetElementState()`, removing the overlay entirely.
- **Element hidden by ancestor `display:none`**: `getBoundingClientRect()` returns zero rect, caught by the existing zero-dimension check.
- **Partially visible elements**: `rectIntersectsViewport()` returns `true` for partial intersection, so overlay remains visible (correct behavior).
- **Fixed/sticky positioning**: `getBoundingClientRect()` returns viewport-relative coordinates, so intersection check works correctly.
- **CSS transforms**: `getBoundingClientRect()` accounts for transforms, so intersection is accurate.

## Files Changed
| File | Change |
|---|---|
| `utils/overlay.ts` | Add `rectIntersectsViewport()` helper; update `updateElementOverlayPosition()` condition |

## Validation
1. Run `bun run compile` — zero TypeScript errors.
2. Run `bunx biome check` — no new lint issues.
3. Manual verification:
   - Load a page with images, scroll an image out of viewport → overlay disappears.
   - Scroll image back into viewport → overlay reappears.
   - Resize window so image goes out of viewport → overlay disappears.
   - Verify partially visible images still show overlays.

## Risks
- Minimal. The change is a single additional condition in an existing positioning function. No API or type changes. No behavior change for elements already having zero dimensions (already hidden).
