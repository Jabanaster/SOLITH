# Solith / Solith Roadmap

## Current Baseline (Solith 2.3.0-alpha.2)

Product UI: **Solith** · package `solith@2.3.0-alpha.2`

* Local **`master` @ `60b762b`** — tag `v2.3.0-alpha.2` pushed; current work continues from the clean Vite-boundary / test-stability safe harbor
* Research Lab lock: `v1-milestone-l-research-lab-accepted` → `cdd8c51`
* In-process pilot lock: `v1-milestone-m-in-process-pilot-accepted` → `97326d7`
* Shell polish tag: `v2.1-shell-polish` → `0928d29`
* Adoption tag: `v2.2-wemod-adoption` → `6ddefb8`
* Pre-alpha lock branch: `cursor/offline-sweep-after-v2-2` (historical)

### God-Tier Technical Audit — Alpha release blockers

| Blocker | Status |
|---------|--------|
| Schema v1 unified (Phases 0→5, execute-path SoT, CI import bans) | **RESOLVED** — on `master` @ `5e190cd`+ |
| CI pipeline green (`npm test` / Electron output verifier) | **NEEDS RECHECK** — prior local Alpha gate evidence was updated to `774ff7e`, but current dirty tree requires a fresh full-suite run |
| Dual-Core Engine Authorized | **RESOLVED** — Internal (Win32 VEH/Hooks) and External (WinGDK RPM) mainstream paths fully authorized per updated AGENTS.md |
| L3 live-memory baseline (Atomfall ammo, restart-stable) | **RESOLVED** — `Docs/Baselines/ATOMFALL_L3_EVIDENCE.md`; feature `certificationLevel: L3` |
| Renderer/native boundary warnings | **RESOLVED** — Vite build is silent after Electron-safe module split and renderer boundary enforcement |

### Stability lock

| Gate | Status |
|------|--------|
| Offline sweep + CI/honesty on `master` | **Merged** `6ddefb8..ac43ec6` |
| Local `npm test` (Alpha tip) | **PASS** — `811/811` at `v2.3.0-alpha.2`; rerun required after this safety-hardening slice |
| Local `npm run build:vite` (Alpha tip) | **PASS** — silent renderer build at `v2.3.0-alpha.2`; rerun required after this safety-hardening slice |
| Local `npm run build:electron` (Alpha tip) | **PASS** — Electron output verifier passed `19/19` after this safety-hardening slice |
| Catalog unification / schema.v1 SoT | **Merged to `master`** (Phase 5 + Atomfall L3) |
| Atomfall L3 live cert branch | **Merged** `cursor/atomfall-l3-live-cert` → `master` |

### Accepted capability stack

```text
schema.v1.yml → compile → SQLite payloadJson
         ↑ export                    ↓ lazy load
   Discovery Lab              Trainer Library
                                    ├─ memoryFeatures → LiveMemorySession
                                    ├─ Trainer Deck / install discovery / health
                                    └─ saveEditor.saveFields → TrainerHost (catalog save controls)
Trainer Research Lab → PE / memory diff / Script Analyzer / Dumpspace (Milestone L)
Dual-Core Live Engine → Internal (Win32 VEH/Injection) + External (WinGDK RPM) actively routing based on target environment.
```

### Milestone map (recent)

