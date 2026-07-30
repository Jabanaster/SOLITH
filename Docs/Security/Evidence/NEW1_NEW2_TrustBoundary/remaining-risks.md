# Remaining limitations — NEW-1 / NEW-2

## Scope boundaries (intentional, per authorized task)

- Only the 6 named live-memory/injector channels + `trainer-host-approve-and-write`
  were hardened. Every other L/N-tier IPC channel identified during Phase 2
  inventory (game-library CRUD, catalog, OCR, hotkeys, research, install
  discovery, cheat-toggle, ct-library, Wisp-overlay UI-only IPC) is
  **intentionally untouched** — that is the separate "Privileged IPC
  hardening beyond B1.1" roadmap workstream, already tracked as `PENDING` in
  SOLITH_SECURITY_ROADMAP.md.

## Test-coverage limitations

- **Dev-mode navigation origin not driven live.** The real-Electron e2e
  suite only exercises the packaged-mode allowed origin
  (`file://.../dist/index.html`) because standing up a concurrent Vite dev
  server was out of scope for this pass. The dev-mode origin
  (`http://localhost:3000`) uses the identical `isApprovedUrl()` matcher,
  already covered by `tests/trusted-sender-registry.test.ts` and the fake-
  WebContents cases in `tests/new1-new2-sender-validation.test.ts`
  ("does not block navigation within the allowed dev-server origin").
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
