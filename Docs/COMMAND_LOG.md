# Command Log

This log records the commands run during baseline validation and final milestone verification.

## 2026-06-28 — Electron Runtime, Build Pipeline & Complete Workflow Verification

Executed complete baseline and post-change verification command sets to prove that Solith works as a real Electron application, using tsup bundler, strict local-only CSP, system font fallbacks, single-instance dev safeguards, and Playwright verification tests.

### Verification Sequence:
```powershell
# 1. Baseline status checks (branch: master, HEAD: e11d95e)
git rev-parse --show-toplevel; git status --short; git branch --show-current; git log --oneline -5

# 2. TypeScript compilation (zero errors)
npx tsc --noEmit

# 3. Main core tests (346/346 tests passed)
npm test

# 4. Compile main, preload, and host-entry (tsup bundler)
npm run build:electron

# 5. Output Verification Check (19/19 checks passed)
node scripts/verify-electron-output.mjs

# 6. Production frontend Vite build
npm run build:vite

# 7. Package distribution build (after terminating locked background Solith instances)
npm run build

# 8. Playwright Electron window smoke checks (6/6 passed)
npm run test:electron-smoke

# 9. Playwright Electron full E2E workflow checks (4/4 passed - after rollback journal fix)
npm run test:electron-e2e

# 10. Playwright Packaged Installer verification (22/22 passed)
npm run test:packaged-smoke
```

### Observed Verification Results:
- `npm test` pass count: **346/346**
- `npx tsc --noEmit`: **0 errors**
- `build:electron` output verifier: **19/19**
- `test:electron-smoke`: **6/6**
- `test:electron-e2e`: **4/4**
- `test:packaged-smoke`: **22/22**

---

## 2026-06-25 — Drill Core `master_volume` writable sandbox pilot

Repository precheck (branch `feature/v1-writable-real-world-pilot`, clean tree,
HEAD = master = origin/master = `2642a23`, no `v0.3.0` tag). Verified prior
`settings.json` intake evidence (719 bytes, UTF-8 no BOM, strict parse OK,
semantic round-trip MATCH, original unmodified). Local cosmetic evidence timestamp
to use: `$EvidenceTimestamp = (Get-Date).ToString("o")`.

```powershell
# Sandbox runs (local, ignored runner using the production adapter)
npx tsx .local-pilot-data/sandbox-run.ts   # run-01 + run-02: all assertions PASS

# Verification (all PASS)
npx tsc --noEmit
npm test                      # 132/132 (incl. 24 new adapter tests)
npm test                      # 132/132 (idempotent)
npm run test:drill-core       # 24/24
npm run build:vite
npm run build:electron        # output verifier 18/18
npm run test:electron-smoke   # 6/6
npm run test:electron-e2e     # 4/4
npm run test:ipc-channels     # 13/13
npm run test:trainer-states   # 15/15
npm run test:trainer-e2e      # 5/5
npm run test:browser-fallback # 7/7
npm run test:performance      # 12/12
npm run test:accessibility    # 7/7 (no worker crash this run)
npm run test:pilot-intake     # 10/10
npm run dist                  # electron-builder OK
npm run test:packaged-smoke   # 22/22
git diff --check              # only benign LF/CRLF notices
```

Result: `READY FOR IN-GAME VALIDATION — Drill Core master_volume sandbox workflow passed`.
Live original modified: No. Real pilot data committed: No. `v0.3.0` not created/pushed.

## 2026-06-25 — KI-013 + accessibility + dead-script cleanup

Executed baseline and post-change verification command sets (using actual package scripts):

```powershell
npm test
npm test
npx tsc --noEmit
npm run build:vite
npm run build:electron
npm run verify:electron-output
npm run test:electron-smoke
npm run test:electron-e2e
npm run test:trainer-e2e
npm run test:ipc-channels
npm run test:trainer-states
npm run test:browser-fallback
npm run test:accessibility
npm run test:performance
npm run test:pilot-intake
npm run build
npm run dist
npm run test:packaged-smoke
git diff --check
git status --short
```

Observed results include:
- `npm test` pass count: **108/108**
- `build:electron` verifier: **18/18**
- `test:trainer-states`: **15/15**
- `test:accessibility`: **7/7**
- `test:packaged-smoke`: **22/22**

## 2026-06-23 — V1 Trainer UX + Compatibility Pilot Verification

