# Phase 1 / Stage 7 — Final Certification Gate

> **Supersession notice (Phase 1 final closure).** This document’s Stage 7 verdict stands: Stage 7.5 is CERTIFIED. Two of its *current-status* statements have since changed — gate item 19 (“Pointer depth remains OPEN”) and the “Scope boundaries” note that pointer depth is untouched. D05 is closed by doc 138. Nothing else here is altered; see doc 143 for the current Phase 1 status.


Candidate: `97e51b57517c513b19afa89b4e2f084013e3c0fb` (code-final; documentation commits follow).

## Gate

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Shipping tree untouched | **MET** | `G:\ACTIVE_PROJECTS\SOLITH` at `9fdc6e7`, branch `preserve/review-gate2-5-working-tree-2026-09-12`, the same 4 untracked files as at entry. Verified at entry, mid-stage and at close |
| 2 | Default backend NATIVE | **MET** | asserted with zero override in real-process tests and on 3/3 real games (docs 124, 127) |
| 3 | signature-engine exact migrated | **MET** | `MIGRATED_TO_BACKEND` (doc 126) |
| 4 | signature-engine fuzzy migrated | **MET** | `MIGRATED_TO_BACKEND` (docs 122, 124) |
| 5 | Uncontrolled production direct legacy AOB callers = 0 | **MET** | 0, down from doc 119's honestly-reported 1 (doc 126) |
| 6 | Legacy rollback retained | **MET** | `LEGACY_ROLLBACK_ONLY`; real-process rollback and toggle-back, no rebuild (doc 124) |
| 7 | Real fuzzy fixture PASS | **MET** | 23/23 fixture matrix, independent ground truth (doc 124) |
| 8 | Packaged fuzzy path PASS | **MET** | `verify-packaged-fuzzy-scan.mts`, addon resolved only from `dist/win-unpacked` (doc 124) |
| 9 | Routing modes PASS | **MET** | LEGACY / NATIVE / SHADOW_COMPARE all exercised (docs 124, 125) |
| 10 | Rollback PASS | **MET** | including rollback after a NATIVE failure (doc 125) |
| 11 | Real-process native bugs = 0 | **MET** | no `NATIVE_BUG` classification produced |
| 12 | Unresolved real parity = 0 | **MET** | one difference observed, classified `EXPECTED_NATIVE_CORRECTION` against the named cause (doc 124) |
| 13 | Failure injection unresolved = 0 | **MET** | 12 real, 2 deterministic, 2 provably N/A, 0 unresolved (doc 125) |
| 14 | Legacy caller UNKNOWN = 0 | **MET** | doc 126 |
| 15 | 1 MiB remains CLOSED | **MET** | doc 132 D01 |
| 16 | Alignment remains CLOSED | **MET** | doc 132 D02 |
| 17 | AOB remains CLOSED | **MET** | doc 132 D03, now including fuzzy |
| 18 | int64 remains CLOSED | **MET** | doc 132 D04 |
| 19 | Pointer depth remains OPEN | **MET** | untouched, `PRODUCT_DEFECT_NOT_YET_CLOSED` (doc 132 D05) |
| 20 | Semgrep local PASS | **MET** | PR-gate configuration, 0 findings across 216 changed files (doc 123) |
| 21 | Windows native build PASS | **MET** | 33/33 output checks |
| 22 | Package PASS | **MET** | `electron-builder --dir`, both packaged proofs |
| 23 | 3-game canary PASS | **MET** | 3/3, both legs native by default (doc 127) |
| 24 | Rust PASS | **MET** | 185 passed, 0 failed, 1 ignored |
| 25 | NAPI PASS | **MET** | 52/52 |
| 26 | JS/TS PASS | **MET** | 1904/1904 + 10/10 |
| 27 | Typecheck PASS | **MET** | renderer and electron |
| 28 | npm audit 0 | **MET** | 0 vulnerabilities |
| 29 | Fresh worktree PASS | **MET** | doc 128 |
| 30 | Remote Windows native/Electron PASS | **MET** | `PR Windows` success at `97e51b5` (doc 129) |
| 31 | Remote Semgrep PASS | **MET** | success at `97e51b5` (doc 129) |
| 32 | All required remote checks PASS | **MET** | 7/7 success (doc 129) |
| 33 | ROADMAP untouched | **MET** | `ROADMAP.md` not in any commit's diff |
| 34 | PR #31 not merged | **MET** | OPEN |
| 35 | PR #29 not merged | **MET** | OPEN |
| 36 | local == remote | **MET** | both `97e51b5` at the code-final SHA |
| 37 | Worktree clean | **MET** | verified at close |
| 38 | Zero unresolved Stage-7 P0/P1 defects | **MET** | doc 132; the one open defect (D05) is explicitly out of Stage 7 scope |

## Verdict

**STAGE 7 FINAL VERDICT: CERTIFIED.**

Every gate item is met with current-pass evidence at the candidate SHA. Nothing was rounded up, and nothing was inherited from an earlier stage's run.

## What this stage changed about earlier conclusions

Three, recorded because a certification that quietly revises history is not a certification.

1. **Stage 7.4's "fuzzy cannot be migrated" was wrong.** Doc 116 and `signature-engine.ts`'s own comment held that fuzzy matching had no native equivalent and must remain legacy-only, permanently. The observation behind it was correct — `pattern.rs` matches exactly and has no substitution budget — but it drew the boundary in the wrong place. Drift tolerance is a pure computation over bytes a scanner returns, not a scan primitive. Migrating it required no new Rust.

2. **Doc 121's `LOCAL_TECHNICAL_CERTIFICATION: PASS` was not accurate when written.** A real-process test failed at `6fcd0c5` because of a defect in the Rust test fixture. Doc 121 is preserved unmodified; doc 131 carries the current status.

3. **`PR Windows` was an intermittently broken gate, not a clean one.** It failed at four of six runs on this branch including the Stage 7.5 entry commit. Fixed rather than excused (doc 129).

Two live shipping defects were also closed that no prior document had recorded as open on the fuzzy path: D01 and D03 both applied there in full, because `readBuffer` throws above 1 MiB and the fuzzy loop swallowed it.

## Scope boundaries, stated rather than implied

- **Pointer depth (D05) is untouched** and remains open, by instruction.
- **Value-scan fan-out, next-scan and unknown-initial-value scans remain legacy.** Named and classified in doc 126, forward-assigned to Stage 8.
- **Native module enumeration does not exist.** Both backends are fed the same OS module list; forward-assigned to Stage 8 (doc 133, FA-2).
- **No definition-driven fuzzy resolution against a commercial game was exercised** — no shipped catalog definition for the canary titles carries a drift-tolerant signature (doc 127).

## Certification of the documentation SHA

The commits after `97e51b5` change only `Docs/phase1/**`. At the documentation SHA `2e5cfa8`, **all 7 remote checks are green**:

| Check | `2e5cfa8` |
|---|---|
| PR Windows | success |
| Semgrep | success |
| CI Fast | success |
| PR Static | success |
| Gitleaks | success |
| OSV-Scanner | success |
| Vendored memoryjs integrity | success |

So the required checks pass at both the code-final SHA (`97e51b5`, doc 129) and the documentation SHA. This section is the one place a self-reference is unavoidable — a document cannot contain its own commit's CI result — so the recursion is terminated here deliberately: the amendment that fills this table is documentation-only, and its own check results are stated in the commit message rather than chased into another round.

## Next

**PHASE 1 STAGE 8 — production migration completion / legacy scanner retirement / final Phase-1 parity closure.**

Not started. See doc 136 for the Phase 1 verdict, which is **not** the same as this one.
