# ResourceForge Roadmap

## Current Baseline

ResourceForge's current pushed release baseline is **v1.0.1**.

* Current pushed baseline: `v1.0.1`
* `v1.0.1` tag object: `7c71dd68421c869c5ec19cb3224c65521ba0f0e3`
* `v1.0.1` peeled commit: `6e340c765e21396f8936f6c493824a08c3b23b9f`
* Remote `master` target after v1.0.1: `6e340c765e21396f8936f6c493824a08c3b23b9f`
* Status: accepted, tagged locally, and pushed.

`v1.0.0` remains unchanged, but it is superseded by `v1.0.1` for fresh-clone reproducibility.

A local **v1.0.2 hygiene candidate** has also been prepared, but it is not tagged or pushed yet.

* Prepared candidate: `v1.0.2`
* Candidate commit: `e0539a14163fb25b4ef045c6001b5273fcc72f9b`
* Status: local candidate only; not tagged, not pushed.

## v1.0.1 Patch Release — Fresh Clone Reproducibility

`v1.0.1` corrected fresh-clone reproducibility problems found after the original `v1.0.0` release lock.

Fixes included:

* Ignored `.junie/` assistant metadata through `.gitignore`.
* Added a self-contained trainer-host test prerequisite.

  * `npm run test:trainer-host` now builds required Electron host output first.
  * This prevents clean clones from failing on missing `dist-electron/host-entry.js`.
* Added a self-contained Milestone E packaged-app prerequisite.

  * `npm run test:milestone-e` now builds the packaged app first.
  * This prevents clean clones from failing on missing `dist/win-unpacked/ResourceForge.exe`.
* Fresh clone verification no longer depends on stale local `dist/` or `dist-electron/` artifacts.

## Verified v1.0.1 Gate Results

Final v1.0.1 verification passed:

* `npm ci`: PASS
* `npx tsc --noEmit`: PASS
* `npm run test:game-profile`: PASS, 33/33
* `npm run test:trainer-schema`: PASS, 35/35
* `npm run test:trainer-host`: PASS, Electron output 19/19, tests 64/64
* `npm run test:milestone-e`: PASS, packaged build ran first, 15/15
* `npm run test:milestone-j`: PASS, 5/5

Remote-tag v1.0.1 verification also passed the full gate:

* `npm ci`: PASS
* `npx tsc --noEmit`: PASS
* `npm run test:game-profile`: PASS, 33/33
* `npm run test:trainer-schema`: PASS, 35/35
* `npm run test:trainer-host`: PASS, Electron output 19/19, tests 64/64
* `npm run test:milestone-e`: PASS, packaged build ran first, 15/15
* `npm run test:milestone-j`: PASS, 5/5
* `npm test`: PASS, 365/365
* `npm run build:electron`: PASS, Electron output 19/19
* `npm run build`: PASS
* `node scripts/verify-electron-output.mjs`: PASS, 19/19
* `node scripts/validate-packaged-host.mjs`: PASS, 23/23
* `node scripts/orphan-check.mjs`: PASS

Known v1.0.1 verification note:

* The remote-tag v1.0.1 verification passed all gates, but final `git status --short` showed parser fixture files modified.
* `git diff --quiet` returned `0`.
* No content diff was found.
* The issue appeared to be line-ending / CRLF normalization noise.

## v1.0.2 Candidate — Line-Ending Hygiene

A local `v1.0.2` hygiene candidate has been prepared to fix the v1.0.1 line-ending noise.

Candidate commit:

`e0539a14163fb25b4ef045c6001b5273fcc72f9b`

Fix:

* Adds `.gitattributes`.
* Stabilizes parser fixture line endings.
* Prevents fresh clone verification from ending with phantom modified parser fixture files.
* Does not change app behavior.
* Does not change parser logic.
* Does not change test expectations.

Fresh local-clone verification path:

`G:\RESOURCEFORGE_LINE_ENDING_VERIFY`

Verification results for the candidate:

* `npm ci`: PASS
* `npx tsc --noEmit`: PASS
* `npm run test:game-profile`: PASS, 33/33
* `npm run test:trainer-schema`: PASS, 35/35
* `npm run test:trainer-host`: PASS, Electron output 19/19, tests 64/64
* `npm run test:milestone-e`: PASS, packaged build ran first, 15/15
* `npm run test:milestone-j`: PASS, 5/5
* Final fresh-clone `git status --short`: clean
* Final `git diff --quiet`: returned `0`

Status:

* `v1.0.2` is not tagged.
* `v1.0.2` is not pushed.
* It is suitable for a hygiene tag after explicit tag/push authorization.

## Next Required Step Before V1.1

Preferred path:

1. Explicitly authorize `v1.0.2` tag and push.
2. Tag `v1.0.2` from commit `e0539a14163fb25b4ef045c6001b5273fcc72f9b`.
3. Push branch and tag.
4. Run remote-tag fresh clone verification against `v1.0.2`.
5. Begin V1.1 planning only after remote-tag verification passes.

