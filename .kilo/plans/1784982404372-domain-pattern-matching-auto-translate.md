# Domain Pattern Matching & Auto-Translate-on-URL-Change Plan

## Goal
Two features:
1. Expand the domain system from simple hostname matching to pattern matching that supports domain, include, and regex match types — enabling entries like `mangaplus.shueisha.co.jp/viewer/<something>`.
2. Auto-translate images when the active tab's URL changes to match an auto-translate domain pattern (e.g., navigating to a manga viewer page triggers translation automatically).

## Current State
- `enabledDomains` in `chrome.storage.sync` is `string[]`, each entry matched by hostname exact match or suffix (subdomain).
- `autoTranslateIfAllowed()` in `content.ts` runs once at module load, then uses a `MutationObserver` for dynamic content but does NOT handle SPA navigation or tab URL changes.
- Background script has no `tabs.onUpdated` listener — content scripts are only injected via context menu or popup polling.
- No `webNavigation` or `tabs.onUpdated` permission in manifest.

---

## Changes

### 1. Update `src/types.ts`
- Add `DomainPattern` type:
  ```ts
  export type DomainPattern = string | { pattern: string; matchType: 'domain' | 'include' | 'regex' }
  ```
- Update settings-related types to use `DomainPattern[]` instead of `string[]`:
  - `SettingsResponse` → `enabledDomains: DomainPattern[]`
  - `SettingsUpdate` → `enabledDomains?: DomainPattern[]`
  - `NotifySettingsChanged.settings.enabledDomains` → `DomainPattern[]`
  - `SettingsChanged.settings.enabledDomains` → `DomainPattern[]`

### 2. Add shared `isUrlAllowed()` function — new file `src/domain-matcher.ts`
- Creates a new file exporting `isUrlAllowed(url: string, patterns: DomainPattern[]): boolean`
- Logic:
  - `"string"` entry → backward-compatible domain match (`hostname === d || hostname.endsWith('.' + d)`)
  - `{ pattern, matchType: 'domain' }` → same as string but explicit
  - `{ pattern, matchType: 'include' }` → `url.includes(pattern)`
  - `{ pattern, matchType: 'regex' }` → `new RegExp(pattern).test(url)` (catch invalid regex)
- This function is imported by `background.ts`, `content.ts`, and `App.tsx` replacing duplicated logic.

### 3. Update `src/content.ts`
- Import `isUrlAllowed` from `./domain-matcher`
- Replace inline domain check in `autoTranslateIfAllowed()` (line 680) with `isUrlAllowed(window.location.href, settings.enabledDomains)`
- **SPA URL change detection**: Add a `setInterval` poll (every 500ms) that checks `window.location.href`. When URL changes, re-run `autoTranslateIfAllowed()` (which will stop the old observer, process new page images, and start a new observer).
- Also add `chrome.webNavigation.onCommitted` support via message pass — actually, just polling is sufficient and simpler.

### 4. Update `src/background.ts`
- Add `chrome.tabs.onUpdated` listener:
  - When `changeInfo.url` is present and the tab finished loading (`status === 'complete'`), check if the URL matches any `enabledDomains` pattern using `isUrlAllowed`.
  - If it matches and settings are enabled, inject `content.js` into the tab via `chrome.scripting.executeCode` or `chrome.scripting.executeScript` and let the content script's module-level `autoTranslateIfAllowed()` run.
  - Need `tabs` permission if not already present — current permissions already include `tabs` indirectly via `activeTab` but `onUpdated` needs `tabs` permission explicitly.
- Import `isUrlAllowed` from `./domain-matcher`
- Replace inline domain check in context menu handler (line 41) with `isUrlAllowed(tab.url || '', enabledDomains)`
- Add `webNavigation` permission to `manifest.json` if using `chrome.webNavigation.onCommitted` — alternatively, stick with `tabs.onUpdated` which doesn't need extra permission beyond `tabs`.

**Decision**: Use `chrome.tabs.onUpdated` (no extra permission needed beyond what's already in `host_permissions`). `tabs` permission is already implied by using `chrome.tabs.query` and `chrome.tabs.sendMessage` in the codebase. Actually, checking — `chrome.tabs.onUpdated` requires the `"tabs"` permission. Current manifest doesn't have it. So add `"tabs"` to permissions.

### 5. Update `public/manifest.json`
- Add `"tabs"` to `permissions` array.

### 6. Update `src/App.tsx`
- Import `isUrlAllowed` from `./domain-matcher`
- Replace inline `isDomainAllowed` function (lines 120-124) with call to `isUrlAllowed`
- Update `currentDomain` display to show full URL (not just hostname) so users can see path-based patterns
- Add UI for creating new domain entries with match type selector (domain/include/regex)
- Update `addDomain()` to accept pattern objects with matchType
- Update `quick-add` button to detect whether the current URL looks like a path pattern vs plain domain and set matchType accordingly
- Update `addDomain` to support both string and object format in the input

### 7. Update `src/App.css`
- Add styles for match type selector buttons (radio-like buttons for domain/include/regex)
- Minor style additions for the new UI elements

### 8. Update `AGENTS.md`
- Add notes about the domain pattern system architecture

---

## Auto-Translate Flow (New)
1. User navigates tab to `mangaplus.shueisha.co.jp/viewer/123`
2. `chrome.tabs.onUpdated` fires in background script with new URL
3. Background checks `isUrlAllowed(newUrl, enabledDomains)` → matches `include` pattern
4. Background injects `content.js` into the tab via `chrome.scripting.executeScript`
5. Content script module loads → `autoTranslateIfAllowed()` runs → finds images, starts OCR
6. `MutationObserver` starts watching for dynamically added images
7. **SPA navigation**: If user navigates within the page (pushState), the 500ms polling in content.ts detects `window.location.href` change → re-runs `autoTranslateIfAllowed()` for the new page

---

## Backward Compatibility
- Existing `string[]` entries in `enabledDomains` continue to work as before (domain match type)
- `isUrlAllowed()` handles both `string` and `{ pattern, matchType }` entries
- Old popup behavior (plain domain input) still works; users can optionally add match types

---

## Open Questions
1. Should `tabs.onUpdated` inject content script on every navigation to a matching URL, even if the content script is already injected from a previous navigation? → Yes, because each page load is a fresh document and the content script needs to re-execute.
2. Should the content script's SPA polling interval be configurable? → Not for v1; 500ms is a reasonable default.
3. Should regex patterns have inline flags? → Yes, allow `/pattern/flags` syntax where flags are optional.

---

## Verification
- Test that old `string[]` domain entries still work (domain matching + subdomain)
- Test `include` match type with URL substring like `mangaplus.shueisha.co.jp/viewer/`
- Test `regex` match type with pattern like `mangaplus\.shueisha\.co\.jp/viewer/\d+`
- Test that navigating to a matching URL auto-injects content script and translates images
- Test that SPA navigation (hash change / pushState) triggers re-translation
- Test that navigating away from a matching URL stops translation
- Verify `tabs` permission is declared and `tabs.onUpdated` fires correctly