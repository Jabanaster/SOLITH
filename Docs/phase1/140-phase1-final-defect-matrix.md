# Phase 1 — Final Defect Matrix

Supersedes doc 132 as the current-status defect matrix. Doc 132 is preserved unmodified and remains accurate as of `2618286`; every row below that differs from it differs because the defect was closed after that commit, not because the earlier record was wrong.

## Two numbering schemes — read this first

Unchanged from doc 132, repeated because it is load-bearing. `ROADMAP.md` and the Stage 7 evidence trail use **different D-numbers for the same defects**.

| ROADMAP D# | ROADMAP description | This document |
|---|---|---|
| D01 | sibling truth-reporting gaps (`catch{continue}` sites) | **D06** |
| D02 | 1 MiB region-read cap | **D01** |
| D03 | forced alignment | **D02** |
| D04 | AOB repair above the cap / false `found:false` | **D03** |
| D05 | pointer-scan depth truncation/misreporting | **D05** (only coincidental match) |
| D06 | int64 mismatch at the IPC boundary | **D04** |

`NATIVE_PATH_FIXED` never implies `PRODUCT_DEFECT_CLOSED`.

## §18 — The matrix

| ID | Defect | Root cause | Fix | Real test | Packaged | CI | Certifying commit | Status |
|---|---|---|---|---|---|---|---|---|
| D01 | >1 MiB read cap / silent region skip *(ROADMAP D02)* | `readBuffer` throws above 1 MiB; six call sites swallowed it | chunked native reads with per-chunk status | yes | yes | yes | `5a1559c`, `46adeaf` | **CLOSED** |
| D02 | forced value-width alignment *(ROADMAP D03)* | scan stepped by value width | bytewise scanning | yes | yes | yes | doc 113 | **CLOSED** |
| D03 | AOB false-not-found *(ROADMAP D04)* | incomplete coverage returned as `found:false` | completeness contract + `isAuthoritativeAbsence` | yes | yes | yes | doc 115, `46adeaf` | **CLOSED** |
| D04 | int64/u64 truncation *(ROADMAP D06)* | `Number` narrowing across IPC | BigInt end to end | yes | yes | yes | doc 114 | **CLOSED** |
| **D05** | **pointer-scan depth / truncation** | no way to distinguish an exhausted frontier from a cut-off search; no cycle detection | termination reasons, `deepestLevelCompleted`, cycle-safe traversal, truthful caps | **yes — real module-rooted chain** | n/a | yes | **`e5648d3`, `b962cd8`** | **CLOSED (doc 138)** |
| **D06** | **scan completeness truth *(ROADMAP D01)*** | ten `catch{continue}` sites; `maxRegionBytes` filtering invisible; derived scans discarded upstream coverage | one shared `ScanCoverageTracker` using the canonical states | yes | yes | yes | **`e5648d3`, `b962cd8`** | **CLOSED (doc 137)** |
| D07 | cancellation | no cooperative cancellation on legacy sweeps | `ScanBounds.signal`; native cancellation tokens | yes | yes | yes | doc 96, `e5648d3` | **CLOSED** |
| D08 | stale target | PID reuse | identity verification on attach | yes | yes | yes | doc 96 | **CLOSED** |
| D09 | process exit | exit mid-scan looked like an absence | `process_exited` terminal state, now also on legacy sweeps and pointer scans | yes | yes | yes | doc 96, `e5648d3` | **CLOSED** |
| D10 | result / IPC bounding | unbounded match accumulation | `DEFAULT_MAX_MATCHES` always applied; `resource_limit` reported | yes | yes | yes | doc 92 | **CLOSED** |
| D11 | session persistence | snapshot persistence surface | routed route uses `NativeScanTarget`, which has none | structural proof | yes | yes | `06c98e4` | **PROVABLY_NOT_APPLICABLE** |
| D12 | packaged native addon | addon resolution | loads strictly from the packaged path | yes | yes | yes | `06c98e4` | **CLOSED** |
| D13 | direct legacy bypasses | callers reaching `MemoryDriver` directly | routed through the backend contract | yes | yes | yes | `f5db9fe`, `46adeaf`, `e5648d3` | **CLOSED** (primitive/AOB; residual named below) |
| D14 | fuzzy / drift AOB legacy-only | believed unmigratable | `SHARED_BACKEND_RESOLVER`, no new Rust | yes | yes | yes | `46adeaf`, `c53df4d` | **CLOSED** |
| D15 | native build / CI reproducibility | hidden artifact dependency | fresh-worktree gate | yes | yes | yes | `c529352`, `6fcd0c5` | **CLOSED** |
| D16 | fixture leaked a duplicate planted pattern | heap `Vec<u8>` never scrubbed | scrub + `black_box` | yes | n/a | yes | `1788f56` | **CLOSED** (test infrastructure) |
| **D17** | **native backend discarded per-region completeness** | `worstCompleteness = outcome.completeness` overwrote instead of accumulating; policy-excluded regions counted as read | `CompletenessAccumulator`; region counts taken from native metrics | **yes — found by real-game coverage** | yes | yes | **`e5648d3`** | **CLOSED (doc 139)** |
| **D18** | **`scanFirstRange` aborted the sweep on a skip** | shared `if (truncated) break` conflated skip with stop | skip continues, only a stop breaks | yes | yes | yes | **`e5648d3`** | **CLOSED (doc 137)** |
| **D19** | **`maxRegionBytes` exclusions invisible** | regions filtered out before the `try` | excluded regions recorded as skipped | yes | yes | yes | **`e5648d3`** | **CLOSED (doc 137)** |
| **D20** | **derived scans out-claimed their source** | snapshot completeness discarded | `inherit(upstream)` | yes | yes | yes | **`e5648d3`** | **CLOSED (doc 137)** |
| **D21** | **pointer scan threw on a dead process** | `getModules` outside any guard | structured `process_exited` / `module_enumeration_failed` | **yes** | n/a | yes | **`e5648d3`** | **CLOSED (doc 138)** |

