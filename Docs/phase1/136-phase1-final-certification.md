# Phase 1 — Final Certification

> **Supersession notice (Phase 1 final closure).** This document’s verdict — PHASE 1: NOT_COMPLETE — was correct at `2618286` and is **superseded by doc 143**. All three blocking items it names (D05, ROADMAP D01, the real-game coverage percentage) are closed by docs 138, 137 and 139.


Assessed at `97e51b5` (code-final). This is a **phase-level** verdict and is deliberately not the same as Stage 7.5's stage-level verdict in doc 130.

## Gate

| # | Requirement | Status |
|---|---|---|
| 1 | Stage 1 reconciled | **MET** — doc 131 |
| 2 | Stage 2 reconciled | **MET** — doc 131 |
| 3 | Stage 3 reconciled | **MET** — doc 131 |
| 4 | Stage 4 reconciled | **MET** — doc 131 |
| 5 | Stage 5 reconciled | **MET** — doc 131 |
| 6 | Stage 5.4 reconciled | **MET** — doc 131 |
| 7 | Stage 6 reconciled | **MET** — doc 131 |
| 8 | Stage 6.1 reconciled | **MET** — doc 131 |
| 9 | Stage 7 reconciled | **MET** — doc 131 |
| 10 | Stage 7.4 reconciled | **MET** — doc 131, including the correction to its local-pass claim |
| 11 | Stage 7.5 certified | **MET** — doc 130 |
| 12 | All historical defect statuses reconciled | **MET** — doc 132 |
| 13 | Stale CURRENT defect statuses = 0 | **MET** — doc 131 is authoritative for current status |
| 14 | All direct production primitive/AOB legacy callers migrated | **MET** — 0 (doc 126) |
| 15 | Fuzzy production path migrated | **MET** — doc 124 |
| 16 | Pointer-depth status explicitly preserved / forward-assigned | **MET as a status** — preserved and explicit; **but it cannot be forward-assigned** (see verdict) |
| 17 | Current AOB corpus policy consistent | **MET** — 111,467 current / 120,245 `HISTORICAL_CERTIFIED_RUN_COUNT_UNRECONCILED`; no estimate resurrected (doc 135) |
| 18 | Current backend default NATIVE | **MET** |
| 19 | Rollback LEGACY works | **MET** |
| 20 | SHADOW_COMPARE works | **MET** |
| 21 | Packaged native addon PASS | **MET** |
| 22 | Clean build PASS | **MET** |
| 23 | Fresh worktree PASS | **MET** — three runs, doc 128 |
| 24 | Remote CI PASS | **MET** — 7/7 at `97e51b5`, doc 129 |
| 25 | Semgrep PASS | **MET** — local and remote |
| 26 | npm audit 0 | **MET** |
| 27 | Preserved branch dispositions known | **MET** — 0 unknown, doc 133 |
| 28 | PR #29 status recorded | **MET** — OPEN, not merged |
| 29 | PR #31 status recorded | **MET** — OPEN, not merged |
| 30 | Docs/phase1 authoritative index complete | **MET** — doc 131, 01-136 contiguous |
| 31 | ROADMAP Phase 1 requirement accounting 100% | **MET** — 23/23 accounted, doc 134 |
| 32 | Unresolved Phase-1 P0 defects = 0 | **NOT MET** |
| 33 | Unresolved Phase-1 P1 defects = 0 | **NOT MET** |
| 34 | local == remote | **MET** |
| 35 | Worktree clean | **MET** |
| 36 | ROADMAP untouched | **MET** |
| 37 | Shipping preservation worktree untouched | **MET** — `9fdc6e7`, same 4 untracked files |

## Verdict

**PHASE 1 FINAL VERDICT: NOT_COMPLETE.**

35 of 37 gate items are met. Two are not, and both trace to the same root: `ROADMAP.md` assigns work to Phase 1 that Phase 1 has not done. This verdict rests on the roadmap's own text, not on a judgment call.

### Open item 1 — D05, pointer-depth truth-reporting

`levelsSearched: 1` reported against `maxDepth: 3`, with `truncated: false`. Untouched by every Stage 7.x pass, each time by explicit instruction.

