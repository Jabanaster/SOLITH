# Phase 1 / Stage 7 — Rollback

## §7.16 — rollback is operational, not theoretical, for the cases actually tested

`ScannerBackendRouter.setMode()` switches `LEGACY ⇄ NATIVE ⇄ SHADOW_COMPARE` on the SAME router instance — no session recreation, no process restart, no rebuild. Proven in `tests/live-memory/scanner-backend-router.test.ts`:

- **After a normal scan**: `setMode` switches NATIVE→LEGACY between two calls on the same router; the second call's `result.backend === 'legacy'`, proving the switch took effect immediately (`rollback: setMode switches routing on the SAME router instance...`).
- **After a native error**: a router in `NATIVE` mode with a backend that throws is rolled back to `LEGACY` and the very next call succeeds via legacy, with an assertion that native is never called again post-rollback (`rollback after a native error...`).

**Not tested this stage**: rollback specifically after a cancelled scan, a real process exit, or a malformed AOB request. These are not expected to behave differently — `setMode` is a plain field write with no dependency on the previous operation's outcome, and this is exactly why it was designed this way (mission §7.16: "No corrupted session state... No application restart required") — but mission §7.16 asks for each case to be explicitly tested, and this stage does not add those specific tests. Recorded as an honest gap, not silently assumed equivalent.

At the IPC level: `live-memory-scanner-routing-mode-set` (electron/live-memory-ipc.ts) lets a caller change mode on a live, attached session without restarting Electron or rebuilding the app — the same underlying mechanism, exposed. No end-to-end IPC-level rollback test was added this stage (see doc 76's "production integration test harness: Partial").

No application restart is required for any rollback case tested. No corrupted session state was observed in any test — `detach()`/`detachNative()` cleanly tear down whichever backend(s) were in use regardless of the mode at the time of detach.
