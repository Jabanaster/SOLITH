# Accessibility Polish Verification

## Scope Completed

- `ApplyDialog` now includes:
  - `role="dialog"`, `aria-modal`, `aria-labelledby`, `aria-describedby`
  - keyboard focus trap while open
  - Escape-close guard while idle
  - focus restoration to previously focused opener on close
  - polite live status region for busy/idle announcement
- Trainer control accessibility improvements:
  - slider now has explicit `<label>`, `step`, value text with optional unit
  - dropdown now has explicit `<label>` and structured option labels
  - controls/actions receive `aria-describedby` links to visible disabled explanations

## Verification

- `npm run test:accessibility` → PASS (7/7)
- `npm run test:trainer-states` → PASS (15/15), including renderer-state assertions that cover disabled states and control interactions

## Remaining Accessibility Work

- Add fully interactive modal-focused E2E assertions for focus-loop and focus-restore behavior through a deterministic trainer-page route harness.
