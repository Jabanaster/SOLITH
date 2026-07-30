# Gate 2.5 Owner Decision Package

## OD-2.5-001

ID: OD-2.5-001
Control: Electron TypeScript baseline
Status: **TECHNICALLY RESOLVED — INDEPENDENT REVIEW COMPLETED; CONDITIONS ADDRESSED.** This status covers only the technical resolution of the Electron TypeScript baseline (0 diagnostics, independently reproduced and re-reviewed twice — see below). It does NOT constitute owner acceptance, and it does NOT authorize OD-2.5-003 (B1.1 promotion), OD-2.5-004 (merge/`master` verification), unconditional B1.1, or release. The owner explicitly reassigned this control to a Claude Sonnet session, superseding the "owned by separate Codex cleanup workstream" / "prohibited for Claude" language previously recorded here — Codex's assignment is limited to the separate Wisp workstream only (`src/core/companion/wisp.ts` and related files). A Claude Sonnet session performed the cleanup; a separate independent (fresh-context) Claude reviewer session verified it and returned **VERIFIED WITH CONDITIONS**; a corrective pass then addressed every condition raised; a second, separate independent (fresh-context) Claude reviewer session then reviewed the corrective pass specifically and also returned **VERIFIED WITH CONDITIONS**, confirming all three original conditions resolved with no new defect found. See the provenance addendum below (points 1-6) for the full chain.
CurrentEvidence: `tsc -p tsconfig.electron.json --noEmit --pretty false` went from the accepted 31-diagnostic/13-file baseline to 0 diagnostics, reproduced independently by the implementing session, the first independent reviewer session, and the second independent reviewer session (corrective-pass review), and reconfirmed again in the subsequent B1.1 integration-readiness review. Main TypeScript (`tsconfig.json`) remains at 0 diagnostics throughout. Full suite 1043/1043, live-memory 257/257, and the focused suites covering every touched file all pass. Independent review: corrective-pass conditions resolved (compat-test-main.ts UNPROVEN status resolved via tsconfig exclusion of the orphaned `run-compat-test.ts`; both `?? {}` defense-in-depth regressions resolved via `isValidMemoryFeatureResolution`; stale ownership language resolved).
WhatWasNotTested: A broader structural-validation redesign of `isSolithDefinitionPayload` (beyond the narrow guard added at the two `resolution`-reading call sites) was explicitly out of scope for this cleanup and is not implemented. A fresh packaged-executable rebuild against the current working tree has not been performed as part of this technical-resolution claim (packaged verification is a separate OD-2.5-004/integration-stage requirement, not part of OD-2.5-001).
Exploitability: Not classified by Gate 2.5; no new diagnostic was introduced, and no security-sensitive behavior (consent, write-authorization, freeze/rollback, sender validation) was changed anywhere in the cleanup or the corrective pass.
CurrentMitigation: Main TypeScript passes and packaged regression is green.
RecommendedDisposition: Technical resolution and independent re-review are both complete; bring the complete package (original cleanup + first independent review + corrective pass + second independent review) to the owner for acceptance, alongside OD-2.5-003/004, which remain separate decisions this status does not resolve.
Options: Accept the technical result as resolving OD-2.5-001; or request further changes if the owner identifies a gap not covered by either independent review.
Consequences: B1.1 cannot be represented as unconditional while owner disposition of this item remains outstanding, even though the technical substance is now resolved and independent review of that resolution is complete.
AcceptanceRequired: OWNER DECISION REQUIRED.
FollowUp: None outstanding for technical resolution. Remaining follow-up is owner acceptance of this item, then OD-2.5-003/OD-2.5-004 disposition — see the final-decision checklist (post-cleanup) in `SOLITH_SECURITY_ROADMAP.md`.

## OD-2.5-002

ID: OD-2.5-002
Control: GameLibrary whitespace baseline
Status: **Named historical/documented condition — not silently deleted.**
CurrentEvidence: `git diff --check` reports only lines 286 and 303 in the underlying baseline; on this reviewed branch (`review/gate2-5-doc-audit` @ `317baf0e`) the file is already committed to HEAD, so the unstaged `git diff --check` for this branch currently returns exit 0 with zero errors — this has no independent release effect but does not retroactively resolve the named condition, since the underlying lines themselves have not been reformatted.
WhatWasNotTested: Cleanup was explicitly prohibited in every session to date, including this one.
Exploitability: None identified; repository-integrity gate remains nonzero against the pre-commit baseline.
CurrentMitigation: Exact unchanged lines are documented.
RecommendedDisposition: Keep conditional or authorize a later narrow formatting repair.
Options: Accept temporarily; or repair in an authorized separate change.
Consequences: Full clean-diff certification against the original baseline remains unavailable.
AcceptanceRequired: OWNER DECISION REQUIRED.
FollowUp: Separate baseline cleanup, not Gate 2.5, and not part of the Electron TypeScript cleanup workstream (see OD-2.5-001).

## OD-2.5-003

