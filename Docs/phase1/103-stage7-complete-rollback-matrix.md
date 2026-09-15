# Phase 1 / Stage 7.2/7.3 — Complete 8/8 Rollback Matrix

## §4/§11 — full table

All against a real spawned fixture process, through the real registered `ipcMain.handle` callbacks, against the real production default (NATIVE, Stage 7.3 §2 — no explicit routing-mode-set is issued before each scenario's first scan). Test file: `tests/live-memory/scanner-backend-rollback-matrix.test.ts` (cases 1–7); case 8 cites `tests/live-memory/scanner-backend-router.test.ts`.

| # | Case | Evidence | Result |
|---|---|---|---|
| 1 | Successful native exact scan | Real >1 MiB `U32_VALUE` found under default NATIVE, then `setMode('LEGACY')`, new scan finds a freshly-planted, genuinely legacy-reachable value, then back to NATIVE | **PASS** |
| 2 | Successful native AOB scan | Real AOB match under default NATIVE, then rollback, legacy scan succeeds, then back to NATIVE | **PASS** |
| 3 | Invalid primitive input | Malformed `dataType` rejected by schema under NATIVE; session unharmed (valid scan immediately after succeeds); rollback proven | **PASS** |
| 4 | Malformed AOB | `'ZZ'` rejected under NATIVE; session unharmed; rollback proven | **PASS** |
| 5 | Cancelled scan | Real cancellation via `live-memory-scan-first-start`/`-cancel`, drained to terminal, then rollback proven | **PASS** |
| 6 | Target process exits | Real process killed mid-scan (adapted: rollback proven against a second, freshly-spawned process — see below) | **PASS** |
| 7 | Resource limit | Explicit `maxMatches: 1` against a densely-matching value, capped exactly at 1, `truncated: true`; rollback proven | **PASS** |
| 8 | Native backend/addon failure | `scanner-backend-router.test.ts`'s existing "rollback after a native error: switching to LEGACY immediately stops native from being called again" — a real (synthetic-injected) native throw, a real `setMode('LEGACY')`, and a real subsequent successful call, at the router level | **PASS (synthetic injection, router level)** |

**ROLLBACK: 8/8 PASS.**

## Two disclosed adaptations, not weakenings

1. **Case 6's literal template cannot apply physically.** The mission's own per-case template says "perform scenario... switch routing to LEGACY... start a NEW scan... prove legacy operates normally" — but a process that has exited cannot be scanned again under any backend. This case proves (a) the scenario itself (process exit mid-scan) reaches a real terminal state with no hang, and (b) LEGACY genuinely operates normally afterward, against a second, freshly spawned fixture process. This is stated explicitly rather than silently reinterpreting the case.

2. **Every case's "legacy operates normally" step searches for a value planted in `REFINE_REGION` (64 KiB) via the fixture's real `write <offset> <hex>` protocol, not `TYPES_REGION` (4 MiB).** `TYPES_REGION` exceeds `native-memory-driver.ts`'s real 1 MiB `readBuffer` ceiling (`native-memory-driver.ts:361`: `if (size <= 0 || size > 1048576) throw ...`), so LEGACY structurally cannot read it at all — the entire 4 MiB region is skipped by legacy's try/catch, regardless of alignment or offset. This was discovered empirically during this pass (all 7 new tests initially failed identically on "legacy must find its own aligned value normally after rollback" until this was diagnosed) and is itself real, direct, corroborating evidence for the 1 MiB shipping defect's exact mechanism — not a test bug being covered up. Using a `REFINE_REGION` value makes "legacy operates normally" mean what it should: legacy actually finds a real value it is structurally capable of finding.

## Case 8's honest limitation, carried forward from doc 96

Re-deriving case 8 against a genuinely corrupted `.node` file (rather than a synthetic thrown `ScannerBackendError`) was not attempted this pass — same disclosed limitation as doc 96. The router-level test is real in the sense that matters for rollback (a real thrown error, a real mode switch, a real subsequent call), even though the fault itself is injected rather than a real corrupted artifact.
