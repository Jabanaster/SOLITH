# Remaining Risks — Gate 2.2 Resume

## R-2.2-RESUME-001 (new finding): renderer freeze-start IPC wiring is broken

`src/app/pages/LiveMemoryTrainerPage.tsx` calls `electronAPI.liveMemoryFreezeStart({address, dataType, value, intervalMs})`,
but `electron/live-memory-ipc.ts`'s `'live-memory-freeze-start'` handler now requires
`{proposalId, consentToken}` (`LiveMemoryFreezeConfirmSchema`, `.strict()`). There is no
`liveMemoryFreezePropose` / `liveMemoryFreezeIssueConsent` preload method exposed at all. This
means the shipped renderer currently has **no working path to start a freeze** through its own
UI. This predates Gate 2.2 entirely — existing code comments in `live-memory-ipc.ts` reference
this propose/consent rework as prior "Batch B1.1" work — and is not a regression introduced by
Gate 2/2.1/2.2/2.2A/2.2A.1.

Worked around for THIS cycle's verification via a narrow test-only hook
(`__testStartFreezeForOwner`, gated `SOLITH_TEST_BUILD=1`) that calls the exact same production
functions (`proposeFreeze`, `requestPrivilegedWriteConsent`, `manager.freezeStart`) the real,
currently-unreachable IPC flow would call — see `control-provenance.csv`.

AcceptanceStatus: Proposed for acceptance as a known, disclosed, pre-existing defect requiring
its own remediation (fixing `preload.ts`/`LiveMemoryTrainerPage.tsx` to use the real
propose/issue-consent/confirm flow, or exposing the two missing preload methods). Not fixed this
cycle — out of the narrow evidence-gathering/certification scope authorized for Gate 2.2 Resume.
**Owner decision required**: whether to authorize a Gate 2.2B (or similar) to fix the renderer's
freeze-start wiring for real end users, separate from this certification work.

## R-2.2-RESUME-002: overlay identity/permission boundaries not exercised (Phase 8)

Not attempted — Wisp/trainer overlays are created on-demand via UI interaction beyond this
harness's scope in a single session. Documented per the authorization's own instruction rather
than fabricated as tested.

## R-2.2-RESUME-003: full window recreation without app quit not exercised (Phase 7)

Not a real Windows code path for this single-window app (`window-all-closed` unconditionally
calls `app.quit()` on non-macOS). The functionally equivalent real scenario — close, quit,
relaunch, no inherited authority — is fully covered by the Phase 4.1-4.5 shutdown/restart proofs.

## R-2.2-RESUME-004: navigation sub-cases 9.2-9.5 and Phase 10 child-frame/DevTools not live-tested

The packaged app's single registered trusted URL prefix (its own asar-bundled `dist/index.html`)
offers no realistic sibling/case-variant path to construct same-prefix or traversal attacks
against without fabricating an artificial second installation. The `isMainFrame` check
(`electron/sender-validation.ts`) is a per-handler, non-bypassable code path exercised logically
by the 9.1/9.6 proof; not separately reproduced live this cycle. DevTools is not enabled in the
production candidate by design, and enabling it solely for testing would itself violate the
authorization.

## R-2.2-RESUME-005 (carried forward, unchanged): unrelated Electron TypeScript baseline and GameLibrary.tsx whitespace

Identical to every prior gate; not addressed this cycle (explicitly out of scope).

## Final Gate 2.2 verdict

All Gate 2.2 lifecycle certification work explicitly authorized and attempted this cycle is
**VERIFIED COMPLETE**: fixture prerequisite, active-session shutdown (all 6 sub-scenarios,
unified 4.1/4.2 per disclosed platform architecture), mid-freeze feature-disable, main-window
reload identity, unauthorized-navigation revocation, normal-build hook-absence, and full
regression (packaged + Node-based) — all passed against the real packaged application and the
real Gate 2.2 fixture.

Three items are explicitly **PENDING** (overlay, full recreation-without-quit, navigation
sub-cases/child-frame) — each with an architecture-grounded or scope-grounded reason recorded
above, not fabricated as passing.

One item is a **new, disclosed, pre-existing production defect** (R-2.2-RESUME-001) requiring an
owner decision on whether/when to fix it — discovered, not introduced, by this cycle's work.

## B1.1 verdict

BATCH B1.1 CONDITIONAL PASS. The six originally-required packaged lifecycle scenarios are now
substantively certified (with the disclosed narrowings above), closing the majority of the
Phase 2/3 exit criteria gap. Remaining conditions for unconditional PASS: the pre-existing
Electron TypeScript baseline, the pre-existing `GameLibrary.tsx` whitespace, the newly-discovered
renderer freeze-start wiring defect (R-2.2-RESUME-001), and the three PENDING items above.