| Milestone | Theme | Status |
|-----------|--------|--------|
| **L** | Research Lab — PE, memory diff, script analyzer, Dumpspace | **Accepted** (tag + remote) |
| **M** | In-process pilot — Crimson Desert hooks / trainer spawn | **Accepted** (tag + remote); user charter + default OFF |
| **M–Q** *(legacy lettering)* | Live trainer parity, schema.v1, catalog routing, hotkeys | **Accepted** |
| **R** | Brand neutrality, Advanced Scan Mode naming | **Done** |
| **S** | Connection baselines + restart-stable pointers | **Partial** — Atomfall ammo L3 done; Avowed L0 packaging Done (live L0→L2+ still next); Dredge / Crimson Desert live-blocked |
| **T** | 50 bundled + 1000 catalog seed | **Done** |
| **U** | Certification L1–L4 (`certificationLevel`, scripts) | **Partial** — offline L0/L1 + Atomfall L3; Avowed remains L0 until SOP evidence (`AVOWED_LIVE_VALIDATION_SOP.md`) |
| **V** | Feedback, promotion, rating prompt | **Done** |
| **W** | CT import, pointer scan, watch-list, speedhack | **Done** |
| **X** | Binary save router + research stubs | **Partial** — demo/stub only; **immediate next** after Avowed live: Terraria `.plr` wave 1 `canWrite` |
| **Y** | Overlay presets, hotkey rebind, onboarding | **Done** |
| **Z** | Managed runtime (.NET/Mono) | **Not started** |
| **AA** | Install discovery (Steam/Epic/GOG) | **Done** |
| **AB** | Library installed/running badges + filters/sort/drag-exe | **Done** (on `master`) |
| **AC** | Per-game Trainer Deck | **Done** |
| **AD** | Stale / version health engine | **Done** |
| **AE** | Process-detect quick attach | **Done** |
| **AF** | Local demand + repair pipeline | **Done** |
| **AG** | Adoption polish + smoke alignment | **Done** — tag `v2.2-wemod-adoption` |
| **AH** | schema.v1 catalog unification (capability SoT) | **Done** — merged to `master` (Phases 0→5) |
| **AI** *(Alpha)* | Verified Alpha cut — installer + `v2.3.0-alpha.1` | **Done** — NSIS `dist/Solith Setup 2.3.0-alpha.1.exe`; await push/tag lock |

### Shell polish / evidence (2026-07)

| Item | Commit / artifact |
|------|-------------------|
| Layered HTML banner + sharper background | `405dcc6` |
| Compact sidebar header (no duplicate slogan) | `b21856b` |
| Sidebar icon mapping + nav readability | `c56711b` |
| A11y axe gate + contrast fixes | `0a655d3` |
| Catalog seed 1000 entries | `e25b896` |
| Binary save research stubs (read-only) | `56b8487` |
| Research Lab (L) | `cdd8c51` / tag `v1-milestone-l-research-lab-accepted` |
| In-process pilot (M) | `97326d7` / tag `v1-milestone-m-in-process-pilot-accepted` |
| Save UX + live-memory/catalog harden | `a9483f6` |
| Shell polish acceptance | tag `v2.1-shell-polish` → `0928d29` |
| AG smoke + matrix + overlay bounds | `6ddefb8` / tag `v2.2-wemod-adoption` |
| Atomfall L3 live evidence + harness | captured before current `774ff7e` baseline / `Docs/Baselines/ATOMFALL_L3_EVIDENCE.md` |
| Offline sweep + CI/honesty lock | `20739f5` + `ac43ec6` → **`master`** |

### Post-Alpha architecture — Done (branch tip)

Shipped on `master` before the current `774ff7e` baseline. These close product/architecture gaps; they do **not** fake live L2+ certs.

