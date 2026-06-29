# ResourceForge Roadmap

## Current Status

ResourceForge is a local-only, offline-only, single-player focused trainer/save-editor application.

The Phase 9 full code/test/build gate passed live at HEAD `6d4b806724baa3ddb2d1c10eb03fca7dc93fdce2`. This means the code/test/build gate is accepted for that commit.

Documentation, release tag creation, push, and public release publication may still be pending unless separately completed and verified. Do not treat this roadmap as evidence that a tag, push, merge, or public release has happened.

## V1.0 Release Lock

- Complete Phase 10 documentation honesty pass.
- Ensure docs match live Phase 9 evidence.
- Commit docs.
- Create release tag only after docs are accurate.
- Optional: push tag only after local release lock is verified.

## Fresh Clone Verification

- Clone repo fresh.
- Run `npm ci`.
- Run the full release gate from scratch.
- Verify packaged app starts without dev server.
- Verify no local-only developer paths are required.

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
