# Changes Log

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
