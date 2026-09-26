# Priority Queue & Port-based Message Lifecycle Fix

## Context
- Current runtime: MV3 service worker (`entrypoints/background.ts`) routes OCR and translation to an offscreen document (`entrypoints/offscreen/offscreen.ts`).
- Offscreen owns PaddleOCR (`runBatchOcr`) and the translation engine (`translationEngine`) that spawns a dedicated Web Worker (`src/translation/worker.ts`).
- Translation is only triggered after OCR completes, but both flows are independent fire-and-forget `runtime.sendMessage` calls.
- Observed error: `A listener indicated an asynchronous response … channel closed` — caused by the SW terminating before an async `sendResponse`.

## Decisions (locked)
1. **Keep the translation worker** (inside offscreen) – it already has full Web API access and isolates heavy inference.
2. **Shared priority queue lives in the offscreen document** – the long-lived context that runs both OCR and translation.
3. **Queue policy**: weighted fair, translation-first with a bounded OCR guarantee (e.g., 2 translation dispatches then 1 OCR batch). Prevents OCR starvation.
4. **Message lifecycle fix**: switch to **long-lived `runtime.connect` ports** for all cross-context traffic (content ↔ background ↔ offscreen). Ports survive SW idle shutdown and avoid the channel-closed race.

## Scope
### In scope
- Add a `PriorityQueue` module in `src/queue/` (or `utils/queue.ts`) used by offscreen.
- Replace `background.ts` message listeners with a thin port router that opens a port to offscreen and forwards content ports.
- Update `offscreen.ts` to accept incoming ports, enqueue `OcrJob` / `TranslateJob`, and return results on the same port.
- Adjust `content.ts` (`ocr-pipeline.ts`, `translateAndUpdateOverlay`) to open a port to background (or directly to offscreen via background) and await responses.
- Ensure translation jobs are enqueued only after OCR succeeds (existing callback chain stays).
- Preserve existing batch size / debounce for OCR but drive it from the offscreen queue.
- Add keep-alive heartbeat from offscreen while queue non-empty (optional; ports already keep SW alive since Chrome 114).

### Out of scope
- Persistent queue across extension reloads.
- Per-language model instances (target stays `vie_Latn`).
- Changing the translation worker to run on the offscreen main thread.

## Implementation Steps
1. **Create queue module**
   - `src/queue/types.ts`: `JobType = "ocr" | "translate"`, `Job = { id, type, payload, resolve, reject, priority }`.
   - `src/queue/priority-queue.ts`: bounded priority queue with `enqueue(job)`, `dequeue(): Job | null`, `size()`; translation jobs get priority 0, OCR priority 1; scheduler picks translation first, but forces an OCR dequeue after `MAX_TRANSLATION_BEFORE_OCR` (default 2) consecutive translation dequeues.

2. **Offscreen integration**
   - Import `PriorityQueue` in `offscreen.ts`.
   - On `runtime.onConnect`, accept ports from background; for each port, listen `onMessage`:
     - If `msg.type === "enqueue-ocr"` → wrap in `OcrJob`, `queue.enqueue`, when dequeued call `runBatchOcr([msg.payload])` and `port.postMessage({ jobId, result })`.
     - If `msg.type === "enqueue-translate"` → wrap in `TranslateJob`, `queue.enqueue`, when dequeued call `translateRegions(msg.payload.regions)` and `port.postMessage({ jobId, result })`.
   - Run a microtask loop (`setImmediate` / `queueMicrotask`) that repeatedly `dequeue` and processes until queue empty.

3. **Background port router**
   - Replace `runtime.onMessage` listeners with `runtime.onConnect`.
   - On connect from content (`port.name === "content-port"`), open a second port to offscreen (`runtime.connect({ name: "background-to-offscreen" })`).
   - Forward messages bidirectionally: content → offscreen (tag with original port), offscreen → content (route back via stored map `jobId → contentPort`).

4. **Content script changes**
   - `ocr-pipeline.ts`: instead of `sendMessage("ocr/process")`, open a port to background (`browser.runtime.connect({ name: "content-port" })`), send `{ type: "enqueue-ocr", payload: … }`, await single `onMessage` response, then close port (or keep for reuse).
   - `translateAndUpdateOverlay`: same pattern with `{ type: "enqueue-translate", payload: { regions } }`.

5. **Worker status handler**
   - Add missing `WORKER_API.status` case in `worker.ts` (returns `getModelStatus()`).

6. **Type cleanup**
   - Replace `any` in `OcrBatchItem.sendResponse` and `BatchRunOcrResponse.results` with proper types.
   - Remove dead `MAX_CONCURRENT` export or wire it into OCR concurrency limiter (optional follow-up).

7. **Validation**
   - `bun run compile` – zero TS errors.
   - `bun run build` & `bun run build:firefox` – both outputs contain non-empty worker asset.
   - `bunx biome check .` – no new warnings (existing `any` warnings cleared).
   - Manual smoke test: load extension, open page with images, verify OCR + translation overlays appear, no console “channel closed” errors.

## Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| Port forwarding complexity introduces bugs | Write small unit test for port router logic (mock `runtime.connect`). |
| Queue starvation if translation flood persists | Weighted policy + unit test verifying OCR runs after N translations. |
| Offscreen document unload while queue has items | Offscreen only closes when explicitly closed; ports keep it alive. Add `onDisconnect` to requeue or reject pending jobs. |
| Backward compatibility with popup/context-menu | Popup already polls via `ui/*` messages – unchanged. Context menu uses `background/translate` → becomes port message. |

## Open Questions (explicitly out of scope)
- Queue persistence across extension restarts.
- Dynamic priority tuning at runtime.
- Exposing queue metrics to popup.

---
*Plan ready for implementation.*