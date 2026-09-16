# Phase 1 — Authoritative Status Index

**This document is the current-status index for Phase 1.** Where an older document's *current-status* claim disagrees with a row below, this index is authoritative. No historical report has been rewritten; each remains valid as a record of what was true when it was written.

Established at `703feaf` (Stage 7.5 candidate). Working tree of record: `G:\ACTIVE_PROJECTS\solith-phase0-convergence`, branch `feature/solith-phase1-scanner-reconstruction`.

## Lineage (verified from git, not from prose)

| Point | Full SHA | Date | Subject | Ancestor of HEAD |
|---|---|---|---|---|
| Phase 0 roadmap freeze | `239fd88c4aaad720e3f6c7865064fe5fec9f771c` | 2026-09-13 | docs: freeze canonical 15-phase SOLITH roadmap | yes |
| Phase 0.14.1 repair | `3b8c1c33c014b440df9dbe9646fa8c647f6de37a` | 2026-09-13 | test: decouple product contracts from roadmap prose | yes |
| Stage 6.1 accounting repair | `23dc5551bbc22f3fd1f47ef9a1081ebca738bbbe` | 2026-09-14 | docs(scanner): correct Stage 6 shipping defect accounting | yes |
| Stage 7.4 final report baseline | `0fcc77d74c7de8ab494078816e21896796750dc6` | 2026-09-15 | docs(scanner): correct final certification with real remote CI outcome | yes |
| Semgrep follow-up | `6fcd0c5dd193dc9293f94d2ef7eaddf95ade8466` | 2026-09-15 | fix(security): resolve pre-existing Semgrep blocking findings on PR #31 | yes (was HEAD at Stage 7.5 entry) |

