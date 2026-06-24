# Known Issues

This document records the current known bugs, design limitations, and trade-offs.

## Open Issues

### KI-001: Playwright not installed — smoke tests require manual install step
`@playwright/test` is in `devDependencies` but browsers must be downloaded before tests run:
```powershell
npm install && npx playwright install
```
This is a one-time setup step per machine.

### KI-003: fix-esm-imports.mjs / .ps1 in repo root (dead code)
These files are no longer referenced by any build script. They can be deleted:
```powershell
Remove-Item "fix-esm-imports.mjs", "fix-esm-imports.ps1"
```

### KI-006: Apply dialog does not trap focus
Pressing Tab past the last button in `ApplyDialog.tsx` exits the modal. A focus trap with cycle-back behavior should be added. Escape key does not close the dialog either.

### KI-007: Card state badges communicate meaning through color class only
`TrainerCard.tsx` state badges use CSS class names (e.g., `.state-applied`) for color. A screen reader sees only the text. Cards should add `aria-describedby` pointing to a visually hidden description of the state.

### KI-008: Slider control has no visible label element
The range input in `TrainerCard.tsx` renders with no wrapping `<label>` element. The field name is rendered as a heading sibling, but the control is not programmatically linked to it.

### KI-009: Disabled controls lack aria-disabled and explanatory description
When a card is in BLOCKED, BROKEN, GAME_RUNNING, or APPLYING state, the control is `disabled` but there is no `aria-disabled` attribute and no `aria-describedby` pointing to a reason.

### KI-010: Reduced-motion not detected by Trainer UI components
CSS `prefers-reduced-motion` is respected in `index.css` global transitions, but `TrainerCard.tsx` and `ApplyDialog.tsx` do not read `window.matchMedia('(prefers-reduced-motion: reduce)')` for JS-controlled animations.

### KI-011: No pagination on trainer cards
The trainer cards list in `TrainerPage.tsx` renders all recipes without pagination or virtual scrolling. This is acceptable for small recipe sets (< 50 items) but will degrade for games with 100+ recipes.

### KI-013: slider and dropdown inputTypes unreachable via recipeToTrainerItem
`recipeToTrainerItem()` (`src/core/recipes/index.ts` line 460) only produces `inputType = 'toggle'` (for `valueType === 'boolean'`) or `inputType = 'number'` (all other types). The `slider` and `dropdown` control branches in `TrainerCard.tsx` are implemented and unit-tested (trainer-ui.test.ts tests 25-27) but are not reachable via the `getRecipes` IPC call. Resolving this requires adding `inputType`, `min`, `max`, and `options` to the recipe creation IPC or overriding them in `recipeToTrainerItem`.

### KI-014: Atomfall Xbox save format is read-only

Atomfall 1.23.105.0 uses an extensionless, fixed-size, sparse proprietary binary container
with possible integrity metadata. Real-world sandbox copying and source-hash preservation are
verified, but no parser, serializer, checksum rules, or format-version validator exists.
Compatibility is locked to `READ_ONLY`; blind offsets, trailer manipulation, checksum guessing,
repacking, apply, and restore are prohibited.

## Resolved

| Issue | Resolution |
|-------|-----------|
| Node ESM bare imports crashing at runtime | Replaced tsc + fix-esm-imports with tsup bundling |
| Shared database singleton causing test failures across runs | Added `resetForTesting()` with unique temp DB per suite |
| Remote Google Fonts CDN reference in index.html | Removed; local system font stacks only |
| Missing `prefers-reduced-motion` support | Added at end of index.css |
| No single-instance lock | Implemented in electron/main.ts |
| No unified dev command | `npm run dev` via scripts/dev.mjs |
| KI-004: Page UIs are scaffold-level | TrainerPage, CompatibilityDashboard fully implemented; others functional |
| KI-002: Installer not verified end-to-end | Gate 18 packaged smoke 20/20 — exe verified with Playwright |
| TypeScript errors in 6 legacy page files | Fixed in commit `8c92dcd` |
| KI-012: BROKEN state unreachable through IPC | `recipeToTrainerItem()` now preserves `status='Broken'`; Electron IPC and renderer assertions pass |

## Architectural Limitations

1. **Binary Files**: Safe structures are verified but bitwise parsing and validations for unknown binary file types are not supported in V1.
2. **Offline AI Connection**: If local AI services (Ollama/LM Studio) are not running, rule-based fallback explanations are used.
3. **Reparse Points/Junction Escapes**: Symbolic links and junctions at the target path are actively detected and rejected, but testing of complex Windows volume mount points depends on native OS permissions.
4. **Real-World Compatibility**: Atomfall has `REAL_WORLD_SANDBOX` read-only evidence. No writable real-game pilot has passed; fixture evidence remains the only apply/restore evidence.