| Item | Status | Evidence |
|------|--------|----------|
| Zero-Input detect → prepare → resolve loop | **Done** | `process-watcher` / feature resolver / memory audit IPC; blueprint `Docs/Architecture/SOLITH_ZERO_INPUT_BLUEPRINT.md` |
| Avowed WinGDK executable packaging (L0) | **Done** | `AVOWED_L0_DEFINITION` + aliases `Avowed-WinGDK-Shipping.exe`; deck stays `scan_unknown` / L0 |
| WinGDK `wgs` save + Alabama config backup watchers | **Done** | `electron/avowed-wingdk-backup-watch.ts` + `src/core/backups/avowed-wingdk.ts` (READ + COPY only) |
| Phase 3 Hub Sync Orchestrator & Trust UI | **Done** | Opt-in community sync polling, Catalog trust UI, PII sanitization / L0 quarantine |
| Core engine hardening | **Done** | Fuzzy AOB drift recovery, local crash reporter, local sandbox scaffold |
| Solith rebrand + opening cinematic | **Done** | Product rename + UI cinematic integration |
| Phase 9 Address/Data Research Tools | **Done** | Read-only viewer/hex/pointer/snapshot — `Docs/Plans/PHASE9_ADDRESS_DATA_RESEARCH_TOOLS.md` |
| Phase 10 Gated Write Architecture | **Done** | `WritePolicyGate` + MemoryManager enforce; researchWriteMode default OFF; Trust Shift waiver replaces connection-count write blocks — `Docs/Plans/PHASE10_GATED_WRITE_ARCHITECTURE.md` |
| Inert CT Registry Framework (Phases 1–10) | **Done** | Query/schema/CLI/UI + static research + read-only runtime + gated writes — `Docs/Architecture/INERT_CT_REGISTRY_BLUEPRINT.md` |
| Trust Shift + CT→Live Phases 2–4 | **Done** | Waiver consent; `CtLiveResolution`; toggle cards; pointer table / What-Changed; local pack export — `Docs/Plans/PHASE2_4_CT_LIVE_BRIDGE.md` |

Honest stance unchanged: Avowed memory features remain **L0 `scan_unknown`** until live AOB/pointer evidence. Live elevation playbook: `Docs/Plans/AVOWED_LIVE_VALIDATION_SOP.md`.

### Ordered safety build — Active sequence

| Order | Item | Current status |
|-------|------|----------------|
| 1 | Security hardening | **Active / strengthened** — renderer boundary has a static test; Vite remains the enforcement smoke |
| 2 | Anti-cheat / protected-target blocking | **Active / strengthened** — read-only process adapter fails closed on known protected indicators before returning a session |
| 3 | Harmless-process smoke tests | **Available** — `npm run smoke:runtime-readonly -- --pid <pid> --name <process.exe>` uses explicit PID selection and bounded module reads |
| 4 | Offline/single-player support | **Standing rule** — live features require explicit offline/private-play confirmation and guard evidence |
| 5 | Restart validation + L0–L4 certification | **Active / strengthened** — restart artifact comparison can classify unique stable signatures as L3 candidates only when evidence stays stable |
| 6 | Metadata-only CT import + inert script preservation | **Done / strengthened** — CT scripts remain `executable=false`; rejection reasons are preserved for review |
| 7 | Read-only process/module scanning + AOB extraction | **Done / active** — AOB extraction and read-only signature resolution exist; live game validation still requires explicit process selection |
| 8 | Safe save editing with backup/rollback | **Implemented for accepted save-field paths** — proposal/backup/rollback remains the preferred route where file-backed support exists |
| 9 | CT Library Explorer + rejection reports | **Active / strengthened** — CT Library detail now surfaces rejection reasons, not just counts |

### Bundled schema.v1 definitions

All seven curated games (`games.ts`) ship as `schema.v1` payloads via `bundled-definition-seed.ts`:
Stardew Valley (save-field controls) plus six live-memory titles. Atomfall includes verified
`atomfall-current-weapon-ammo` at **L3**; other pinned live cheats remain `scan_unknown` until certified.
Avowed ships Steam + WinGDK executables at **L0** only (no `signature` / `baseOffset` / `pointerChain` yet).

### Remaining live-session work (do not fake)

**Immediate next targets (priority order):**

1. **Avowed connection baselines + L0 → L2+ elevation** — Game Pass / WinGDK live session: process detect, `measure-connection-baseline.mjs`, state-delta scan on `Avowed-WinGDK-Shipping.exe`, then restart-verify before any schema promotion (`Docs/Plans/AVOWED_LIVE_VALIDATION_SOP.md`)
2. **Milestone X — Terraria `.plr` binary save write path (wave 1)** — commercial binary writes beyond sandbox fixtures (`canWrite` still blocked until certified)

**Still required (after the two above, or when sessions allow):**

