# Gate 2.2 Resume Test-Only Freeze-Start Hook — Disposition

## Decision: REMOVED

`__testStartFreezeForOwner` / `globalThis.__solithTestStartFreezeForOwner`
(`electron/live-memory-ipc.ts`) has been deleted entirely, along with its
`SOLITH_TEST_BUILD`-gated registration block. It is no longer needed: the real
renderer/preload/IPC propose -> issue-consent -> confirmed-start flow is now
fully wired and was proven (see packaged-real-freeze-authorization-matrix.csv
and packaged-production-flow-lifecycle-matrix.csv) to work end-to-end against
the real packaged app, including with `SOLITH_TEST_BUILD` **unset** for the
Phase 4.6 and Phase 5 scenarios (see packaged-production-flow-lifecycle-matrix.csv
rows for those phases) — proving the real flow needs no test-only assistance
at all.

`tests/gate2-2-resume-packaged-lifecycle.e2e.test.ts`'s `attachAndFreeze`
helper was rewritten to call the real `electronAPI.liveMemoryFreezePropose` /
`liveMemoryFreezeRequestConsent` / `liveMemoryFreezeStart({proposalId,
consentToken})` sequence instead of the removed hook, and all 10 of that
file's tests were re-run and re-pass against the freshly rebuilt packaged
candidate (packaged-real-flow-run.txt).

## Confirmation of absence in normal production

Phase 11's pre-existing test
(`tests/gate2-2-resume-packaged-lifecycle.e2e.test.ts`, "normal packaged
candidate exposes no Gate 2.1/2.2 test-only hooks") re-passed against the
Gate 2.3 packaged candidate. Because the hook and its `globalThis`
registration were deleted from source (not merely left env-gated), it cannot
appear in ANY build, test or normal — a stronger guarantee than "gated,"
structurally impossible to reach.

## Other Gate 2.1 test-only hooks — retained, unaffected

`__setTestProcessIdentityOverride` / `__clearTestProcessIdentityOverrides`
(`src/core/live-memory/windows-process-identity.ts`),
`__setTestForcedCleanupFailureStep` / `__clearTestForcedCleanupFailureSteps`,
and `__testHasSessionForOwner` (`electron/live-memory-ipc.ts`) are unrelated
to the freeze-start authorization path (they simulate PID reuse, force a
cleanup step to fail, and introspect session presence, respectively) and were
not touched this cycle. They remain `SOLITH_TEST_BUILD=1`-gated,
`globalThis`-only, and proven absent in normal builds (Phase 11, unchanged).
No lower-level fault-injection hook was needed for the freeze authorization
flow itself.
