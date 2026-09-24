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