**It cannot be forward-assigned.** Mission §O permits forward-assignment "only if the roadmap explicitly places its full reconstruction later". The roadmap does the opposite:

- Line 165 lists D05 with phase **1**.
- Line 116: *"Pointer scanning | PARTIAL | Exists, tested, inherits scanner's silent-truncation defects | **1 (truth-reporting), 2 (feature)**"* — the feature work is Phase 2; the truth-reporting work is Phase 1.
- Line 96: *"the deeper scanner defects (1 MiB cap, alignment, AOB fail-open, **pointer-depth**) remain open and are **Phase 1 scope**"*.
- Line 270 lists it under Phase 1's Mandatory Work.

**Destination: Phase 1.** No later phase owns it.

### Open item 2 — ROADMAP D01, sibling truth-reporting sites

The roadmap asks for `truncated = true` at each remaining `catch{continue}` site, one regression test per site. Measured at `97e51b5`, six sibling functions in `memory-scanner.ts` still do not set it:

| Line | Function |
|---|---|
| 163 | `scanFirst` |
| 285 | `scanNext` |
| 365 | `scanFirstUnknown` |
| 409 | `scanNextFromSnapshot` |
| 537 | `scanNextFromSnapshotMultiType` |
| 613 | `scanFirstByComparison` |

(`scanFirstRange` at 234 does set it — the pre-Phase-1 P0-SCAN-001 repair.) That is **six**, where ROADMAP line 96 estimated four.

Phase 1 built a native scanner whose completeness contract makes silent skipping structurally impossible and routed production to it, which closes the defect for every routed path. It does not close it for the value-scan paths that were never routed — `scanFirstAutoMatrix`, `scanNext`, `scanFirstUnknown`, `scanNextFromUnknown` — which are reachable from live IPC handlers and still report `truncated: false` when a region is skipped for exceeding the 1 MiB ceiling.

The roadmap's prohibited-shortcut clause is explicit: *"Do not mark D01 closed by fixing only a subset of the five sibling functions."* So it is not marked closed. The remaining work is mechanical and ready to do; it was not folded into a scanner-integration stage scoped to fuzzy AOB closure, and is raised here for an owner decision.

### Also unmet, and worth naming

ROADMAP's Phase 1 verification requirements ask for a **recorded, honest real-game coverage percentage** against one of the 7 curated titles. It is not recorded. Stardew Valley — the title doc 10's exit gate names — is confirmed not installed on this machine (docs 80, 91). The canaries record regions, bytes read, matches, completeness and duration across Bastion, Godlike Burger and Aegis Defenders, but no coverage percentage and no curated-roster title. Forward-assigned within Phase 1 (doc 133, FA-8).

## What is genuinely finished

The verdict above should not obscure the scale of what is closed. Of fifteen tracked scanner defects, **fourteen are `PRODUCT_DEFECT_CLOSED` in the shipping product**, including all four the Stage 7.5 mission named plus the fuzzy AOB path that Stage 7.4 had concluded was permanently unmigratable. Zero legacy AOB callers remain in normal production. Every automated suite is green locally, in three independent clean worktrees, and across 7/7 remote checks.

Phase 1 is close. It is not done, and saying so is the point of this document.

## Forward-assigned items

| ID | Item | Destination |
|---|---|---|
| FA-1 | D05 pointer-depth truth-reporting | **Phase 1** — cannot move |
| FA-8 | Real-game coverage percentage | **Phase 1** — cannot move |
| (new) | ROADMAP D01 remaining six sibling sites | **Phase 1** — cannot move |
| FA-2 | Native module enumeration | Stage 8 |
| FA-3 | Unrouted legacy value-scan paths | Stage 8 |
| FA-4 | Point-read call sites | Stage 8 |
| FA-7 | `x86_on_wow64` positive validation | Stage 8 / Phase 12 |
| FA-5 | 81 Semgrep full-audit findings | Phase 13 / security pass |
| FA-6 | 18 Dependabot findings (12 high) | Phase 13 / dependency pass |

Nothing is carried silently. Every item above has a defect, a reason, a destination and evidence in doc 133.

## Next

**Not Phase 2.** Phase 1 must close its three remaining Phase-1-scoped items first. Stage 8 may proceed independently for the Stage-8-assigned items, but it does not close Phase 1 on its own.