3. Connection baselines — Dredge, Crimson Desert (`measure-connection-baseline.mjs`)
4. Restart-verify pointer paths for remaining bundled memory games (beyond Atomfall ammo)
5. Additional L2–L4 certification runs with in-game evidence for non-Atomfall / non-elevated-Avowed titles
6. Managed-runtime live memory spike (Milestone Z) — research only when authorized

### Can continue offline (post-merge)

- ~~Offline sweep AB / cert docs / watch-confidence / Epic/GOG fixtures~~ — **on master**
- ~~Catalog search test isolation (`:memory:`) + CI fresh-clone~~ — **on master**
- ~~README L0 honesty + in-process user charter~~ — **on master**
- ~~schema.v1 Phase 0→5~~ — **on master**
- ~~Atomfall L3 live baseline~~ — **on master** (`Docs/Baselines/ATOMFALL_L3_EVIDENCE.md`)
- ~~Zero-Input loop / Avowed L0 + WinGDK backups / Hub sync+trust / engine harden / Solith rebrand~~ — **on `master`**
- ~~Phase 9 address/data research tools (view/hex/pointer report/session snapshot, read-only)~~ — **on `master`** (`Docs/Plans/PHASE9_ADDRESS_DATA_RESEARCH_TOOLS.md`)
- ~~Phase 10 gated write architecture (policy scaffold; researchWriteMode default OFF)~~ — **on `master`** (`Docs/Plans/PHASE10_GATED_WRITE_ARCHITECTURE.md`)
- ~~Trust Shift + CT→Live Phases 2–4 (waiver, promote/toggles, research UX, local packs)~~ — **on `master`** (`Docs/Plans/PHASE2_4_CT_LIVE_BRIDGE.md`)
- ~~Inert CT Registry Framework (Phases 1–10)~~ — **on `master`** via PR #4 (`Docs/Architecture/INERT_CT_REGISTRY_BLUEPRINT.md`)
- Remaining S / U live titles still require game sessions (Avowed first)

See **`Docs/Plans/SCHEMA_V1_UNIFICATION_PLAN.md`** + **`SCHEMA_V1_PHASE0_CONSUMER_INVENTORY.md`**.
Run **`npm run verify:schema-v1-boundaries`** and **`npm run orphan-check`** before merge.  
See **`Docs/Plans/WEMOD_ADOPTION_PLAN.md`** for the WeMod-style adoption track (milestones AA–AG).  
See **`Docs/Plans/SOLITH_PINNACLE_MASTER_PLAN.md`** for the full R→Z roadmap.  
See **`Docs/Plans/AVOWED_LIVE_VALIDATION_SOP.md`** for Avowed L0 → L2/L3 live elevation.  
See **`Docs/Plans/PHASE9_ADDRESS_DATA_RESEARCH_TOOLS.md`** for read-only research IPC/UI.  
See **`Docs/Plans/PHASE10_GATED_WRITE_ARCHITECTURE.md`** for write policy gate + residual risks.

---

## Historical: v1.0.2 baseline

Solith v1.0.2 remains the prior save-editor / Stardew-controls release baseline.

* Tag: `v1.0.2`
* Commit: `d84b155a8f6729f8428b5c777f0784853c65d419`

Older milestone tags (`v1-milestone-f` through `v1-milestone-j`) are unchanged on the legacy branch history.

---

## Historical: v1.1 development notes

The sections below document earlier v1.1 bite work. They are retained for audit trail only.

---

# Historical Roadmap (archive)

## Current Development State

### Trainer Toggle Persistence & Live-Watch Migration (2026-07-09)

Status: **Accepted locally, not pushed, not tagged.**

Commit: `806ba568c9ea9c11d1484e879849983074e76afd`

This is a UI-wiring migration, not a scope expansion. It removed obsolete trainer components
and replaced ad hoc cheat-toggle component state with a persisted store.

Removed as obsolete: `LiveTrainer.tsx`/`.module.css`/`.test.tsx`, `PalworldCheatMenu.tsx`/
`.module.css`/`.test.tsx`, `PalworldTrainerPage.tsx`/`.module.css`, `useFreezeValue.ts`,
`useLiveTrainerWorkflow.ts`.

