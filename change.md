# Change Log

## Popup Image Selection
- Popup now automatically fetches all visible images (≥30px) from the active tab
- Users can choose which images to translate using checkboxes
- "Select All" and "None" quick-select buttons added
- "Translate Selected" and "Translate All" action buttons per tab
- Content script injects automatically when the popup opens if not already present

## Canvas Support
- Added ability to detect and extract OCR from all `<canvas>` elements on the page
- Uses `canvas.toDataURL('image/png')` to capture canvas content as base64
- New "Canvases" tab showing canvas index + dimensions
- "Translate Selected" and "Translate All" for canvas elements
- Overlays track canvas resize through `ResizeObserver` and `MutationObserver` on `width`/`height` attributes

## Domain-Based Auto-Translation
- Users now manage **domains** instead of selecting images individually
- When a domain is added to the allowlist, **all images and canvases on that domain translate automatically**
- No more manual image-by-image selection in the popup
- Configurable via **chrome.storage.sync** with `{ enabled: boolean, enabledDomains: string[] }`
- Supports subdomain matching (e.g., `example.com` allows `sub.example.com`)

## Live Translation Foundation
- Content script requests settings from background on load
- Auto-translates existing images and canvases if domain is allowed
- New `MutationObserver` on `documentElement` watches for injected images/canvases
- Watches `src`/`srcset` changes on images and `width`/`height` on canvases
- Real-time re-translation when page content changes dynamically

## Settings Distribution
- Background service worker acts as settings hub for all tabs
- On popup save, background broadcasts new settings to every open tab
- Content scripts reload settings and auto-translate without page reload
- Context-menu translations also respect domain settings

## Popup Simplification
- Popup redesigned into a **domain settings manager**
- Shows current domain with quick Add/Remove toggle
- Displays detection count (images + canvases found on page)
- Removed per-image selection UI — auto-translation replaces it

## Tab Layout
- Popup redesigned into 3 tabs: **Images**, **Canvases**, **Settings**
- Removed long single-page scroll; each tab is focused and scrollable independently

## Dark Theme
- Popup restyled for dark UI: `#1e1e2d` background, `#2b2b3d` surfaces, `#4f8ef7` primary actions
- Tabs have active blue underline indicator
- Buttons, inputs, lists, and status banners adjusted for dark readability
- Error (red) and warning (amber) banners for settings feedback

## Processing Status
- Popup now shows live processing status next to each image and canvas in the Images/Canvases tabs
- Status text includes "Translating..." (with animated pulse) while OCR is running and "Done" after completion
- Content script tracks `processingImages` and `processingCanvases` Sets in real-time
- Popup polls status every 1.5s via `get-image-status` and `get-canvas-status` messages
- Tab badges show count of currently-processing items (e.g. orange badge on Images tab)

## Live Queue & Concurrency Limit
- Content script now runs a batched OCR queue capped at **4 concurrent requests**
- Auto-translation and live `MutationObserver` no longer fire unlimited parallel background requests
- Prevents overload when scrolling fast or pages inject many images/canvases at once
- Maintains existing `processingImages`/`processingCanvases` tracking for popup status polling

## Domain Management Simplified
- Removed "Scan open tabs" feature — domain selection now relies on current tab only
- Current domain quick-add/remove button remains in Settings tab
- Users can still manually type domains or use the current-domain shortcut

## Bug Fix
- Fixed `chrome.storage.sync` error in content script by moving storage access to background service worker
