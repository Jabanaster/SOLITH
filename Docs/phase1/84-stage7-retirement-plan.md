# Phase 1 / Stage 7 — Legacy Retirement Plan

## §7.24 — legacy scanner is NOT deleted this stage; this is the preparation plan

| File/function | Disposition | What must happen before deletion |
|---|---|---|
| `memory-scanner.ts`: `scanFirst` (exact-value path) | **DELETE_AFTER_PARITY** | Production routing default must move `LEGACY`→`NATIVE` for exact-value scan (requires: real-game canary, doc 80; full parity matrix, doc 75; performance comparison, doc 81 — none done yet), with a documented certification stage explicitly authorizing it |
| `memory-scanner.ts`: `scanFirstAutoMatrix`, `scanNext`, `scanFirstUnknown`, `scanNextFromSnapshotMultiType`, `scanFirstByComparison`, `scanFirstRange` | **KEEP** | Not migrated this stage at all — native has no session-based "auto matrix"/multi-mode-fan-out equivalent exposed through this contract yet. A future stage must design that before these can even become `REPLACE` candidates |
| `native-memory-driver.ts` (all of it) | **KEEP** | Still the sole implementation for every non-routed operation (range scan, unknown-value scan, pointer scan, proposeWrite/confirmWrite/rollback, freeze) — none of which this stage touches |
| `aob-resolver.ts`: `scanAobInProcess` | **DELETE_AFTER_PARITY** | Same gate as exact-value scan above, plus doc 83's note that `signature-engine.ts`'s independent AOB-shaped code must ALSO be migrated or explicitly re-scoped before "AOB is fully retired" could ever be true |
| `aob-resolver.ts`: `parseAobSignature`, `findAobInBuffer` | **SHIM candidate** | Still imported directly by `signature-engine.ts`; cannot be deleted while that file exists unmigrated |
| `signature-engine.ts` (all of it) | **KEEP** | Not touched by this stage at all; see doc 83 |
| `pointer-scanner.ts`, `pointer-resolver.ts` | **POINTER_PATH_KEEP** | D05 explicitly out of scope; belongs to whichever future stage reconstructs pointer scanning |
| `feature-resolver.ts` | **KEEP** | Depends on both `aob-resolver.ts` and `pointer-resolver.ts`, neither fully migrated |
| `src/core/in-process-script/hook-engine.ts` | **OTHER / KEEP** | A distinct subsystem (code injection), not scanner retirement's concern |
| `tests/fixtures/fake-memory-driver.ts` | **TEST_FIXTURE_ONLY** | Remains required for every still-legacy-only code path's own test suite regardless of scanner retirement progress |
| `src/core/live-memory/index.ts`'s `scanFirst`/`scanFirstRange`/`scanNext` re-export | **DELETE_AFTER_PARITY candidate, verify first** | No consumer found this stage (see doc 83) — verify no external/build-script consumer before removing, since this repo's own source tree was the only thing searched |

## Explicit closure order (mirrors mission §7.24)

Legacy retirement is prepared, not executed. Before ANY file above may move from `KEEP`/`SHIM` to `DELETE_AFTER_PARITY`'s actual deletion: (1) production routing default must genuinely switch for the relevant operation, (2) parity must be verified (full matrix, not the partial one in doc 75), (3) shipping tests must exercise the new path (not just the core-module-level tests this stage adds), (4) the old implementation must no longer be authoritative in any remaining code path. None of the four conditions is met for any file this stage. This is Stage 8's stated objective per the mission's own "NEXT IF CERTIFIED" pointer, not this stage's.
