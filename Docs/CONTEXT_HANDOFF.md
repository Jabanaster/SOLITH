# Context Handoff

**Last Updated:** 2026-06-23 — V1 Trainer UX + Compatibility Pilot Verification Checkpoint

## Current Branch

`feature/v1-trainer-ux-pilot`

## Commit History (this milestone, chronological)

```
9a47980  docs(evidence): add full 64-char SHA-256 hashes [BASELINE — DO NOT MODIFY]
6b5bff8  feat(pilot): V1 Trainer UX — Outcomes A, B, D delivered; 99/99 tests pass
8c92dcd  fix(types): restore zero-error TypeScript baseline
d14a0f3  test(trainer): add Electron Trainer UX end-to-end verification
```

Do not amend, rebase, or rewrite any commit at or before `9a47980`.

## Current Milestone Status

**BLOCKED — real-world compatibility pilot requires approved user data**

Outcomes A, B, D: COMPLETE. Outcome C: BLOCKED_PENDING_USER_DATA. All non-user-data work is verified. The only remaining blocker is a real commercial save file that the user must provide.

## What Was Done This Milestone

1. **Trainer Mode UI** — `TrainerPage.tsx`, `TrainerCard.tsx` (11-state + STATE_CONFIG), `ApplyDialog.tsx`, `ContextPanel.tsx`
2. **Workshop Mode toggle** — `AppMode` type, `localStorage` persistence, `aria-pressed` buttons in `App.tsx`
3. **Compatibility Framework** — `CompatibilityDashboard.tsx`, 3 new IPC channels (check-game-running, get-compatibility-profile, get-all-profiles), Zod schemas, preload bridge
4. **TypeScript fixed** — 6 pre-existing errors in legacy page files eliminated in commit `8c92dcd`
5. **Trainer E2E** — `tests/trainer.e2e.test.ts` — full Electron lifecycle, 5 tests, 28 assertion points, hash invariant evidence
6. **Gate 18 expanded** — `tests/packaged-smoke.test.ts` expanded from 15 to 20 points; points 16–20 verify Trainer UI in packaged exe

## All Gates Passing

| Gate / Suite | Command | Result |
|--------------|---------|--------|
| TypeScript | `npx tsc --noEmit` | 0 errors |
| Unit tests | `npm test` | 99/99 |
| Electron output verifier | `npm run verify:electron-output` | 18/18 |
| Gate 10 bundled smoke | `npm run test:electron-smoke` | 6/6 |
| Gate 13 Electron E2E | `npm run test:electron-e2e` | 4/4 |
| Trainer E2E | `npm run test:trainer-e2e` | 5/5 |
| Gate 18 packaged smoke | `npm run test:packaged-smoke` | 20/20 |

## Key Architecture Notes for Next Session

- `getRecipes` IPC returns `TrainerItem[]` — NOT `Recipe[]`. TrainerItem has `currentValue`, `status`, `min`, `max`, `options`, `inputType`.
- `applyProposal` returns `{ success: true, backup: { id, backupPath, ... } }` — NOT `{ backupId: string }`. Use `backup.id`.
- `deriveCardState()` priority: transient (APPLYING/APPLIED/RESTORED/FAILED) → BLOCKED (risk or status) → NEEDS_RESCAN → BROKEN → GAME_RUNNING → READY
- `AppMode = 'trainer' | 'workshop'`, persisted to `localStorage` under key `'rf-app-mode'`
- Game-running detection: read-only `tasklist`/`ps` via `isGameRunning(profile)` — no injection

## What Is Needed to Unblock Outcome C

1. User nominates a real single-player game with JSON or plain-text save format
2. User provides or consents to copy one save file
3. Discovery Lab identifies candidate fields
4. Sandbox pilot: apply → verify → restore → verify
5. Tier 1 hash evidence recorded in `Docs/Compatibility/PILOT_RESULTS.md`
6. Profile promoted to VERIFIED
7. No save file content committed to git

---

## Older History

### 2026-06-23 — Electron Runtime and Package Verification Milestone

1. **Test isolation fixed** — `src/core/database/index.ts` now exports `resetForTesting(tempDbPath?)`. Schema DDL extracted into `applySchema()`. Discovery test uses unique temp DB per run via `RUN_ID`.
2. **Package scripts updated** — complete named script set in `package.json`; `fix-esm-imports` removed from all scripts.
3. **Dev launcher created** — `scripts/dev.mjs` starts Vite + tsup watch + Electron without killing unrelated apps.
4. **Font/CSP** — All hardcoded font names replaced with full system stacks. `prefers-reduced-motion` block added.
5. **Playwright smoke test** — `tests/electron.smoke.test.ts` + `playwright.config.ts` written.
6. **`.gitignore`** — created with full exclusion list.
7. **Documentation** — Architecture, Reports, and status docs updated.