### Commit A: `8c92dcd` — fix(types): restore zero-error TypeScript baseline

Files modified:
- `src/app/pages/Backups.tsx` — added `if (!gameId) { setLoading(false); return; }` inside `loadBackups()`
- `src/app/pages/DiscoveryLab.tsx` — added `if (!gameId) { setLoading(false); return; }` inside `loadSaveFiles()`
- `src/app/pages/Journal.tsx` — removed `result?.error` access on narrowed-to-never type
- `src/app/pages/Recipes.tsx` — added `if (!gameId) return`; changed `result?.error` to `Array.isArray(result)` guard
- `src/app/pages/SaveEditor.tsx` — added `if (!gameId) return` inside `loadSaveFiles()`
- `src/app/pages/SaveLocations.tsx` — added `if (!gameId) { setLoading(false); return; }` inside `loadLocations()`

TypeScript result after commit A: `npx tsc --noEmit` → **0 errors**

### Commit B: `d14a0f3` — test(trainer): add Electron Trainer UX end-to-end verification

Files added:
- `tests/trainer.e2e.test.ts` — 5 tests, 28 assertion points, full Electron lifecycle

Key fix discovered during authoring: `applyProposal` returns `{ success: true, backup: { id, backupPath, ... } }` — use `applyRes.backup.id`, NOT `applyRes.backupId`.

Hash evidence from Trainer E2E:
```
source_before          = 269cb1a4e497525453ca71f6b840bfa855ae716d4068c6abafd41754fcc82e55
source_after           = 269cb1a4e497525453ca71f6b840bfa855ae716d4068c6abafd41754fcc82e55
workspace_before       = 269cb1a4e497525453ca71f6b840bfa855ae716d4068c6abafd41754fcc82e55
workspace_after_apply  = 811a630f9bdcda767edce9aa26532116d212a0ebb0d2affa93663fd36f7f1f63
workspace_after_restore= 269cb1a4e497525453ca71f6b840bfa855ae716d4068c6abafd41754fcc82e55
renderer_errors        = 0
main_errors            = 0
```

Gate 18 also expanded in this commit: `tests/packaged-smoke.test.ts` — 15 → 20 points.

### Gate sequence run for final verification:

```powershell
npm test                      # 99/99
npx tsc --noEmit              # 0 errors
npm run build:vite            # OK
npm run build:electron        # OK
npm run verify:electron-output # 18/18
npm run test:electron-smoke   # 6/6
npm run test:electron-e2e     # 4/4, repeatability CONFIRMED
npm run test:trainer-e2e      # 5/5
npm run dist:dir              # OK
npm run test:packaged-smoke   # 20/20
```

### Commit C: `643e2b4` — docs(pilot): record compatibility pilot BLOCKED milestone decision

Files added / updated:
- `Docs/Reports/COMPATIBILITY_PILOT_REPORT.md` — milestone BLOCKED, outcome table, evidence matrix
- `Docs/IMPLEMENTATION_STATUS.md` — V1 outcomes table, test counts
- `Docs/CONTEXT_HANDOFF.md` — full commit history, gate results, architecture notes
- `Docs/NEXT_ACTIONS.md` — Outcome C blocked, unblocked a11y items, gate sequence
- `Docs/KNOWN_ISSUES.md` — resolved KI-002/KI-004; added KI-006 through KI-011
- `Docs/COMMAND_LOG.md` — added V1 Trainer UX session commands
- `Docs/Reports/TRAINER_UX_VERIFICATION.md` — corrected gate terminology (18/18 = output verifier)
- `Docs/Architecture/PILOT_SANDBOX.md` — NEW
- `Docs/Compatibility/V1_FORMAT_COMPATIBILITY.md` — NEW
- `Docs/Compatibility/V1_GAME_VALIDATION.md` — NEW
- `Docs/Compatibility/PILOT_RESULTS.md` — NEW
- `Docs/Guides/TRAINER_MODE_GUIDE.md` — NEW
- `Docs/Guides/WORKSHOP_MODE_GUIDE.md` — NEW
- `Docs/Reports/ACCESSIBILITY_REPORT.md` — NEW
- `Docs/Reports/PERFORMANCE_REPORT.md` — NEW

---

## 2026-06-23 — V1 Non-User-Data Closeout