Added: `LiveWatchPanel.tsx`/`.module.css` (active live-watch UI), `electron/cheat-toggle-ipc.ts`,
`src/core/cheat-system/cheat-toggle-store.ts` (persists cheat toggle state to a new
`cheat_toggle_state` database table).

Verification passed:

* `npx tsc --noEmit`: PASS
* `npm run test:trainer-schema`: PASS, 35/35
* `npm run test:live-memory`: PASS, 72/72
* `npm run test:trainer-host`: PASS, 80/80
* `npm test`: PASS, 508/508

Scope boundaries preserved:

* No new process/memory capability beyond what already existed.
* No previously-blocked control was enabled.
* No deleted files were restored.
* Existing per-game cheat catalog (`src/core/cheat-system/games.ts`) unchanged.

Known gap: `cheat-toggle-ipc.ts`, `cheat-toggle-store.ts`, and `LiveWatchPanel.tsx` have no
dedicated tests yet. Existing suites (trainer-schema, live-memory, trainer-host, standard)
cover the surrounding modified files but not these three directly ΓÇö open item, not hidden.

V1.1 development has started from the locked `v1.0.2` baseline.

Current local development state:

* Latest accepted local V1.1 bite: **V1.1 Bite 2**
* Commit: `5f6d1ad590ece1cf38eeb19b158488372d348fc2`
* Status: accepted locally and fresh local-clone verified.
* Not tagged.
* Not pushed as a release.
* Working tree after verification: clean.

Fresh local-clone verification for Bite 2 passed from:

`G:\SOLITH_V11_BITE2_VERIFY`

Bite 2 verification results:

* `npm ci`: PASS
* `npx tsc --noEmit`: PASS
* `npm run test:game-profile`: PASS, 33/33
* `npm run test:trainer-schema`: PASS, 35/35
* `npm run test:trainer-host`: PASS, 73/73
* `npm run test:milestone-e`: PASS, 15/15
* `npm run test:milestone-j`: PASS, 5/5
* `npm test`: PASS, 381/381
* Final fresh-clone `git status --short`: clean
* Final `git diff --quiet`: PASS

## Release History

### v1.0.0 - Original Release Lock

`v1.0.0` remains published and unchanged.

It is no longer the recommended baseline because later fresh-clone verification found reproducibility issues that depended on leftover local artifacts.

### v1.0.1 - Fresh Clone Reproducibility Patch

`v1.0.1` fixed fresh-clone artifact dependency issues.

Fixes included:

* Ignored `.junie/` assistant metadata through `.gitignore`.
* Added self-contained trainer-host test prerequisites.

  * `npm run test:trainer-host` builds required Electron host output first.
  * Prevents clean clones from failing on missing `dist-electron/host-entry.js`.
* Added self-contained Milestone E packaged-app prerequisites.

  * `npm run test:milestone-e` builds the packaged app first.
  * Prevents clean clones from failing on missing `dist/win-unpacked/Solith.exe`.

Known note:

* Remote-tag `v1.0.1` verification passed all gates, but final status showed parser fixture line-ending noise.
* No content diff existed.
* This was corrected in `v1.0.2`.

### v1.0.2 - Line-Ending Hygiene Patch

`v1.0.2` is the current pushed release baseline.

Fixes included:

* Added `.gitattributes`.
* Stabilized parser fixture line endings.
* Prevented fresh-clone verification from ending with phantom modified parser fixture files.
* Preserved existing app behavior.
* Preserved parser logic.
* Preserved test expectations.

Final state:

* Accepted.
* Tagged locally.
* Pushed.
* Remote verified.
* Clean baseline for V1.1.

## V1.1 Status

V1.1 is focused on safe save-format expansion and compatibility pilot readiness.

V1.1 must remain:

* Local-only.
* Offline-first.
* Single-player only.
* Save/data-file focused.
* Backup/rollback protected.
* Explicitly guarded against unsafe trainer behavior.

