# Phase 1 / Stage 7 Final Closure — Legacy Retirement Plan (Final)

## §15/§21 — final taxonomy, mapped to mission's exact categories

The full narrative retirement plan lives in doc 84. This document restates it in the mission's exact requested category names (`KEEP` / `SHIM` / `DELETE_STAGE8` / `POINTER_KEEP` / `TEST_ONLY`) with explicit deletion preconditions, so Stage 8 is execution, not rediscovery.

| File/function | Category | Deletion precondition (if `DELETE_STAGE8`) |
|---|---|---|
| `memory-scanner.ts`: `scanFirst` (exact-value path) | `DELETE_STAGE8` | Production routing default must genuinely switch `LEGACY`→`NATIVE` for exact-value scan; full parity matrix complete (doc 94 — NOT yet complete); real-game canary at scale (doc 91 — 3 games done, more available); a documented certification stage explicitly authorizing the switch |
| `memory-scanner.ts`: `scanFirstAutoMatrix`, `scanNext`, `scanFirstUnknown`, `scanNextFromSnapshotMultiType`, `scanFirstByComparison`, `scanFirstRange` | `KEEP` | Not migrated at all — native has no session-based multi-mode-fan-out equivalent exposed through the contract yet; a future stage must design that first |
| `native-memory-driver.ts` (all of it) | `KEEP` | Still the sole implementation for range scan, unknown-value scan, pointer scan, proposeWrite/confirmWrite/rollback, freeze — none touched by any scanner-routing stage |
| `aob-resolver.ts`: `scanAobInProcess` | `DELETE_STAGE8` | Same gate as exact-value scan above, PLUS `signature-engine.ts`'s independent AOB-shaped code must ALSO be migrated or explicitly re-scoped (doc 99) — "AOB fully retired" cannot be true while that second path exists |
| `aob-resolver.ts`: `parseAobSignature`, `findAobInBuffer` | `SHIM` candidate | Still imported directly by `signature-engine.ts`; cannot be deleted while that file exists unmigrated |
| `signature-engine.ts` (all of it) | `KEEP` | Not touched by any scanner-routing stage; independent AOB defect instance documented (doc 97/99) |
| `pointer-scanner.ts`, `pointer-resolver.ts` | `POINTER_KEEP` | D05 explicitly out of scope for every scanner-routing stage; belongs to a future stage that reconstructs pointer scanning |
| `feature-resolver.ts` | `KEEP` | Depends on both `aob-resolver.ts` and `pointer-resolver.ts`, neither fully migrated |
| `src/core/in-process-script/hook-engine.ts` | `KEEP` (distinct subsystem) | Code injection, not scanner retirement's concern — not a scanner-routing candidate at all |
| `tests/fixtures/fake-memory-driver.ts` | `TEST_ONLY` | Remains required for every still-legacy-only code path's own test suite regardless of scanner retirement progress |
| `src/core/live-memory/live-memory-session.ts`'s `scanFirst` method (wrapper) | `DELETE_STAGE8` | Zero remaining callers confirmed (doc 97) — lowest-risk deletion candidate in this entire plan, gated only on a final "no external consumer" sanity check since grep cannot see outside this repo |
| `src/core/live-memory/index.ts`'s `scanFirst`/`scanFirstRange`/`scanNext` re-export | `DELETE_STAGE8` candidate, verify-first | No in-repo consumer found; verify no external/build-script consumer before removing |

## Explicit closure order (unchanged from doc 84, reaffirmed)

Legacy retirement remains prepared, not executed, after this closure pass. Before ANY `KEEP`/`SHIM` item may move to actual `DELETE_STAGE8` deletion: (1) production routing default must genuinely switch for the relevant operation, (2) the full parity matrix (doc 94) must be complete — it is currently NOT, (3) shipping tests must exercise the new path, (4) the old implementation must no longer be authoritative in any remaining code path. None of the four conditions is met for any file in this table as of this pass. Stage 8's own stated objective, not this stage's or this closure pass's.
