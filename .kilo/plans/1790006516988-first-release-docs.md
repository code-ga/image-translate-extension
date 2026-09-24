# Plan: First Release Documentation

## Goal

Write the README and release-focused documentation for the Image Translate browser extension's first release.

## Context

The project is a WXT + React Manifest V3 browser extension (`ppu-paddle-ocr` + HuggingFace NLLB-200 via Web Worker). The current `README.md` is still the WXT template placeholder. `PROJECT_DESCRIPTION.md` and `changes.md` exist but are dev-facing. No user-facing release docs exist.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Version number | `0.1.0` | First public release; pre-1.0 to allow iteration before stability guarantees |
| Changelog format | `CHANGELOG.md` (Keep a Changelog) | Conventional, widely understood, easy to extend |
| Screenshots | Placeholder rows with note to add `docs/screenshots/` | No screenshots exist yet; don't block release on assets |
| Repo URL | Placeholder `<this-repo-url>` | User must fill or update to real clone URL |

## Tasks

### [ ] 1. Replace README.md

Overwrite `README.md` (currently 3-line WXT template) with full project README containing:

- **Title + one-line tagline**: "Translate text inside images on any web page — automatically."
- **Hero paragraph**: 2-3 sentence summary of what it does, the tech stack, and that everything is local.
- **Key badges**: built with WXT, Manifest V3, client-side (no icons unless user provides).
- **Features** bullet list (7-8 items: auto-detection, PaddleOCR, NLLB-200, auto language detection, hover popup, two-level cache, zero server round-trip, multi-browser).
- **Supported Languages**: 17 source languages (script-detect + TinyLD) → Vietnamese default; hover popup supports 17 targets.
- **Screenshots**: 3-column table with placeholder cells + note to add `docs/screenshots/`.
- **Installation**: two options — (A) dev from source via `bun run dev`, (B) `bun run build` + load unpacked. Explicit note: not on Web Store.
- **Permissions** table: `activeTab`/`scripting`, `offscreen`, `contextMenus`, `storage`, `declarativeNetRequest`, `<all_urls>` — with "used for" and "no data leaves browser" notes.
- **Usage**: automatic mode description, popup UI walkthrough (Images/Canvases tabs, Translate button, Settings tab, error badges), context menu, Host API (`sendOcrToHost`/`removeOcrToHost`).
- **Settings** table: `enabled` (default true), `enabledDomains` (default []), `targetLang` (default "vi").
- **Architecture**: entrypoints table (content.ts, background.ts, popup/App.tsx, offscreen/offscreen.ts) + translation engine flow (6-step pipeline into Web Worker). Pointer to PROJECT_DESCRIPTION.md for full detail.
- **Development**: prerequisites (Bun.js), command table (install, dev, dev:firefox, build, build:firefox, zip, compile), code style (biome, path aliases, no `any`).
- **Project Layout**: tree of entrypoints/, src/translation/, utils/, types/, config/, public/.
- **Known Limitations** (5 items: fixed target lang, ~300MB model download, client-side only, not on stores, no layout analysis).
- **License** + tech stack attribution footer.
- **"Change log" section** linking to CHANGELOG.md.

### [ ] 2. Create CHANGELOG.md

New file `CHANGELOG.md` following [Keep a Changelog](https://keepachangelog.com/) format:

```markdown
# Changelog

All notable changes to this project are documented in this file.

## [0.1.0] - 2026-09-21

### Added
- Image Translate: browser extension that translates text inside images on any web page
- Automatic image & canvas detection with OCR overlay rendering on page load and SPA navigation
- PaddleOCR engine running in offscreen document for text extraction
- Neural machine translation via Xenova/nllb-200-distilled-600M (WebGPU + WASM fallback)
- Automatic source-language detection (17 languages) using Unicode script analysis + TinyLD
- Default translation target: Vietnamese (vie_Latn)
- Hover translation popup with per-overlay language selection
- Two-level translation cache: in-memory (L1) + IndexedDB (L2) with SHA-256 keys
- Token protection: URLs, emails, numbers, currency, hex codes, paths, code identifiers preserved
- Web Worker isolation for translation inference (UI stays responsive)
- Popup UI: image/canvas list with status badges, batch translate, settings tab
- Context menu: right-click to translate a single image or canvas
- Per-image independent processing via Promise.allSettled (one failure cannot block others)
- Error tracking with persistent per-element error state in popup
- IndexedDB asset caching for model files
- Domain allow-list configuration for extension enable/disable
- Live settings broadcast to open tabs
- Works on Chrome/Chromium/Edge and Firefox

### Known Issues
- Target language fixed to Vietnamese for default mode; hover popup supports 17 targets
- Model files (~300 MB) download on first translation
- Not published to browser extension stores (load unpacked only)

### Internal / Dev
- Refactored content.ts, background.ts, offscreen.ts into modular utilities
- Translation engine architecture: engine.ts, worker.ts, model-manager.ts, scheduler.ts
- Unified message type system with routing (types/messages.ts)
- Full type-checking passes (bun run compile); Biome lint passes
```

### [ ] 3. Update package.json

- Change `"version": "0.0.0"` → `"version": "0.1.0"`
- Change `"name": "wxt-react-starter"` → `"name": "image-translate"` (or `"image-translate-extension"`)
- Change `"description"` from `"manifest.json description"` → user-facing description string

### [ ] 4. Update changes.md

- Add header entry for `[0.1.0] - 2026-09-21` release consolidating the existing dev changelog entry at top
- Ensure existing detailed entries remain as historical detail

## Validation

- `bun run compile` passes (no TS errors introduced)
- `bunx biome check .` passes
- README renders correctly on GitHub (valid markdown, no broken links to existing files)
- CHANGELOG.md follows Keep a Changelog format

## Out of scope

- Screenshot assets (placeholder in README)
- Publishing to Chrome Web Store / Firefox AMO
- Actual git tag/release creation (unless user asks)
- LICENSE file creation (links to LICENSE; if missing, note it)
