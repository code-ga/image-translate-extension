# Refactoring Plan

## Phase 1: content.ts refactoring

### Problem
`entrypoints/content.ts` was 935 lines with deeply tangled concerns and massive duplication between image and canvas handling paths.

### Strategy
Extracted 4 utility modules and thinned content.ts to a 469-line orchestration layer.

### New files
- `utils/overlay.ts` (75 lines) — Shared overlay DOM creation, positioning, box rendering, container management
- `utils/element-state.ts` (93 lines) — Generic element tracking with lifecycle management (`createElementState<T>()`)
- `utils/ocr-pipeline.ts` (196 lines) — OCR processing pipeline with callback-based result handling
- `utils/dom-observer.ts` (102 lines) — Live DOM observation and SPA URL polling

### Result
`content.ts` reduced from 935 → 469 lines. All concerns delegated to utilities.

---

## Phase 2: background.ts & offscreen.ts refactoring

### Problem
`background.ts` (298 lines) had duplicated settings retrieval, domain checking, and script injection patterns. `offscreen.ts` (286 lines) mixed asset caching, model initialization, fetch interception, and OCR batch processing.

### New files
- `utils/extension-settings.ts` — Centralized settings retrieval and domain permission checking
- `utils/script-injection.ts` — Safe content script injection helper
- `utils/asset-cache.ts` — IndexedDB caching, cache URL validation, fetch wrapper
- `utils/ocr-batcher.ts` — PaddleOcrService model initialization and batch OCR execution

### Result
- `background.ts` refactored from 298 → ~160 lines
- `offscreen.ts` refactored from 286 → ~25 lines as a thin message dispatch entry point

---

## Reliability improvements (all phases)
- Unified cleanup lifecycle via `element-state.ts`
- `onComplete` callback ensures processingSet is always cleaned up
- Centralized overlay positioning with debounced rAF scheduling
- No duplicate processing — processing set prevents concurrent OCR on same element
- Centralized settings retrieval eliminates inconsistent patterns

## Verification
- All files pass `bun run compile` (zero TypeScript errors)
- All files pass `bunx biome check` (no new lint issues; only pre-existing `any` warnings)