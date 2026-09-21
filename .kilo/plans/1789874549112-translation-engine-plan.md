# Translation Engine Implementation Plan

Based on the detailed architecture specification provided, this plan breaks down the implementation into ordered, actionable tasks.

## Project Context

Current state: Extension uses PaddleOCR (offscreen) + opus-mt models per language pair (background). The `srcLang` is empty, making translation unreliable.

Target state: Single NLLB-200 distilled 600M model with automatic language detection, running in a Web Worker, with caching, token protection, and graceful degradation.

---

## Phase 1: Foundation & Types

### 1.1 Add Translation Subsystem Types
**File:** `src/translation/types.ts` (new)

Define all core types per the architecture:
- `TranslationUnit` — grouped OCR blocks with bbox
- `TranslationRequest` / `TranslationResponse` — public API
- `LanguageDetectionResult` — script + TinyLD output
- `NllbLanguageCode` — supported source languages mapping
- `TranslationError` — error taxonomy (MODEL_DOWNLOAD_FAILED, LANGUAGE_UNKNOWN, etc.)
- `TranslationCacheKey` — SHA-256 based key with model version
- Worker message types: `TranslationWorkerRequest`, `TranslationWorkerResponse`

### 1.2 Define Supported Language Map
**File:** `src/translation/language/language-map.ts` (new)

```typescript
const SUPPORTED_SOURCE_LANGUAGES = {
  eng: "eng_Latn", jpn: "jpn_Jpan", cmn: "zho_Hans",
  zho: "zho_Hant", kor: "kor_Hang", fra: "fra_Latn",
  deu: "deu_Latn", spa: "spa_Latn", por: "por_Latn",
  ita: "ita_Latn", rus: "rus_Cyrl", ara: "arb_Arab",
  hin: "hin_Deva", tha: "tha_Thai", vie: "vie_Latn",
} as const;
```

---

## Phase 2: Language Detection (Self-Implemented)

### 2.1 Script Detector
**File:** `src/translation/language/script-detector.ts` (new)

- Unicode code point analysis → `ScriptStats` (latin, hiragana, katakana, han, hangul, cyrillic, arabic, devanagari)
- `detectScript(text): ScriptStats` — pure, fast, no deps
- `identifyLanguageFromScript(stats): string | null` — returns language code if uniquely identified (e.g., Hangul→kor, Hiragana/Katakana→jpn)

### 2.2 Language Detector (TinyLD Integration)
**File:** `src/translation/language/language-detector.ts` (new)

- Install `tinyld` via bun
- `detectLanguage(text): LanguageCandidate[]` — wraps TinyLD `detectAll()`
- Restrict candidates to `SUPPORTED_SOURCE_LANGUAGES` keys
- Return top candidates with scores

### 2.3 Language Resolver
**File:** `src/translation/language/language-resolver.ts` (new)

Algorithm per spec:
1. Filter useless OCR: empty, `...`, `!!!`, numbers only, symbols
2. Calculate script distribution across unit
3. If script strongly identifies language → accept (high confidence)
4. Else → run TinyLD on concatenated text
5. Filter candidates to supported NLLB languages
6. If confidence < threshold (e.g., 0.6) → return `{ language: "unknown", confidence, method: "tinyld" }`
7. Special case: if detected `vie` → return original (no translation needed)

---

## Phase 3: Text Preprocessing & Grouping

### 3.1 Text Normalization
**File:** `src/translation/preprocess/normalize.ts` (new)

- Trim whitespace, collapse repeated whitespace
- Normalize line breaks
- Remove OCR artifacts (isolated punctuation, garbage chars)

### 3.2 Token Protection
**File:** `src/translation/preprocess/protect-tokens.ts` (new)

- Regex patterns for: URLs, emails, numbers, percentages, currency, hex colors, file paths, code identifiers
- `protectTokens(text): { protectedText: string; tokens: Map<string, string> }` — replaces with `__TOKEN_N__`
- `restoreTokens(translatedText, tokens): string` — restores original tokens

