# Phase 1 / Stage 5.1 — Certification Repair

## Why this exists

Stage 5's original closeout (docs 36-45) reported two gaps that block 100% certification:

1. The mission required analysis of the real, audited 120,245-signature CT AOB corpus. Stage 5 substituted the repository's own smaller, already-certified AOB parser and test corpus instead, because the real corpus was not present in the repository. That substitution is not sufficient for certification on its own — it required a second, exhaustive recovery attempt before being accepted as a final scope limit.
2. Stage 5's defect-status doc (44) reported the product-level 1 MiB defect as "not applicable — product has no AOB/string scanner today." That is incorrect: the shipping product has a real AOB path (`aob-resolver.ts`), and it is not applicable only because the native fix has not yet been wired into production, not because no such product code exists.

This document records the Stage 5.1 repair for both.

## 5.1-B/C/D — corpus recovery outcome

**FULL 120,245-SIGNATURE CORPUS: NOT FOUND.**

Exhaustive, read-only search performed (full location list in doc 39's new "Stage 5.1 — exhaustive corpus-recovery search" section): current working tree, ignored local data directories, every local/remote git ref (91), the three explicitly named preserved refs (`preserve/ct-selective-import-2026-09-12`, `preserve/review-gate2-5-working-tree-2026-09-12`, `review/gate2-5-doc-audit`) and their registered worktrees, dangling/unreachable git objects, the registry-compiler's own declared output path, and common local CT-library locations (Desktop/Downloads). No CT scripts were executed, no branches were merged, no corpus data was mutated.

**Exact Audit 2 artifact that produced the 120,245 count:** ROADMAP.md cites it directly — `> **Reconstruction evidence.** 38-step-0.14-roadmap-source-reconciliation.md, 39-step-0.14-roadmap-consistency-audit.md, 40-step-0.14-final-roadmap-certification.md in SOLITH_PHASE0_EVIDENCE/2026-09-12/`. That directory and those three files do not exist in this repository's git history under any of its 91 local/remote refs, and were not found on this machine's local disk under any location this session can access read-only. The 120,245 figure and its sibling figures (23,953 files / 20,865 tables / 713,349 cheats / 442,602 pointers / 150,502 scripts) exist only as prose citations in ROADMAP.md and the Phase 1 docs that quote it — the underlying raw/compiled dataset itself was never persisted as a retrievable artifact in a location this repair could reach.

**Can the artifact be reconstructed from something smaller?** No smaller normalized subset of the real corpus (a partial registry export, a sampled JSON, a database dump) was found either — the search above was for the dataset at any granularity, not only the full count.

Per mission §5.1-D: since the corpus remains genuinely unavailable after this second exhaustive attempt, **Stage 5 corpus certification cannot be marked complete**, and per §5.1-J's certification rule, this alone is sufficient to keep Stage 5 as a whole at **NOT_COMPLETE** rather than CERTIFIED — no corpus substitution (including this repair's own reuse of the in-repo parser/test-corpus evidence) satisfies the certification bar the mission sets.

## 5.1-E — grammar correction assessment

No new evidence of a legitimate, unsupported AOB syntax family was found during this repair (the search above targeted the missing *data*, not new *syntax* claims, and no new syntax evidence surfaced as a byproduct of it). Doc 39's finding: because `normalizeAobPattern` — the exact, unmodified function that performed the certified ingest — has no nibble-wildcard branch, no nibble-wildcard token could have survived that ingest as a *supported, compiled* entry within the certified 120,245 count. **Update (Stage 5.2, docs 47/48): the raw corpus was subsequently recovered.** It contains 426 real nibble-wildcard signatures (no longer "UNKNOWN"), every one confirmed rejected as invalid by the same unmodified ingest function — and it also reveals two further real, evidenced, currently-unsupported syntax families (`xx`/`x` alternate wildcard notation, 16,392 occurrences; continuous/unspaced hex notation) not previously known. See doc 48 for full detail; none of this was implemented in either repair, per each mission's own scope limits.

**PARSER CHANGES REQUIRED: NO.** Per the mission's own instruction ("If no corrections are needed: do not touch production/native source"), no source in `native/solith-scanner-core`, `native/solith-scanner-napi`, or any production TypeScript was modified this repair.

## 5.1-F — corrected defect accounting

Applied directly to `Docs/phase1/44-stage5-defect-status.md`:

| Item | Native path | Shipping product (corrected) |
|---|---|---|
| AOB / large-region defect (D04) | NATIVE_PATH_FIXED (unchanged — already correctly stated in Stage 5) | PRODUCT_DEFECT_NOT_YET_CLOSED (unchanged — already correctly stated) |
| 1 MiB / coverage defect | Foundation-complete, no cap in Stage 5's own code (unchanged) | **Corrected: PRODUCT_DEFECT_NOT_YET_CLOSED** (was incorrectly "N/A — product has no AOB/string scanner today") |

The correction: the product's `aob-resolver.ts` is real, shipping, and actively wired into `signature-engine.ts`, `feature-resolver.ts`, `live-memory-session.ts`, and `hook-engine.ts` (confirmed by a direct grep of `src/` for `aob-resolver`/`scanAobInProcess` references, this repair). "N/A" was wrong because it implied no such product code exists; the correct status is that a real, defective product code path exists and remains open until migrated to the native scanner — matching D04's own already-correct framing, which this repair now makes consistent between the two defect rows.

## 5.1-G — old production AOB path, read-only cross-check

**File/function:** `src/core/live-memory/aob-resolver.ts`, function `scanAobInProcess` (lines 71-103), calling `findAobInBuffer` (lines 35-50) and `parseAobSignature` (lines 14-29).

