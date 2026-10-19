# Image Translate Extension

A Manifest V3 browser extension that detects images and canvas elements on web pages, runs OCR (PaddleOCR), and overlays translated text directly on top of the originals — no copy/paste.

See [short.md](short.md) for a quick overview.

## Features
- Auto-detects images & canvas on page load, SPA navigation, and dynamic DOM changes
- Translates OCR regions with the free Google Translate API (33 languages)
- Hover any translated box to re-translate into another language on demand
- Per-item independent OCR so one failure never breaks the batch
- Asset caching (IndexedDB) + two-level translation cache
- Configurable target language via popup Settings

## Quick Start
```bash
bun install
bun run dev        # Chrome
bun run dev:firefox
```
Build: `bun run build` · Package: `bun run zip` · Typecheck: `bun run compile`

## Stack
WXT · React · PaddleOCR · TypeScript

## Documentation
- [PROJECT_DESCRIPTION.md](PROJECT_DESCRIPTION.md) — full architecture and feature flow
- [changes.md](changes.md) — change log
EOF