V1.1 must not add:

* Online game cheating.
* Multiplayer manipulation.
* Anti-cheat bypass.
* Process injection.
* Live memory writing.
* Memory scanning.
* Debugger attachment.
* Unsafe shipped profile placeholders.
* New executable game controls unless separately scoped and verified.

## V1.1 Bite 1 - Save Format Capability Layer

Status: **Accepted locally and fresh local-clone verified**

Commit:

`da5c67f819c0cf81ccb97f88d9878af58e1009b8`

Bite 1 added:

* Save-format capability/error model.
* Explicit `UnsupportedSaveFormatError`.
* Unsupported-format guards in TrainerHost save-field read/write paths.
* Focused save-format tests.
* TrainerHost unsupported-format rejection tests.
* `package.json` test coverage updates.

Verification passed:

* `npx tsc --noEmit`: PASS
* `npm run test:game-profile`: PASS, 33/33
* `npm run test:trainer-schema`: PASS, 35/35
* `npm run test:trainer-host`: PASS, 66/66
* `npm run test:milestone-e`: PASS, 15/15
* `npm run test:milestone-j`: PASS, 5/5
* `npm test`: PASS, 373/373

Fresh local-clone verification also passed.

Behavior preserved:

* Existing Stardew XML controls unchanged.
* Existing XML read/write/rollback behavior unchanged.
* No JSON or INI write expansion added.

## V1.1 Bite 2 - JSON Read-Only Save-Field Support

Status: **Accepted locally and fresh local-clone verified**

Commit:

`5f6d1ad590ece1cf38eeb19b158488372d348fc2`

Bite 2 added:

* JSON read-only save-field support.
* Simple dot-path JSON field reads.
* JSON proposal validation/preview.
* Malformed JSON handling.
* Missing JSON field handling.
* Oversized JSON safety coverage.
* JSON write execution rejection through `UnsupportedSaveFormatError`.

Scope boundaries preserved:

* JSON writes are still not allowed.
* JSON execution/mutation is still rejected.
* Existing XML/Stardew read/write/rollback behavior remains unchanged.
* No new shipped game controls were added.
* No INI support was added yet.
* No memory writing or process scanning was added.

Verification passed:

* `npx tsc --noEmit`: PASS
* `npm run test:game-profile`: PASS, 33/33
* `npm run test:trainer-schema`: PASS, 35/35
* `npm run test:trainer-host`: PASS, 73/73
* `npm run test:milestone-e`: PASS, 15/15
* `npm run test:milestone-j`: PASS, 5/5
* `npm test`: PASS, 381/381

Fresh local-clone verification also passed:

* `npm ci`: PASS
* `npx tsc --noEmit`: PASS
* `npm run test:game-profile`: PASS, 33/33
* `npm run test:trainer-schema`: PASS, 35/35
* `npm run test:trainer-host`: PASS, 73/73
* `npm run test:milestone-e`: PASS, 15/15
* `npm run test:milestone-j`: PASS, 5/5
* `npm test`: PASS, 381/381
* Final clone status: clean

## Next Bite - V1.1 Bite 3

Recommended next scope:

**JSON write proposal hardening only**

Bite 3 must not add actual JSON write execution.

Goals:

* Strengthen JSON proposed-edit previews.
* Validate proposed JSON edits without mutating files.
* Confirm current value before previewing a change.
* Preserve type compatibility where possible.
* Reject unsafe type changes unless explicitly allowed.
* Reject unsupported paths clearly.
* Keep JSON write execution blocked.
* Keep XML write execution unchanged.

Allowed:

* Proposal preview logic.
* Validation-only JSON edit model.
* Type-safety checks.
* Better user-safe error messages.
* Tests for rejected proposal cases.

Not allowed:

* Actual JSON file mutation.
* JSON rollback workflow.
* New shipped JSON game profiles.
* New executable controls.
* INI support.
* Array mutation.
* JSONPath support.
* Automatic profile inference.