ID: OD-2.5-003
Control: Final B1.1 promotion
Status: **NOT AUTHORIZED.** Pending the necessary technical (OD-2.5-001), branch/merge (OD-2.5-004), and owner conditions.
CurrentEvidence: All Gate 2.5 supported live packaged scenarios pass; the discovered overlay stop/status defect is fixed; 48/48 packaged (this session's suite/candidate) and separately 49/49 packaged (the prior session's suite/candidate) both pass; 1,040/1,040 npm; 257/257 live-memory.
WhatWasNotTested: Other architectures and natural PID reuse outside the controlled fixture.
Exploitability: No unresolved exploitable B1.1 defect found in the tested Windows x64 candidate.
CurrentMitigation: Fail-closed sender validation, owner cleanup, exact test guard, full regression.
RecommendedDisposition: Retain BATCH B1.1 CONDITIONAL PASS until the owner explicitly disposes of OD-2.5-001, OD-2.5-004, and this item together.
Options: Accept specific residual conditions and promote; or keep conditional and run the exact next milestone (see the final-decision checklist (post-cleanup) in `SOLITH_SECURITY_ROADMAP.md`).
Consequences: Promotion without explicit acceptance would violate the verdict rules.
AcceptanceRequired: OWNER DECISION REQUIRED.
FollowUp: Owner disposition of remaining B1.1 conditions; then final independent re-verification of the Electron TypeScript baseline cleanup (see OD-2.5-001), branch reconciliation, and merge, in that order.

## OD-2.5-004 (new — Residual-Risk Review, this session)

ID: OD-2.5-004
Control: Branch merge and release-line verification
Status: **NOT STARTED.** Merging is explicitly not part of any Gate 2.5 or documentation-reconciliation task.
CurrentEvidence: All current verification (Gate 2.4/2.4A/2.5 and this reconciliation) applies only to `review/gate2-5-doc-audit` @ `317baf0ea573992dfa1a0cec2a30d6529b6ecee0`. `master` has not been rechecked against any of this work.
WhatWasNotTested: Whether `master`'s actual tip passes any Gate 2.4/2.5 scenario — it was never run against `master`.
Exploitability: N/A — this is a scope/authority condition, not a technical defect.
CurrentMitigation: All evidence and roadmap language now explicitly states the verified branch and commit rather than implying `master`.
RecommendedDisposition: Do not merge until OD-2.5-001 and OD-2.5-003 are resolved; after an authorized merge, identify the resulting `master` commit and re-run the required final checks against that exact commit before any claim transfers to `master`.
Options: Merge now and re-verify after (not recommended — risks a `master` state that has never been checked); or hold merge until upstream conditions clear (recommended).
Consequences: Until merged and rechecked, `master` cannot be described as having passed Gate 2.4, Gate 2.5, or Batch B1.1.
AcceptanceRequired: OWNER DECISION REQUIRED.
FollowUp: See the 10-step final-decision checklist (post-cleanup) appended to `SOLITH_SECURITY_ROADMAP.md`.

## OD-2.5-005 (new — Canonical Documentation Reconciliation, this session)

ID: OD-2.5-005
Control: Documentation consolidation (security-status authority, branch caveats, certification-terminology disambiguation, prohibited-capability deduplication)
Status: **Scoped edits applied this session** to `SOLITH_SECURITY_ROADMAP.md`, `ROADMAP.md`, `AGENTS.md`, and `README.md`. Not marked complete until all scoped documentation checks below are confirmed passing.
CurrentEvidence: `SOLITH_SECURITY_ROADMAP.md` now states explicit documentation authority (itself for security status, `ROADMAP.md` for product direction, `PROJECT_SPEC.md §3.2` for prohibited capabilities) and explicit branch-authority language naming the exact verified branch and commit. `AGENTS.md` now references `PROJECT_SPEC.md §3.2` instead of restating the prohibited-capability list. `README.md` now defers to `PROJECT_SPEC.md` on conflict and disambiguates its L0–L4 feature-maturity scale from Gate/Batch security certification. `ROADMAP.md`'s "Current Baseline" section now links to the security roadmap and carries the same branch caveat instead of implying `master` is current for security purposes.
WhatWasNotTested: This session did not verify that every cross-reference resolves to a stable heading in a downstream renderer (only markdown-heading text matching was checked manually).
Exploitability: N/A — documentation-only.
CurrentMitigation: N/A.
RecommendedDisposition: Mark complete once a future session (or the owner) confirms the cross-references read correctly in context and no further duplication is found.
Options: Accept as complete now; or request a follow-up documentation QA pass.
Consequences: None blocking — this item does not gate B1.1, release, or B2/B2A.
AcceptanceRequired: Informational; no owner risk acceptance needed.
FollowUp: None required unless a future session finds additional duplication.

## Note on provenance (added by this session, Claude Sonnet)

