# PHASES 3–5 FINAL CLOSEOUT

**Date:** 2026-08-20
**Branch:** review/gate2-5-doc-audit
**Classification:** PHASES 3–4 COMPLETE; Phase 5 not started — READY TO BEGIN

This report supersedes an earlier version of itself in the same working
tree, written when Phase 4 was BLOCKED. The owner has since supplied an
explicit V1 artwork-rights policy (see
[PHASE_4_CLOSEOUT.md](PHASE_4_CLOSEOUT.md) §2), which was implemented,
tested, and closed this pass.

## Phase 3 — Trainer Library

**Status: COMPLETE — reconfirmed this pass, no correction required.**

Per this pass's authorization, Phase 3's closure was re-verified from fresh
repository/ROADMAP evidence rather than inherited:

- **Exact governing exit-gate text**, `ROADMAP.md` line 560: *"Exit gate:
  Trainer Library discovery is useful by default and still supports
  full-catalog exploration."* This is the only "Exit gate:" line in the
  entire Phase 3 section (verified by reading lines 425–562 in full). It
  does not say "all 34 §3.6 filter values must be functional," does not say
  "all listed categories must be complete," and does not reference a
  filter count at all — it is a UX-outcome statement about discovery being
  useful and full-catalog exploration remaining possible, both of which are
  satisfied (Popular default view + 500-curated ranking + All Games view +
  33 working filters with result count/Reset/remembered state/no hidden
  active filters).
- **Offline-only support evidence, re-searched fresh:** the only
  `offlineOnly`-shaped construct anywhere in `src/` or `electron/` remains
  the whole-application scope literal in
  `src/core/game-profiles/support-matrix.ts` / `catalog.ts`
  (`localOnly: true; offlineOnly: true; singlePlayerOnly: true` — SOLITH's
  own product-wide operating boundary, not per-title metadata). No
  `supportMode`, `compatibilityMode`, `safetyClassification`,
  `onlineRestricted`, or equivalent per-title/per-profile field exists.
  Per this pass's explicit instruction not to infer the filter from
  `offlinePlayAvailable`, absence of anti-cheat flags, MMO exclusion,
  single-player assumptions, or session state, none of those were used —
  the filter remains correctly unimplemented rather than fabricated.
- **Conclusion:** because the governing exit gate is a UX-outcome statement
  with no numeric completeness requirement, and no trustworthy per-title
  evidence exists for Offline-only support, Phase 3's prior COMPLETE
  classification is **preserved, not corrected**. §3.6 is 33/34, with
  Offline-only support the one deliberately, honestly unavailable filter.

- Commit SHAs: `12df29b225ac43c72803667462a9fa197130a92c` (feature) +
  `3515f1206a35d8645dbd2130933a23e389007c6e` (report SHA fix), both
  previously pushed; local == remote confirmed again this pass.
- No Phase 3 code was altered this pass — no evidence of a real
  implementation defect was found, so none was warranted.

Full detail: [PHASE_3_CLOSEOUT.md](PHASE_3_CLOSEOUT.md) (unchanged this
pass).

## Phase 4 — Artwork Identity, Cache, Legal Sourcing, Background Fetching

**Status: COMPLETE.** See [PHASE_4_CLOSEOUT.md](PHASE_4_CLOSEOUT.md) for
full detail (rights model, TDD RED evidence, full verification matrix).

- Commit SHA: `6d5a81bce8b33fc82c033c51896e1dd801b378e5`, pushed; local ==
  remote confirmed.
- Rights/provenance model: `ArtworkRightsClass` (`solith-owned` /
  `explicitly-licensed` / `user-provided` / `remote-unverified-rights`),
  persistent-cache gate enforced in `cache-writer.ts` (the sole disk-write
  path) and short-circuited earlier in `fetch-executor.ts` to avoid a
  pointless network fetch.
- Steam CDN final treatment: **`remote-unverified-rights`, always** — never
  auto-promoted by a successful, allowlist-passing download. Jobs are still
  enqueued and their refusal recorded as an auditable `'rights-blocked'`
  status (distinct from `'failed'`) rather than silently dropped.
