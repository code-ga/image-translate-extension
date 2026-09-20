# Async Independent OCR + Popup Fix Plan

## Problem Statement

1. **Offscreen OCR lacks independence**: Current batching in `offscreen.ts` + `ocr-batcher.ts` processes all images in one batch call and returns all results at once. If one image errors, the whole batch can fail (all items get error). Results are not reported independently per image.
2. **Popup shows "No images found" despite images existing**: When OCR fails on an image, the content script reverts it to "pending" status (no "error" status exists). Images that errored disappear from the popup list. The popup also never displays error status.

---

## Change 1: Make offscreen OCR per-item independent (`utils/ocr-batcher.ts`)

**File**: `utils/ocr-batcher.ts`, function `runBatchOcr` (line 68)

**Current behavior**: Calls `model.batchRecognize(imageBuffers, ...)` on ALL items at once. Results mapped with `.map()` — if the batch call itself throws, every item fails.

**Fix**: Wrap each individual OCR call in its own try/catch using `Promise.allSettled` semantics. Process each image independently within the batch so one image's error cannot affect another.

```
// Pseudo:
const results = await Promise.allSettled(
  items.map(async (item) => {
    try {
      const buffer = base64ToArrayBuffer(item.imageData);
      const ocrResult = await model.batchRecognize([buffer], { settle: true, strategy: "per-box" });
      return { success: true, data: groupOcrBoxesIntoRegions(...) };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  })
);
```

Also update the return type from `RunBatchResultItem[]` to include `Promise.allSettled`-compatible shape (each entry is either `{ success: true/false, ... }` with per-item error isolation).

---

## Change 2: Make offscreen message handler per-item independent (`entrypoints/offscreen/offscreen.ts`)

**File**: `entrypoints/offscreen/offscreen.ts`, message handler (line 7-36)

**Current behavior**: `runBatchOcr` is awaited for the entire batch, then results `.map()` over items. If `runBatchOcr` throws (e.g., model init failure), all items get error.

**Fix**: After `ocr-batcher.ts` Change 1, the `runBatchOcr` call itself won't throw for individual item errors. But still wrap each result in try/catch at the message handler level for defense-in-depth. Keep the existing flow since `runBatchOcr` now handles per-item errors internally.

Additionally: strip `translation: undefined` only for successful results (already done). Ensure failed items' error messages are passed through correctly.

---

## Change 3: Add "error" status to types (`types/index.ts`)

**File**: `types/index.ts` lines 34, 40

**Current**:
```typescript
status: "pending" | "processing" | "done";
```

**Fix**: Add `"error"` to both `ImageInfoWithStatus` and `CanvasInfoWithStatus` status unions:
```typescript
status: "pending" | "processing" | "done" | "error";
```

---

## Change 4: Track error state in content script (`entrypoints/content.ts`)

**File**: `entrypoints/content.ts`

### 4a. Add error tracking to element state

**Problem**: When OCR fails, `processImage`/`processCanvas` call `onComplete` which removes the element from `processingSet`, making it appear "pending" again. The error is lost.

**Fix**: Add an `errorMap` to `element-state.ts` that tracks error messages per element:

- Extend `createElementState<T>()` with an `errorMap: Map<T, string>` (similar to `processed`/`overlayMap`)
- Add `setError(element, message)` method
- Add `getError(element)` method  
- Clear error in `resetElementState`

### 4b. Mark images/canvases as "error" on OCR failure

In `content.ts` `processNewImage` (line 115-142): In the error callback, before calling `onError`, call `imageState.setError(img, errorMsg)` to mark the image as errored.

In `content.ts` `processNewCanvas` (line 144-171): Same — call `canvasState.setError(canvas, errorMsg)`.

### 4c. Include error status in `collectImageInfo`/`collectCanvasInfo`

Update `collectImageInfo()` (line 242) status computation:
```typescript
status: imageState.processingSet.has(img)
    ? "processing"
    : imageState.errorMap.has(img)
    ? "error"
    : imageState.processed.has(img) && ...
    ? "done"
    : "pending",
```

Same for `collectCanvasInfo()` (line 452).

### 4d. Clear error on re-processing

In `processNewImage` and `processNewCanvas`, when starting a new OCR attempt (after the `processingSet.has` check), call `imageState.clearError(img)` / `canvasState.clearError(canvas)`.

---

## Change 5: Display error status in popup (`entrypoints/popup/App.tsx`)

**File**: `entrypoints/popup/App.tsx`

### 5a. Update `getStatusLabel` (line 230)
```typescript
case "error":
    return "Error";
```

### 5b. Update `getStatusClass` (line 241)
```typescript
case "error":
    return "status-error";
```

### 5c. Track error count in state
Add `imageErrorCount` / `canvasErrorCount` state variables (similar to existing `imageProcessingCount` / `canvasProcessingCount`).

### 5d. Update `pollPageData` to count errors
Filter images/canvases by `"error"` status and update error count state.

### 5e. Show error badge on tabs
Add error count badges to the Images/Canvases tabs similar to processing count badges.

### 5f. Display error status in list items
Ensure error images are shown with their error status badge in the list (they already will be since `images.length > 0` when there are errors).

### 5g. Add CSS for `status-error`
Add `.status-error` style to `App.css` (or create a class for error status visual).

---

## Change 6: Update types for messages if needed (`types/messages.ts`)

No changes needed — status strings are in `types/index.ts` and are structurally typed.

---

## Files Modified Summary

| File | Change |
|------|--------|
| `utils/ocr-batcher.ts` | Wrap each OCR item in try/catch via Promise.allSettled pattern |
| `utils/element-state.ts` | Add errorMap, setError/getError/clearError methods |
| `entrypoints/offscreen/offscreen.ts` | Defensive per-item error handling |
| `entrypoints/content.ts` | Track errors, include "error" status in collectImageInfo/collectCanvasInfo |
| `types/index.ts` | Add "error" to status union |
| `entrypoints/popup/App.tsx` | Display error status, error counts on tabs |
| `entrypoints/popup/App.css` | Add .status-error style |

---

## Verification

1. `bun run compile` — zero TypeScript errors
2. `bunx biome check` — no new lint violations
3. Manual test: Trigger OCR on multiple images, cause one to fail (e.g., CORS image), verify other image still shows success in popup
4. Manual test: Check popup shows "Error" badge for failed images instead of "No images found"
5. Manual test: Verify images with "error" status remain visible in popup list (not hidden as "pending")
