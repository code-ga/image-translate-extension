# Image Translate Extension

A browser extension (WebExtension Manifest V3) that detects images and canvas elements on web pages, runs OCR on them using PaddleOCR via an offscreen document, and renders translation overlay boxes on the translated text.

## Architecture

### Entrypoints

| File | Role |
|---|---|
| `entrypoints/content.ts` | Content script — orchestrates OCR processing, overlay rendering, DOM observation, and auto-translation on page load/URL change |
| `entrypoints/background.ts` | Service worker — batches OCR requests, manages offscreen document, handles extension settings and context menus |
| `entrypoints/popup/App.tsx` | Popup UI — shows image list and triggers batch translation |
| `entrypoints/offscreen/offscreen.ts` | Offscreen document — runs the PaddleOCR model engine |
| `entrypoints/offscreen/index.html` | HTML anchor for the offscreen document |

### Utilities

| File | Role |
|---|---|
| `utils/overlay.ts` | Shared overlay DOM creation, positioning, box rendering, and container management |
| `utils/element-state.ts` | Generic element tracking (processing set, processed map, overlay map, mutation maps, resize observer) with lifecycle cleanup |
| `utils/ocr-pipeline.ts` | Image URL resolution (srcset), canvas-to-base64, fetch-to-base64, and sending OCR jobs to background |
| `utils/ocr-region-grouping.ts` | Spatial grouping of OCR word/line boxes into logical text regions using adjacency heuristics and convex hull |
| `utils/dom-observer.ts` | Live MutationObserver for new DOM nodes, SPA URL change polling, used by content script for auto-translation |
| `utils/asset-cache.ts` | IndexedDB asset caching, cache URL validation, fetch wrapper installation |
| `utils/ocr-batcher.ts` | PaddleOcrService model initialization, batch OCR execution, and region grouping |
| `utils/extension-settings.ts` | Centralized settings retrieval and domain permission checking |
| `utils/domain-matcher.ts` | URL domain/pattern matching for extension enablement rules |
| `utils/constants.ts` | Shared constants (offscreen paths, message targets) |

### Config & Types

| File | Role |
|---|---|
| `config/ocr-config.ts` | OCR batch size, concurrency, and debounce timing |
| `types/index.ts` | All shared TypeScript types (Point, OCRBox, OCRRegion, OCRResult, message types, settings) |
| `wxt.config.ts` | WXT build configuration (manifest, permissions, CSP) |

## Feature Flow

1. **Content script activation**: `content.ts` runs automatically on all pages via manifest `<all_urls>` match. On load, it calls `autoTranslateIfAllowed()` which checks extension settings and domain permissions, then processes all matching images/canvases. It also starts URL polling to detect SPA navigation and a live DOM observer for dynamically added elements
2. **Settings change handling**: `settings-changed` messages from the popup trigger `autoTranslateIfAllowed()` to re-evaluate auto-translation rules
 3. **User triggers translation**: Via popup (translating listed images/canvases) or context menu (`translate` message) — content script processes the specified elements on demand
 4. **New element added**: `dom-observer.ts` → `handleAddedNodes()` → calls `processNewImage()` or `processNewCanvas()`
 5. **OCR pipeline**: `ocr-pipeline.ts` tries canvas extraction first, then fetch, then URL-based background processing
 6. **Background batch**: `background.ts` queues OCR requests, batches them, sends to offscreen document for PaddleOCR inference
 7. **Region grouping**: `ocr-batcher.ts` converts raw PaddleOCR boxes to `OCRBox[]`, runs `groupOcrBoxesIntoRegions()` to produce `OCRRegion[]` with convex hull bounds and concatenated text
 8. **Result callback**: OCR regions flow back via `onSuccess` callback → `renderImageOverlay()` / `renderCanvasOverlay()` flattens region boxes and creates DOM overlay
 9. **Overlay positioning**: `element-state.ts` ResizeObserver + rAF-scheduled batch updates keep overlays aligned with their target elements
 10. **Host communication**: `window.sendOcrToHost` / `window.removeOcrFromHost` allow external scripts to trigger or clear overlays
 11. **Asset caching**: `asset-cache.ts` intercepts fetch for model assets and caches them in IndexedDB, avoiding redundant downloads
 12. **Batch OCR**: `ocr-batcher.ts` initializes PaddleOcrService and runs `model.batchRecognize()` on batches of image buffers
 13. **Extension settings**: `extension-settings.ts` centralizes settings retrieval and domain permission checking, eliminating duplication in `background.ts`

## Key Design Patterns

- **Generic element tracking**: `createElementState<T>()` eliminates duplication between image and canvas state management
- **Callback-based OCR pipeline**: `processImage()` / `processCanvas()` accept `onSuccess` callbacks for decoupled result rendering
- **Overlay utilities**: Shared positioning, box creation, and container management in `overlay.ts` avoid duplicated CSS and DOM logic
- **Observer lifecycle**: Every resize observer, mutation observer, and overlay DOM node is tracked and cleaned up on element removal or src change