### 3.3 OCR Box Grouping into Translation Units
**File:** `src/translation/preprocess/grouping.ts` (new)

Input: `OCRRegion[]` (from existing `ocr-region-grouping.ts`)
Output: `TranslationUnit[]`

Algorithm (MVP):
- Group nearby boxes on same approximate line (Y overlap threshold)
- Same region proximity (X distance threshold)
- Reading order: top-to-bottom, left-to-right
- Merge into units, each with concatenated `sourceText` and union `bbox`
- Enforce `MAX_TRANSLATION_CHARS = 800` — split at sentence boundaries (`. ? ! 。 ？ ！ \n`)

---

## Phase 4: Translation Core (Worker)

### 4.1 Web Worker Entry Point
**File:** `src/translation/worker.ts` (new)

- Register message handlers for:
  - `translate` — array of `TranslationUnit` with detected language
  - `warmup` — preload model
  - `dispose` — unload model
- Response types: `result`, `progress`, `error`
- Use `self.postMessage` for all communication

### 4.2 Model Manager (inside worker)
**File:** `src/translation/model-manager.ts` (new, worker-only)

State machine: `UNAVAILABLE → DOWNLOADING → LOADING → READY ↔ INFERENCE → ERROR → READY`

- `load(): Promise<void>` — lazy load `Xenova/nllb-200-distilled-600M`
- Backend selection: try WebGPU, catch → WASM
- `translate(texts: string[], srcLang: NllbLanguageCode): Promise<string[]>`
- `getStatus(): ModelStatus` — for UI progress
- `unload(): Promise<void>` — after idle timeout (5 min)

### 4.3 Translation Scheduler (inside worker)
**File:** `src/translation/scheduler.ts` (new, worker-only)

Responsibilities (per spec):
1. Deduplicate identical texts (same sourceLang)
2. Cache lookup (L1 memory → L2 IndexedDB)
3. Group by source language (target always `vie_Latn`)
4. Batch texts per language
5. Call model manager
6. Post-process (restore tokens, normalize output)
7. Cache write (both levels)
8. Return results with `cached: boolean`

### 4.4 Translation Cache
**File:** `src/translation/cache/translation-cache.ts` (new)

- L1: `Map<string, TranslationResult>` — instant
- L2: IndexedDB (`translation-cache` store) — persistent
- Key: `SHA-256(modelVersion + srcLang + targetLang + normalizedText)`
- Include `modelVersion` + `engineVersion` in key for invalidation
- TTL optional, but model version handles staleness

---

## Phase 5: Post-Processing

### 5.1 Output Normalization
**File:** `src/translation/postprocess/normalize-output.ts` (new)

- Trim, collapse whitespace
- Preserve intentional line breaks
- Restore protected tokens (from preprocess)

---

## Phase 6: Integration with Extension

### 6.1 Translation Engine Facade (Main Thread)
**File:** `src/translation/engine.ts` (new)

Public API:
```typescript
interface TranslationEngine {
  translate(request: TranslationRequest): Promise<TranslationResponse>;
  warmup(): Promise<void>;
  dispose(): Promise<void>;
}
```

- Spawns/manages Web Worker
- Handles worker lifecycle, message routing
- Falls back gracefully if worker fails

### 6.2 Update Background Translation Handler
**File:** `entrypoints/background.ts` (modify)

- Replace `translateDynamic` (opus-mt) with call to `TranslationEngine`
- Remove per-language model caching (`loadedModels` map)
- Handle `translate/text` with `srcLang: ""` → engine auto-detects
- Return `TranslateTextResponse` format for popup compatibility

### 6.3 Update Content Script for Batch Translation
**File:** `entrypoints/content.ts` (modify)

- When OCR completes (`ocrRegions`), group into `TranslationUnit[]`
- Send to background via new message type `translate/regions` (or reuse flow)
- Background → engine → worker → response → overlay update

### 6.4 Update Translation Popup
**File:** `utils/translation-popup.ts` (modify)

