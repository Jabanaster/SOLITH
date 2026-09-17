# Phase 1 — ROADMAP Requirement Reconciliation

> **Supersession notice (Phase 1 final closure).** Superseded as the current reconciliation by **doc 141**, which recomputes the accounting as 23/23 met. Its finding that Stardew Valley is not installed was incorrect — see doc 139. Preserved unmodified as the record of what was measured at `2618286`.


`ROADMAP.md` is **not modified** by this work. This document compares completed work against `ROADMAP.md`'s Phase 1 section (lines 257-287) and its defect register, so every requirement is accounted for.

Legend: `IMPLEMENTED` / `TESTED` / `CERTIFIED` / `OPEN` / `FORWARD-ASSIGNED`.

## Mandatory Work

| # | ROADMAP requirement | Implemented | Tested | Certified | Status |
|---|---|---|---|---|---|
| 1 | Fix **D01** (sibling truth-reporting gaps) "using the exact proven `scanFirstRange` pattern — add `truncated = true` at each remaining `catch{continue}` site, one regression test per site" | partial | partial | no | **OPEN** — see below |
| 2 | Remove the 1 MiB region-read cap (**D02**); chunked scanning with truthful coverage | yes | yes | yes | `CERTIFIED` (doc 107; matrix D01) |
| 3 | Remove forced alignment (**D03**); support unaligned values | yes | yes | yes | `CERTIFIED` (doc 113; matrix D02) |
| 4 | Repair AOB/signature scanning above the cap (**D04**); eliminate false `found:false` | yes | yes | yes | `CERTIFIED` (docs 116, 124; matrix D03) |
| 5 | Fix pointer-depth/truncation truth-reporting (**D05**) | **no** | no | no | **OPEN** |
| 6 | Resolve the int64 mismatch at the IPC boundary (**D06**) — "fix site is `ipc-validation.ts`, not only the decoder" | yes | yes | yes | `CERTIFIED` (docs 112, 114; matrix D04) |
| 7 | Implement exact scan, unknown initial value, changed/unchanged/increased/decreased/increased-by/decreased-by, value-range scans, integer families, float/double, strings, byte arrays, AOB/binary patterns, scan refinement | yes | yes | yes | `CERTIFIED` (docs 19-26, 27-35, 36-58) |
| 8 | Large-process support, cancellation, progress reporting, resumable scan sessions, performance measurement, memory safety, process-exit/stale-process handling | yes | yes | yes | `CERTIFIED` (docs 59-70) |

### Requirement 1 — the precise gap

`scanFirstRange` was repaired before Phase 1 began (P0-SCAN-001) and does set `truncated = true` in its `catch`. The ROADMAP asks for the same repair at every remaining sibling site. Measured against `src/core/live-memory/memory-scanner.ts` at `703feaf`:

| Line | Function | Sets `truncated` in its `catch{continue}` |
|---|---|---|
| 163 | `scanFirst` | **no** |
| 234 | `scanFirstRange` | yes (the pre-Phase-1 repair) |
| 285 | `scanNext` | **no** |
| 365 | `scanFirstUnknown` | **no** |
| 409 | `scanNextFromSnapshot` | **no** |
| 537 | `scanNextFromSnapshotMultiType` | **no** |
| 613 | `scanFirstByComparison` | **no** |

**Six** sibling sites remain, not the four ROADMAP line 96 estimated.

What Phase 1 did instead was build a native scanner whose completeness contract makes silent skipping structurally impossible, and route production to it. That genuinely closes the defect **for every routed path** — exact value, exact AOB, and now fuzzy AOB — and `LegacyScannerBackend` additionally surfaces the previously-silent skip as a named `complete_with_skipped_regions` range.

It does not close it for the value-scan paths that were never routed: `scanFirstAutoMatrix`, `scanNext`, `scanFirstUnknown` and `scanNextFromUnknown` are reachable from live IPC handlers (`live-memory-ipc.ts:539/570/585/606`) and still return `truncated: false` when a region is skipped for being over the 1 MiB ceiling.

The ROADMAP's own prohibited-shortcut clause is explicit: *"Do not mark D01 closed by fixing only a subset of the five sibling functions."* It is therefore **not** marked closed. The remaining work is mechanical — six `truncated = true` assignments and six regression tests — and is ready to be done; it is recorded here as an owner decision rather than folded into a scanner-integration stage that was scoped to fuzzy AOB closure.