Bite 3 acceptance should require:

* JSON proposal validation tests.
* JSON write execution rejection tests.
* Existing JSON read-only tests.
* Existing XML/Stardew tests.
* TrainerHost tests.
* Milestone E/J tests.
* Full `npm test`.
* Fresh local-clone verification after commit.

## V1.1 Future Bite Plan

### Bite 3 - JSON Write Proposal Hardening

Status: pending

Purpose:

Make JSON proposed-edit previews safer before any future write support is considered.

Scope:

* Validate proposed value type.
* Validate simple object dot paths.
* Reject arrays unless explicitly supported later.
* Reject missing parent objects.
* Reject unsupported write execution.
* Keep preview-only semantics.

### Bite 4 - XML Hardening Review

Status: pending

Purpose:

Strengthen XML safety without changing accepted Stardew behavior.

Scope:

* Review hostile XML handling.
* Preserve existing Stardew field paths.
* Preserve write/rollback behavior.
* Add missing malformed XML tests if gaps exist.
* Ensure XML errors are user-safe.

Non-goals:

* No profile expansion.
* No new controls.
* No behavior drift in accepted Stardew controls.

### Bite 5 - INI/Config Read-Only Support

Status: pending

Purpose:

Add conservative read-only support for simple INI/config save files.

Scope:

* Flat section/key reads.
* User-safe malformed INI errors.
* Unsupported ambiguous formats rejected.
* Proposal preview only if safe.

Non-goals:

* No INI write execution.
* No nested or custom parser magic.
* No shipped game profile expansion.

### Bite 6 - Runtime Save-Location Binding

Status: pending

Purpose:

Bind runtime save locations through approved local paths only.

Scope:

* Validate resolved paths.
* Require approved game root or registered save path.
* Reject traversal.
* Reject developer-machine absolute paths in shipped profiles.
* Keep backup/rollback ownership intact.

### Bite 7 - Profile Authoring Safety

Status: pending

Purpose:

Make profile creation safer and more deterministic.

Scope:

* Profile validation UI or CLI helper.
* Format declaration checks.
* Fixture-backed profile validation.
* Reject unsupported executable controls.
* Reject placeholder/future controls.
* Reject unsafe paths.

### Bite 8 - Compatibility Pilot Readiness

Status: pending

Purpose:

Prepare pilot validation for real offline single-player games without shipping unsafe controls.

Scope:

* Pilot report format.
* Fixture capture process.
* Read-only compatibility checks.
* Manual approval checklist.
* No executable controls enabled by default.

## Compatibility Pilot

The compatibility pilot should only begin after V1.1 safety infrastructure is stable.

Pilot rules:

* Offline games only.
* Single-player games only.
* Save/data-file workflows only.
* No process memory manipulation.
* No anti-cheat interaction.
* No online-mode support.
* No default executable controls for unverified games.
* Backup/rollback required before any future write path.
* Every profile must have test coverage before being treated as supported.

Suggested pilot order:

1. Demo game fixture.
2. Stardew Valley existing XML save profile.
3. One simple JSON-save game.
4. One simple XML-save game.
5. One simple INI/config-style game.

## V1.3 Compatibility Pilot Process

V1.3 makes Solith safer for limited compatibility pilots without enabling new executable game controls by default.

V1.3 scope:

* Fixture-backed profile authoring validation.
* Read-only JSON/INI/XML compatibility reporting.
* Pilot readiness reports for offline single-player candidate games.
* Manual review workflow before any profile is treated as supported.
* Documentation of blocked operations and required manual checks.

V1.3 does not add:

* Online or multiplayer support.
* Memory writing, memory scanning, process injection, debugger attachment, or anti-cheat interaction.
* Automatic writes for candidate pilot games.
* Shipped executable controls for unverified pilots.
* Fake disabled or future controls in shipped profiles.

Compatibility pilot workflow:

1. Gather a safe sample or fixture from a user-owned offline single-player game.
2. Classify the save/config format and reject unsupported or ambiguous formats.
3. Run read-only validation against the fixture and profile declaration.
4. Generate a pilot report with sample evidence, format support, cloud-sync risk, supported operations, blocked operations, and required manual checks.
5. Manually approve any proposed profile only after fixture-backed validation passes.
6. Consider write support only in a separate scoped bite with explicit approval, backup/rollback verification, and fresh-clone evidence.

Pilot reports must keep executable controls disabled until separately accepted. A report alone cannot enable writes, rollback execution, runtime patching, or new shipped controls.

## Fresh Clone Verification Policy

Every accepted bite that changes source, tests, package scripts, or build behavior should receive fresh local-clone verification before the next bite begins.

Every release candidate must pass from a fresh clone with no prior `node_modules`, `dist`, or `dist-electron` artifacts.

Standard gate order:

1. `npm ci`
2. `npx tsc --noEmit`
3. `npm run test:game-profile`
4. `npm run test:trainer-schema`
5. `npm run test:trainer-host`
6. `npm run test:milestone-e`
7. `npm run test:milestone-j`
8. `npm test`
9. `npm run build:electron`
10. `npm run build`
11. `node scripts/verify-electron-output.mjs`
12. `node scripts/validate-packaged-host.mjs`
13. `node scripts/orphan-check.mjs`
14. `git status --short`
15. `git diff --quiet`

A release candidate is not cleanly reproducible unless both the gate commands pass and the final working tree is clean.

## Release Gate Policy

Every milestone must preserve:

* TypeScript correctness.
* Existing profile tests.
* Existing trainer schema tests.
* Existing trainer-host tests.
* Milestone E acceptance.
* Milestone J acceptance.
* Full test suite.
* Electron build.
* Packaged build.
* Packaged host validation.
* Orphan process check.
* Fresh clone clean-tree check.

No roadmap item is complete unless verified by live commands.

## Files Likely Affected During V1.1

Likely source areas:

* `src/core/saves/*`
* `src/core/trainer-host/*`
* `src/core/game-profiles/*`
* `src/core/trainer-control-schema/*`
* `electron/ipc-validation.ts`, only if runtime binding requires IPC validation changes
* `electron/main.ts`, only if runtime binding requires IPC changes
* `src/types/global.d.ts`, only if exposed APIs change

Likely test areas:

* `tests/save-format.test.ts`
* `tests/parsers.test.ts`
* `tests/trainer-host/read-save-field.test.ts`
* `tests/trainer-host/write-save-field.test.ts`
* `tests/game-profile.test.ts`
* `tests/trainer-control-schema.test.ts`
* New focused tests for JSON/XML/INI behavior if needed

Package files:

* `package.json` only if test scripts need explicit inclusion.
* `package-lock.json` should not change unless dependencies are intentionally added.

## Must Remain Unchanged Unless Explicitly Scoped

The following must not be altered casually:

* Existing Stardew accepted controls.
* Existing Stardew field paths.
* Existing XML write/rollback path.
* `v1.0.0`, `v1.0.1`, and `v1.0.2` tags.
* Local-only/offline/single-player safety model.
* No-memory-write V1 policy.
* No online/multiplayer policy.
* No anti-cheat interaction policy.

## Explicit Non-Goals

Solith should not support:

* Online game cheating.
* Multiplayer manipulation.
* Anti-cheat bypass.
* Process injection.
* Live memory writing in V1.
* Memory scanning in V1.
* Debugger attachment.
* Hidden cloud dependency.
* Unsafe arbitrary file patching.
* Fake disabled/future controls in shipped profiles.
* Release gates that depend on stale local build artifacts.

## V2 Direction

Only after V1 is stable:

* Broader profile library.
* Community profile format.
* Local-only profile import/export.
* Richer discovery workflows.
* Optional local AI assistance for explaining save fields.
* More advanced trainer workflows only if safety boundaries remain enforceable.

V2 must still exclude online-game cheating, multiplayer manipulation, anti-cheat bypass, and unsafe memory editing.