- Keep UI but change message: send `translate/text` with empty `srcLang`
- Background/engine handles auto-detection
- Remove per-language model selection from popup (target fixed to Vietnamese per MVP)

---

## Phase 7: Configuration & Dependencies

### 7.1 Add Dependencies
**File:** `package.json` (modify)

```json
"dependencies": {
  "@huggingface/transformers": "^4.2.0",
  "tinyld": "^1.x",  // add
  "onnxruntime-web": "^1.27.0",
  ...
}
```

### 7.2 Web Worker Build Configuration
**File:** `wxt.config.ts` (modify)

- Configure WXT to build `src/translation/worker.ts` as a web worker
- Ensure Transformers.js WASM/WebGPU assets are accessible

---

## Phase 8: Testing & Validation

### 8.1 Unit Tests (Manual/Integration)
- Script detector: Japanese, Korean, Chinese, Arabic, Cyrillic, Latin
- Language resolver: mixed scripts, short texts, Vietnamese passthrough
- Token protection: URLs, numbers, currency, code
- Grouping: multi-line, multi-region, long text splitting
- Cache: hit/miss, model version invalidation
- Worker: warmup, translate, progress, error, dispose

### 8.2 E2E Scenarios
- Japanese manga page → Vietnamese
- English screenshot → Vietnamese
- Mixed-language image (JA + EN + numbers)
- Vietnamese source → passthrough
- Weak device (WASM fallback)
- Model download progress UI

---

## Risk & Mitigation

| Risk | Mitigation |
|------|------------|
| NLLB model too large for browser | Lazy load, quantized (q4), WASM fallback, 5-min idle unload |
| WebGPU unreliable | Try/catch → WASM, remember backend per session |
| Language detection wrong on short text | Script-first, confidence threshold, fallback to original |
| Worker communication overhead | Batch requests, minimal serialization |
| IndexedDB quota exceeded | LRU eviction, max entries limit |

---

## Out of Scope (MVP)

- Server-side translation fallback
- Per-language model selection
- User-facing language selection (target fixed to Vietnamese)
- Translation quality scoring / confidence
- LLM-based post-correction
- Full document layout analysis

---

## Task Order Summary

1. Types & language map
2. Script detector → language detector → language resolver
3. Normalize, protect-tokens, grouping
4. Cache (memory + IndexedDB)
5. Worker: model manager, scheduler, entry point
6. Engine facade (main thread)
7. Background integration
8. Content script integration
9. Popup integration
10. Build config, dependencies
11. Validation scenarios

---

## Files to Create (New)

```
src/translation/
├── types.ts
├── engine.ts
├── scheduler.ts
├── model-manager.ts
├── worker.ts
├── language/
│   ├── script-detector.ts
│   ├── language-detector.ts
│   ├── language-resolver.ts
│   └── language-map.ts
├── preprocess/
│   ├── normalize.ts
│   ├── protect-tokens.ts
│   └── grouping.ts
├── postprocess/
│   └── normalize-output.ts
└── cache/
    └── translation-cache.ts
```

## Files to Modify

- `package.json` — add `tinyld`
- `wxt.config.ts` — worker entry
- `entrypoints/background.ts` — replace translation logic
- `entrypoints/content.ts` — send regions for translation
- `utils/translation-popup.ts` — simplify, rely on auto-detect
- `utils/translation.ts` — **remove** (replaced by engine)
- `types/messages.ts` — add `translate/regions` message type

---

## Acceptance Criteria

- [ ] Single NLLB model translates 13+ source languages → Vietnamese
- [ ] Language auto-detection works without user input
- [ ] Translation runs in Web Worker (UI responsive)
- [ ] WebGPU preferred, WASM fallback works
- [ ] Model lazy-loads on first translation request
- [ ] Cache hits on repeated text (memory + IndexedDB)
- [ ] Numbers/URLs/currency preserved in translation
- [ ] Mixed-language images handled per-unit
- [ ] Low-confidence detection → original text shown
- [ ] No global failure: one bad unit doesn't block others
- [ ] TypeScript compiles clean (`bun run compile`)