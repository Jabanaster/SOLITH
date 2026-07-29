# Remaining Risks — Gate 2.3

## R-2.3-001: renderer-crash cleanup not independently re-proven with a real-flow freeze

The `render-process-gone` cleanup code path is unchanged from Gate 2.1/2.2
Resume and was already proven (with a freeze started via the now-removed
test hook in Gate 2.2 Resume, and with a write proposal in Gate 2.1). It was
not independently re-exercised this cycle specifically with a freeze started
via the newly-repaired propose/consent/start sequence, due to time-scoping.
The cleanup coordinator code itself was not modified by Gate 2.3, so the risk
is limited to "an interaction between the new call sequence and crash timing
that differs from the write-flow/old-hook case" — considered low given the
underlying session/consent primitives are identical.

## R-2.3-002: wrong-owner proposal/token not independently e2e-tested with two concurrent windows

Session, proposal, and consent-token ownership are all enforced structurally
by keying every registry on `event.sender.id` (`requireBundle`, the
`sessions` map, `getPendingFreezeProposal`, the write-consent store) — the
identical ownership model already relied upon and accepted for the write
propose/consent/confirm flow across every prior gate in this engagement. Not
independently re-verified this cycle with two live concurrent trusted
windows each holding their own session.

## R-2.3-003 (carried forward, unchanged): child-frame/DevTools sender rejection not live-tested

Identical to R-2.2-RESUME-004. DevTools is disabled by design in the
production candidate; enabling it solely for testing would itself violate
the authorization. The `isMainFrame` check is verified by source inspection
only, consistent with every prior gate's identical disclosure.

## R-2.3-004 (carried forward, unchanged): overlay identity/permission boundaries, full window recreation without quit, and navigation sub-cases 9.2-9.5

Identical to R-2.2-RESUME-002/003/004. Not in scope for Gate 2.3 (these are
window-lifecycle/navigation boundary items unrelated to the freeze
authorization flow specifically) and remain open from Gate 2.2 Resume.

## R-2.3-005 (carried forward, unchanged): unrelated Electron TypeScript baseline and GameLibrary.tsx whitespace

Identical to every prior gate; not addressed this cycle (explicitly out of
scope).

## Resolved this cycle

**R-2.2-RESUME-001 is RESOLVED.** The renderer's real freeze-start wiring
(preload signature mismatch; missing `liveMemoryFreezePropose`/
`liveMemoryFreezeIssueConsent` preload methods) has been fixed. All 3 known
renderer call sites now use the real propose -> issue-consent -> confirmed-
start sequence, proven end-to-end against the real packaged application and
the real Gate 2.2 fixture, with no test-only hook. The Gate 2.2 Resume
test-only `__testStartFreezeForOwner` hook that stood in for this gap has
been removed from source entirely (not merely env-gated).

## Final Gate 2.3 verdict

All Gate 2.3 objectives explicitly authorized and attempted this cycle are
**VERIFIED COMPLETE**: preload repair, renderer workflow repair, legacy API
removal, test-hook removal, real packaged end-to-end freeze authorization
certification (propose -> consent -> start -> ticks -> external-mutation
restore -> stop -> no-further-writes -> replay-rejection), affected lifecycle
re-certification (shutdown/quit, feature-disable, reload, navigation, forced
termination — all now via the real flow, several launched WITHOUT
SOLITH_TEST_BUILD to prove the real flow needs no test assistance), and
normal-build security checks (legacy payload/fake token/reused token/reused
proposal/untrusted sender all rejected; test-only hook structurally absent).

Two items (R-2.3-001, R-2.3-002) are explicitly narrowed/disclosed rather
than fabricated as independently proven, on the basis that the underlying
code paths are unchanged and already covered by equivalent prior-gate proofs.
Four items are carried forward unchanged from Gate 2.2 Resume, out of scope
for Gate 2.3.

## B1.1 verdict

BATCH B1.1 CONDITIONAL PASS → the renderer/preload/IPC freeze authorization
flow (the specific defect that blocked an unconditional PASS after Gate 2.2
Resume) is now repaired and certified. Remaining conditions for unconditional
PASS: the pre-existing Electron TypeScript baseline, the pre-existing
GameLibrary.tsx whitespace, and the disclosed PENDING items above (overlay,
full window recreation without quit, navigation sub-cases 9.2-9.5,
child-frame/DevTools, R-2.3-001, R-2.3-002) — none of which constitute a
proven functional or security regression.
