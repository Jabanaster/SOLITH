# Phase 1 / Stage 7.5 §9 — Failure Injection Closeout

## What was reopened, and why

Doc 117 closed 14 of 16 cases with real evidence and left two — **#11 corrupt session metadata** and **#12 unsupported snapshot version** — as "NOT APPLICABLE / out of scope", reasoning that no persisted session metadata exists for the scan route in question.

Mission §9 rejects that wording on its own: *"out of scope alone is not sufficient. For PROVABLY_NOT_APPLICABLE: prove architecturally why the failure mode cannot occur."* Both were reopened this stage and are now closed with a structural proof plus runtime defence in depth.

## The architectural proof for #11 and #12

The native addon splits its surface in two:

| Class | Responsibilities | Persistence? |
|---|---|---|
| `NativeScanSession` | `createUnknownInitial`, `refine`, `getResults`, `generationHistory`, `exportSnapshotJson` | **yes** — the only class with any |
| `NativeScanTarget` | `attach`, `enumerateRegions`, `readRegionChunked`, `scanExact`, `scanBytes`, `scanString`, `scanAob` | **none** |

Plus three free functions — `saveSessionSnapshot`, `loadSessionSnapshotInfo`, `deleteSessionSnapshot` — which exist solely to serve `NativeScanSession`.

Every routed production scan — exact, AOB, and as of this stage fuzzy — goes through `NativeScannerBackend`, which constructs `NativeScanTarget` and nothing else. **There is no persisted session metadata on this route to be corrupt, and no snapshot schema version on this route to be unsupported.**

This is asserted mechanically rather than argued, so it cannot quietly stop being true. `tests/live-memory/scanner-backend-failure-injection-closeout.test.ts` reads the source of every file in the routed path — `scanner-backend.ts`, `scanner-backend-native.ts`, `scanner-backend-legacy.ts`, `scanner-backend-router.ts`, `signature-engine.ts` — and fails if any of them so much as names `NativeScanSession`, `exportSnapshotJson`, `saveSessionSnapshot`, `loadSessionSnapshotInfo`, `deleteSessionSnapshot` or `createUnknownInitial`. If a future change routes a scan through the session class, cases 11 and 12 stop being provably not applicable and this test says so immediately.

## Defence in depth (not closure evidence, but recorded)

Even granting that the API is unreachable from this route, it was exercised directly:

| Input | Behavior | Result |
|---|---|---|
| Structurally invalid JSON snapshot file | `loadSessionSnapshotInfo` throws a real `Error` | PASS — rejected, never partially accepted |
| Well-formed JSON with `schema_version: 99999` (core implements 1) | throws a real `Error` | PASS — rejected, never reconstructed on a guess |

No crash, no hang, no silently-accepted session in either case.

## Fuzzy-path extensions to the existing matrix

The newly migrated path was added to the failure matrix in its own right:

| Case | Evidence | Result |
|---|---|---|
| Malformed AOB pattern | rejected with `Invalid AOB token` / empty-pattern error **before any read** — asserted by counting `readRegion` calls (0), not by inspection | PASS |
| NATIVE fuzzy failure | typed `ScannerBackendError` surfaces; `effectiveBackend: 'native'`, `fellBackToLegacy: false`, `fallbackCount: 0` | PASS — no hidden fallback |
| Explicit LEGACY rollback after a NATIVE failure | resolves the real planted pattern; `fallbackCount` still 0 (an explicit rollback is not a fallback) | PASS |
| SHADOW_COMPARE with a failing native source | legacy stays authoritative, `nativeError` recorded not swallowed | PASS |
| Cancellation | `cancelled`, no match, `isAuthoritativeAbsence: false` | PASS (fixture matrix 14 + real-process) |
| Process exit mid-scan | `process_exited`, not authoritative | PASS (fixture matrix 15) |
| Resource limit | named skipped range, not authoritative | PASS (fixture matrix 16) |
| Access denied / unreadable region | named skipped range, not authoritative | PASS (fixture matrix 13, 13b) |
| Unattached backend | typed `attach_failed` | PASS (fixture matrix 21) |
| Module query it cannot answer | typed `unsupported_operation`, never `[]` | PASS (fixture matrix 20) |

## Final 16-case disposition

| # | Case | Classification |
|---|---|---|
| 1 | Native addon missing | `REAL_PASS` (doc 117, `registerHooks`) |
| 2 | Wrong/corrupt addon | `REAL_PASS` (doc 117, corrupted `.node` copy) |
| 3 | Addon load failure | `REAL_PASS` (doc 117) |
| 4 | Access denied | `DETERMINISTIC_PASS` (doc 117, PID 4; environment-dependence disclosed) |
| 5 | Process exit | `REAL_PASS` |
| 6 | Resource limit | `REAL_PASS` |
| 7 | Cancellation | `REAL_PASS` |
| 8 | Invalid primitive | `REAL_PASS` |
| 9 | Malformed AOB | `REAL_PASS` (extended to the fuzzy path this stage) |
| 10 | Stale target / PID reuse | `REAL_PASS` |
| 11 | Corrupt session metadata | **`PROVABLY_NOT_APPLICABLE`** — structural proof + asserted mechanically + API-level defence in depth |
| 12 | Unsupported snapshot version | **`PROVABLY_NOT_APPLICABLE`** — same |
| 13 | Closed session reuse | `REAL_PASS` |
| 14 | Double close | `REAL_PASS` |
| 15 | Bad architecture | `DETERMINISTIC_PASS` (no i686 target installed; disclosed since Stage 2 doc 17) |
| 16 | Routing rollback after failure | `REAL_PASS` (extended to the fuzzy path this stage) |

**FAILURE INJECTION — real pass: 12 (cases 1, 2, 3, 5, 6, 7, 8, 9, 10, 13, 14, 16). deterministic pass: 2 (cases 4, 15). provably N/A: 2 (cases 11, 12). unresolved: 0.** Total 16.

Cases 9 and 16 were already real at Stage 7.4 and were additionally re-proven against the newly migrated fuzzy path this stage; they are counted once each.

No crash, no hang, no silent success, no silent fallback was observed in any case.
