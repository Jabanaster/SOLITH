# Phase 2 P2-4.1 — CI Cancellation-Flake Closure

PR #33's remote CI required a manual rerun of one Windows check: `native/solith-scanner-napi/test/exact-scan.test.js`'s `"exact scan: cancellation works from real JS"` test failed once, expecting `outcome.completeness.state === 'cancelled'` but observing `'complete'`. The user rejected accepting "pre-existing flake, rerun went green" as a final disposition under a "no known flaky certification test" standard, requiring an actual root cause and either a fix or a defensible, instrumented explanation.

## Root cause

The test used `progress.snapshot().chunksRead > 0` as a proxy for "the scan is still genuinely in flight" before calling `cancellation.cancel()`. That condition is equally true on the **last** chunk of the scan — `chunksRead > 0` proves at least one chunk was read, not that more remain.

The scan covers Bastion's fixture-equivalent `TYPES_REGION` (4 MiB) in 4096-byte chunks — roughly 1024 chunks total. On a normally-scheduled machine, observing the first chunk (`chunksRead === 1`) leaves ~1023 chunks of real margin before the scan can possibly finish, comfortably enough time for the JS-side `cancel()` call to land while the native scan is still genuinely in progress. But on a throttled or oversubscribed CI runner, an occasional multi-millisecond Node event-loop stall (GC pause, scheduler contention on a shared VM) can let the native scan — running independently on its own thread, unaffected by the JS event loop — finish **all** ~1024 chunks before the JS polling loop's very first `setTimeout(1)` callback even fires. In that case, `cancellation.cancel()` is called against an operation that has already resolved `'complete'`, which is the real, honestly-reported terminal state — not a defect in the cancellation mechanism itself.

This is the same class of race the codebase's own JS-IPC-level cancellation tests already document and retry for:
- `scanner-backend-cancellation.test.ts` case A/C/D already retries up to 5 times for exactly this reason (its own comment: "enough of a window for a cancel fired immediately after start to land while the native scan is still genuinely in progress ... retried up to 5 times to absorb real machine-timing variance").
- Case B (AOB scan) already accepts either `'cancelled'` or `'complete'` as correct, because "AOB's first-match search frequently completes before the cancel signal is observed."

The NAPI-level `exact-scan.test.js` test was the one place in the suite that had NOT been given this same honest-retry treatment.

## Reproduction

Not reproducible locally: 35 consecutive full-suite runs of `exact-scan.test.js` (15 before the fix, 20 after) all passed cleanly, consistent with a CI-scheduling-specific race that needs the kind of contention a shared CI VM produces, not a local dev machine. This matches the mission's anticipated "genuinely impossible to reproduce" branch — root cause was established from direct code analysis (the exact assumption invalidated by the last-chunk case), not from a locally-triggered failure.

## Fix

Wrapped the scan+cancel attempt in a retry loop identical in spirit to the already-established JS-IPC pattern: up to 5 attempts, each attempt starts a genuinely fresh scan, waits for real progress, and cancels; a `'complete'` outcome is treated as an honest "the scan finished before the cancel signal landed" result — logged via `console.error` as diagnostic instrumentation (mission §9/§10: so a future CI failure has an explicit, attributable log line rather than a bare assertion mismatch) — and retried. The test fails only if none of 5 attempts observe a genuine `'cancelled'` terminal state.

## Verification

- 20 consecutive full-suite runs post-fix: 7/7 tests passed every time, 0 failures.
- Combined with the 15 pre-fix runs used to establish non-reproducibility, 35 total local runs recorded, 0 flakes observed either way — consistent with the race being real but CI-scheduling-specific, not something a local run can trigger on demand.
- The fix does not fake, skip, or weaken the actual assertion: cancellation must still be observed at least once, and the test still fails outright if cancellation genuinely never works.

## Disposition

**Root-caused and fixed**, not merely re-run to green. `KNOWN CERTIFICATION FLAKES` after this closure: **0** — no test in the required certification suite is left with an unaddressed, undispositioned intermittent-failure mechanism.
