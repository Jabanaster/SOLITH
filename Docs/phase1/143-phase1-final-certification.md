# Phase 1 — Final Certification

**This document is the current-status authority for Phase 1.** Where any earlier document's *current-status* claim disagrees with it, this one governs. No historical report has been rewritten; each remains valid as a record of what was true when written, and the six whose current-status claims changed now carry a supersession banner pointing here.

Supersedes doc 136 (`NOT_COMPLETE`) and doc 131 (the previous authoritative index).

## §19 — Stale current-status reconciliation

Every occurrence of a status marker in `Docs/phase1/`, classified.

| Document | Marker | Classification |
|---|---|---|
| 25, 34, 44, 46, 53, 58, 68, 70, 71, 85, 87, 94, 99, 101, 105, 107, 111, 119, 124, 126 | `NOT_COMPLETE`, `PRODUCT_DEFECT_NOT_YET_CLOSED`, `UNRESOLVED` | `HISTORICAL_SUPERSEDED` — each records a per-stage state, later closed and already superseded by a later stage's document |
| **130** | gate item 19, "Pointer depth remains OPEN" | was `STALE_CURRENT_STATUS` → banner added; D05 closed by doc 138 |
| **131** | D01 / D05 / coverage rows | was `STALE_CURRENT_STATUS` → banner added; superseded by this document |
| **132** | `D05: PRODUCT_DEFECT_NOT_YET_CLOSED` | was `STALE_CURRENT_STATUS` → banner added; superseded by doc 140 |
| **133** | FA-1, FA-8 forward assignments | was `STALE_CURRENT_STATUS` → banner added; both closed, not carried |
| **134** | 4 open requirements; "Stardew Valley is not installed" | was `STALE_CURRENT_STATUS` and one **factually incorrect** finding → banner added; superseded by docs 139, 141 |
| **136** | `PHASE 1 FINAL VERDICT: NOT_COMPLETE` | was `STALE_CURRENT_STATUS` → banner added; superseded by this document |
| 137–144 | — | `CURRENT_VALID` |

**`STALE_CURRENT_STATUS` remaining: 0.** No document is left presenting a superseded current-status claim without a pointer to the one that replaces it. No historical document was edited beyond the addition of that pointer.

Documents 01–144 are contiguous, with no gaps and no duplicate numbers.

## §25 — Final certification gate

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Stage 1 certified / reconciled | **MET** | doc 131 |
| 2 | Stage 2 certified / reconciled | **MET** | doc 131 |
| 3 | Stage 3 certified / reconciled | **MET** | doc 131 |
| 4 | Stage 4 certified / reconciled | **MET** | doc 131 |
| 5 | Stage 5 certified / reconciled | **MET** | doc 131; corpus policy doc 135 |
| 6 | Stage 5.4 certified / reconciled | **MET** | doc 131 |
| 7 | Stage 6 certified / reconciled | **MET** | doc 131 |
| 8 | Stage 6.1 certified / reconciled | **MET** | doc 131 |
| 9 | Stage 7 certified | **MET** | doc 130 (38/38) |
| 10 | Stage 7.4 reconciled | **MET** | doc 131, including the correction to its local-pass claim |
| 11 | Stage 7.5 certified | **MET** | doc 130 |
| 12 | **D01 fully closed at all sibling sites** | **MET** | doc 137 — ten sites, one shared rule, mechanically asserted |
| 13 | **D05 pointer depth fully closed** | **MET** | doc 138 |
| 14 | **pointer truncation truthful** | **MET** | doc 138 §10 — eight terminal states |
| 15 | **pointer depth semantics verified in a real process** | **MET** | doc 138 §13 — 8/8, module-rooted chain, 3 consecutive |
| 16 | **real-game coverage requirement satisfied** | **MET** | doc 139 — Stardew 68.32 %, DREDGE 73.51 % at the code-final SHA; run-to-run variance recorded |
| 17 | all Phase 1 defects reconciled | **MET** | doc 140 — 20 closed, 1 provably N/A, 0 open, 0 unknown |
| 18 | stale current doc statuses = 0 | **MET** | §19 above |
| 19 | direct production legacy AOB callers = 0 | **MET** | doc 126; `scanAobSignature` routed in `e5648d3` |
| 20 | unknown legacy callers = 0 | **MET** | doc 126 |
| 21 | default backend NATIVE | **MET** | asserted with zero override in real-process tests and 5/5 real games |
| 22 | LEGACY rollback works | **MET** | doc 124 — real-process rollback and toggle-back, no rebuild |
| 23 | SHADOW_COMPARE works | **MET** | docs 124, 125 |
| 24 | packaged native addon works | **MET** | doc 142 — both packaged proofs |
| 25 | fresh worktree passes | **MET** | doc 142 — 18/18 at the code-final SHA `30436d0` |
| 26 | remote CI passes | **MET** | doc 142 — 7/7 required checks at `30436d0` |
| 27 | Semgrep passes | **MET (remote; local run unavailable)** | doc 142 — remote `semgrep.yml` passes at the code-final SHA; the local pre-check could not run because PyPI is unreachable from this machine, and that is recorded as missing rather than reported as passed |
| 28 | npm audit 0 | **MET** | 0 vulnerabilities |
| 29 | roadmap requirements 100 % accounted and met | **MET** | doc 141 — 23/23 accounted, 23/23 met |
| 30 | unresolved Phase-1 P0 = 0 | **MET** | doc 140 |
| 31 | unresolved Phase-1 P1 = 0 | **MET** | doc 140 |
| 32 | ROADMAP untouched | **MET** | `ROADMAP.md` appears in no commit's diff since `6fcd0c5` |
| 33 | shipping tree untouched | **MET** | `G:\ACTIVE_PROJECTS\SOLITH` at `9fdc6e7`, same branch, same 4 untracked files |
| 34 | PR #31 OPEN / not merged | **MET** | OPEN |
| 35 | PR #29 OPEN / not merged | **MET** | OPEN |
| 36 | local == remote | **MET** | both `30436d0` |
| 37 | worktree clean | **MET** | doc 142 |