All five short SHAs quoted in the Stage 7.5 mission resolve to exactly these commits, and every one is a genuine ancestor of the current HEAD. `3b8c1c3` is also the tip of `feature/solith-canonical-convergence-phase0` (PR #29's head), which is therefore **already integrated into this branch** even though PR #29 itself remains open against `master`.

## Stage status

Allowed values: `CERTIFIED`, `SUPERSEDED_BY_LATER_CERTIFICATION`, `NOT_COMPLETE`.

| Stage | Status | Certifying commit | Authoritative evidence | Superseded docs | Open items |
|---|---|---|---|---|---|
| 1 — Audit / design | `CERTIFIED` | `f52fa20` | 01-10 (gate: 10) | — | none |
| 2 — Native scanner foundation | `CERTIFIED` | `36d89db` | 11-18 (gate: 18) | — | `x86_on_wow64` positive validation not executed — no i686 Rust target installed; disclosed in doc 17, still true |
| 3 — Exact primitive engine | `CERTIFIED` | `598cc44` | 19-26 (gate: 26) | — | none |
| 4 — Refinement engine | `CERTIFIED` | `58f6cbd` | 27-35 (gate: 35) | — | none |
| 5 — String / byte / AOB engine | `SUPERSEDED_BY_LATER_CERTIFICATION` | `afd5100` | 36-45 | 44, 45 superseded by 5.1-5.4 | verdict was `NOT_COMPLETE` at 5.1/5.3; resolved at 5.4 |
| 5.4 — Final AOB corpus grammar closure | `CERTIFIED` | `98d8e38` | 54-58 (gate: 58) | 46, 48, 53 (all `NOT_COMPLETE`/partial verdicts) | 120,245 remains `HISTORICAL_CERTIFIED_RUN_COUNT_UNRECONCILED` **by policy**, not as a defect (doc 54) |
| 6 — Cancellation / completeness / session hardening | `CERTIFIED` | `23dc555` | 59-70 (gate: 70) | — | none |
| 6.1 — Shipping defect-accounting correction | `CERTIFIED` | `23dc555` | 71 | corrects 68's accounting | none |
| 7 — Production scanner integration | `SUPERSEDED_BY_LATER_CERTIFICATION` | `37f86b8` | 72-87 | gate 87 `NOT_COMPLETE` → superseded by 7.3/7.4/7.5 | — |
| 7.1 / 7.2 / 7.3 | `SUPERSEDED_BY_LATER_CERTIFICATION` | `5964d13`, `ff10505` | 88-111 | gates 101, 111 both `NOT_COMPLETE` → superseded | — |
| 7.4 — Shipping defect closure | `SUPERSEDED_BY_LATER_CERTIFICATION` | `0fcc77d` | 112-121 | gate 121 (`LOCAL PASS` / `REMOTE CI FAIL`) superseded by 7.5 | see correction below |
| 7.5 — Final zero-gap integration closure | see doc 130 | `703feaf` + docs 128-130 | 122-130 | — | pointer depth remains open by design |

### Correction to Stage 7.4's local result

Doc 121 recorded `LOCAL_TECHNICAL_CERTIFICATION: PASS`. That claim was **not accurate at the time it was made**: `tests/live-memory/feature-resolver-native-default-real-process.test.ts`'s legacy-rollback case fails at unmodified `6fcd0c5`, reproducibly, with a different wrong address on each run (ASLR). The cause was a defect in the Rust test fixture, not in the scanner — `apply_write_command` left a second heap-resident copy of every planted pattern — and it is fixed at `1788f56` (doc 124). Doc 121 is preserved unmodified as the historical record; this row is the current status.

Doc 121's `REMOTE_CI_CERTIFICATION: FAIL` was accurate, and is what `6fcd0c5` subsequently addressed (doc 123).

## Document map

| Range | Stage | Notes |
|---|---|---|
| 01-10 | 1 | audit, architecture, semantics, test strategy, exit-gate design |
| 11-18 | 2 | native layout, region enumeration, chunked reader, napi boundary |
| 19-26 | 3 | primitive type model, exact scan engine, result model |
| 27-35 | 4 | session model, refinement, candidate storage, stale-target |
| 36-45 | 5 | string/byte/AOB engine, grammar, corpus analysis |
| 46 | 5.1 | certification repair (`NOT_COMPLETE`) |
| 47-48 | 5.2 | corpus provenance recovery |
| 49-53 | 5.3 | corpus reconciliation, wildcards, continuous hex (`NOT_COMPLETE`) |
| 54-58 | 5.4 | corpus-of-record policy, final coverage, **CERTIFIED** |
| 59-70 | 6 | completeness, progress, cancellation, persistence, **CERTIFIED** |
| 71 | 6.1 | defect accounting repair |
| 72-87 | 7 | production scanner map, backend contract, parity, packaging |
| 88-92 | 7.1 | semantic differences, IPC validation, packaged scan |
| 93-101 | 7.2 | int64 end-to-end, parity matrix, failure injection |
| 102-105 | 7.2/7.3 | cancellation, rollback matrix, parity update |
| 106-111 | 7.3 | native default migration, shipping defect disposition |
| 112-121 | 7.4 | wire types, alignment/u64/AOB shipping closure, defect matrix |
| **122-130** | **7.5** | fuzzy audit, Semgrep, fuzzy migration, failure closeout, legacy inventory, canary, fresh worktree, remote CI, final certification |
| **131-136** | **Phase 1 closeout** | this index, defect matrix, disposition, roadmap reconciliation, reproducibility, final certification |

Numbering 01-136 is contiguous with no gaps and no duplicate numbers. Several *slugs* repeat across stages (`-final-reproducibility`, `-final-certification`, `-legacy-caller-inventory`, `-product-defect-closure`); the numbers disambiguate them and the table above states which is current.

## Related documents

`Docs/phase0/` does not exist. A repo-wide search for Phase 1 stage documents outside `Docs/phase1/` returns nothing — `Docs/Security/`, `Docs/Certification/`, `Docs/Reports/`, `Docs/roadmap/` and `Docs/authority/` contain no Phase 1 stage docs.

## Companion documents

- **132** — final defect matrix (D01-D15)
- **133** — legacy and preserved-work disposition, plus forward assignments
- **134** — ROADMAP Phase 1 requirement reconciliation (ROADMAP.md itself untouched)
- **135** — Phase 1 final reproducibility
- **136** — Phase 1 final certification verdict
