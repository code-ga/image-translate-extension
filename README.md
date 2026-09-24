# Image Translate

> Translate text inside images on any web page — automatically.

**Built with WXT** · **Manifest V3** · **Client-side** · **No server round-trip**

Image Translate is a browser extension that finds images and canvas elements on a page, extracts their text with PaddleOCR, and replaces the text in place with a Vietnamese translation from NLLB-200. OCR, language detection, model inference, and caching all run locally in the browser; image and text data are not sent to an application server.

Repository: `<this-repo-url>`

## Features

- Automatically detects images and canvases on page load, DOM changes, and single-page-app navigation.
- Runs PaddleOCR in an offscreen document so page scripts and the extension UI stay responsive.
- Translates with `Xenova/nllb-200-distilled-600M`, using WebGPU when available and WASM as a fallback.
- Detects the source language automatically with Unicode script analysis and TinyLD.
- Shows a hover translation popup with per-overlay language selection.
- Uses a two-level translation cache: an in-memory L1 cache and a persistent IndexedDB L2 cache with SHA-256 keys.
- Preserves URLs, email addresses, numbers, currency, hex codes, paths, and code identifiers during translation.
- Works with Chrome, Chromium, Edge, and Firefox without a server-side translation service.

## Supported Languages

Automatic source-language detection and the hover popup expose 17 language choices. The default translation target is Vietnamese (`vie_Latn`).

| Code | Language | Code | Language |
|---|---|---|---|
| `en` | English | `vi` | Vietnamese |
| `es` | Spanish | `fr` | French |
| `de` | German | `zh` | Chinese (Simplified) |
| `ja` | Japanese | `ko` | Korean |
| `ru` | Russian | `pt` | Portuguese |
| `ar` | Arabic | `th` | Thai |
| `tr` | Turkish | `id` | Indonesian |
| `it` | Italian | `nl` | Dutch |
| `hi` | Hindi |  |  |

The automatic detector uses script detection first and TinyLD as a fallback. Unsupported or low-confidence input is left unchanged rather than silently producing a misleading translation.

## Screenshots

| Automatic detection | OCR overlay | Hover translation |
|---|---|---|
| _Screenshot pending_ | _Screenshot pending_ | _Screenshot pending_ |
| Show an image or canvas being discovered on a page. | Show extracted text regions and translated overlay boxes. | Show the hover popup and language selection. |

Add release screenshots under `docs/screenshots/` before publishing a store listing or announcement.

## Installation

Image Translate is not published to the Chrome Web Store or Firefox Add-ons (AMO). Install a local development build or an unpacked build from source.

### Option A — Run from source

```bash
bun install
bun run dev
```

WXT serves a development build for the selected browser. Use the browser's extension developer mode controls to load the generated extension directory if it is not opened automatically.

### Option B — Build and load unpacked

```bash
bun run build
```

Load the generated Chrome/Chromium/Edge extension directory from `.output/chrome-mv3` in a Chromium-based browser. For Firefox, run `bun run build:firefox` and load the corresponding Firefox output directory. Browser-restricted pages such as `chrome://` and `about:` pages cannot run content scripts.

## Permissions

| Permission | Used for | Privacy note |
|---|---|---|
| `activeTab`, `scripting` | Access the active tab and inject the content script when needed. | Page content is processed locally; no page data is uploaded by the extension. |
| `offscreen` | Keep the PaddleOCR offscreen document available for image recognition. | OCR inference runs in the browser. |
| `contextMenus` | Add the right-click image/canvas translation action. | The menu is local browser UI. |
| `storage` | Persist extension settings such as enablement, domains, and target language. | Settings remain in browser storage. |
| `declarativeNetRequest`, `declarativeNetRequestFeedback` | Manifest V3 network-rule capability and feedback declarations. | No remote telemetry or tracking endpoint is used by this project. |
| `<all_urls>` host permission | Discover and process eligible images and canvases across web pages. | The permission grants page access; it does not send image or OCR data to a server. |

The build also exposes the local `onnx/*` runtime assets to extension pages that need them.

## Usage

### Automatic mode

1. Install or load the extension and keep it enabled.
2. Open an eligible web page containing an image or canvas with text.
3. The content script scans the page, sends eligible elements through the OCR batcher, and renders overlay boxes over detected text regions.
4. The detected regions are translated automatically using the default target language.
5. Hover an overlay box to inspect the original text and open the translation popup.
6. New elements and single-page-app route changes are observed without a full page reload.

### Extension popup

Open the extension popup to inspect the current page:

- **Images** lists detected image elements and their OCR/translation status.
- **Canvases** lists detected canvas elements and their OCR/translation status.
- **Translate** starts or refreshes translation for the listed items when the action is available.
- **Settings** controls whether the extension is enabled, configures the domain allow-list, and selects the default target language.
- Status badges show processing, translated, pending, and error states. Error badges keep per-element failures visible so one failed item does not hide the rest of the page.

### Context menu

Right-click an eligible image or canvas and choose the Image Translate menu action to process that element on demand. The request is isolated from other elements, so a failure in one item does not block the rest of the batch.