### Purpose

Prove that every non-user-data requirement is complete before beginning the real-save pilot. The 17-step closeout was requested after the milestone BLOCKED decision was found to lack exact evidence for: two consecutive npm test runs, build commands, git clean check, a11y, performance, browser fallback, Electron card state and control coverage, and IPC channel regression tests.

### Files written (non-user-data closeout):

```
tests/ipc-channels.e2e.test.ts           — 9 tests: check-game-running, get-compatibility-profile, get-all-profiles
tests/trainer-states-controls.e2e.test.ts — 8 tests: card states + control types (5 pass, 3 documented gaps)
tests/browser-fallback.e2e.test.ts       — 7 tests: all 7 guarded pages without electronAPI
src/core/pilot/manifest.ts               — RealWorldPilotManifest Zod schema (schemaVersion 1.0)
src/core/pilot/intake.ts                 — 13-step intake pipeline (hash → copy → verify → manifest)
tests/pilot-intake.test.ts               — 10 dry-run tests (JSON, INI, XML, CSV, text, binary fixtures)
Docs/Reports/V1_NON_USER_DATA_CLOSEOUT.md — main closeout evidence matrix
Docs/Guides/REAL_WORLD_PILOT_INTAKE.md  — intake guide (required fields, accepted formats, what the intake does)
Docs/Compatibility/REAL_WORLD_PILOT_CHECKLIST.md — checklist (pre-session, format criteria, testing, outcome)
```

### Files updated:

```
package.json           — added test:ipc-channels, test:trainer-states, test:browser-fallback scripts
                         added tests/pilot-intake.test.ts to npm test command
.gitignore             — added .local-pilot-data/, .local-pilot-workspaces/, .local-pilot-backups/, .local-pilot-reports/
Docs/KNOWN_ISSUES.md   — added KI-012 (BROKEN state unreachable via IPC), KI-013 (slider/dropdown unreachable)
Docs/NEXT_ACTIONS.md   — updated Outcome C description to reference intake guide; added new test scripts
Docs/IMPLEMENTATION_STATUS.md — updated test counts (99→109), added new test suites
Docs/CONTEXT_HANDOFF.md — added closeout gate table, new architecture notes, updated Outcome C unblock steps
Docs/COMMAND_LOG.md    — this entry
```

### Closeout verification sequence:

```powershell
npm test (run 1)        # 109/109 (includes pilot-intake ×10)
npm test (run 2)        # 109/109
npx tsc --noEmit        # 0 errors
```

Diagnosis note: pilot-intake tests 01-06 initially failed because `os.tmpdir()` was in `BLOCKED_SOURCE_PREFIXES`. Fixed by removing `os.tmpdir()` from constant and instead blocking `workspaceRootDir` per-call in `isBlockedSourcePath()`. Then intake-06 failed because `.bin` was not in the format map — fixed by adding `bin: 'binary'` to `detectFormat()` map.

### Initial closeout decision (REJECTED — evidence out of order):

The complete gate sequence ran BEFORE the new test files were added. Decision was set to
REJECTED — post-change non-user-data verification incomplete.

---

## 2026-06-23 — Post-Change Closeout Verification

### Purpose

Re-run every verification step AFTER adding:
- `tests/ipc-channels.e2e.test.ts` (expanded 9→13 tests)
- `tests/trainer-states-controls.e2e.test.ts` (fixed createRecipe return shape + CURRENCY category)
- `tests/browser-fallback.e2e.test.ts`
- `tests/accessibility.e2e.test.ts` (NEW)
- `tests/performance.e2e.test.ts` (NEW)
- `tests/packaged-smoke.test.ts` points 21-22 (NEW: actual IPC invocations)
- Missing npm scripts: `test:ipc-e2e`, `test:trainer-states-e2e`, `test:browser-fallback-e2e`,
  `test:accessibility`, `test:performance`, `test:pilot-intake`

### Post-change verification sequence:

