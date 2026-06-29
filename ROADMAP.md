# ResourceForge Roadmap

## Current Baseline

ResourceForge is a local-only, offline-only, single-player focused trainer/save-editor application.

Current baseline: `v1.0.1`.

Remote `master` points to commit `6e340c765e21396f8936f6c493824a08c3b23b9f`.

Remote `v1.0.1` tag object: `7c71dd68421c869c5ec19cb3224c65521ba0f0e3`.

Remote `v1.0.1` peeled commit: `6e340c765e21396f8936f6c493824a08c3b23b9f`.

`v1.0.1` is accepted, tagged, and pushed. `v1.0.0` remains unchanged, but it is superseded by `v1.0.1` for fresh-clone reproducibility. Do not erase the `v1.0.0` history; future work should treat `v1.0.1` as the corrected reproducible release baseline.

## v1.0.1 Patch Release - Fresh Clone Reproducibility

The `v1.0.1` patch release fixes release reproducibility from a clean clone.

- `.junie/` assistant metadata is ignored through `.gitignore`; `.junie/` contents were not committed.
- Cleanup commit: `6e340c765e21396f8936f6c493824a08c3b23b9f`.
- `npm run test:trainer-host` now builds required Electron host output first.
- This prevents clean clones from failing on missing `dist-electron/host-entry.js`.
- `npm run test:milestone-e` now builds the packaged app first.
- This prevents clean clones from failing on missing `dist/win-unpacked/ResourceForge.exe`.
- Fresh-clone gates now build required artifacts instead of relying on stale local `dist` or `dist-electron` output.

## Verified v1.0.1 Gate Results

- `npm ci`: PASS
- `npx tsc --noEmit`: PASS
- `npm run test:game-profile`: PASS, 33/33
- `npm run test:trainer-schema`: PASS, 35/35
- `npm run test:trainer-host`: PASS, Electron output 19/19, tests 64/64
- `npm run test:milestone-e`: PASS, packaged build ran first, 15/15
- `npm run test:milestone-j`: PASS, 5/5

## Next Required Step Before V1.1

- Optional final confirmation: clone from remote `v1.0.1` tag and run the full release gate.
- If that passes, V1.1 planning may begin from `v1.0.1`.
- No V1.1 feature work should begin from `v1.0.0`.

## V1.1 Entry Criteria

- Must start from clean `v1.0.1`.
- Must preserve local-only, offline-only, single-player scope.
- Must not reintroduce memory-write controls.
- Must not reintroduce unsafe shipped profile placeholders.
- Must keep fresh-clone reproducibility intact.
- Any new milestone test that needs build artifacts must build them through explicit npm script prerequisites.

## Compatibility Pilot

Goal: test ResourceForge against a small number of real offline/single-player games without expanding unsafe scope.

Pilot rules:

- Save-file/data-file only.
- No online games.
- No multiplayer games.
- No process memory manipulation.
- No unsupported binary patching.
- Backup and rollback required before every write.

Suggested pilot order:

1. Demo game fixture.
2. Stardew Valley save-field profile.
3. One simple JSON-save game.
4. One simple XML-save game.
5. One simple INI/config-style game.

## V1.1 - Save Format Expansion

Add support for more local save/data formats:

- JSON
- XML
- INI
- simple text configs
- clearly detected binary metadata only
- parser adapters with file-size guards
- clear unsupported-format errors

Do not add blind binary editing unless safety, backup, validation, and rollback are proven.

## V1.2 - Discovery Lab Hardening

Improve:

- file comparison accuracy
- false-positive filtering
- deterministic hash proof
- large-file handling
- binary-safe comparison
- confidence scoring
- explainable discovery results
- safer "suggest edit" output

Discovery must remain advisory until a safe write path exists.

## V1.3 - Profile Authoring

Add tools for creating safe game profiles:

- profile validation UI
- safe path selector
- runtime save-location binding
- preview before write
- dry-run mode
- fixture generator
- profile test generator

Profiles must reject:

- developer-machine absolute paths
- `C:\Users\...`
- memory-write controls
- online/multiplayer cheat-style controls
- unsupported future controls in shipped executable profiles

## V1.4 - UX / Reliability

Improve:

- clearer demo vs real game labeling
- better backup/rollback visibility
- clearer edit risk labels
- destructive action confirmation
- first-run safety tutorial
- packaged app smoke checks
- better failure messages without leaking full filesystem paths

## V1.5 - Packaging / Distribution

- reproducible release build
- signed installer if applicable
- Windows fresh-machine smoke test
- clean uninstall behavior
- release notes
- checksum generation
- rollback support verified in packaged app

## V2 - Advanced Trainer Ecosystem

Only after V1 is stable:

- broader game profile library
- community profile format
- local-only profile import/export
- richer discovery workflows
- optional local AI assistance for explaining save fields
- never enable online-game cheating or multiplayer manipulation

## Explicit Non-Goals

ResourceForge should not support:

- online game cheating
- multiplayer manipulation
- anti-cheat bypass
- process injection
- live memory writing in V1
- hidden cloud dependency
- unsafe arbitrary file patching

## Release Gate Policy

Every milestone must pass:

- TypeScript
- profile tests
- trainer schema tests
- trainer host tests
- milestone acceptance tests
- full test suite
- Electron build
- renderer build
- packaged host validation
- orphan process check

No roadmap item is complete unless verified by live commands.
