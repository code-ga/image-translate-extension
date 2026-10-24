# Plan: OCR caching, accurate overlay status, cross-tab OCR queue

## Goal
Three related fixes in the image-translate extension:
1. **OCR cache** — skip re-running OCR on identical images (shared across tabs via the background service worker).
2. **Accurate popup status** — the popup must not show "Done" until the translated overlay is actually painted; while translation is in flight it should show "Translating..." (processing).
3. **Cross-tab OCR queue** — OCR processing state lives in the background (shared), so the popup can display the current process queue across all tabs instead of forgetting the active tab's state when the user switches tabs.

## Problem statement (from current code)
- `utils/ocr-batcher.ts` / `entrypoints/background.ts`: every `ocr/process` request is sent to the offscreen PaddleOCR engine with no cache. Same image in two tabs = two OCR runs.
- `entrypoints/content.ts`: `processingSet` is deleted in `processImage`'s `onComplete` **before** `translateAndUpdateOverlay` (async translation) finishes. `collectImageInfo` then reports `processed` ⇒ `"done"` while the translated overlay is still not painted (popup shows "Done" before the corrected overlay appears).
- `entrypoints/popup/App.tsx`: `pollPageData` only `tabs.sendMessage`s the **active** tab. State (`imageState`/`canvasState`) lives per content script (per tab), so OCR kicked off in tab A is invisible when the popup is opened on tab B.

## Design decisions (recommended answers)

| Decision | Recommended answer |
|---|---|
| Cache location | Background service worker (`entrypoints/background.ts`) — single shared instance, automatically cross-tab. |
| Cache store | In-memory `Map` only (LRU, cap 100 entries). No IndexedDB/storage persistence for MVP (service-worker restarts clear it — acceptable). |
| Cache key | SHA-256 of the item's `imageData` string via `crypto.subtle.digest`. URL items keyed by URL hash; base64/canvas items keyed by content hash. |
| New util file | `utils/ocr-cache.ts` exporting an `OcrCache` class: `get(key)`, `set(key, value)`, `has(key)`, `clear()`, `size()`. |
| "Done" definition | Overlay painted **with final translated content**. Track via a new `translatedMap` in `element-state.ts`. |
| Status priority (`collectImageInfo`/`collectCanvasInfo`) | `processingSet`/`translatingSet` → `"processing"`; `errorMap` → `"error"`; `translatedMap` matches → `"done"`; `processed` matches but not translated → `"processing"` ("Translating..."); else `"pending"`. |
| Translation in-flight tracking | Keep element in `processingSet` until `translateAndUpdateOverlay` settles (move `processingSet.delete` out of `onComplete` into translation settle). Direct render path (`sendOcrToHost`) marks translated immediately ⇒ `"done"`. |
| Cross-tab tab identity | Background infers `tabId`/`tabUrl` from `sender.tab` on `ocr/process`. Content script reports job completion via new `ocr/job-*` messages carrying a `jobId` returned by `ocr/process`. |
| Job registry | Background `ocrJobRegistry: Map<jobId, OcrJob>` with TTL cleanup (jobs older than 10 min removed; cap 500 jobs). |
| Popup queue | Popup adds `ocr/get-queue` polling (in addition to active-tab image/canvas list) and renders jobs grouped by tab URL with status badges. |

## Files to change

### New
- `utils/ocr-cache.ts` — `OcrCache` class (in-memory LRU, SHA-256 key helper `hashImageData`).

### Edit
- `types/messages.ts` — add `OcrJob` type, `OcrJobStatus` union (`"queued"\|"processing"\|"done"\|"error"`), and messages: `ocr/job-started`, `ocr/job-completed`, `ocr/job-failed`, `ocr/get-queue`, `ocr/get-queue-response`; extend `ProcessOcrMessage` response to carry `jobId`; add `jobId` to `AppMessage` union.
- `types/index.ts` — export `OcrJob`, `OcrJobStatus` (or re-export from messages).
- `utils/element-state.ts` — add `translatedMap: Map<T, string>` + `setTranslated/getTranslated/hasTranslated/clearTranslated`; expose in return object.
- `entrypoints/content.ts` —
  - `processNewImage`/`processNewCanvas`: do NOT delete from `processingSet` in `onComplete`; capture `jobId` from `processImage` response and call `translateAndUpdateOverlay`; on translation settle delete `processingSet`, call `setTranslated` (success) or `setError` (failure).
  - `translateAndUpdateOverlay`: return a promise that settles after translation so caller can update state; mark translated on success, error on failure.
  - `collectImageInfo`/`collectCanvasInfo`: apply new status priority (incl. translatedMap).
  - `sendOcrToHost`: after `renderImageOverlay`, call `setTranslated` so direct renders show `"done"`.
  - Report `ocr/job-started` at process start and `ocr/job-completed`/`ocr/job-failed` with `jobId` on settle.
- `entrypoints/background.ts` —
  - `ocrCache` instance; in `flushOcrBatch`, per item: check cache before resolving/sending to offscreen; on success `set` result.
  - `ocrJobRegistry` + TTL cleanup; create job on `ocr/process` (capture `sender.tab.id`/`url`), return `jobId` in `sendResponse`; settle job on `ocr/job-completed`/`ocr/job-failed`/`sendResponse` error.
  - Add `ocr/get-queue` handler returning a registry snapshot.
- `entrypoints/popup/App.tsx` — add `queueJobs` state; poll `ocr/get-queue` (merged into existing interval, skipped on settings tab); render cross-tab queue grouped by tab with status badges; keep existing active-tab image/canvas list.
- `entrypoints/popup/App.css` — add styles for the queue section (tab group header, per-tab job rows, status badges).
- `PROJECT_DESCRIPTION.md` — update Architecture/Feature Flow/Key Design Patterns/Notes to document the cache, translated-status tracking, and cross-tab queue (per AGENTS.md).
- `changes.md` — add a dated change entry (per AGENTS.md).

## Data contract (new messages)

`ocr/job-started` `{ jobId, tabId, tabUrl, type: "image"\|"canvas", target: string }` → content→background.
`ocr/job-completed` `{ jobId }` → content→background.
`ocr/job-failed` `{ jobId, error? }` → content→background.
`ocr/get-queue` `{}` → popup→background; response `{ jobs: OcrJob[] }`.

`OcrJob = { id: string; tabId: number; tabUrl: string; type: "image"\|"canvas"; target: string; status: OcrJobStatus; createdAt: number; finishedAt?: number; error?: string }`.

## Validation steps
- `bun run compile` (`tsc --noEmit`) passes with no new type errors; avoid `any`.
- Same image open in two tabs: second tab's OCR returns from cache (no offscreen call), both show correct status.
- Popup shows "Translating..." (processing badge) while OCR→translation is in flight, and only "Done" after the translated overlay is painted.
- Trigger OCR in tab A, switch popup to tab B: tab A's job still appears in the cross-tab queue with live status.
- Errored OCR job shows `"error"` badge in queue and in the active-tab list.
- Job registry cleanup: old jobs (>10 min) removed; no unbounded memory growth.

## Out of scope (MVP)
- Persistent OCR cache across browser restarts (IndexedDB/storage).
- Per-language model selection or quality scoring.
- Translations persisted/re-applied on page reload (existing behavior unchanged).

## Open questions (deferred, recommended defaults)
- Cache eviction cap/TTL: default 100 entries, no TTL (LRU). Adjust if memory pressure observed.
- Cross-tab queue UI placement: integrated into the Images tab as a "Processing queue" section below the active-tab list. Revisit if a dedicated tab is preferred.
