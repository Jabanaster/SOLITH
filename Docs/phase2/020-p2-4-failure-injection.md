# Phase 2 P2-4 — Failure Injection (mission §25)

## Covered, deterministic

| Scenario | Test | Result |
|---|---|---|
| Module missing | `pointer-stability.test.ts` | `module_missing`, never silently treated as broken/stale |
| Chain broken (intermediate dereference fails) | `pointer-stability.test.ts` | `chain_broken`, distinct from a final-read failure |
| Read failure (chain resolves, ground-truth read fails) | `pointer-stability.test.ts` | `read_failed`, distinct from `chain_broken` |
| Process exits mid-validation | `pointer-stability.test.ts` | `process_exited`, never silently stable |
| Target semantic mismatch (readable but wrong value) | `pointer-stability.test.ts` | `false_positive`, never a safe/correct classification |
| A chain that breaks after a prior success | `pointer-stability-orchestration.test.ts` | The break is recorded truthfully; the earlier success is never retroactively rewritten |
| Corrupt stability history on disk | `pointer-map-store.test.ts` (new) | `loadPointerMap` rejects it as `corrupt` rather than letting malformed data crash later summary/UI code — a real gap found and fixed this stage: `isWellFormedPointerMap` did not previously validate the `stability` field's shape at all |
| Unsupported (newer) persistence schema version | `pointer-map-store.test.ts` | Rejected as `unsupported_schema_version`; a real *older* version (1) is migrated forward, not rejected — see `Docs/phase2/019` |
| Real process exits during the 10-restart campaign's own kill/relaunch cycle | `pointer-stability-real-process.test.ts` | Every restart's fixture is genuinely killed and a fresh one spawned; the campaign's own save/load path is the real recovery mechanism |

## Deliberately not built: cancel validation

`pointerMapValidateNodeAfterRestart` is a single `resolvePointerPath` call plus one bounded memory read — not a scan. Following the exact precedent P2-3.1 already established for a fast, non-long-running operation (`Docs/phase2/006` §6's "no fake Cancel button" decision, reused here rather than re-litigated): there is no meaningful in-flight window for a user to interrupt, so no cancellation UI was added. Adding one would be cosmetic, not real — the same anti-pattern the earlier decision was written to avoid.

## Not covered: real-game-specific scenarios

"Game does not restart," "wrong executable selected," "different architecture" are real-game campaign scenarios. Since the real-game restart campaign itself was not completed this stage (`Docs/phase2/018`), these specific injected-failure cases against a real title were not exercised. The identity-mismatch class of failure they represent is exercised structurally at the fixture level already: `pointer-map-real-process.test.ts` (P2-2) proves a save/load cycle correctly ties a map to `executableIdentity`, and `pointerMapLoad` never blindly trusts a stale PID (every restart in the 10-restart campaign uses a genuinely different real PID, proving the module-relative resolution never depends on the old one).
