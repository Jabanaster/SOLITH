# Phase 1 / Stage 7.2/7.3 — Final Failure Injection

## §5/§22 — full 16-case table (mission's exact list)

Baseline is doc 96 (Stage 7 final closure). This pass closes 3 previously-disclosed gaps with real, dedicated tests and reinforces several others with new real evidence under the production default (NATIVE).

| # | Case | Status before this pass | Status after this pass | Evidence |
|---|---|---|---|---|
| 1 | Native addon missing | PARTIAL (synthetic) | **Unchanged — PARTIAL (synthetic)** | `scanner-backend-router.test.ts` stub throwing `native_addon_missing` |
| 2 | Wrong/corrupt addon | NOT COVERED | **Unchanged — NOT COVERED** | Real code path exists (`scanner-backend-native.ts:139-152`); no genuinely corrupted `.node` file exercised this pass |
| 3 | Addon load failure | PARTIAL (synthetic) | **Unchanged — PARTIAL (synthetic)** | Same mechanism as #1 |
| 4 | Access denied | NOT COVERED | **Unchanged — NOT COVERED** | `access_denied` kind exists in the type union; no dedicated test |
| 5 | Process exits mid-scan | COVERED (real) | **Reinforced** | New: `scanner-backend-cancellation.test.ts` case H, `scanner-backend-rollback-matrix.test.ts` case 6 |
| 6 | Resource limit | COVERED (real) | **Reinforced** | New: `scanner-backend-rollback-matrix.test.ts` case 7 (explicit `maxMatches: 1`, exact cap proven) |
| 7 | Cancellation | PARTIAL (pre-abort only) | **UPGRADED — real mid-flight cancellation proven** | `scanner-backend-cancellation.test.ts` cases A/C/D — genuine in-flight interruption, not merely a pre-flight check (doc 102) |
| 8 | Invalid primitive | COVERED (by construction, not re-tested) | **UPGRADED — dedicated real test** | `scanner-backend-rollback-matrix.test.ts` case 3 |
| 9 | Invalid int64/u64 transport | Not explicitly tested | **CLOSED — real dedicated test** | `scanner-backend-failure-injection-gaps.test.ts`: non-decimal string and implausibly-long string both rejected by the wire schema; session unharmed afterward |
| 10 | Malformed AOB | COVERED (real) | **Reinforced** | `scanner-backend-rollback-matrix.test.ts` case 4 |
| 11 | Corrupt snapshot metadata | NOT APPLICABLE | **Unchanged — NOT APPLICABLE** | No persisted session metadata exists for the scan route this stage covers |
| 12 | Unsupported snapshot version | NOT ADDRESSED | **Unchanged — NOT ADDRESSED** | Out of scope (snapshot versioning belongs to `SessionSnapshotManager`/research tools, not scanner routing) |
| 13 | Closed session reuse | COVERED (by construction, not dedicated test) | **CLOSED — real dedicated test** | `scanner-backend-failure-injection-gaps.test.ts`: scan-first after detach returns a structured `success:false`, no crash |
| 14 | Double close | COVERED (by construction, not dedicated test) | **CLOSED — real dedicated test** | `scanner-backend-failure-injection-gaps.test.ts`: detach called twice, both succeed, idempotent |
| 15 | Invalid operation ID | NOT COVERED / NOT APPLICABLE (feature didn't exist) | **CLOSED — real dedicated test** | `scanner-backend-cancellation.test.ts` case F |
| 16 | Cancel completed operation | NOT COVERED / NOT APPLICABLE (feature didn't exist) | **CLOSED — real dedicated test** | `scanner-backend-cancellation.test.ts` case G |

## Required properties, rechecked

- **CRASH = NO** across every case exercised this pass.
- **HANG = NO** — every cancellation/poll test uses a bounded retry loop and completes within its timeout; the process-exit race test explicitly asserts a terminal state is reached.
- **UNAUTHORIZED SILENT FALLBACK = NO** — no test this pass observed a NATIVE-mode failure silently resolved as a legacy success; the router's `allowFallback` default remains `false`.
- All errors surfaced this pass are structured (`{ success: false, error: string }`), never a bare uncaught throw reaching the caller.

## Honest summary

Of 16 cases: **10 now covered with real, dedicated evidence** (5, 6, 7, 8, 9, 10, 13, 14, 15, 16), 1 not applicable to this route (11), 1 explicitly out of scope (12), and **4 remain genuinely open** (1, 2, 3, 4 — all four require either a real corrupted native artifact or real OS-level access-denial, neither of which was set up this pass). This is real, substantial progress over doc 96's baseline, not full closure — reported as such rather than rounded up.