- Persistent-cache allow/deny rules: allow `solith-owned`,
  `explicitly-licensed`, `user-provided`; deny `remote-unverified-rights`.
  Enforced by a strict allowlist membership check
  (`isPersistableRightsClass`), which fails closed for any unrecognized or
  malformed value — verified by a dedicated test.
- TDD RED evidence (Part C): `artwork-cache-cache-writer.test.ts` 2/10
  failed pre-implementation; `artwork-cache-fetch-executor.test.ts` 7/14
  failed pre-implementation; `artwork-cache-store.test.ts` 8/8 failed
  pre-implementation (`NOT NULL constraint failed: artwork_cache.sourceTier`
  — the old schema column). All three reached 100% green after their
  respective implementations.
- Fresh verification: `tsc` (both configs) PASS, `npm test` 1569/1569 +
  10/10, live-memory 257/257, trainer-e2e 4/5 (1 pre-existing/unrelated,
  freshly reconfirmed, source untouched by this diff), `npm audit` 0
  vulnerabilities, Vite build PASS, Electron build/output verifier 29/29,
  `git diff --check` clean. Packaged verification not run — no
  packaging-mode-sensitive behavior in this pass (justified in
  [PHASE_4_CLOSEOUT.md](PHASE_4_CLOSEOUT.md) §5).
- Final Phase 4 classification: **COMPLETE**, under the owner-approved V1
  rights policy, which this pass implemented and technically enforced
  rather than merely claimed.

## Phase 5 — Popularity Pipeline + Curated Catalog + Signed Catalog Updates

**Status: NOT STARTED — READY TO BEGIN.** Per this pass's explicit
instruction, Phase 5 is not implemented in this pass. Both gating
conditions are now met: Phase 3's current status satisfies its ROADMAP
exit gate (reconfirmed above), and Phase 4 is genuinely closed, committed,
and pushed (`6d5a81b`).

**First Phase 5 ROADMAP subsection: §5.1 "Ranking sources"**
(`ROADMAP.md` line 666), under `# PHASE 5 — POPULARITY PIPELINE + CURATED
CATALOG + SIGNED CATALOG UPDATES`.

## Cross-cutting state

- Repository branch: `review/gate2-5-doc-audit`, local HEAD ==
  `origin/review/gate2-5-doc-audit` at
  `6d5a81bce8b33fc82c033c51896e1dd801b378e5`.
- Working tree: clean except this report itself and
  `Docs/Reports/PHASE_R_FULL_CLOSEOUT.md` (a separate phase's report, still
  intentionally untracked from an earlier pass) and the three pre-existing
  untracked worktree directories (`solith-b11-integration/`,
  `solith-baseline-comparison-worktree/`, `solith-val-bf97e8b/`) — all
  three left exactly as found, provenance still unexplained and out of
  scope.
- All four stashes (`baseline-51-preserve-pre-ff`,
  `baseline-18-preserve-pre-ff`, `health-check-test`,
  `wisp-wip-exclude-from-security-commit`) untouched.
- PR #7: not merged, not touched this pass.
- No open CRITICAL/HIGH security findings; `npm audit` 0 vulnerabilities on
  the current tree.

## Whether Phase 6 may begin

**No.** Rule 12 requires Phases 3, 4, and 5 to each be independently closed
before Phase 6 starts. Phase 5 has not been attempted yet.

## Machine-readable summary

```text
phases_3_to_5: PARTIAL — 3 and 4 COMPLETE, 5 not started (ready)
phase_3: COMPLETE (commit 12df29b225ac43c72803667462a9fa197130a92c, report-fix 3515f1206a35d8645dbd2130933a23e389007c6e; reconfirmed this pass, no correction required)
phase_4: COMPLETE (commit 6d5a81bce8b33fc82c033c51896e1dd801b378e5)
phase_5: NOT_STARTED, READY_TO_BEGIN (first subsection: §5.1 Ranking sources)
phase_6_may_begin: false
pr_7: unmerged, untouched
stashes: 4/4 preserved, untouched
worktree_dirs: 3/3 preserved, untouched
next_action: begin Phase 5 §5.1 in a future authorized pass
```