Acceptable hold path:

* Keep `v1.0.1` as the current pushed baseline.
* Accept that v1.0.1 passed all gates but may show line-ending noise in fresh clones.
* Start V1.1 from `v1.0.1` only with awareness of that hygiene limitation.

No V1.1 feature work should begin from `v1.0.0`.

## V1.1 Entry Criteria

V1.1 should start from a clean release baseline.

Preferred:

* Start from `v1.0.2` after it is tagged, pushed, and remote-tag verified.

Fallback:

* Start from `v1.0.1` only if the team chooses to hold the v1.0.2 hygiene patch.

Mandatory entry criteria:

* Preserve local-only, offline, single-player scope.
* Do not reintroduce memory-write controls.
* Do not reintroduce unsafe shipped profile placeholders.
* Do not reintroduce developer-machine absolute paths.
* Do not reintroduce online-game or multiplayer manipulation paths.
* Keep fresh-clone reproducibility intact.
* Any milestone test requiring build artifacts must build them through explicit npm script prerequisites.
* Any generated local assistant/IDE metadata must be ignored or excluded from commits.
* Any fixture files must remain line-ending stable after clone, test, and build runs.

## Fresh Clone Verification Policy

Every release candidate must pass from a fresh clone with no prior `node_modules`, `dist`, or `dist-electron` artifacts.

Required gate order:

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

## Compatibility Pilot

Goal:

Test ResourceForge against a small set of real offline/single-player games without expanding unsafe scope.

Pilot rules:

* Save-file/data-file only.
* No online games.
* No multiplayer games.
* No process memory manipulation.
* No anti-cheat bypass.
* No unsupported binary patching.
* Backup and rollback required before every write.
* Every profile must have test coverage before being treated as supported.

Suggested pilot order:

1. Demo game fixture.
2. Stardew Valley save-field profile.
3. One simple JSON-save game.
4. One simple XML-save game.
5. One simple INI/config-style game.

## V1.1 — Save Format Expansion

Add support for more local save/data formats:

* JSON
* XML
* INI
* simple text configs
* clearly detected binary metadata only
* parser adapters with file-size guards
* clear unsupported-format errors

Do not add blind binary editing unless safety, backup, validation, and rollback are proven.

Required gates:

* Parser unit tests.
* Oversized file rejection tests.
* Unsupported-format tests.
* Backup/rollback tests.
* Fresh clone verification.

## V1.2 — Discovery Lab Hardening

Improve:

* File comparison accuracy.
* False-positive filtering.
* Deterministic hash proof.
* Large-file handling.
* Binary-safe comparison.
* Confidence scoring.
* Explainable discovery results.
* Safer "suggest edit" output.

Discovery must remain advisory until a safe write path exists.

## V1.3 — Profile Authoring

Add tools for creating safe game profiles:

* Profile validation UI.
* Safe path selector.
* Runtime save-location binding.
* Preview before write.
* Dry-run mode.
* Fixture generator.
* Profile test generator.

Profiles must reject:

* Developer-machine absolute paths.
* `C:\Users\...`
* `memory_write` controls.
* Online/multiplayer cheat-style controls.
* Unsupported future controls in shipped executable profiles.

## V1.4 — UX / Reliability

Improve:

* Clearer demo vs real game labeling.
* Better backup/rollback visibility.
* Clearer edit risk labels.
* Destructive action confirmation.
* First-run safety tutorial.
* Packaged app smoke checks.
* Better failure messages without leaking full filesystem paths.

## V1.5 — Packaging / Distribution

Tasks:

* Reproducible release build.
* Signed installer if applicable.
* Windows fresh-machine smoke test.
* Clean uninstall behavior.
* Release notes.
* Checksum generation.
* Rollback support verified in packaged app.

## V2 — Advanced Trainer Ecosystem

Only after V1 is stable:

* Broader game profile library.
* Community profile format.
* Local-only profile import/export.
* Richer discovery workflows.
* Optional local AI assistance for explaining save fields.

V2 must still exclude online-game cheating and multiplayer manipulation.

## Explicit Non-Goals

ResourceForge should not support:

* Online game cheating.
* Multiplayer manipulation.
* Anti-cheat bypass.
* Process injection.
* Live memory writing in V1.
* Hidden cloud dependency.
* Unsafe arbitrary file patching.
* Fake disabled/future controls in shipped profiles.
* Release gates that depend on stale local build artifacts.

## Release Gate Policy

Every milestone must pass:

* TypeScript.
* Profile tests.
* Trainer schema tests.
* Trainer host tests.
* Milestone acceptance tests.
* Full test suite.
* Electron build.
* Renderer/package build.
* Packaged host validation.
* Orphan process check.
* Fresh clone final clean-tree check.

No roadmap item is complete unless verified by live commands.
