# Plan: Sentence Translation On-Demand via Button

## Goal
Keep automatic word translation in hover popup, but only translate the whole sentence when user clicks a button.

## Changes
- `utils/translation-popup.ts`: 
  - Do not auto-call `requestTranslateText(text, ...)` for sentence on popup open.
  - Render a "Translate sentence" button in sentence section; on click, call `requestTranslateText(text, cachedTargetLang, sentenceResultEl, popup)`.
  - Keep auto word translation (`requestTranslateText(word, ...)`).
  - Show placeholder "Click button to translate sentence" initially.

## Validation
- Typecheck.
- Manual hover test.

## Risks
- Existing tests? none.
