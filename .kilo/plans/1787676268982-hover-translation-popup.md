# Plan: Unified Message Type System + Hover Translation Popup
## Goal
1. Design a unified message type system where adding any new message/event is a single obvious step
2. Implement hover translation popup for OCR boxes using that system

## Design Principle: One Way to Add a Message

When a developer wants to add a new message, they should:
1. Add one type definition in `types/messages.ts`
2. Add one case in the relevant handler's switch statement
3. Done. No inline objects, no scattered type definitions.

## Proposed Unified Message Type System

### Core Type Helper

```typescript
// types/messages.ts
type Message<T extends string, P extends object = {}> = { type: T } & P;
```

Every message in the extension uses `Message<"type-name", { payload }>`.

### Naming Convention

Format: `{feature}/{action}` in kebab-case.

Examples:
- `"ocr/process"` - request OCR processing
- `"settings/get"` - request settings
- `"settings/changed"` - broadcast settings changed
- `"translate/text"` - request text translation
- `"translate/images"` - command to translate images
- `"ui/get-images"` - request page images
- `"extension/error"` - broadcast error

### Message Registry (Single Source of Truth)

All message types defined in one file `types/messages.ts`:

```typescript
// OCR messages
export type ProcessOcrMessage = Message<"ocr/process", {
  fetchingType: "url" | "base64";
  imageData: string;
  headers?: Record<string, string>;
}>;

export type BatchRunOcrMessage = Message<"offscreen/batch-run-ocr", {
  items: Array<{ fetchingType: "url" | "base64"; imageData: string; headers?: Record<string, string> }>;
}>;

export type BatchRunOcrResponse = {
  success: boolean;
  results?: Array<{ success: boolean; data?: OCRRegion[]; error?: string }>;
  error?: string;
};

// Settings messages
export type GetSettingsMessage = Message<"settings/get">;
export type SettingsChangedMessage = Message<"settings/changed", { settings: ExtensionSettings }>;
export type NotifySettingsChangedMessage = Message<"settings/notify-changed", { settings: ExtensionSettings }>;

// Status messages
export type GetImagesMessage = Message<"ui/get-images">;
export type GetImageStatusMessage = Message<"ui/get-image-status">;
export type GetCanvasesMessage = Message<"ui/get-canvases">;
export type GetCanvasStatusMessage = Message<"ui/get-canvas-status">;
export type ImagesListResponse = Message<"ui/images-list", { images: ImageInfo[] }>;
export type CanvasListResponse = Message<"ui/canvas-list", { canvases: CanvasInfo[] }>;
export type ImageStatusListResponse = Message<"ui/image-status-list", { images: ImageInfoWithStatus[] }>;
export type CanvasStatusListResponse = Message<"ui/canvas-status-list", { canvases: CanvasInfoWithStatus[] }>;

// Translation messages
export type TranslateImagesCommand = Message<"translate/images", { urls: string[] }>;
export type TranslateCanvasesCommand = Message<"translate/canvases", { indices: number[] }>;
export type TranslateTextRequest = Message<"translate/text", { text: string; srcLang: string; targetLang: string }>;
export type TranslateTextResponse = Message<"translate/text-response", { translation: string | null; error?: string }>;
export type TranslateProgressMessage = Message<"translate/progress", { url: string; index: number; total: number; success: boolean; error?: string }>;
export type TranslateCompleteMessage = Message<"translate/complete", { total: number; successCount: number }>;

// Context menu / other
export type ContextMenuTranslateMessage = Message<"background/translate", { url: string }>;
export type ExtensionErrorMessage = Message<"extension/error", { error: string }>;
export type GetSettingsResponse = Message<"settings/response", { enabled: boolean; enabledDomains: DomainPattern[] }>;
```

### Context-Specific Unions (for exhaustive type checking)

