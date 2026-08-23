# Toast Notification System for Extension Errors

## Context

The extension currently has **no toast notification system**. Errors are only logged to `console.error`/`console.warn`. The popup has a dead `error` state (`_setError`, never called) and an unused `.error` CSS class. OCR pipeline failures are silently swallowed (`bgResponse?.success && onSuccess(...)` drops all failed background responses without logging or surfacing them).

## Goal

Implement a toast notification system that makes extension errors visible to the user in two surfaces:
1. **Page toast** — a lightweight DOM toast overlay injected into the web page by the content script
2. **Extension popup** — wire up and extend the existing dead error UI

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Toast for content script | DOM-based utility (`utils/toast.ts`) | Content script has no React; DOM injection is lightweight and matches existing overlay patterns in `overlay.ts` |
| Toast for popup | React state + `.error` CSS class reuse | Popup already has dead `error` state and `.error` CSS; reuse rather than add new deps |
| Error propagation | `onError` callback added to `processImage`/`processCanvas` | Mirror existing `onSuccess`/`onComplete` callback pattern; minimal API change |
| Popup error display | Single error bar (replace dead `error` state) | Keeps popup UI simple; matches existing `.error` CSS block |
| Content → popup error relay | New `extension-error` message type | Allows content script to push errors to popup (background acts as relay) |

## Task List

### 1. Create page toast utility — `utils/toast.ts`
- Function `showToast(message, type = "error", duration = 4000)` that injects a styled `<div>` into the overlay container (reuse `getOrCreateOverlayContainer()` from `overlay.ts`)
- Function `removeToast(element)` to auto-dismiss after timeout
- CSS: error (red), warning (amber), info (blue) variants with dark theme matching popup styling
- Self-contained: no external dependencies

### 2. Fix OCR pipeline silent failures — `utils/ocr-pipeline.ts`
- Add `onError: (error: string | Error) => void` parameter to `processImage` and `processCanvas`
- Replace silent `bgResponse?.success && onSuccess(...)` with explicit check:
  ```ts
  if (bgResponse?.success && bgResponse.ocrData) {
    onSuccess(bgResponse.ocrData);
  } else {
    onError(bgResponse?.error ?? "OCR processing failed");
  }
  ```
- Update `sendOcrWithBase64` and `sendOcrWithUrl` to accept and use `onError`
- Keep existing `console.error` calls for dev visibility

### 3. Wire content script to show page toasts — `entrypoints/content.ts`
- Import `showToast` from `utils/toast.ts`
- In `processNewImage` and `processNewCanvas`, pass an `onError` callback that calls `showToast(errorMessage, "error")`
- Also surface errors from the canvas-base64 and fetch-base64 failures (currently only `console.error`)

### 4. Add content → popup error relay — `entrypoints/background.ts`
- Add listener for new `extension-error` message type (target: "popup", type: "extension-error")
- Broadcast errors to all extension popup tabs via `browser.tabs.sendMessage`
- Content script sends `extension-error` messages with error details

### 5. Wire up popup error display — `entrypoints/popup/App.tsx`
- Replace `_setError` (dead) with `setError` and wire it up
- In `progressListener`, check `msg.error` field on `translate-images-progress` messages and call `setError(msg.error)`
- Listen for `extension-error` messages via `browser.runtime.onMessage` and call `setError`
- Auto-clear error after a timeout (e.g., 6 seconds) so it doesn't persist

### 6. Clean up unused error state
- Ensure `App.css .error` styling is used by the live error state (already exists, just needs to be wired)
- Remove the underscore prefix from `setError`

## Affected Files

| File | Change |
|---|---|
| `utils/toast.ts` | **New file** — page toast DOM utility |
| `utils/ocr-pipeline.ts` | Add `onError` callback; fix silent failure swallowing |
| `entrypoints/content.ts` | Import & use `showToast` in `processNewImage`/`processNewCanvas`; send `extension-error` messages |
| `entrypoints/background.ts` | Relay `extension-error` messages to popups |
| `entrypoints/popup/App.tsx` | Wire up `setError`; listen for progress `error` field + `extension-error` messages; auto-clear |
| `types/index.ts` | Add `ExtensionErrorType` message type |
| `PROJECT_DESCRIPTION.md` | Update to document toast system and error flow |
| `changes.md` | Log changes |

## Data Flow

```
OCR fails (offscreen.ts)
  → background sends { success: false, error: "..." }
  → ocr-pipeline.ts: bgResponse.success === false → onError("...")
  → content.ts onError: showToast(error)     [page toast]
                      + browser.runtime.sendMessage({ type: "extension-error", error })
  → background.ts relays to popup
  → popup App.tsx: setError(error)          [popup error bar]

Progress errors (content.ts handleTranslateImages)
  → browser.runtime.sendMessage({ type: "translate-images-progress", error: "..." })
  → popup App.tsx: setError(msg.error)      [popup error bar]
```

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Page toasts could be intrusive / spammy | Auto-dismiss after 4-6s; deduplication: don't show same error twice within 10s |
| Popup error bar could cover content | Error bar is already positioned at top of popup; auto-clears after timeout |
| Content script `browser.runtime.sendMessage` failures if popup not open | Use `.catch(() => {})` like existing code does (line 78 of App.tsx) |
| Background relay could send to closed popups | `browser.tabs.sendMessage` already handles this gracefully with `.catch()` |

## Validation

1. `bun run compile` — type check passes (no `any` types in new code)
2. `bun run dev` — extension loads without errors
3. Manually trigger OCR failure (e.g., cross-origin image without permissions) → verify page toast appears
4. Manually trigger "translate image not found" → verify popup error bar shows
5. Verify toasts auto-dismiss after timeout
6. Verify existing `.error` CSS class is used (not duplicated)
