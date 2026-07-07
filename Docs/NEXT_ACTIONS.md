# Next Actions

**Updated:** 2026-07-06 — Live Memory Trainer: pointer-path discovery + one real, restart-verified control (Atomfall ammo) landed

## Live Memory Trainer — next bite

- [x] Install and build `memoryjs`'s native addon (patched via `patch-package`, see KI-015).
- [x] Verify a real ReadProcessMemory/WriteProcessMemory round trip against a controllable test-target process (`scripts/live-memory-verify.mts`).
- [x] Verify attach mechanics (`openProcess`/`closeProcess`) against real running commercial games (Stardew Valley.exe, Atomfall_dx12.exe) — no memory read/written against either real game.
- [x] Add IPC channels + preload exposure + Trainer-mode UI (process picker, offline confirmation, manual read/write, saved controls, scan workflow, freeze toggle).
- [x] Fix the remote-connection observer's real-world output-size bug (KI-017) — rewritten to a PID-scoped `Get-NetTCPConnection` query.
- [x] Add Cheat-Engine-style memory scanning (first scan + next scan) — verified read-only against 2 real games (Stardew Valley gold, Atomfall ammo), including a real narrowing sequence (5000 candidates → 1).
- [x] Add WeMod/Wand-style freeze-value loop (guard-rechecked every tick) — unit-tested only; not yet exercised against a real game with a real write.
- [x] Decide the KI-017 policy question for two specific, reviewed games (not the general default): added `acceptedConnectionBaseline` — Stardew Valley (5) and Atomfall (2), both measured live. Any other game still gets the strict default (0).
- [x] Add module enumeration, a reverse pointer scanner, and a pointer-path resolver — needed because a raw scanned address is only valid for the current process instance.
- [x] Build one real per-game trainer control end-to-end: Atomfall "Set Current Weapon Ammo", discovered via real gameplay (scan → narrow → pointer scan) and proven restart-stable (verified across a full game close/relaunch — 1 of 20 candidates survived; the other 19 were session-local coincidences).
- [ ] Palworld (the originally-requested game) still has no live-memory control — not investigated this round.
- [ ] Verify the freeze-value loop and confirmWrite/rollback against a real game with a real write — every real-game verification so far has been deliberately read-only (scan, resolve, read), since writing to a live save risks corrupting real player progress; this needs explicit authorization before attempting.
- [ ] The managed-runtime pointer-scanning gap (KI-018) remains open — the technique does not work against .NET/Mono games like Stardew Valley; would need a CLR/Mono-specific approach.
- [ ] Do not remove or weaken the online-session guard
      (`src/core/live-memory/online-guard.ts`) — it is fail-closed by design
      and evidence overrides user confirmation. Baselines are per-game,
      evidence-based exceptions, not a general relaxation. See
      PROJECT_SPEC.md Section 3.1.

**Updated:** 2026-06-25 — Drill Core `master_volume` writable sandbox pilot passed

## Waiting for User — in-game validation authorization

- [x] Record Atomfall 1.23.105.0 Xbox as `REAL_WORLD_SANDBOX / READ_ONLY`; source-copy hashes matched and the original remained unchanged.
- [x] **Outcome C: writable real-world sandbox pilot** — Drill Core `settings.json` → `master_volume` passed parse → backup → sandbox apply → validation → exact restore across two independent runs with byte preservation and live-original integrity.
- [ ] **Authorize live in-game validation** — With explicit approval, apply `master_volume` to the live `%LOCALAPPDATA%\Drill_Core\settings.json` (after verified backup), launch Drill Core, confirm the slider reflects the change, then restore from backup and verify exact SHA-256 equality.
- [ ] **`v0.3.0` release gate** — Do not create or push `v0.3.0` until the user explicitly approves after merge.

The complete writable real-world pilot is **not** accepted until live in-game
loading and restoration are authorized and verified.

## Short-term (unblocked, no user data needed)

- [ ] Add `@axe-core/playwright` to the Trainer E2E suite to automate accessibility audits
- [x] Add focus trap to `ApplyDialog.tsx` (Escape key + focus loop past last button)
- [x] Return focus to the card that triggered the dialog on close
- [ ] Add `aria-describedby` linking state badges to card descriptions
- [x] Add `<label>` element to slider control in `TrainerCard.tsx`
- [ ] Add `aria-disabled` and `aria-describedby` to disabled controls
- [ ] Add `prefers-reduced-motion` detection to animation code paths
- [ ] Add large-list benchmark fixtures (100/500/1000/5000) before deciding pagination or virtualization
- [ ] Add onboarding wizard / first-run experience
- [x] Delete `fix-esm-imports.mjs` and `fix-esm-imports.ps1` (dead code — KI-003)
- [x] Resolve KI-013 by making slider/dropdown controls reachable through validated recipe IPC and persistence

## New E2E Test Suites (run after build:electron)

```powershell
npm run test:ipc-channels      # 9 tests — check-game-running, get-compatibility-profile, get-all-profiles
npm run test:trainer-states    # 8 tests — card states + control types (5 pass, 3 documented skips)
npm run test:browser-fallback  # 7 tests — all 7 guarded pages without electronAPI
```

## Gate Sequence to Run Before Any New Milestone Acceptance

```powershell
npm test                         # 346 unit/integration tests
npx tsc --noEmit
npm run build:vite
npm run build:electron           # output verifier 19/19
npm run test:electron-smoke      # Gate 10, 6/6
npm run test:electron-e2e        # Gate 13, 4/4
npm run dist:dir
npm run test:packaged-smoke      # Gate 18, 22/22
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