```typescript
// What content script can RECEIVE
export type ContentIncomingMessage = 
  | ContextMenuTranslateMessage
  | SettingsChangedMessage
  | GetImagesMessage
  | GetImageStatusMessage
  | GetCanvasesMessage
  | GetCanvasStatusMessage
  | TranslateImagesCommand
  | TranslateCanvasesCommand;

// What content script can SEND
export type ContentOutgoingMessage = 
  | ProcessOcrMessage
  | ExtensionErrorMessage
  | TranslateProgressMessage
  | TranslateCompleteMessage
  | ImagesListResponse
  | ImageStatusListResponse
  | CanvasListResponse
  | CanvasStatusListResponse;

// What background can RECEIVE from any context
export type BackgroundIncomingMessage = 
  | ProcessOcrMessage
  | ExtensionErrorMessage
  | TranslateProgressMessage
  | TranslateCompleteMessage
  | GetSettingsMessage
  | NotifySettingsChangedMessage
  | TranslateTextRequest;

// What background can SEND
export type BackgroundOutgoingMessage = 
  | ContextMenuTranslateMessage
  | SettingsChangedMessage
  | ExtensionErrorMessage
  | BatchRunOcrMessage;

// What offscreen can RECEIVE
export type OffscreenIncomingMessage = 
  | BatchRunOcrMessage
  | TranslateTextRequest;

// What offscreen can SEND
export type OffscreenOutgoingMessage = 
  | BatchRunOcrResponse
  | TranslateTextResponse;
```

### Handler Pattern

```typescript
// Content script
browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!isContentIncomingMessage(msg)) return;
  
  switch (msg.type) {
    case "background/translate":
      handleContextMenuTranslate(msg.url);
      break;
    case "ui/get-images":
      sendResponse({ type: "ui/images-list", images: collectImageInfo() });
      break;
    // ... every case covered, TypeScript enforces exhaustiveness
  }
  
  return true; // if async
});
```

### How to Add a New Message (Developer Workflow)

1. **Define the type** in `types/messages.ts`:
   ```typescript
   export type MyNewMessage = Message<"feature/action", { payload: string }>;
   ```

2. **Add to the appropriate union** in `types/messages.ts`:
   ```typescript
   export type ContentIncomingMessage = ... | MyNewMessage;
   ```

3. **Handle in switch statement** in the relevant entrypoint:
   ```typescript
   case "feature/action":
     // TypeScript knows msg.payload is { payload: string }
     break;
   ```

4. **Type-check**: `bun run typecheck` - if you missed a case in a switch, TypeScript will error.

## Implementation Steps

### Phase 1: Unified Message Type System
1. **Create `types/messages.ts`** with:
   - `Message<T, P>` helper type
   - All current message types using the unified pattern
   - Context-specific unions

2. **Update `types/index.ts`**:
   - Re-export everything from `types/messages.ts`
   - Keep existing domain/entity types (OCRBox, etc.) here or in separate files
   - Maintain backward compatibility

3. **Type all inline messages**:
   - Replace every inline `{ type: "..." }` object with the appropriate typed message
   - Use `Message<"type", { ... }>` pattern consistently

### Phase 2: Hover Translation Popup
4. **Remove blocking translation from OCR pipeline**
   - Edit `entrypoints/offscreen/offscreen.ts`: remove broken `translateDynamic` call in `batch-run-ocr` handler

5. **Add translation handler in offscreen**
   - Add `browser.runtime.onMessage.addListener` for `"translate/text"`
   - Call `translateDynamic`, send `TranslateTextResponse` via `sendResponse`
   - Return `true` for async

6. **Add translation relay in background**
   - Add listener for `"translate/text"` in `BackgroundIncomingMessage`
   - Forward to offscreen, return response to sender

7. **Create `utils/translation-popup.ts`**
   - `showTranslationPopup(box, text)` - position below box, 300ms debounce
   - `updateTranslationPopup(popup, translation, error?)` - update content
   - `dismissTranslationPopup()` - remove from DOM
   - Styling: reuse toast.ts patterns

8. **Update `utils/overlay.ts`**
   - Add hover state management
   - Replace commented-out `focus` listener with `mouseenter`/`mouseleave`
   - Trigger translation on hover, update popup on response
   - Handle scroll/resize repositioning

9. **Add `targetLang` setting** in `utils/extension-settings.ts`

### Validation
- `bun run typecheck` - zero errors
- Verify exhaustive switch coverage via TypeScript
- Manual test full hover translation flow

## Open Questions
- None pending
