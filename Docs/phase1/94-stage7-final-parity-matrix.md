# Phase 1 / Stage 7 Final Closure — Final Parity Matrix

## §10 — synthetic classifier cases vs. real-process certification cases, separated

Mission §10 requires the known synthetic ambiguity (legacy `complete` + match at `0x1000`; native `complete` + match at `0x2000`; same target value; no independent ground truth) be classified `UNRESOLVED_SYNTHETIC_AMBIGUITY`-equivalent and kept OUT of real-process totals. This case lives in `tests/live-memory/scanner-backend-router.test.ts` ("classifies an unexplained match-set disagreement as SEMANTIC_DIFFERENCE_REQUIRING_OWNER_DECISION, never guessed") — the codebase's actual classification enum (`ParityDifferenceClassification` in `scanner-backend.ts`) does not have a literally-named `UNRESOLVED_SYNTHETIC_AMBIGUITY` value; `SEMANTIC_DIFFERENCE_REQUIRING_OWNER_DECISION` is the enum value this exact scenario maps to, and it is never produced by any real-process test in this codebase — confirmed by grep across `scanner-backend-real-process.test.ts` and `scanner-backend-int64-end-to-end.test.ts` (zero occurrences). This satisfies the mission's intent (the classifier refuses to guess, and this specific case never contaminates real-process totals) even though the exact string name differs from mission's suggested label; renaming the enum was judged unnecessary churn for a documentation-level naming preference (see doc 88 for full analysis of this specific case).

**SYNTHETIC CLASSIFIER CASES**: 1 (the case above). Classification: `SEMANTIC_DIFFERENCE_REQUIRING_OWNER_DECISION` (mission's `UNRESOLVED_SYNTHETIC_AMBIGUITY` intent). Never counted toward real-process totals.

**REAL-PROCESS CERTIFICATION CASES** (cumulative across all Stage 7 + Stage 7.1 + this final-closure pass's real-process/real-IPC/real-game tests):

| Source | Cases | Matches | Expected corrections | Legacy bugs | Native bugs | Unresolved |
|---|---|---|---|---|---|---|
| Stage 7 `scanner-backend-real-process.test.ts` (1 MiB, alignment+int64, AOB) | 3 | — | 3 | 0 | 0 | 0 |
| Stage 7.1 `scanner-backend-ipc-real-path.test.ts` (full IPC path, 8 assertions across attach/mode/exact/AOB/no-match/malformed/rollback/detach) | 1 aggregate real-process session | — | 0 | 0 | 0 | 0 |
| Stage 7.1 3-real-game canary (doc 91: Bastion, Godlike Burger, Aegis Defenders) | 3 | — | 3 | 0 | 0 | 0 |
| This pass: default-cap / maxMatches matrix / 100k pressure (real fixture) | 3 test cases | — | 0 (correctness, not parity, cases) | 0 | 0 | 0 |
| This pass: int64/u64 end-to-end (fixture pre-planted + live-written values) | 6 | — | 0 (correctness cases; no legacy/native disagreement to classify — legacy simply cannot represent these, which is D03/D06, already accounted) | 0 | 0 | 0 |

**Real-process totals**: `NATIVE_BUGS = 0`, `UNRESOLVED_REAL_PROCESS = 0` — required by mission §10, both satisfied across every real-process test this operation has ever run (Stage 7 through this final-closure pass).

## §11 — full primitive/case/pattern matrix: honest, partial coverage

Mission §11 asks for a full matrix: 10 primitive types × 15 value-condition cases × ~14 pattern-matching cases, each difference classified. **This was not built exhaustively this pass** — doing so rigorously (real backend calls, real classification, for all ~350+ cells) is a substantial undertaking beyond what this closure pass's remaining time budget could respons ibly cover alongside its other required sections (int64 fix, IPC pressure fix, packaged proof, fresh worktree, full regression). What IS real and already covered, drawing on the Rust fixture's actual planted content (`native/solith-scanner-core/src/bin/fixture.rs`'s `TYPES_REGION`/`PATTERN_REGION`, which already contains real values for all 10 primitives, INF/NaN specials, repeated values, 4 chunk-boundary-straddling cases, and AOB exact/wildcard/nibble/near-miss/UTF-8/UTF-16/raw-bytes patterns — built in earlier stages for the Rust/napi test suites, but not yet exercised through `ScannerBackend`/`NativeScannerBackend`/the IPC layer for most of these):

| Primitive | Exercised through ScannerBackend this operation | Not yet exercised through ScannerBackend |
|---|---|---|
| i32 | not directly (only via legacy scanFirst indirectly) | aligned/unaligned/signed-negative/min/max cases via NativeScannerBackend |
| u32 | YES — extensively (sentinel, no-match, pressure, canary) | boundary-straddling, duplicate-matches cases |
| i64 | YES — extensively (this pass's int64 end-to-end suite) | — |
| u64 | YES — u64::MAX and a mid-range value, backend layer | via IPC (structural gap, doc 93) |
| i8, u8, i16, u16, f32, f64 | **NO** | all cases |
| AOB exact | YES (far-marker case) | — |
| AOB wildcard/nibble/CE-syntax variants | **NO** | all cases — fixture already has `AOB_WILDCARD_PATTERN`/`AOB_NIBBLE_PATTERN` planted and unused by any `ScannerBackend`-layer test |
| UTF-8/UTF-16 patterns | **NO** | fixture has ASCII/multibyte/non-BMP-surrogate-pair content planted, unused by `ScannerBackend`-layer tests — `NativeScannerBackend`'s `aobScan` contract doesn't yet expose a distinct "string search" mode separate from raw AOB, so this may require a contract extension, not just a test, to close properly |

**Honest conclusion**: the full parity matrix mission §11 asks for is **NOT_COMPLETE**. The primitives and patterns most directly tied to the four named shipping defects (u32/i64/u64 exact, AOB exact) are real and proven; i8/u8/i16/u16/f32/f64 and AOB wildcard/nibble/string-pattern coverage through the actual backend contract remain undone. This is reported as an open item in the final certification (doc 101) rather than closed by assumption or by testing only the convenient subset and calling it "the matrix."
