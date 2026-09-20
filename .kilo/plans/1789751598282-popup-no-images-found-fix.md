# Fix: Popup shows "No images found on this page"

## Root Cause

The popup's `pollPageData()` in `entrypoints/popup/App.tsx` checks response types that don't match what the content script sends:

| Popup checks (`App.tsx`) | Content script sends (`content.ts`) |
|---|---|
| `"image-status-list"` | `"ui/image-status-list"` |
| `"canvas-status-list"` | `"ui/canvas-status-list"` |

The content script correctly responds with `ui/`-prefixed types (lines 348–365 in `content.ts`), but the popup's `if` checks at lines 113 and 128 look for the non-prefixed variants. The check fails every time, so `setImages`/`setCanvases` are never called and the arrays stay empty → "No images found on this page".

## Secondary Issue: `Promise.all` fails atomically

`App.tsx` line 107 wraps two `browser.tabs.sendMessage` calls in `Promise.all`. If the content script isn't loaded on the active tab (e.g. `chrome://` pages, not-yet-loaded pages, extension pages), both calls reject and the catch block at line 141 resets everything to empty. Switching to `Promise.allSettled` allows independent success/failure.

## Tertiary Issue: Progress-listener message type mismatches

The popup's `progressListener` checks for types that don't match what content/background send:

| Popup checks (`App.tsx` lines 168–179) | Sender (`content.ts` / `background.ts`) |
|---|---|
| `"translate-images-complete"` | `"translate/complete"` (content.ts lines 434, 469) |
| `"translate-images-progress"` | `"translate/progress"` (content.ts lines 423, 458) |
| `"extension-error"` | `"extension/error"` (background.ts line 99) |

Additionally, the background relays `extension/error` via `tabs.sendMessage` (which only reaches content scripts, not the popup). For the popup to receive it, the background must also send via `runtime.sendMessage` (which reaches all extension contexts including the popup).

## Type Definition Gap

`types/messages.ts` `ImageStatusListResponse` and `CanvasStatusListResponse` (lines 78–97) have `status: "pending" | "processing" | "done"` — missing `"error"`. This should be added for type consistency with `ImageInfoWithStatus` / `CanvasInfoWithStatus` in `types/index.ts`.

---

## Implementation Tasks

### Task 1: Fix response-type checks in popup (`entrypoints/popup/App.tsx`)

- **Line 113**: Change `"image-status-list"` → `"ui/image-status-list"`
- **Line 128**: Change `"canvas-status-list"` → `"ui/canvas-status-list"`

This is the **primary fix** — without it, no images or canvases will ever appear in the popup.

### Task 2: Switch `Promise.all` to `Promise.allSettled` (`entrypoints/popup/App.tsx` lines 106–149)

Replace `Promise.all([...])` with `Promise.allSettled([...])` and handle each result independently:

- If fulfilled with correct type → update images/canvases state
- If rejected → log the error, don't reset already-known data
- Only reset to empty arrays if **both** fail and content script is definitively absent

### Task 3: Fix progress-listener message types (`entrypoints/popup/App.tsx` lines 166–180)

- Change `"translate-images-complete"` → `"translate/complete"`
- Change `"translate-images-progress"` → `"translate/progress"`
- Change `"extension-error"` → `"extension/error"`

### Task 4: Fix error message delivery to popup

In `entrypoints/background.ts` `extension/error` handler (lines 91–107):

- Keep the existing `tabs.sendMessage` broadcast to content scripts
- **Add** `browser.runtime.sendMessage({ type: "extension/error", error: msg.error })` so the popup's `runtime.onMessage` listener also receives it

### Task 5: Add "error" to message response types (`types/messages.ts` lines 78–97)

- `ImageStatusListResponse`: add `"error"` to status union
- `CanvasStatusListResponse`: add `"error"` to status union

### Task 6: Reset error counts in catch block (`entrypoints/popup/App.tsx` lines 141–149)

Add `setImageErrorCount(0)` and `setCanvasErrorCount(0)` to the catch block for consistency.

---

## Validation Steps

1. Run `bun run compile` (tsc --noEmit) — verify zero TypeScript errors
2. Run `bunx biome check entrypoints/popup/App.tsx entrypoints/background.ts types/messages.ts` — verify no new lint violations
3. Rebuild extension (`bun run build` or `bun run dev`)
4. Reload extension in browser (`chrome://extensions` → reload)
5. Open popup on a page with visible images ≥30×30px and ≥1 configured domain
6. Verify images appear in popup list (no longer "No images found")
7. Verify "processing" → "done" status transitions appear correctly
8. Test error scenario: verify errored images show "Error" badge and remain visible

## Risks

- **Low**: Type-only changes to `messages.ts` won't affect runtime behavior
- **Medium**: The `Promise.allSettled` change could slightly alter behavior on pages without content scripts — ensure empty state is still shown appropriately
- **Low**: The `runtime.sendMessage` addition for error relay is additive — won't break existing content-script error handling

## Out of Scope

- Restructuring the popup's progress listener into a more robust event system
- Adding retry logic for content script not-yet-ready scenarios
- Changing the `collectImageInfo`/`collectCanvasInfo` filtering thresholds