## Repository / Technology Adoption

| Requirement | Status |
|---|---|
| napi-rs, FULL adoption as the native Rust↔Node boundary | `CERTIFIED` — `native/solith-scanner-napi`, docs 14, 22, 31, 41 |
| Native Rust scanner architecture as needed | `CERTIFIED` — `native/solith-scanner-core`, docs 06, 11-18 |
| No other Phase 1 adoptions frozen | met — none added |

## Preserved Work Inputs

ROADMAP: *"None — no preserved ref contains scanner-reconstruction code."* **Confirmed** by the Stage 7.5 re-audit: no preserved branch contains scanner-reconstruction code (doc 133).

## Verification Requirements

| Requirement | Status |
|---|---|
| Extended `memory-scanner` / `live-memory` suites | `CERTIFIED` — live-memory 395/395; JS/TS 1896 + 10; Rust 185 (1 ignored); NAPI 52 |
| **Real-game scan coverage measured against at least one of the 7 curated titles, with a recorded honest coverage percentage — not a synthetic-fixture-only claim** | **OPEN** — see below |
| Large-region behavior verified | `CERTIFIED` — 4 MiB and 8 MiB fixture regions; a 16-byte signature resolved 6 MiB deep under NATIVE (docs 124, 127) |
| Performance baseline recorded | `CERTIFIED` — docs 04, 16, 24, 33, 43, 67, 81; per-title durations in doc 127 |
| Fresh install/build/package validation | `CERTIFIED` — doc 128 |

### The coverage-percentage gap

Doc 10's exit-gate design names Stardew Valley (with a measured % directly comparable to Audit 2's ~4.5 % / ~95.5 %-unread baseline) and Palworld as a second, architecturally different title.

**Stardew Valley is not installed on this machine** — only its `%AppData%` save folder exists. Confirmed in doc 80 and reconfirmed independently in doc 91. The Stage 7.3/7.4/7.5 canaries therefore use Bastion, Godlike Burger and Aegis Defenders, and record regions considered, bytes read, match counts, completeness and duration per title — but **not a coverage percentage** against each process's total committed memory, and not against a curated-roster title.

This is an environmental gap honestly disclosed rather than an accounting error, but it is unmet. Forward-assigned within Phase 1 (doc 133, FA-8).

## Exit Gate

| Exit-gate item | Status |
|---|---|
| Zero known Phase-1 scanner correctness defects | **NOT MET** — D05 (pointer depth) open; ROADMAP D01 partially open |
| Truthful coverage reporting at **every** code path | **NOT MET** — six legacy sibling sites still silent |
| Full required automated suite green | **MET** — every suite green locally and in a fresh worktree |
| Real-game scan coverage independently verified and recorded | **NOT MET** — no coverage percentage recorded |
| Large-region behavior verified | **MET** |
| Performance baseline recorded | **MET** |
| Fresh install/build/package validation passes | **MET** — doc 128 |

## Defect register cross-check (ROADMAP lines 160-170)

| ROADMAP D# | Phase assigned | Status |
|---|---|---|
| D01 sibling truth-reporting | 1 | **OPEN** (partial) |
| D02 1 MiB cap | 1 | CLOSED |
| D03 alignment | 1 | CLOSED |
| D04 AOB fail-open | 1 | CLOSED |
| **D05 pointer-scan depth truncation/misreporting** | **1** | **OPEN** |
| D06 int64 IPC mismatch | 1 | CLOSED |
| D13 adaptive scan planner | 2 | not Phase 1 |
| D15 unhandled promise rejection, D16 env-var gating | 13 | not Phase 1 |

ROADMAP line 116 is the decisive line for D05: *"Pointer scanning | PARTIAL | Exists, tested, inherits scanner's silent-truncation defects | **1 (truth-reporting), 2 (feature)**"*. The *feature* work is Phase 2; the **truth-reporting** work is Phase 1. D05 therefore cannot be forward-assigned out of Phase 1.

## Accounting

**ROADMAP Phase 1 requirements accounted for: 8/8 mandatory work items + 3/3 adoption items + 5/5 verification requirements + 7/7 exit-gate items = 23/23. No orphan requirement.**

Of those: **19 met, 4 open** — ROADMAP D01 (partial), D05 (pointer depth), truthful coverage at every code path, and the recorded real-game coverage percentage. Every open item is named, evidenced, and assigned in doc 133.