**Old cap behavior:** `scanAobInProcess` reads each candidate region in a single call: `driver.readBuffer(handle, region.baseAddress, region.size)` (line 92) — the *entire* region size, uncapped and unchunked at this call site. The actual 1 MiB ceiling is enforced one layer down, in `NativeMemoryDriver.readBuffer` (`src/core/live-memory/native-memory-driver.ts:361`): `if (size <= 0 || size > 1048576) { throw new Error(...) }` — a hard single-call maximum with no chunking/retry logic anywhere in this call path.

**Old incomplete-read behavior:** When a region's size exceeds 1 MiB, `readBuffer` throws. `scanAobInProcess` wraps the read in `try { ... } catch { continue; }` (lines 91-99) — the exception is silently discarded and the loop moves to the next region. No count, flag, or return value anywhere in `scanAobInProcess` records that a region was skipped.

**Old `found:false` behavior:** After the region loop completes, `scanAobInProcess` returns `null` (line 102) whether the pattern was genuinely absent from every successfully-read region, or was actually present in a region that was silently skipped for being over 1 MiB. These two cases are indistinguishable to every caller — the exact defect class ROADMAP.md's D04 and this stage's own truthful-completeness contract (`ScanCompleteness`, doc 40/44) were built to eliminate in the native path.

**Current shipping status:** Live and unfixed. `scanAobInProcess`/`aob-resolver.ts` is not dead code — it is called from `signature-engine.ts`, `feature-resolver.ts`, `live-memory-session.ts`, and `hook-engine.ts` (confirmed by grep this repair). This repair made no changes to this file or any file in its call chain, per the mission's explicit "Do NOT fix it in this repair" instruction — its purpose here is accurate defect ownership only.

## 5.1-H — implementation drift check

No code changed this repair (5.1-E concluded no grammar correction was needed). Per the mission's "if no code changes occurred: rerun focused native/parser tests sufficient to prove no drift" instruction, `cargo test --release` was rerun in `native/solith-scanner-core`:

```
76 unit tests: ok
15 exact_scan_integration tests: ok
8 fixture_integration tests: ok
20 pattern_scan_integration tests: ok
17 session_integration tests: ok
= 136/136 pass, identical to doc 42's certified Stage 5 baseline
```

No drift. Fresh-worktree reproducibility is not re-required (mission: "Fresh-worktree verification required again if code changed" — it did not).

## 5.1-I — evidence updated

- `Docs/phase1/39-stage5-ct-aob-corpus-analysis.md` — added "Stage 5.1 — exhaustive corpus-recovery search" and "Structural finding on nibble wildcards" sections (the latter corrected in Stage 5.2 — see doc 47).
- `Docs/phase1/44-stage5-defect-status.md` — corrected the 1 MiB product-defect row and its summary-table entry from "N/A" to `PRODUCT_DEFECT_NOT_YET_CLOSED`, with the exact production call chain cited.
- `Docs/phase1/45-stage5-reproducibility.md` — not updated; no implementation change occurred this repair, so its fresh-worktree record from Stage 5 remains accurate as-is.
- This document (`46-stage5-certification-repair.md`) — new.

## 5.1-J — certification-rule checklist, evaluated

| Requirement | Status |
|---|---|
| Full 120,245-signature corpus analyzed, or authoritative count changed with evidence | **NOT MET** — corpus confirmed genuinely unavailable after exhaustive second search |
| Legitimate required syntax coverage established | Met for the syntax vocabulary provable from real in-repo evidence (exact bytes, `??`/`*` full wildcards); not provable at full-corpus percentage granularity |
| Unsupported legitimate syntax = 0, or explicitly scoped with owner-approved reason | Nibble wildcards: proven unable to survive certified ingest as supported entries; raw-corpus prevalence UNKNOWN (corrected Stage 5.2, see doc 47); no other unsupported legitimate syntax evidenced |
| Malformed corpus entries separated from unsupported valid syntax | Met for available evidence (doc 39's `Invalid AOB token` mechanism) |
| Old production AOB path accurately documented | Met (5.1-G, this doc) |
| AOB native-path defect status truthful | Met (unchanged from Stage 5, already correct) |
| 1 MiB native-path defect status truthful | Met (unchanged from Stage 5, already correct) |
| Shipping product defects remain open until migration | Met — corrected this repair (5.1-F) |
| All affected tests green | Met (136/136, 5.1-H) |
| ROADMAP.md unchanged | Met — confirmed via empty diff against remote, this repair |
| Production scanner not switched | Met — no production source touched |

**Overall: NOT_COMPLETE.** The single unmet item (full-corpus analysis) is, per the mission's own §5.1-J wording ("No corpus substitution is sufficient for certification"), sufficient by itself to withhold CERTIFIED status regardless of every other item passing.

**Stage 5.3 update:** the full corpus was subsequently recovered (doc 47/48) and `xx`/`x` wildcard support implemented (doc 50) with real corpus-backed necessity now proven for nibble wildcards too. The 120,245-vs-111,467 count reconciliation remains open after real investigation (doc 49), and grammar coverage is now a precise 96.95% against a corrected legitimate-syntax denominator (doc 52), not 100%. See doc 53 for Stage 5's final certification determination.

**Stage 5.4 update:** continuous/unspaced Cheat Engine hex syntax is now implemented (doc 55), and the full 111,467-signature corpus-of-record reanalysis (doc 56) achieves 100.000% grammar coverage with zero unsupported valid syntax. 120,245 remains preserved as `HISTORICAL_CERTIFIED_RUN_COUNT_UNRECONCILED` (doc 54) — never the certification denominator. See doc 58 for Stage 5's superseding final certification determination.
