# Devlog

## TL;DR

- WXT.js: Refactored entrypoints into thin orchestrators — content.ts, background.ts, offscreen.ts all slimmed down significantly.
- Context Menu: Fixed silent settings broadcast bug (popup sent wrong message name, changes never propagated).
- Messaging: Introduced typed, namespaced message routing in `types/messages.ts`.
- Overlay: Added hover-to-translate popup with language selector; race-condition safe, self-contained lifecycle.
- Error UX: Toast notifications for OCR/translation failures instead of silent death.
- Auto-translate: Restored page-load + SPA auto-translation that got lost during refactor.
- PaddleOCR: Still fighting text-box grouping 😭. Convex hull + adjacency heuristics added but imperfect.

---

## WXT.js

This is really easy. Almost everything is guided on their introduction page, so I need to follow it. Also, I need to refactor code from 1 huge file into many smaller files, which helps me maintain this more easily.

Applied thin orchestrator pattern to all three entrypoints:

- **content.ts** 935 → ~469 lines. Extracted `overlay.ts`, `element-state.ts`, `ocr-pipeline.ts`, `dom-observer.ts`.
- **background.ts** 298 → ~150 lines. `extension-settings.ts` owns all storage access and domain checking.
- **offscreen.ts** 286 → ~30 lines. `asset-cache.ts` handles IndexedDB + fetch interception; `ocr-batcher.ts` owns PaddleOCR init and batching.

Each file has one job now. Also added `ocr-region-grouping.ts` for convex hull + adjacency heuristics grouping.

---

## Better context menu (and first trade-off)

Due to the main problem that extensions don't know which one was clicked, I need to trade off user privacy with convenience. From now on, extensions will inject a content script into every page that you open, including enabling and disabling auto-translation.

---

## Better overlay box

Over time, the extension displays an image by adding an extension element to a div, which is the image tag's parent. But now we switch the approach to create a separate div that does not depend (or depends less) on how the page works. Also, we need to check whether the current image displays are visible, or we will not render an overlay box for them.

---

## Hover translation popup + default language

Hover over any OCR box → popup appears with original text, target-language dropdown, and translation result. 300ms debounce, mouseleave close delay with cancel-on-reenter, race-condition safe (drops late responses). Popup owns the translate request internally — self-contained.

Users pick a default target language (default: Vietnamese "vi", 17 languages) in Settings. Stored in `browser.storage.sync`, broadcast live to all tabs. Per-hover choice is ephemeral.

---

## Unified messaging + error feedback

The popup was sending `"notify-settings-changed"` and the background was listening for `"settings/notify-changed"` — a typo that meant settings changes died silently for weeks. Fixed by introducing `types/messages.ts` with proper typed, namespaced routing. Settings now propagate live.

Added `utils/toast.ts` for inline error notifications. OCR and translation failures show a debounced, deduped toast instead of failing silently. Extracted shared popup styling into `utils/popup-base.ts`.

---

## Empty domains fix

When `enabledDomains` is empty, the extension should translate nothing — but the old code treated empty as "allow all." Fixed in `background.ts` and `isDomainAllowed`. Now empty list correctly disables translation entirely.

---

## Auto-translate restored

After the refactor, `autoTranslateIfAllowed()`, URL polling, and the live DOM observer had been stripped out. The extension was dormant until manual trigger. Added them back: page-load check, SPA URL polling, and live DOM observer for dynamically added images.

---

## PaddleOCR and grouping text box (I hate this; why yolo)

This is the very unsolved problem that may annoy the user and me. The problem is paddle-ocr working like this, meaning it will separate the text bubble into smaller parts, which will make translation crazy. Currently, we are adding grouping to solve the issue of text on the same line, but the solution is not ready yet. Also, we are considering switching models for a better experience.

---

*Logged between debugging sessions on Aug 2026*