# Phase 2 P2-2 — Verification Report

**This is a stage report, not a Phase 2 certification.** Mission §19 is explicit: "Do NOT call Phase 2 certified. This is P2-2 only." Phase 2 as a whole has 26 more items of scope (structure discovery, typed views, the adaptive planner, Zydis/Vectorscan/DynamoRIO/ImGui adoption, real-game freeze/write exercise, restart-stability campaign) untouched by this stage.

## §19 exit gate, checked item by item

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | P2-1 model used directly | MET | `pointer-map-orchestration.ts` imports and calls `addPointerMapNode`/`pointerMapNodeFromCandidate` from P2-1, does not reimplement |
| 2 | One production pointer-map service exists | MET | `LiveMemorySession` — the same object `pointerScan`/`resolveControl`/`scanAobSignature` already live on, doc 002 |
| 3 | Multiple targets supported | MET | `scanTargetsIntoMap([...])`, real-process-proven with 2 independent targets (doc 003) |
| 4 | Pointer candidates populate real map nodes | MET | doc 003 tests 1–2 |
| 5 | Completeness retained per target | MET | `PointerMapTargetOutcome` per target — `requestedDepth`/`deepestLevelCompleted`/`termination`/`completeness`/`candidateCount`/`nodesAdded`/`truncated`, all from the real `PointerScanResult` |
| 6 | Aggregate completeness truthful | MET | `aggregatePointerMapCompleteness` — worst-of across targets, unit-tested to never report `complete` when any input is not (`pointer-map-orchestration.test.ts`) |
| 7 | Cancellation supported | MET | between-target abort tested (`pointer-map-orchestration.test.ts` — unreached targets reported `cancelled` with zero candidates, distinct from scanned-and-empty) |
| 8 | Resource bounds enforced | MET | `MAX_TARGETS_PER_SCAN`/`MAX_NODES_PER_TARGET`/`MAX_NODES_PER_MAP`, each with a test that actually exceeds the bound and confirms `resourceLimited: true` plus the map/response staying within it |
| 9 | Process exit truthful | MET | `process_exited` node status (P2-1) + `getModules`-throw path exercised in `live-memory-session-pointer-map.test.ts` ("process exit between scan and resolve") |
| 10 | Stale target safe | MET | a reloaded map is forced `unresolved`/`lastResolvedAddress: null` (`pointer-map-store.ts`'s `toInactiveOnLoad`), proven in both the in-memory store test and the real-process restart test |
| 11 | Persistence versioned | MET | `schemaVersion` column + `POINTER_MAP_SCHEMA_VERSION`; unsupported-future-version rejection tested |
| 12 | Reload is inactive/not automatically trusted | MET | same as #10 |
| 13 | IPC implemented | MET | 13 handlers, doc 004 |
| 14 | Preload contract implemented | MET | doc 004 |
| 15 | BigInt-safe | MET | every address on the wire is a `"0x..."` string (schemas + serializers + DTOs), matching the existing `liveMemoryPointerScan` convention |
| 16 | Real-process two-target fixture PASS | MET | doc 003 — 3/3 in isolation; one transient attach-timeout flake encountered and diagnosed as pre-existing environmental flakiness, not a new defect (doc 003) |
| 17 | Persistence tests PASS | MET | `pointer-map-store.test.ts`, 8/8 |
| 18 | Full live-memory regression PASS | MET | 522/522 (see run below) |
| 19 | Root regression PASS | MET | 2033/2033 (`npm test`, both chained groups) — see "A real defect found and fixed" below |
| 20 | Typechecks PASS | MET | root (`tsconfig.json`) and electron (`tsconfig.electron.json`) both clean |
| 21 | No ROADMAP changes | MET | `ROADMAP.md` untouched this stage |
| 22 | Preservation tree untouched | MET | `G:\ACTIVE_PROJECTS\SOLITH` not touched by this worktree |

## Test count summary

| Suite | New this stage | Result |
|---|---|---|
| `pointer-map.test.ts` (P2-1, extended) | 10 | 10/10 |
| `pointer-map-orchestration.test.ts` | 7 | 7/7 |
| `pointer-map-store.test.ts` | 8 | 8/8 |
| `live-memory-session-pointer-map.test.ts` | 7 | 7/7 |
| `pointer-map-real-process.test.ts` | 3 | 3/3 (isolated run) |
| **Full `test:live-memory`** | — | **522/522**, 0 fail, 0 cancelled |
| **Full `npm test` (root)** | — | **2033/2033** (2023 + 10 chained), 0 fail, 0 cancelled |

## A real defect found and fixed: the root `npm test` script broke outright

Registering the 5 new pointer-map test files pushed the `test` npm script's command-line length from 8029 to 8272 characters. Windows' `cmd.exe` (which `npm run` shells out through) caps a single command line at roughly 8191 characters, so `npm test` started failing immediately with `The command line is too long` — not a test failure, a complete inability to run the suite at all. `test:live-memory` (2882 characters) was nowhere near the cap and ran fine, which is why this was not caught until the root suite was run for this stage's own regression check.

This was already a latent, near-the-edge fragility (the script was at 8029/~8191 before this stage touched it at all — any future contributor adding even one more test file to the root suite would have hit the same wall), not something P2-2 introduced by being careless; it is fixed properly rather than patched around:

[`scripts/run-node-tests.mjs`](../../scripts/run-node-tests.mjs) spawns `node` directly against `tsx`'s real entry point (`node_modules/tsx/dist/cli.mjs`) via `child_process.spawnSync` with `shell:false` and an argv array, instead of npm handing a giant single string to `cmd.exe`. This goes through Windows' `CreateProcess` directly, whose limit (~32767 characters) is far above anything this suite will reasonably reach. The file lists inside the wrapper were extracted **programmatically** from the previous inline npm script strings (not hand-transcribed), specifically to avoid introducing a silent drop of a test file during the move. `package.json`'s `test` and `test:live-memory` scripts now just call `node scripts/run-node-tests.mjs <group>`; the two-group `&&`-chain the old `test` script had (main suite, then `tests/sql-parameter-binding.test.ts` in its own process) is preserved exactly, not merged away.

Verified: `node --check scripts/run-node-tests.mjs` (syntax), then a full `npm test` run — 2033/2033 pass across both groups.

## A note on TypeScript narrowing across the two tsconfigs

Two call sites (`live-memory-session.ts#pointerMapLoad`, `live-memory-ipc.ts`'s `pointer-map-save` handler) hit a real discrepancy: a discriminated-union `if (!result.ok)` guard narrows correctly under the root `tsconfig.json` (`strict: true`) but does not reliably narrow the same code under `tsconfig.electron.json` (`strict: false`). Both sites now use an explicit type cast on the error branch instead of relying on narrowing, so they compile identically under both configs. Recorded here because it is a real, reproducible tooling quirk of this codebase's split strict/non-strict tsconfig setup — not something specific to this stage's code — and worth knowing if it recurs elsewhere.

## What P2-2 explicitly did not do

- No UI (mission §17 — deliberately deferred to P2-3).
- No repeated-run flake gate (3 consecutive real-process runs) the way Phase 1's certification required — one isolated real-process run passed 3/3; the transient flake seen under concurrent load has not yet been re-run enough times to call it a "zero known flaky tests" result at Phase 1's bar.
- No fresh-worktree proof, no remote CI push/verification for this branch (`feature/solith-phase2-pointer-engineering`) — those are still open before this stage could be called even provisionally certified, let alone Phase 2 as a whole.
