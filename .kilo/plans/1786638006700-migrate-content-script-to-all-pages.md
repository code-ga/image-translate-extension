# Migrate Content Script from Background-Triggered to Always-Present

## Goal

Change the content script from being manually injected by `background.ts` only on allowed Google pages to being present on all pages automatically via manifest. Disable automatic translation and live observation so the extension is dormant until the user explicitly triggers translation from the popup or context menu.

## Current Architecture

- `entrypoints/content.ts` matches only `*://*.google.com/*`, and on `main()` immediately runs `autoTranslateIfAllowed()` which starts a live DOM observer, URL polling, and processes all images/canvases.
- `entrypoints/background.ts` listens for `browser.tabs.onUpdated` and injects `content.ts` via `browser.scripting.executeScript` when a tab completes loading and passes settings/domain checks.
- `entrypoints/background.ts` also injects and triggers translation via the context menu.
- `utils/script-injection.ts` is the shared injection helper used by background and popup.
- `entrypoints/popup/App.tsx` has its own local `injectContentScript` with a 800ms timeout, used as a fallback when `sendMessage` fails (meaning content script isn't present).

## Target Architecture

- `entrypoints/content.ts` is declared with `matches: ["<all_urls>"]` so it runs on every supported page automatically.
- `content.ts` `main()` does **not** start auto-translation. It only sets up message listeners and exposes `window.sendOcrToHost` / `window.removeOcrFromHost`.
- `background.ts` no longer injects content scripts. It handles: offscreen document lifecycle, OCR batch queue, settings storage/notification, and context menu (sends message to existing content script).
- `popup/App.tsx` no longer needs injection fallback. It sends messages directly to the already-present content script.
- `utils/script-injection.ts` is removed (no longer used anywhere).

## Implementation Steps

### 1. Update `entrypoints/content.ts`

- Change `defineContentScript` matches from `["*://*.google.com/*"]` to `["<all_urls>"]`.
- In `main()`, **remove** the call to `autoTranslateIfAllowed()`.
- **Remove** the `settings-changed` message handler that calls `autoTranslateIfAllowed()`.
- **Keep** all other message handlers (`get-images`, `get-image-status`, `get-canvases`, `get-canvas-status`, `translate-images`, `translate-canvases`, `translate` for context menu).
- **Keep** `window.sendOcrToHost` and `window.removeOcrFromHost` assignments.
- **Keep** scroll/resize event listeners for overlay positioning.
- Optionally, if `autoTranslateIfAllowed` is no longer used anywhere, delete it. Otherwise leave it unused.

### 2. Update `entrypoints/background.ts`

- **Remove** the `injectContentScript` import and `utils/script-injection.ts` dependency.
- **Remove** the `browser.tabs.onUpdated` listener entirely.
- In the `browser.contextMenus.onClicked` handler:
  - Remove the `await injectContentScript(tab.id)` call.
  - Keep the settings/domain check.
  - Keep `browser.tabs.sendMessage(tab.id, { type: "translate", url: info.srcUrl })`.
- **Keep** everything else: `onStartup`/`onInstalled` listeners, offscreen document management, context menu creation, OCR batch queue, settings notification, and `get-settings` message handler.

### 3. Update `entrypoints/popup/App.tsx`

- **Remove** the local `injectContentScript` callback (lines 40–46).
- In `pollPageData`, remove the `try { ... } catch (err) { await injectContentScript(...); retry }` pattern.
- Instead, send messages directly. If `sendMessage` throws (page doesn't support content scripts), catch the error and set empty lists / show a small warning instead of attempting injection.
- Remove the `injectContentScript` dependency from the `useCallback` dependency array if it was there (it's in `pollPageData`'s deps already, so just remove the function entirely).

### 4. Remove `utils/script-injection.ts`

- Delete the file since it is no longer imported by any remaining code.

### 5. Validate

- Run `bun run compile` (TypeScript check).
- Run `bun run dev` to verify the extension loads and content script is present on non-Google pages.
- Verify popup can communicate with content script without injection.
- Verify context menu sends translate message correctly.
- Verify auto-translation does NOT run on page load.

## Risks & Edge Cases

- **Restricted pages**: Content scripts cannot run on `chrome://`, `about:`, `edge://`, extension pages, etc. The popup should gracefully handle `sendMessage` failures on these pages.
- **Performance**: Running content script on all pages adds a small overhead (script loading + message listener setup). This is unavoidable for "always present" but should be negligible.
- **Duplicate injection**: If `background.ts` accidentally still tries to inject, it may add a second copy. Ensure `tabs.onUpdated` is fully removed.
- **SPA navigation**: Since auto-translation is disabled, the live observer and URL polling are not running. If the user later wants auto-translation back, it must be explicitly triggered via popup or a future toggle.

## Open Questions

None — user confirmed context menu should be kept without injection.
