# PaddleOCR Post-Processing: OCR Region Grouping

## Goal
Add a post-processing stage between PaddleOCR output and downstream consumers that groups individual OCR word/line boxes into larger logical text regions (OCRRegion[]), suitable for manga/comic images.

## Current Flow
```
PaddleOCR (batchRecognize)
    ↓
Raw boxes in ocr-batcher.ts (lines 85-103)
    ↓
OCRResult[] = [{text, top, left, width, height}, ...]
    ↓
Returned via offscreen → background → content → overlay rendering
```

## Target Flow
```
PaddleOCR (batchRecognize)  ← UNCHANGED
    ↓
Raw PaddleOCR boxes
    ↓
Convert to OCRBox[] (with polygon)  ← NEW
    ↓
groupOcrBoxesIntoRegions()  ← NEW
    ↓
OCRRegion[]  ← NEW OUTPUT
    ↓
Returned via same message chain
```

## Files to Modify

### 1. `types/index.ts` — Add new types
- Add `Point`, `OCRBox`, `OCRRegion` types
- Keep `OCRResult` as backward-compatible alias or update all consumers to use `OCRBox` directly

### 2. `utils/ocr-region-grouping.ts` — NEW FILE
**Purpose:** Spatial grouping algorithm that clusters nearby OCR boxes into logical text regions.

**Function signature:**
```ts
export function groupOcrBoxesIntoRegions(rawBoxes: OCRBox[]): OCRRegion[];
```

**Algorithm steps:**
1. Convert each rectangular box to a 4-corner polygon
2. Build adjacency graph: two boxes are neighbors if spatially close
   - Same-line detection: vertical overlap > 30% of min height AND horizontal gap < avgHeight * 1.2
   - Stacked-line detection: vertical gap < avgHeight * 1.5 AND horizontal overlap > 30% of min width
3. Find connected components via DFS/union-find
4. For each component:
   - Sort boxes by reading order (y then x, with tolerance for same-line grouping)
   - Concatenate texts with space separator
   - Compute convex hull of all box polygon points (Andrew's monotone chain)
   - Compute axis-aligned bounds from hull points

**Key parameters (tunable constants):**
- `SAME_LINE_VERTICAL_OVERLAP_RATIO = 0.3`
- `SAME_LINE_HORIZONTAL_GAP_RATIO = 1.2`
- `STACKED_VERTICAL_GAP_RATIO = 1.5`
- `STACKED_HORIZONTAL_OVERLAP_RATIO = 0.3`
- `SAME_LINE_Y_TOLERANCE_RATIO = 0.3` (for reading order sort)

### 3. `utils/ocr-batcher.ts` — Modify `runBatchOcr()`
**Current:** Maps PaddleOCR result → `OCRResult[]` and returns `{ success: true, data: ocrData }`

**New:**
1. After extracting box data, create `OCRBox[]` with `polygon` field (4 corners from rectangle)
2. Call `groupOcrBoxesIntoRegions(rawBoxes)`
3. Return `{ success: true, data: OCRRegion[] }`

**Line 85-104:** Replace the flat mapping with region grouping.

### 4. `utils/ocr-pipeline.ts` — Update callback types
- `onSuccess: (ocrData: OCRResult) => void` → `onSuccess: (ocrRegions: OCRRegion[]) => void`
- Affects: `sendOcrWithBase64` (line 98), `sendOcrWithUrl` (line 112), `processImage` (line 126), `processCanvas` (line 171)

### 5. `entrypoints/content.ts` — Update consumers
- `renderImageOverlay(img, ocrData: OCRResult)` → `renderImageOverlay(img, ocrRegions: OCRRegion[])`
- `renderCanvasOverlay(canvas, ocrData: OCRResult)` → `renderCanvasOverlay(canvas, ocrRegions: OCRRegion[])`
- `sendOcrToHost(src, ocrData: OCRResult)` → `sendOcrToHost(src, ocrRegions: OCRRegion[])`
- Flatten region boxes: `const allBoxes = ocrRegions.flatMap(r => r.boxes)` before passing to `addOcrBoxes`

### 6. `utils/overlay.ts` — Update `addOcrBoxes` signature
- Change parameter type from `OCRResult` to `OCRBox[]`
- Update property access: `box.top` → `box.box.y`, `box.left` → `box.box.x`, etc.
- The rendering logic stays identical (just different property paths)

## Preserved Behavior
- `batchRecognize()` call unchanged (lines 80-83 in `ocr-batcher.ts`)
- Success/error result wrapper `{ success: true, data: ... }` unchanged
- Image/canvas processing flow unchanged
- Overlay rendering logic unchanged (only data shape changes)

## Validation
1. `bun run compile` or `tsc --noEmit` — ensure no type errors
2. Verify `runBatchOcr` returns `{ success: true, data: OCRRegion[] }` for fulfilled results
3. Verify region `text` is concatenated, `polygon` is convex hull, `bounds` is axis-aligned
4. Verify individual `OCRBox` polygons preserved inside `region.boxes`
