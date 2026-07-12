# Solith / ResourceForge Roadmap

## Current Baseline (Solith 2.0+)

Product UI: **Solith** · package `resourceforge@2.0.0`

* Branch: `master`
* Latest milestone work: **M–Q** (live trainer parity, schema.v1 definitions, catalog routing, hotkeys)
* Post-2.0 offline pinnacle batch: CT import, drift quarantine, community feedback/promotion, pointer-scan UI, catalog export

### Accepted capability stack

```
schema.v1.yml → compile → SQLite payloadJson
         ↑ export                    ↓ lazy load
   Discovery Lab              Trainer Library
                                    ├─ memoryFeatures → LiveMemorySession
                                    └─ saveEditor.saveFields → TrainerHost (catalog save controls)
```

### Milestone map (recent)

| Milestone | Theme | Status |
|-----------|--------|--------|
| **M** | Live trainer parity — overlay, hotkeys, memory_write unlock | Accepted |
| **N** | Trainer Library — 1000+ metadata seed, remote sync, Steam art | Accepted |
| **O.1** | schema.v1 guard, fingerprint, AOB resolver | Accepted |
| **O.2** | YAML export + Solith module branding | Accepted |
| **O.3** | YAML compiler + catalog import | Accepted |
| **O+** | Catalog → live memory wiring | Accepted |
| **P** | Save-field execution router from catalog | Accepted |
| **Q** | F1–F12 cheat hotkeys, hybrid launch chooser, drift modal | Accepted |
| **R–W (offline)** | Brand neutrality, CT import, quarantine, feedback, pointer scan UI | In progress on `master` |

### Bundled schema.v1 definitions

All seven curated games (`games.ts`) ship as `schema.v1` payloads via `bundled-definition-seed.ts`:
Stardew Valley (save-field controls) plus six live-memory titles (pinned cheats as `scan_unknown` features).

### Next suggested work

See **`Docs/Plans/SOLITH_PINNACLE_MASTER_PLAN.md`** for the full R→Z roadmap (offline-first section at top).

**Requires live game sessions (do not fake):**

1. Measure connection baselines for Avowed, Dredge, Crimson Desert (KI-017)
2. Restart verifier + pointer registry (15 cheats, then scale)
3. L3 certification runs on bundled cheats with in-game evidence

**Can continue offline:**

- Catalog seed executable enrichment (`scripts/generate-trainer-catalog-seed.mjs`)
- Community pack export/import polish
- Binary save profile research (architecture in place)

---

## Historical: v1.0.2 baseline

ResourceForge v1.0.2 remains the prior save-editor / Stardew-controls release baseline.

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

`G:\RESOURCEFORGE_V11_BITE2_VERIFY`

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
  * Prevents clean clones from failing on missing `dist/win-unpacked/ResourceForge.exe`.

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

V1.3 makes ResourceForge safer for limited compatibility pilots without enabling new executable game controls by default.

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

ResourceForge should not support:

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
