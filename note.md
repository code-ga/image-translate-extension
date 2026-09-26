# Translation runtime handoff

Date: 2026-09-22

## Current goal

Move NLLB model execution out of the MV3 background service worker. The background must remain a lightweight router; the offscreen document owns the translation engine and its model Web Worker.

## Implemented architecture

1. `entrypoints/content.ts` sends `translate/text` or `translate/regions` to the background.
2. `entrypoints/background.ts` ensures the offscreen document exists, then forwards an internal `offscreen/translate-text` or `offscreen/translate-regions` message. It no longer imports `translationEngine` or `translateRegions`, and startup/install no longer warm up the model.
3. `entrypoints/offscreen/offscreen.ts` imports `translationEngine`, handles OCR and translation messages, and returns translated OCR regions.
4. `src/translation/engine.ts` creates the model worker with `TranslationWorker from "./worker?worker"` and `new TranslationWorker(...)`. This avoids the broken `new URL("./worker.ts", import.meta.url)` path in WXT output.
5. `src/translation/worker.ts` registers its message handler by calling `startTranslationWorker()` when the worker bundle loads.
6. `src/translation/preprocess/grouping.ts` records `regionIndex`/`boxIndex` for every translation unit. `src/translation/scheduler.ts` carries those indexes through cached, translated, and fallback results.
7. `src/translation/engine.ts::applyTranslationsToRegions()` maps worker results back to `OCRRegion.translation`; `utils/overlay.ts` renders the translated region text and passes the cached translation to the hover popup.
8. `src/translation/language/language-resolver.ts::detectLanguagesForUnits()` preserves an explicitly supplied language and only detects units marked `unknown`.

## Files changed for this pass

- `entrypoints/background.ts`
- `entrypoints/offscreen/offscreen.ts`
- `src/translation/engine.ts`
- `src/translation/worker.ts`
- `src/translation/language/language-resolver.ts`
- `src/translation/preprocess/grouping.ts`
- `src/translation/scheduler.ts`
- `src/translation/types.ts`
- `types/index.ts`
- `types/messages.ts`
- `utils/overlay.ts`
- `PROJECT_DESCRIPTION.md`
- `README.md`
- `changes.md`

## Validation already run

- `bun run compile` — passed.
- `bun run build` — passed; Chrome output contains a non-empty worker asset.
- `bun run build:firefox` — passed; Firefox output contains a non-empty worker asset.
- Targeted `bunx biome check ...` — command exited successfully, but warnings remain for explicit `any` and the default `{}` payload type.
- `git diff --check` — no whitespace errors; Git reported normal LF-to-CRLF warnings on Windows.

Use Bun for all JavaScript/TypeScript commands, per `AGENTS.md`.

## Continue here: highest-priority fixes

1. Add the missing worker status branch in `src/translation/worker.ts`:
   - `WORKER_API.status` should return `getModelStatus()` with `sendResponse("status", ...)`.
   - Without it, `translationEngine.getStatus()` cannot work even though the request/response types define status.
2. Remove explicit `any` warnings:
   - `entrypoints/background.ts:137`: type `OcrBatchItem.sendResponse` with the actual OCR response shape.
   - `entrypoints/background.ts:206` and `:227`: use a typed OCR batch response instead of `any[]`.
   - `types/messages.ts:34`: replace `results?: any[]` with the OCR result union.
   - `types/messages.ts:9`: replace the default `{}` payload type with a safe empty-object type such as `Record<string, never>` (or another project-approved type).
3. Harden `applyTranslationsToRegions()`:
   - Validate `result.boxIndexes` before indexing `translatedRegions[index]`.
   - Ignore negative/out-of-range indexes and fall back to bbox matching.
4. Re-run all validation after fixes:
   - `bun run compile`
   - `bun run build`
   - `bun run build:firefox`
   - `bunx biome check .`
   - `git diff --check`

## Next todo

- [ ] Next agent: finish the remaining translation-runtime cleanup, then validate it:
  1. Add the missing `WORKER_API.status` branch in `src/translation/worker.ts`.
  2. Replace explicit `any` types in `entrypoints/background.ts` and `types/messages.ts`; replace the default `{}` payload type safely.
  3. Harden `applyTranslationsToRegions()` against invalid or out-of-range `boxIndexes`.
  4. Run `bun run compile`, `bun run build`, `bun run build:firefox`, `bunx biome check .`, and `git diff --check`.
- Do not commit or alter unrelated staged work without explicit approval.

## Important constraints / known behavior

- Do not import `src/translation/engine.ts` in `entrypoints/background.ts`; doing so reintroduces the service-worker `Worker` failure and pulls model code into the background bundle.
- Keep `main()` in `entrypoints/background.ts` synchronous. WXT expects a synchronous WXT service worker lifecycle.
- Keep the translation engine in the offscreen document; the content script is a possible future alternative, but the current route is background -> offscreen.
- `TranslationEngine.translate()` currently forces `targetLang` to `TARGET_LANGUAGE` (`vie_Latn`), so alternate popup targets are not honored yet. Do not describe that limitation as fixed.
- The scheduler documentation says it deduplicates identical texts, but the current implementation does not perform a real deduplication pass. Treat that as a separate follow-up.
- The worktree contains many unrelated release/documentation changes. Do not revert, restage, or commit them without explicit instruction. `changes.md` is currently both staged and modified (`MM` in `git status --short`).
- No automated test files were found in this pass.

## Message types

New internal routes in `types/messages.ts`:

- `offscreen/translate-text`
- `offscreen/translate-regions`

Public content routes remain:

- `translate/text`
- `translate/regions`

## Useful entry points

- `entrypoints/background.ts:154` — offscreen lifecycle and concurrency guard.
- `entrypoints/background.ts:270` — text translation forwarding.
- `entrypoints/background.ts:292` — region translation forwarding.
- `entrypoints/offscreen/offscreen.ts:57` — offscreen text handler.
- `entrypoints/offscreen/offscreen.ts:109` — offscreen region handler.
- `src/translation/engine.ts:27` — worker creation.
- `src/translation/engine.ts:217` — OCR result mapping.
- `src/translation/worker.ts:94` — worker message registration.