OD-2.5-001 through OD-2.5-003 above were authored by a prior, different agent
session (Codex, committed as 317baf0 on this branch before this session
began). This session independently reran the full regression set and the
child-frame/stale-frame/DevTools/overlay/env-variant scenarios against a
freshly rebuilt packaged candidate rather than accepting that report on
faith — all results matched (see gate2_4-independent-review-matrix.csv and
this session's own new test file, tests/gate2-5-frame-devtools-overlay-
lifecycle.e2e.test.ts, 6/6 pass, rerun twice). OD-2.5-001, OD-2.5-002, and
OD-2.5-003 remain accurate and unchanged; this session adds no new owner
decision items beyond them, and does not accept any of them on the owner's
behalf.

## Addendum: OD-2.5-001 ownership correction and corrective pass (later session, Claude Sonnet)

The owner directly (not via a delegated file instruction) reassigned the
Electron TypeScript baseline cleanup to a Claude Sonnet session, stating
explicitly that the prior assignment of this control to Codex was incorrect,
and that Codex's ownership is limited to the separate Wisp workstream. That
correction supersedes OD-2.5-001's original "owned by separate Codex cleanup
workstream" / "prohibited for Claude" status language, which has been updated
above rather than deleted, so this provenance chain remains auditable.

Sequence of work performed under that corrected ownership:

1. A Claude Sonnet session reproduced the accepted 31-diagnostic/13-file
   Electron TypeScript baseline and resolved it to 0 diagnostics via 12
   file changes (schema casts backed by runtime-enforced zod validation,
   boolean-discriminant narrowing-idiom corrections, two `?? {}` fallback
   removals, one enum-literal correction, and one new stub module for an
   orphaned dead import).
2. A separate, independent Claude Sonnet session — dispatched specifically
   because self-review by the implementing session would not be independent
   — reviewed that work read-only (no Edit/Write tool access) and returned
   **VERIFIED WITH CONDITIONS**: the 31-diagnostic ledger and all test/tsc
   results were reproduced exactly and no security-relevant change was found,
   but it flagged (a) two defense-in-depth regressions from the `?? {}`
   removals, (b) the new stub module as UNPROVEN rather than justified, and
   (c) this document's stale ownership language as contradicting the actual
   reassignment.
3. A corrective pass then: added an explicit runtime structural guard
   (`isValidMemoryFeatureResolution`, backed by the existing
   `MemoryFeatureResolutionV1Schema`) at the two `resolution`-reading call
   sites in `src/core/definitions/catalog-definition-capabilities.ts` and
   `src/core/trainer-health/index.ts`, restoring graceful-fallback behavior
   for malformed/legacy data without reintroducing the `?? {}` type-widening
   that caused the original diagnostics; removed the invented
   `electron/compat-test-main.ts` stub and instead excluded the orphaned,
   unreferenced `electron/run-compat-test.ts` from `tsconfig.electron.json`'s
   production Electron TypeScript project boundary; and updated this
   document's ownership language as recorded above.
4. `tsc -p tsconfig.electron.json --noEmit --pretty false` and
   `tsc -p tsconfig.json --noEmit --pretty false` were re-run after the
   corrective pass and remain at 0 diagnostics; the focused test suites for
   both corrected files, `git diff --check`, the full `npm test` (1043/1043),
   and `npm run test:live-memory` (257/257) all passed with no regressions.
5. No Wisp file, Gate evidence file, or other documentation file was modified
   by this corrective pass beyond `owner-decision-package.md` itself.
   `src/core/companion/wisp.ts` and `tests/companion-wisp.test.ts` carry a
   pre-existing, separately-owned Codex diff that predates this cleanup
   entirely (established via a status snapshot captured before the cleanup
   began) and was not touched by either the cleanup or this corrective pass.
6. A second, separate independent (fresh-context) Claude Sonnet reviewer
   session — dispatched specifically to review the corrective pass in point 3,
   not a re-review of the whole cleanup — read the corrective-pass diff
   read-only (no Edit/Write tool access) and returned **VERIFIED WITH
   CONDITIONS**: it confirmed all three conditions from the first independent
   review (point 2) were resolved as described — the `isValidMemoryFeatureResolution`
   guard restores the malformed-data fallback at both call sites, the
   `run-compat-test.ts` tsconfig exclusion resolves the compat-test-main.ts
   UNPROVEN finding without fabricating runtime behavior, and this document's
   ownership language was corrected — and found no new defect. It separately
   flagged an apparent scope discrepancy (OD-2.5-004/OD-2.5-005 sections and a
   "Note on provenance" section that it read as newly added by the corrective
   pass); this was investigated and found to be an artifact of this
   repository's shared, multi-session, uncommitted working tree (those
   sections predate the corrective pass, added by an earlier
   documentation-reconciliation session, and a `git diff` against HEAD cannot
   distinguish which uncommitted session added which change) — not a defect
   in the corrective pass itself.

Both required independent reviews (original cleanup, and the corrective pass
addressing that review's conditions) are now complete. Both reviews formally
returned VERIFIED WITH CONDITIONS; the conditions each raised were
subsequently addressed and rechecked. OD-2.5-001's technical resolution is
presented to the owner as: independent review completed, conditions
addressed; this does not by itself authorize OD-2.5-003, OD-2.5-004, B1.1
promotion, release, or any claim about `master`.
