# Phase 1 — Final ROADMAP Requirement Reconciliation

`ROADMAP.md` is **not modified** by this work, and was not modified by any prior stage. This document recomputes doc 134's accounting after the D01, D05 and coverage closures, and supersedes it as the current-status reconciliation. Doc 134 is preserved unmodified.

Doc 134's figure was **19 met / 4 open**. All four are now met.

## Mandatory Work (ROADMAP lines 261-272)

| # | ROADMAP requirement | Implemented | Tested | Certified | Status | Was (doc 134) |
|---|---|---|---|---|---|---|
| 1 | Fix **D01** — "add `truncated = true` at each remaining `catch{continue}` site, one regression test per site" | yes | yes | yes | **`CERTIFIED`** (doc 137) | OPEN |
| 2 | Remove the 1 MiB region-read cap (**D02**); chunked scanning with truthful coverage | yes | yes | yes | `CERTIFIED` | `CERTIFIED` |
| 3 | Remove forced alignment (**D03**) | yes | yes | yes | `CERTIFIED` | `CERTIFIED` |
| 4 | Repair AOB/signature scanning above the cap (**D04**) | yes | yes | yes | `CERTIFIED` | `CERTIFIED` |
| 5 | Fix pointer-depth/truncation truth-reporting (**D05**) | yes | yes | yes | **`CERTIFIED`** (doc 138) | OPEN |
| 6 | Resolve the int64 mismatch at the IPC boundary (**D06**) | yes | yes | yes | `CERTIFIED` | `CERTIFIED` |
| 7 | Scan type coverage (exact, unknown-initial, comparisons, ranges, integer families, float/double, strings, byte arrays, AOB, refinement) | yes | yes | yes | `CERTIFIED` | `CERTIFIED` |
| 8 | Large-process support, cancellation, progress, resumable sessions, performance, memory safety, process-exit/stale handling | yes | yes | yes | `CERTIFIED` | `CERTIFIED` |

### Requirement 1, closed on the roadmap's own terms

The roadmap asks for the repair at **every** remaining sibling site and forbids closing on a subset. Doc 134 measured six sites in `memory-scanner.ts`. The re-audit found **ten** across the scanner surface — the six plus `findPointersNear`, `scanAobInProcess`, `scanExactSignature` and `scanFuzzySignature` — and four further truth gaps that no count had captured (doc 137 §1). All ten are repaired against one shared rule, and a source-shape assertion in the test suite fails if any of them regresses.

The literal ask was "one regression test per site". What was delivered is stronger: mission §4's seven-case matrix run against every sweeping function from a single table (43 cases), so a future divergence between siblings fails rather than passing six independent tests that have drifted apart.

### Requirement 5, closed without touching Phase 2's scope

ROADMAP line 116 splits pointer scanning as "**1 (truth-reporting), 2 (feature)**". Doc 138 closes the truth-reporting half only: depth semantics, termination reasons, cycle safety, truthful caps. Structure discovery and the adaptive planner remain Phase 2, untouched.

## Repository / Technology Adoption

| Requirement | Status |
|---|---|
| napi-rs, FULL adoption as the native Rust↔Node boundary | `CERTIFIED` |
| Native Rust scanner architecture as needed | `CERTIFIED` |
| No other Phase 1 adoptions frozen | met — none added |

## Preserved Work Inputs

ROADMAP: *"None — no preserved ref contains scanner-reconstruction code."* Confirmed by the Stage 7.5 re-audit (doc 133) and unchanged by this work.

## Verification Requirements (ROADMAP line 281)

| Requirement | Status | Was |
|---|---|---|
| Extended `memory-scanner` / `live-memory` suites | `CERTIFIED` — live-memory 478/478; JS/TS 1979 + 10; Rust 185 (1 ignored); NAPI 52 | `CERTIFIED` |
| **Real-game scan coverage measured against at least one of the 7 curated titles, with a recorded honest coverage percentage** | **`CERTIFIED`** — Stardew Valley **68.22 %**, DREDGE **63.84 %** (doc 139) | **OPEN** |
| Large-region behavior verified | `CERTIFIED` | `CERTIFIED` |
| Performance baseline recorded | `CERTIFIED` — per-title durations in docs 127 and 139 | `CERTIFIED` |
| Fresh install/build/package validation | `CERTIFIED` — doc 142 | `CERTIFIED` |

### Correcting doc 134's coverage finding

Doc 134 recorded the coverage requirement as blocked because "Stardew Valley is not installed on this machine", citing docs 80 and 91. **That finding was incorrect.** Stardew Valley is installed, on `Z:\SteamLibrary`; the earlier searches covered only `C:` and `G:`. Reading `libraryfolders.vdf` rather than probing guessed paths finds it, along with four other curated titles.

Docs 80, 91 and 134 are preserved unmodified. Doc 139 carries the current status and explains the method.

The requirement asks for "at least one of the 7". Two were measured.

## Exit Gate (ROADMAP line 283)

| Exit-gate item | Status | Was |
|---|---|---|
| Zero known Phase-1 scanner correctness defects | **MET** — doc 140: 20 closed, 1 provably N/A, 0 open | NOT MET |
| Truthful coverage reporting at **every** code path | **MET** — doc 137, all ten sites, asserted mechanically | NOT MET |
| Full required automated suite green | MET | MET |
| Real-game scan coverage independently verified and recorded | **MET** — doc 139 | NOT MET |
| Large-region behavior verified | MET | MET |
| Performance baseline recorded | MET | MET |
| Fresh install/build/package validation passes | MET — doc 142 | MET |

## Defect register cross-check (ROADMAP lines 160-170)

| ROADMAP D# | Phase assigned | Status |
|---|---|---|
| D01 sibling truth-reporting | 1 | **CLOSED** (doc 137) |
| D02 1 MiB cap | 1 | CLOSED |
| D03 alignment | 1 | CLOSED |
| D04 AOB fail-open | 1 | CLOSED |
| D05 pointer-scan depth truncation/misreporting | 1 | **CLOSED** (doc 138) |
| D06 int64 IPC mismatch | 1 | CLOSED |
| D13 adaptive scan planner | 2 | not Phase 1 |
| D15 unhandled promise rejection, D16 env-var gating | 13 | not Phase 1 |

Every defect the roadmap assigns to Phase 1 is closed. Nothing Phase 1 owns has been forward-assigned.

## Accounting

**8/8 mandatory + 3/3 adoption + 5/5 verification + 7/7 exit-gate = 23/23 requirements accounted for, 23/23 met.**

No orphan requirement. No requirement self-waived. No Phase 1 requirement pushed to a later phase.