```powershell
npx tsc --noEmit              # 0 errors
npm test (run 1)              # 109/109
npm test (run 2)              # 109/109
npm run build:vite            # Exit 0, 28 modules, 261.37 kB / 76.08 kB gzip
npm run build:electron        # Exit 0, 18/18 verifier PASS
npm run test:electron-smoke   # 6/6 in 7.2s
npm run test:electron-e2e     # 4/4 in 1.7s, hash chain CONFIRMED
npm run test:trainer-e2e      # 5/5 in 5.0s
npm run test:ipc-channels     # 13/13 in 7.8s
npm run test:trainer-states   # 7/7 + 3 documented skips in 4.4s
npm run test:browser-fallback # 7/7 in 10.0s
npm run test:accessibility    # 7/7 in 6.6s
npm run test:performance      # 5/5 in 1.0s (startup 512ms, IPC 3-12ms)
npm run test:pilot-intake     # 10/10 in 0.3s
npm run dist                  # Exit 0, ResourceForge.exe produced
npm run test:packaged-smoke   # 22/22 in 2.6s (Gate 18)
git diff --check              # Exit 0 (LF→CRLF warnings only — not errors)
git status --short            # Modified + untracked only
```

### Bugs fixed during post-change sequence:

| Bug | File | Fix |
|-----|------|-----|
| `recipe?.id` should be `recipe?.recipe?.id` (createRecipe returns `{success, recipe}`) | trainer-states-controls.e2e.test.ts | Fixed all 6 occurrences |
| `category: 'CURRENCY'` rejected by Zod (not in enum) | Same file | Changed to `'STATS'` |
| Wrapping-label pattern missing in a11y-06 | accessibility.e2e.test.ts | Added `input.closest('label')` check |

### Final closeout decision:

```
BLOCKED — real-world compatibility pilot requires approved user data.
All non-user-data requirements are VERIFIED (post-change sequence passed).
```

---

## 2026-06-23 — Electron Runtime and Package Verification Milestone

Code changes made (no terminal access):
- `src/core/database/index.ts` — Added `resetForTesting()`, extracted `applySchema()`
- `tests/discovery.test.ts` — Full rewrite with per-run isolation
- `package.json` — Updated script names; `fix-esm-imports` removed from all scripts
- `scripts/dev.mjs` — NEW: unified dev launcher
- `src/app/styles/index.css` — All font stacks updated to system fallbacks; `prefers-reduced-motion` added
- `tests/electron.smoke.test.ts` — NEW: Playwright Electron smoke test
- `playwright.config.ts` — NEW
- `.gitignore` — NEW
- `Docs/**` — Architecture and reports updated

## Baseline Validation

- `npm run test` → Checked baseline (failed on stale value verification due to generic mismatch message).
- `npx tsc --noEmit` → Checked baseline (failed with 2 TypeScript compiler errors in saves/editor.ts).

## Corrected Execution & Hardening

- `npx tsc --noEmit` → Passed with 0 errors after fixing the validateSave return type and dryRunProposal async call interfaces.
- `npm run test` → Passed with 10/10 baseline tests after formatting mismatch errors to include "(stale edit)".
- `npm run test` → Passed with 20/20 tests after adding the comprehensive `tests/failure-injection.test.ts` suite.
- `npm run build` → Packaging initiated.

---

## 2026-06-23 — Renderer State Evidence Completion

- Added Electron-renderer assertions for `GAME_RUNNING`, `NEEDS_RESCAN`, `BROKEN`, `APPLYING`, and `FAILED`.
- Resolved KI-012 by preserving `Broken` through `recipeToTrainerItem()`.
- Removed unreachable `NEEDS_SAVE` and `STALE` values from the active `TrainerCardState` union/config.
- Recorded the ~6198ms cold-start observation as an open performance limitation; latest warm launch was 501ms.

Fresh final sequence:

```powershell
npx tsc --noEmit              # 0 errors
npm test                      # 107/107 (run 1)
npm test                      # 107/107 (run 2)
npm run build:vite            # Exit 0, 28 modules, 261.82 kB / 76.25 kB gzip
npm run build:electron        # Exit 0, 18/18 verifier PASS
npm run test:electron-smoke   # 6/6
npm run test:electron-e2e     # 4/4, hash repeatability confirmed
npm run test:trainer-e2e      # 5/5
npm run test:ipc-channels     # 13/13
npm run test:trainer-states   # 12/12 + 1 KI-013 skip
npm run test:browser-fallback # 7/7
npm run test:accessibility    # 7/7
npm run test:performance      # 12/12; warm startup 501ms
npm run test:pilot-intake     # 10/10
npm run dist                  # Exit 0
npm run test:packaged-smoke   # 22/22
```
