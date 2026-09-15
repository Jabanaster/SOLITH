# Phase 1 / Stage 7.2/7.3 — Parity Matrix Update

## §6/§19 — honest status: NOT exhaustively completed this pass

Mission §6 asks for the full 10-primitive × 15-case matrix plus the 13-pattern AOB matrix. Doc 94 (Stage 7 final closure) already disclosed this was not built exhaustively; this pass adds real, targeted rows (below) but does **not** close the remaining gap. Reported honestly per the mission's own "Do not force expected result. Evidence decides" instruction, rather than claiming a completion this pass did not do the work to earn.

## New rows added this pass (all real-process, through `ScannerBackend`, under the production default NATIVE)

| Primitive | Case | Result | Test |
|---|---|---|---|
| u32 | `>1 MiB`, aligned | MATCH (native only — legacy cannot reach `TYPES_REGION`) | `scanner-backend-native-default-defect-closure.test.ts` |
| u32 | `not-found-complete` (genuinely absent, random value) in `>1 MiB` region | MATCH (native correctly reports 0 matches) | same |
| u32 | `chunk-boundary`, unaligned | MATCH (native finds `BOUNDARY_U32_VALUE` at an offset straddling a 1 MiB chunk boundary and not a multiple of 4) | same |
| i64 | `chunk-boundary`, unaligned (via `BOUNDARY_U64_VALUE`, positive, i64-representable) | MATCH | same |
| i64 | `>2^53` (`9007199254740993n`, `9007199254740995n`) | MATCH, exact BigInt fidelity | same |
| i64 | `max` (`9223372036854775807n`) | MATCH, exact | same |
| i64 | `min` (`-9223372036854775808n`) | MATCH, exact | same |
| u32 | `resource limit` (explicit `maxMatches: 1`) | MATCH, correctly capped, `truncated: true` | `scanner-backend-rollback-matrix.test.ts` case 7 |
| u32 | `cancel` (mid-flight) | MATCH — genuine cancellation observed (doc 102) | `scanner-backend-cancellation.test.ts` |
| u32 | `process exit` | MATCH — typed, non-crashing outcome | `scanner-backend-cancellation.test.ts`, `-rollback-matrix.test.ts` |
| AOB exact | far-offset marker (unchanged from prior stages) | MATCH | `scanner-backend-rollback-matrix.test.ts` cases 2/4 |

All rows above: `NATIVE_BUG = 0`, `UNRESOLVED = 0` — every native result matched ground truth or correctly diverged from legacy for an understood, classified reason (the 1 MiB ceiling).

## What remains genuinely missing (unchanged from doc 94, not addressed this pass)

- **i8, u8, i16, u16, f32, f64**: zero real-`ScannerBackend`-level rows for any case. `i16`/`u16` in particular are additionally blocked by a real structural gap — `LIVE_VALUE_TYPE` (the wire schema) has no `int16`/`uint16` variant at all, so these primitives cannot be exercised through the production IPC route regardless of test effort until that schema gap is closed (a Stage 8-scope change, not a test-writing gap).
- **u64 via IPC**: still blocked by the same pre-existing `uint64` wire-schema gap (doc 93). `u64::MAX` remains provable only at the backend layer, never through the real shipping wire.
- **duplicates, chunk-boundary for every other primitive, `not-found-incomplete`**: not separately exercised this pass.
- **AOB pattern matrix** (`??`, `?`, `*`, `xx/x`, nibble wildcard, UTF-8, UTF-16LE, continuous exact/wildcard, `>1 MiB` AOB, incomplete zero-match): unchanged from doc 94 — only "AOB exact" has a real row through `ScannerBackend`. The Rust fixture has real planted content for all of these (`PATTERN_REGION`), but `NativeScannerBackend.aobScan`'s current contract has no distinct string-search mode, and none of these variants were exercised through the production route this pass.

## Synthetic ambiguity — final disposition (mission §7)

The one known synthetic-fixture case (legacy: `Complete + 0x1000`, native: `Complete + 0x2000`, ground truth intentionally absent) is explicitly classified `SYNTHETIC_CLASSIFIER_AMBIGUITY` and excluded from the real-process unresolved count, the native bug count, and the shipping defect count. Its purpose — proving the parity classifier refuses to guess when no external truth source exists — is already met (doc 94's original `SEMANTIC_DIFFERENCE_REQUIRING_OWNER_DECISION` classification demonstrates exactly this refusal-to-guess behavior); this document restates it under the mission's requested label rather than re-deriving new evidence, since no new synthetic ambiguity case was introduced this pass.

**SYNTHETIC AMBIGUITY: `SYNTHETIC_CLASSIFIER_AMBIGUITY`, correctly excluded from all three counts above.**