### Host API

Pages or compatible host integrations can use the content-script host API to render or clear an OCR overlay:

```ts
window.sendOcrToHost(src, ocrRegions);
window.removeOcrFromHost(src);
```

The current implementation exposes `removeOcrFromHost`; release notes may also refer to the legacy `removeOcrToHost` spelling. The `src` value identifies the image, and `ocrRegions` contains the regions to render.

## Settings

Settings are stored in `browser.storage.sync` under the `extensionSettings` key.

| Setting | Default | Purpose |
|---|---:|---|
| `enabled` | `true` | Enable or disable automatic detection and translation. |
| `enabledDomains` | `[]` | Domain allow-list. An empty list means all eligible domains are allowed. |
| `targetLang` | `"vi"` | Default target language used by automatic translation and the hover popup. |

Settings changes are broadcast to open tabs so the content script can re-evaluate eligibility without reloading the page.

## Architecture

### Entrypoints

| File | Responsibility |
|---|---|
| `entrypoints/content.ts` | Detects images/canvases, manages OCR overlays, observes DOM and URL changes, and coordinates automatic translation. |
| `entrypoints/background.ts` | MV3 service worker; batches OCR requests, manages the offscreen document, handles context menus/settings, and forwards translation requests without loading the model. |
| `entrypoints/popup/App.tsx` | Displays image/canvas status lists, translation controls, error badges, and settings. |
| `entrypoints/offscreen/offscreen.ts` | Hosts PaddleOCR and the translation engine, including the bundled model Web Worker. |

### Translation engine flow

1. The content script sends detected OCR regions to the background service worker.
2. The background ensures the offscreen document exists and forwards an internal offscreen translation request; it does not import the model engine.
3. The offscreen document groups regions, detects source languages, and starts the bundled model Web Worker through `src/translation/engine.ts`.
4. `src/translation/scheduler.ts` deduplicates work, checks L1 and L2 caches, and batches units by language.
5. `src/translation/model-manager.ts` loads `Xenova/nllb-200-distilled-600M` with WebGPU preferred and WASM fallback.
6. The worker returns translated text, cache status, and OCR box indexes; the offscreen document maps them to regions and the content script renders the translated overlay.

See [PROJECT_DESCRIPTION.md](./PROJECT_DESCRIPTION.md) for the detailed file-by-file architecture and message flow.

## Development

### Prerequisites

- [Bun.js](https://bun.sh/) (the project uses Bun rather than npm or Node-based package management)
- A current Chromium-based browser or Firefox with developer/unpacked-extension support enabled

### Commands

| Command | Purpose |
|---|---|
| `bun install` | Install dependencies and run the project postinstall preparation. |
| `bun run dev` | Start the WXT development server for Chrome/Chromium. |
| `bun run dev:firefox` | Start the WXT development server for Firefox. |
| `bun run build` | Build the Chrome/Chromium/Edge extension. |
| `bun run build:firefox` | Build the Firefox extension. |
| `bun run zip` | Create a Chrome/Chromium/Edge ZIP package. |
| `bun run zip:firefox` | Create a Firefox ZIP package. |
| `bun run compile` | Run TypeScript type checking with `tsc --noEmit`. |
| `bunx biome check .` | Run Biome formatting, lint, and style checks. |

### Code style

- Format and lint with Biome.
- Use the existing `@/` path aliases for project imports.
- Keep browser and extension APIs behind the existing message and utility boundaries.
- Prefer explicit TypeScript types and avoid `any`.
- Keep OCR, translation, cache, and UI concerns in their existing modules rather than duplicating logic.

## Project Layout

```text
.
├── entrypoints/
│   ├── content.ts
│   ├── background.ts
│   ├── popup/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── index.html
│   └── offscreen/
│       ├── offscreen.ts
│       └── index.html
├── src/translation/
│   ├── engine.ts
│   ├── worker.ts
│   ├── model-manager.ts
│   ├── scheduler.ts
│   ├── cache/
│   ├── language/
│   ├── preprocess/
│   └── postprocess/
├── utils/
├── types/
├── config/
├── public/
├── PROJECT_DESCRIPTION.md
├── changes.md
└── CHANGELOG.md
```

## Known Limitations

- The automatic translation target is fixed to Vietnamese; the hover popup exposes additional target choices for manual requests.
- The NLLB model files are approximately 300 MB and download on first use, subject to browser cache availability.
- All inference is client-side, so performance depends on the user's device, browser, and GPU/WASM support.
- The extension is not published to browser extension stores; users must load an unpacked or development build.
- OCR overlay placement does not perform full document layout analysis or reconstruct complex page typography.

## License

No `LICENSE` file is included in this repository yet. Confirm the intended license before redistributing the extension or its model assets.

## Attribution

Built with [WXT](https://wxt.dev/), React, PaddleOCR (`ppu-paddle-ocr`), ONNX Runtime Web, Hugging Face Transformers, `Xenova/nllb-200-distilled-600M`, and TinyLD.

## Change log

See [CHANGELOG.md](./CHANGELOG.md) for release history.
