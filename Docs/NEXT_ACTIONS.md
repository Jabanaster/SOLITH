# Next Actions

**Updated:** 2026-06-23 — V1 Trainer UX + Compatibility Pilot Verification Checkpoint

## Blocked — Waiting for User

- [ ] **Outcome C: Real-world compatibility pilot** — Non-user-data closeout is COMPLETE (see `Docs/Reports/V1_NON_USER_DATA_CLOSEOUT.md`). User nominates a single-player offline game with a JSON, INI, XML, CSV, or plain-text save. Provide game title, version, store, and save path to begin intake. See `Docs/Guides/REAL_WORLD_PILOT_INTAKE.md` for required fields and `Docs/Compatibility/REAL_WORLD_PILOT_CHECKLIST.md` for the full checklist.

## Short-term (unblocked, no user data needed)

- [ ] Add `@axe-core/playwright` to the Trainer E2E suite to automate accessibility audits
- [ ] Add focus trap to `ApplyDialog.tsx` (Escape key + focus loop past last button)
- [ ] Return focus to the card that triggered the dialog on close
- [ ] Add `aria-describedby` linking state badges to card descriptions
- [ ] Add `<label>` element to slider control in `TrainerCard.tsx`
- [ ] Add `aria-disabled` and `aria-describedby` to disabled controls
- [ ] Add `prefers-reduced-motion` detection to animation code paths
- [ ] Add pagination / virtual scroll to trainer cards list for games with 100+ recipes
- [ ] Add onboarding wizard / first-run experience
- [ ] Delete `fix-esm-imports.mjs` and `fix-esm-imports.ps1` (dead code — KI-003)

## New E2E Test Suites (run after build:electron)

```powershell
npm run test:ipc-channels      # 9 tests — check-game-running, get-compatibility-profile, get-all-profiles
npm run test:trainer-states    # 8 tests — card states + control types (5 pass, 3 documented skips)
npm run test:browser-fallback  # 7 tests — all 7 guarded pages without electronAPI
```

## Gate Sequence to Run Before Any New Milestone Acceptance

```powershell
npm test                         # 109 unit tests (includes pilot-intake)
npx tsc --noEmit
npm run build:vite
npm run build:electron           # output verifier 18/18
npm run test:electron-smoke      # Gate 10, 6/6
npm run test:electron-e2e        # Gate 13, 4/4
npm run test:trainer-e2e         # 5/5
npm run dist:dir
npm run test:packaged-smoke      # Gate 18, 20/20
```

All must pass before declaring a milestone ACCEPTED. Outcome C remains BLOCKED until Tier 1 real-world save evidence is collected.

---

## Completed This Milestone

- [x] Trainer Mode UI — TrainerPage, TrainerCard (11 states), ApplyDialog, ContextPanel
- [x] Workshop Mode toggle — AppMode, localStorage persist, aria-pressed
- [x] Compatibility Framework — CompatibilityDashboard, 3 IPC channels, Zod schemas
- [x] TypeScript 0 errors — 6 pre-existing errors fixed in commit `8c92dcd`
- [x] Trainer E2E — 5/5 tests, 28 assertion points, hash invariant evidence
- [x] Gate 18 expanded — 15→20 points; packaged Trainer UI verified

## Completed in Earlier Milestones

- [x] Implement auto-detection pathways for common PC save folders
- [x] Audit the Electron Security model and delete generic file access IPC handlers
- [x] Implement recipe runtime schema verification
- [x] Upgrade crash recovery to evidence-driven routine
- [x] Build automated end-to-end integration workflow test (Gate 13)
- [x] Implement failure-injection tests (20 tests)
- [x] Implement TrainerPage UI — item cards with apply/preview
- [x] Implement Backups UI — backup list with restore buttons
- [x] Implement Journal UI — event timeline
- [x] Implement Recipes, SaveEditor, DiscoveryLab, SaveLocations UIs (scaffold + functional)
