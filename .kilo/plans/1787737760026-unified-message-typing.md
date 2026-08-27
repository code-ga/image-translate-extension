# Plan: Unified Message Typing System with from/to Routing

## Goal
Replace scattered, untyped message objects with one discriminated union (`AppMessage`) where checking `msg.type` narrows the full message shape. Add `from`/`to` fields for explicit routing.

## Design

### Core Helper
```typescript
// types/messages.ts
type MessageRoute = {
  from: "content" | "background" | "offscreen";
  to: "background" | "content" | "offscreen" | "all";
};

type Message<T extends string, P extends object = {}> = MessageRoute & {
  type: T;
} & P;
```

### Unified Type
Every message uses `Message<"type-string", { payload }>`. The `type` field is the **discriminant** — TypeScript narrows automatically in `switch` statements.

Naming convention: `{domain}/{action}` in kebab-case (e.g. `"ocr/process"`, `"settings/get"`, `"translate/progress"`).

### Routing via from/to
- `from`: Who sent the message (`"content"`, `"background"`, `"offscreen"`)
- `to`: Intended recipient (`"background"`, `"content"`, `"offscreen"`, `"all"`)
- `to: "all"` = broadcast to every content tab (used by `settings-changed`, `extension-error`)

### Handler Pattern
```typescript
browser.runtime.onMessage.addListener((msg: AppMessage) => {
  switch (msg.type) {
    case "ocr/process":
      // msg is narrowed to ProcessOcrMessage
      // TypeScript knows: fetchingType, imageData, headers
      break;
    case "settings/get":
      // msg narrowed to GetSettingsMessage (no payload)
      break;
  }
  return true;
});
```

**No context-specific unions needed** — `AppMessage` is the single type. Switch exhaustiveness is enforced by TypeScript.

## Implementation Steps

### 1. Create `types/messages.ts`
Define `MessageRoute`, `Message<T, P>`, all message types, and the `AppMessage` discriminated union.

Message types to define (replacing existing scattered types):
| Old Type | New Type | Type String |
|---|---|---|
| `InternalMessageType` | `ProcessOcrMessage` | `"ocr/process"` |
| (inline `target:"offscreen"`) | `BatchRunOcrMessage` | `"offscreen/batch-run-ocr"` |
| — | `BatchRunOcrResponse` | (response, no `from`/`to`) |
| — | `GetSettingsMessage` | `"settings/get"` |
| `NotifySettingsChanged` | `NotifySettingsChangedMessage` | `"settings/notify-changed"` |
| `SettingsChanged` | `SettingsChangedMessage` | `"settings/changed"` |
| `PopupMessageType` | `GetImagesMessage` | `"ui/get-images"` |
| — | `GetImageStatusMessage` | `"ui/get-image-status"` |
| — | `GetCanvasesMessage` | `"ui/get-canvases"` |
| — | `GetCanvasStatusMessage` | `"ui/get-canvas-status"` |
| `PopupResponseType` | `ImagesListResponse` | `"ui/images-list"` |
| `CanvasListResponse` | `CanvasListResponse` | `"ui/canvas-list"` |
| `ImageStatusResponse` | `ImageStatusListResponse` | `"ui/image-status-list"` |
| `CanvasStatusResponse` | `CanvasStatusListResponse` | `"ui/canvas-status-list"` |
| `TranslateCommandType` | `TranslateImagesCommand` | `"translate/images"` |
| — | `TranslateCanvasesCommand` | `"translate/canvases"` |
| `ProgressMessageType` | `TranslateProgressMessage` | `"translate/progress"` |
| `CompleteMessageType` | `TranslateCompleteMessage` | `"translate/complete"` |
| (inline context menu) | `ContextMenuTranslateMessage` | `"background/translate"` |
| `ExtensionErrorType` | `ExtensionErrorMessage` | `"extension/error"` |

Export `AppMessage` as the union of all above (minus response types).

### 2. Update `types/index.ts`
- Re-export everything from `types/messages.ts`
- Keep domain types (`Point`, `OCRBox`, `OCRRegion`, `OCRResult`, `CanvasInfo`, `DomainPattern`, `ImageInfoWithStatus`, `CanvasInfoWithStatus`) here

### 3. Update `entrypoints/background.ts`
- Import `AppMessage`
- Type `onMessage` listener parameter as `AppMessage`
- Convert `if (msg.type === ...)` chains to `switch (msg.type)`
- Add `from`/`to` to all sent messages (`browser.tabs.sendMessage` calls)
- `to: "all"` for broadcasts (`settings-changed`, `extension-error`)

### 4. Update `entrypoints/content.ts`
- Import `AppMessage` and specific types (`ProgressMessageType` → `TranslateProgressMessage`, etc.)
- Type `onMessage` listener as `AppMessage`
- Convert to switch statement
- Add `from: "content"`, `to: "background"` to all `browser.runtime.sendMessage` calls

### 5. Update `entrypoints/offscreen/offscreen.ts`
- Import `AppMessage`, `BatchRunOcrMessage`
- Type `onMessage` listener
- Replace `message.target === "offscreen"` with `message.to === "offscreen"` (and `message.from === "background"` for safety)

### 6. Update `utils/ocr-pipeline.ts`
- Replace `InternalMessageType` imports with `ProcessOcrMessage`
- Add `from: "content"`, `to: "background"` to all `browser.runtime.sendMessage` calls

### 7. Update `utils/overlay.ts`
- Update commented-out `sendMessage` to use typed `ProcessOcrMessage` with `from`/`to`

### 8. Remove dead types from `types/index.ts`
Delete unused exports: `PopupMessageType`, `PopupResponseType`, `TranslateCommandType`, `CanvasListResponse` (old), `CanvasTranslateCommand`, `SettingsResponse`, `SettingsUpdate`, `ImageStatusResponse`, `CanvasStatusResponse` (old)

## Validation
- `bun run typecheck` — zero errors
- All `onMessage` listeners typed as `AppMessage`
- All `sendMessage` calls use a typed message with `from`/`to`
- Switch statements are exhaustive (TypeScript enforces)
