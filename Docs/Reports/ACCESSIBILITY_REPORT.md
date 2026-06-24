# Accessibility Report — Trainer UX V1

## Automated Coverage

The following accessibility properties are verified in `tests/trainer.e2e.test.ts`:

| Property | Evidence |
|----------|----------|
| Mode toggle buttons have `aria-pressed` | Verified in tests 01–06, 28 |
| `window.electronAPI` presence (not an a11y check, but verifies context) | Test 07 |
| No renderer errors on mode switch | All tests |

## Manual / Structural Review

The following were implemented and verified by code inspection:

| Component | Implementation |
|-----------|----------------|
| Mode toggle | `<button aria-pressed={...} title="...">` — both keyboard and click |
| Trainer cards | `role="button" aria-pressed={selected} aria-label="{name} — {state}"` |
| Apply dialog | `role="dialog" aria-modal="true" aria-labelledby="apply-dialog-title"` |
| Apply dialog close | `aria-label="Cancel"` on the ✕ button |
| Apply confirm | `autoFocus` on the Confirm button |
| Context panel | `<aside aria-label="{item name}">` |
| Game-running banner | `role="alert"` |
| Trainer cards region | `aria-label="Trainer items"` |
| Empty state | Plain content — no a11y concern |

## Known Limitations

| Limitation | Severity |
|------------|----------|
| Dialog does not trap focus (no focus loop when tabbing past last button) | Medium |
| Escape key does not close the Apply dialog | Medium |
| Card state badges communicate meaning through color class name only; no `aria-describedby` linking the badge to the card | Low |
| Slider control has no visible `<label>` element wrapping it | Low |
| Disabled controls do not expose an `aria-disabled` or an explanatory `aria-describedby` | Low |
| Reduced-motion preference is not detected — animations (CSS transitions) play regardless | Low |

## What Was Not Automated

- Keyboard-only full workflow (tab through card, adjust value, apply, restore)
- Screen reader announcement testing
- Focus return to triggering element after dialog close
- Live region announcement of APPLIED / RESTORED / FAILED state changes

These require manual testing with a screen reader or a dedicated a11y test framework. They are out of scope for V1 but should be addressed before a public release.

## Automated Tool Status

No automated accessibility scanner (axe, Lighthouse) was run in the E2E tests for this milestone. Adding `@axe-core/playwright` is the recommended next step.