D17-D21 are new in this closeout. None was in the mission brief; all were found while closing D01, D05 and the coverage requirement, and all are genuinely within Phase 1 scope, so they were fixed here rather than recorded for later.

## Residual, named rather than implied

These are real, current limitations. They are **not** open defects against Phase 1's scope, and each has a roadmap-backed destination:

| Item | Why it is not a Phase 1 defect | Destination |
|---|---|---|
| Value-scan fan-out, next-scan and unknown-initial-value scans remain legacy-routed | Phase 1's scope is truth-reporting and the AOB/primitive migration; these paths now report truthfully (D06) | Stage 8 |
| Native module enumeration does not exist; both backends share the OS module list | never claimed; fail-closed and identical across backends | Stage 8 (doc 133 FA-2) |
| Region-selection policy excludes 25-53% of a real game's eligible address space | the policy's *behavior* is now fully visible (doc 139); whether it should admit more is scan-strategy work | Phase 2 (ROADMAP D13, adaptive scan planner) |
| 81 Semgrep full-audit findings (advisory, non-blocking) | outside scanner scope | Phase 13 (doc 133 FA-5) |
| 18 Dependabot findings (12 high) | dependency graph, not scanner | Phase 13 (doc 133 FA-6) |

## Summary

| Status | Count |
|---|---|
| `PRODUCT_DEFECT_CLOSED` | **20** |
| `PROVABLY_NOT_APPLICABLE` (with structural proof) | 1 |
| `PRODUCT_DEFECT_NOT_YET_CLOSED` | **0** |
| `UNKNOWN` / `N/A` / `UNRECONCILED` | **0** |

Every Phase 1-scoped defect is closed. Doc 132's single open row — D05 — is closed by doc 138.
