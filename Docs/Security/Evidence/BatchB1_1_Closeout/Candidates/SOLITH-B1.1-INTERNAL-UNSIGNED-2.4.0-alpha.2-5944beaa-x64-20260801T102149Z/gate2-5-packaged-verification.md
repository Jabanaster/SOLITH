# Candidate-Specific Packaged Gate 2.5 Verification

All tests below launch the real built `Solith.exe` (via `playwright test` `_electron`/`resolvePackagedExecutable`), not source-mode/dev Electron.

## test:packaged-smoke — 23/23 pass

Covers: exe existence, app launch, window title, `domcontentloaded`, React root mount, `contextIsolation` active (no `require` in renderer), `window.electronAPI` exposed via `contextBridge`, preload API surface (`getGames`, `applyProposal`, Trainer IPC methods), functional IPC (`getGames`, `getSettings`, `addGame`, `parseSave`, `getRecipes`, `checkGameRunning`, `getCompatibilityProfile`), zero uncaught renderer errors, no eval CSP violation, clean exit, sidebar navigation/collapse in packaged app, compatibility IPC (`BLOCKED_PENDING_USER_DATA`).

## Trust-boundary / Gate 2.5 packaged suites — 21/21 pass

- `tests/gate2-5-frame-devtools-overlay-lifecycle.e2e.test.ts` (6 tests): child iframes of the main window do not receive the privileged preload bridge; a destroyed/removed iframe reference cannot be invoked and parent reload revokes state; the DevTools webContents has no privileged preload bridge; the real Wisp overlay can be destroyed and recreated with no inherited trust or state; only the exact `SOLITH_TEST_BUILD=1` value enables test-only globals, all other values fail closed; overlay cannot reach freeze-stop or freeze-status.
- `tests/gate2-5-frame-overlay-closeout.e2e.test.ts` (7 tests): live packaged same-origin/trusted-looking/nested child frames reject privileged calls; live packaged untrusted local child frame rejects privileged calls; live packaged cross-origin local HTTP child frame has no privileged bridge; destroyed and navigated child frames cannot invoke through retained frame references; packaged DevTools context has no preload bridge/Node access/trusted-window registration; real Wisp overlay destruction/recreation yields new identity and preserves main-only channel boundaries; `SOLITH_TEST_BUILD` enables main-process hooks only for the exact value `1`.
- `tests/gate2-3-freeze-authorization-security.e2e.test.ts` (3 tests): retired legacy freeze-start payload rejected by real IPC handler; proposal/consent token cannot be replayed after a successful confirmed start; unknown/fabricated proposal ID and unknown consent token both rejected.
- `tests/gate2-4-final-certification.e2e.test.ts` (5 tests): full real propose→consent→start→restore→stop→replay-reject cycle; renderer crash during active real-flow freeze stops writes and revokes state; second real trusted window (overlay) cannot use or interfere with the main window's freeze; same-prefix sibling and encoded-path local navigation do not retain authority; unapproved local HTTP origin does not retain privileged access.

## Note on first run

The first run of this suite (before the fixture below was built) produced 3 failures + 11 not-run, all traced to `spawn ...Gate2_2Fixture.exe ENOENT` — a .NET test-fixture helper (`tests/fixtures/gate2-2-memory-fixture`) that had never been compiled in this freshly created worktree. This was a missing local build artifact, not a candidate security defect. Built via `dotnet build -c Release` (exit 0, 0 warnings, 0 errors), then the full 21-test battery was rerun clean: 21/21 pass, 0 fail.

## Result

```
GATE 2.5 PACKAGED CANDIDATE — VERIFIED COMPLETE
```

44/44 candidate-specific packaged tests pass. No trust-boundary bypass found. `SOLITH_TEST_BUILD` confirmed fail-closed in the packaged candidate (tested both negative and exact-value-`1` cases).
