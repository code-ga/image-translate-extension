# Changes Log

## 2026-07-26

### Build System Fix
- Fixed 83 TypeScript errors that blocked `tsc -b && vite build`.
- **Root cause**: `tsconfig.node.json` included `"src"` in its `include` array, causing all browser source files to be type-checked with node defaults (no DOM lib, ES3 target, no JSX). This conflicted with `tsconfig.app.json` which has proper `target: ES2020`, `lib: [ES2020, DOM, DOM.Iterable]`, and `jsx: react-jsx`.
- **Fix**: Changed `tsconfig.node.json` to include only `["vite.config.ts", "src/manifest.ts"]` instead of `["vite.config.ts", "src"]`, so the node config only type-checks build tooling files while browser source files are exclusively type-checked by `tsconfig.app.json`.
- Fixed `index.html` referencing non-existent `/src/main.tsx` — corrected to `/src/popup/main.tsx`.
- Removed invalid `public/manifest.json` copy target from `vite-plugin-static-copy` in `vite.config.ts` (the CRX plugin generates the manifest from JS, and `public/manifest.json` does not exist).
- Added `prebuild` script to `package.json` that copies WASM files from `node_modules/onnxruntime-web/dist/` to `onnx-assets/` before the build, since `@crxjs/vite-plugin` validates manifest assets before `vite-plugin-static-copy` copies them during the build.

## 2026-07-25

### OCR Batch Recognition Migration
- Introduced `src/ocr-config.ts` to centralize OCR constants (`MAX_CONCURRENT = 2`, `OCR_BATCH_SIZE = 6`, `OCR_BATCH_DEBOUNCE_MS = 80`).
- Migrated OCR processing from single-task to batch recognition using `ppu-paddle-ocr`'s `batchRecognize()` API:
  - `content.ts` now sends individual `PROCESS_OCR` messages without internal queuing.
  - `background.ts` collects `PROCESS_OCR` messages into a debounced batch (max 6 items, 80ms debounce) and dispatches a single `batch-run-ocr` message to the offscreen document.
  - `offscreen.ts` receives `batch-run-ocr` and runs `model.batchRecognize()` with `concurrency: 2` and `settle: true`.
- Removed per-tab concurrency limit from `content.ts`; the global throttle now lives in `background.ts` to prevent service worker / offscreen overload across multiple tabs.
- Background now enforces single-flight batch dispatch (`activeBatchCount`) so only one offscreen batch runs at a time globally.
- Offscreen batch mapper casts fulfilled results to `PaddleOcrResult` for type-safe `.lines` access.
