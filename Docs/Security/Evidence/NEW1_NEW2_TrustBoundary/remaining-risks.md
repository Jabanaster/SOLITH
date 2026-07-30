# Remaining limitations — NEW-1 / NEW-2

## Independent review findings NOT fixed in this pass (out of authorized scope)

An independent hostile reviewer (Phase 8) found two additional handlers in
the SAME liveness/ownership-only trust class as the six that were hardened,
which were NOT in the explicitly authorized channel list and are therefore
**deliberately left unhardened by this patch**, pending an explicit scope
decision:

- **`in-process-confirm-hook` / `in-process-rollback-hook`**
  (`electron/live-memory-ipc.ts`) — these call `installHookFromProposal`,
  which reaches `writeProcessBuffer()` in `src/core/in-process-script/hook-engine.ts`
  to write shellcode plus a jump patch directly into a live target process.
  Only `requireSession(event)` (liveness + ownership map) gates them — the
  exact NEW-1 pattern, on an arguably MORE destructive path than the
  injector-launch handlers that were hardened.
- **`trainer-host-rollback`** (`electron/main.ts`) — restores a game save
  file from backup; still only `event.sender.isDestroyed()`. Its sibling
  `trainer-host-approve-and-write` was hardened; this rollback counterpart
  was not, which is the same asymmetry NEW-1 exists to close (and mirrors
  how `live-memory-rollback` was already hardened alongside
  `live-memory-confirm-write` in the base commit).

These were surfaced during Phase 2 inventory but excluded from the
explicitly authorized "harden exactly these six channels + trainer-host-
approve-and-write" scope. Fixing them was judged out of bounds for this
patch without an explicit scope decision, since the task instructions
explicitly said not to broaden this task. Flagging here rather than silently
leaving them out of the evidence pack.

## Scope boundaries (intentional, per authorized task)

- Beyond the two items above, every other L/N-tier IPC channel identified
  during Phase 2 inventory (game-library CRUD, catalog, OCR, hotkeys,
  research, install discovery, cheat-toggle, ct-library, Wisp-overlay
  UI-only IPC) is **intentionally untouched** — that is the separate
  "Privileged IPC hardening beyond B1.1" roadmap workstream, already tracked
  as `PENDING` in SOLITH_SECURITY_ROADMAP.md.

## Independent review — corrective pass applied

The independent reviewer (Phase 8) also found four defects in what this
patch itself changed, all fixed in a follow-up corrective commit and
re-verified (see verification-final.txt for the re-run totals):

1. **`http://localhost:3000` was trusted unconditionally, including in
   packaged builds** (`electron/main.ts`, `electron/wisp-overlay.ts`,
   `electron/trainer-overlay.ts`) — for both `registerTrustedSolithWindow`
   (IPC trust) and the new `applyWindowNavigationPolicy` (nav guard). Since
   `isApprovedUrl` treats an approved `http:` origin with no path as
   matching any path on that origin, any local process binding port 3000 on
   a shipped machine would have been trusted. Fixed: all three windows now
   compute the existing `isDev` flag at their window-creation call site and
   only include `http://localhost:3000` in `allowedUrlPrefixes` when
   `isDev` is true; packaged builds only ever trust the packaged
   `file://.../dist/index.html` route. This directly fulfills the
   original requirement ("packaged mode must allow only the intended
   packaged app file or route") that the first pass missed.
2. **Denying all popups broke a real, pre-existing `target="_blank"`
   external link** (`src/app/pages/ExternalTrainerResearchLab.tsx`, a link
   to the UEDumper reference repo) — `applyWindowNavigationPolicy`
   (`electron/sender-validation.ts`) now hands a strictly `https:` popup
   request to the OS's default browser via `shell.openExternal` (dynamically
   imported so the file stays unit-testable outside Electron) while still
   always denying in-app `BrowserWindow` creation for every popup. Any
   non-https scheme is still silently denied with no handoff.
3. **The NEW-1 e2e tests only proved non-regression, not that the check is
   wired** (`tests/new1-new2-trust-boundary.e2e.test.ts`) — the original 7
   tests asserted a legitimate main-frame caller doesn't get
   `sender_rejected:*`, which would still pass even if
   `requireTrustedSender`/`validateIpcSender` were deleted from every
   handler. Added a negative-control test that calls all 7 hardened
   channels from the real Wisp overlay window (registered as
   `windowType: 'wisp-overlay'`, sharing the same preload) and asserts each
   one is genuinely rejected with `sender_rejected:unauthorized_window_type`
   — this assertion fails if the check is ever removed.
4. This file previously omitted the two out-of-scope findings above from
   its "intentionally untouched" list — see the section above this one.

## Test-coverage limitations

- **Dev-mode navigation origin not driven live.** The real-Electron e2e
  suite only exercises the packaged-mode allowed origin
  (`file://.../dist/index.html`) because standing up a concurrent Vite dev
  server was out of scope for this pass. The dev-mode origin
  (`http://localhost:3000`, now correctly gated to dev builds only — see
  above) uses the identical `isApprovedUrl()` matcher, already covered by
  `tests/trusted-sender-registry.test.ts` and the fake-WebContents cases in
  `tests/new1-new2-sender-validation.test.ts` ("does not block navigation
  within the allowed dev-server origin").
- **DevTools-sender and raw child-iframe-sender cases are unit-level, not
  live-Electron.** `tests/new1-new2-sender-validation.test.ts` proves the
  production `validateIpcSender` function rejects these shapes; a live
  Electron DevTools/iframe reproduction was judged disproportionate effort
  for this pass and was not built. The Gate 2.5 packaged e2e suite
  (`tests/gate2-5-frame-devtools-overlay-lifecycle.e2e.test.ts`) already
  exercises real DevTools/child-frame/overlay reproduction for the
  freeze/rollback path using the identical trust mechanism; it was not
  re-run here because it requires a packaged executable.
- **Packaged-mode / clean-machine verification not performed** — see
  CLEAN-MACHINE ACCEPTANCE note in the top-level task record. This patch's
  own verification (tsc, unit tests, non-packaged real-Electron e2e, full
  `npm test`) is complete; packaging and installer-level acceptance remain a
  separate release gate.

## Process notes

- This environment only had Node 24 available; the repo pins Node 22
  (`.nvmrc`, `package.json#engines`). `npm ci` was blocked by the engine
  check, so `node_modules` was copied read-only from
  `solith-b11-integration` (identical lockfile, verified via `diff`) instead
  of installed fresh. The literal `npm test` invocation is similarly blocked
  by the repo's own `pretest` Node-version gate; the identical underlying
  test command was run directly. Neither substitution touched any file in
  this patch's scope or altered test behavior — see tests-run.txt for exact
  commands and totals.

## Not authorized / not performed (per task boundaries)

- No merge, push, or packaging.
- No B1.1 promotion or release authorization change.
- No B2/B2A work.
- No Wisp logic, reducer, state, or test changes.