## Verdict

**PHASE 1 FINAL VERDICT: `CERTIFIED COMPLETE`.**

37 of 37. Doc 136's three blocking items are closed on the roadmap's own terms, not by reinterpretation:

- **D05** could not be forward-assigned because ROADMAP line 116 places pointer *truth-reporting* in Phase 1. It is closed, and only the truth-reporting half — the feature work stays in Phase 2 where the same line puts it.
- **ROADMAP D01** could not be closed on a subset. All ten sites are closed, four more than the roadmap's own estimate, with a source-shape assertion that fails if any regresses.
- **The coverage percentage** was never Stardew-specific; the requirement is "at least one of the 7 curated titles". Two were measured. Doc 134's "not installed" finding was simply wrong, and is corrected rather than worked around.

## What this stage changed about earlier conclusions

Recorded because a certification that quietly revises history is not a certification.

1. **Doc 134's Stardew finding was incorrect.** Not an environmental limitation — an incomplete search. Four Steam libraries exist on this machine; two were checked. Six of the seven curated titles are installed.

2. **"Mechanical" was wrong.** Doc 136 described D01's remaining work as mechanical: six assignments and six tests. It was ten sites and four additional defects, one of them inside a function a previous phase had already certified as repaired (`scanFirstRange` aborted the sweep on a skip).

3. **The native backend was under-reporting its own skipped regions.** Found only by measuring real-game coverage and checking the result for internal consistency. A Stardew scan left 375 MiB of eligible memory unread and reported one skipped range of 53 KiB. Every stage-level completeness claim before this one was made against that under-report — they remain true as far as they went, because the routed paths did report their per-region state correctly; what was lost was the aggregate.

4. **A real-game coverage number exists for the first time,** and it is 46–75 %, not 100 %. The honest figure is lower than a reader of "PRODUCT_DEFECT_CLOSED ×20" might expect, and it is stated plainly: the region-selection policy declines a quarter to a half of a real game's eligible address space. Whether it should is Phase 2's adaptive-planner question (ROADMAP D13). What Phase 1 owed was that the exclusion be visible, and it now is.

## Scope boundaries, stated rather than implied

- **Pointer features** — structure discovery, the adaptive planner, restart-stability campaigns — are Phase 2 by ROADMAP line 116. Untouched.
- **Value-scan fan-out, next-scan and unknown-initial-value scans remain legacy-routed.** They now report truthfully (doc 137); routing them is Stage 8.
- **Native module enumeration does not exist.** Both backends are fed the same OS module list. Stage 8.
- **The region-selection policy's exclusions** are measured and reported, not changed.
- **81 Semgrep full-audit findings and 18 Dependabot findings** are outside Phase 1's scanner scope, classified and assigned in doc 133.

## Next

**PHASE 2 — Advanced Memory Engineering & Adaptive Scan Intelligence**, per the canonical ROADMAP.

Not started. Phases 2–7 are inventoried in doc 144, which records why a Phase 0–7 certification is `NOT_COMPLETE` and exactly what is missing.
