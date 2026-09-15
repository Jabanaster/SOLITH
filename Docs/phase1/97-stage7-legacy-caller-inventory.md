# Phase 1 / Stage 7 Final Closure — Legacy Caller Inventory (Final Recheck)

## §14/§20 — pointer to the authoritative inventory, plus this pass's recheck

The full, authoritative caller inventory lives in doc 83 (`83-stage7-legacy-caller-inventory.md`), including its Stage 7.1 §7.1-P addendum. This document is not a duplicate — it records the **final recheck after this closure pass's changes** (int64 wire fix, default match-cap fix, preload/renderer type fixes) and reclassifies every caller into the mission's exact requested taxonomy.

**Recheck method**: `grep -rn "scanFirst(\|scanAobInProcess(\|scanFirstRegions(" src/core/live-memory/*.ts src/core/in-process-script/*.ts electron/*.ts`, excluding test files and the `LegacyScannerBackend` adapter itself. **Result: identical set of callers as doc 83's original inventory — this pass introduced zero new legacy callers.**

| Caller | Function | Classification (mission's exact taxonomy) |
|---|---|---|
| `src/core/live-memory/live-memory-session.ts:678` (`scanFirst` method → `scanFirstRegions`) | `memory-scanner.ts`'s `scanFirst`-family | `STILL_PRODUCTION_REQUIRED` for every mode except plain exact-value (auto-matrix, next-scan, unknown-initial, comparison, range) — none of these are migrated this stage or Stage 7 |
| `src/core/live-memory/live-memory-session.ts:676` (the `scanFirst` **method** itself) | n/a (wrapper) | `DELETE_STAGE8` candidate — **zero remaining callers anywhere in the repo** (confirmed both this pass and Stage 7.1's recheck); superseded by `scanExactViaBackend`. Not deleted this pass (verify-first discipline) |
| `src/core/live-memory/scanner-backend-legacy.ts` | adapter over `scanFirstRegions`/`scanAobInProcess` | `MIGRATED_TO_BACKEND` (the adapter itself) |
| `src/core/live-memory/live-memory-session.ts:962` (`scanAobSignature` method) | `aob-resolver.ts`'s `scanAobInProcess` | `LEGACY_ROLLBACK_ONLY` — the method itself is untouched and still directly callable; production IPC routes through `scanAobViaBackend` instead, but this method remains as an explicit rollback path |
| `src/core/live-memory/feature-resolver.ts:105` | `scanAobInProcess` | `STILL_PRODUCTION_REQUIRED` — signature-based feature resolution, not routed this stage or Stage 7.1 |
| `src/core/in-process-script/hook-engine.ts:43` | `scanAobInProcess` | `STILL_PRODUCTION_REQUIRED` / `COMPATIBILITY_SHIM`-adjacent — a genuinely distinct subsystem (code-injection hook targeting), not the memory-scanning feature this stage covers; has its own authority model, not intended to be migrated as part of scanner production routing |
| `src/core/live-memory/signature-engine.ts` (independent AOB-shaped implementation, calls `driver.readBuffer` directly, not `aob-resolver.ts`) | n/a (separate implementation) | `STILL_PRODUCTION_REQUIRED` — a SECOND, unmigrated instance of the AOB defect mechanism; must be migrated or explicitly re-scoped before "AOB is fully retired" could ever be true (see doc 99) |
| `src/core/live-memory/pointer-scanner.ts`, `pointer-resolver.ts` and their callers | n/a | `POINTER_SPECIFIC` — explicitly out of scope (D05) |
| `tests/fixtures/fake-memory-driver.ts` and all legacy-path test fixtures | n/a | `TEST_ONLY` |
| `src/core/live-memory/index.ts`'s `scanFirst`/`scanFirstRange`/`scanNext` re-export | n/a | `DELETE_STAGE8` candidate, verify-first (no consumer found via repo-wide grep, but an external/build-script consumer outside this repo's own source tree cannot be ruled out by grep alone) |

**UNKNOWN = 0** — every caller of every function in `memory-scanner.ts`, `native-memory-driver.ts`, `aob-resolver.ts`, `signature-engine.ts`, `feature-resolver.ts`, `live-memory-session.ts`, and `hook-engine.ts` is accounted for above or in doc 83, with an explicit classification and reason. None is unaccounted for.
