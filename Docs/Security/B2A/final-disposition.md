# Batch B2A — Final Disposition

## Verdict

`BATCH B2A CONDITIONAL PASS`

Both authorized vulnerabilities are closed. The conditional qualifier covers bounded
residual risk that is pre-existing on `origin/master` and outside the authorized scope
(see Residual risk).

## Identification

- Branch: `devin/1785154484-b2a-freeze-consent-lifecycle`
- Base: `origin/master` @ `12f55a8`
- Final SHA: see the tip of the branch at merge time (`git rev-parse HEAD`)
- Working tree at completion: clean (`git status --short` empty)
- `package-lock.json`: unchanged

## Scope closed

### HIGH — live-memory-freeze-start lacks per-operation consent

Freeze start now requires a server-stored, single-use, expiring opaque approval token.

- Proposal returns exact operation details with no token material.
- Approval is issued only after a native main-process confirmation dialog
  (`dialog.showMessageBox`, default button Cancel) rendering PID, executable, address,
  data type, value, interval, and maximum duration. A caller-supplied boolean cannot
  authorize; the injected confirmation provider is the sole authority.
- The expected binding at start is recomputed from the request payload plus
  server-authoritative PID, executable identity, renderer id (`event.sender.id`) and the
  six-hour duration clamp, then compared against the stored approval. Divergent target,
  PID, duration, operation, or renderer is rejected.
- Consumption is atomic (synchronous delete-then-validate) with bounded replay history,
  so concurrent double-use permits exactly one start.
- Missing, malformed, expired, replayed and reused tokens fail closed.
- Proposal, approval, execution, rejection, expiry, replay, invalid transition, and
  cleanup failure are audited. Token material is only ever recorded redacted.

### MEDIUM — renderer reload/navigation can orphan an active freeze session

A server-authoritative freeze session registry owns every active freeze.

- Owner record: freeze session id, renderer id, frame id where available, PID, start and
  expiry timestamps, approval token id, state, cleanup state.
- Validated, audited state machine: PROPOSED, APPROVED, STARTING, ACTIVE, STOPPING,
  STOPPED, EXPIRED, CANCELLED, FAILED, CLEANUP_FAILED.
- Renderer destruction, renderer crash, main-frame navigation/reload, window close, and
  app quit stop the owned freeze. There is no reattachment protocol, so navigation stops
  rather than detaches.
- A new renderer has a new webContents id and therefore cannot inherit a prior freeze.
- Cleanup is idempotent; a cleanup that cannot verify the freeze stopped fails closed
  into CLEANUP_FAILED and is surfaced and audited.
- Only freezes owned by the given renderer are stopped; unrelated renderers, sessions and
  PIDs are never touched.

### Six-hour maximum duration

No six-hour cap existed prior to this batch — freeze ran unbounded. The cap is now
enforced independently of consent, server-side, in both the session (`max_duration` stop
reason) and the registry expiry timer, and is clamped at the IPC schema and handler.

## Evidence

- `Docs/Security/B2A/freeze-consent-lifecycle-discovery.md`
- `Docs/Security/B2A/freeze-consent-design.md`
- `Docs/Security/B2A/freeze-lifecycle-ownership.md`
- `Docs/Security/B2A/test-evidence.txt` (exact commands, counts, master baseline comparison)
- `Docs/Security/B2A/changed-files.txt`

## Verification summary

| Gate | Command | Result |
| --- | --- | --- |
| Targeted | `npx tsx --test tests/live-memory/freeze-consent.test.ts tests/live-memory/freeze-session-registry.test.ts tests/live-memory/freeze-lifecycle-wiring.test.ts tests/live-memory/live-memory-session.test.ts` | 42 tests, 42 pass |
| Live-memory suite | `npm run test:live-memory` | 201 tests, 198 pass, 3 fail (reproduced on master) |
| Full suite | `npm test` (after `npm run build:electron`) | 873 tests, 869 pass, 4 fail (reproduced on master) |
| Renderer typecheck | `./node_modules/.bin/tsc --noEmit` | PASS |
| Electron typecheck | `./node_modules/.bin/tsc -p tsconfig.electron.json --noEmit` | 36 pre-existing diagnostics, none in touched files |

## Residual risk (basis for CONDITIONAL rather than PASS)

1. `tsc -p tsconfig.electron.json` reports 36 diagnostics in unrelated Electron/core
   files. These exist unchanged on `origin/master` and fixing them is out of scope.
2. Four full-suite failures remain: three Linux invalid-PID expectations in
   `remote-connection-observer.test.ts` and one `safety-integration.test.ts` cleanup
   assertion. All four were reproduced on a clean `origin/master` worktree.
3. Verification ran on Linux; the Windows-only native memory helper is skipped, so the
   native write path itself was exercised through the existing test drivers rather than
   against a live Windows target.
4. Freeze duration expiry is evaluated on scheduler ticks and the registry expiry timer;
   maximum overshoot is bounded by one freeze interval (≤ 5 s by schema).

## Prior-batch evidence

No Batch A or Batch B1 evidence directories exist in this repository, so none were
modified. This document is the only B2A disposition record.

## Excluded work (not started)

Rollback compare-and-swap, rollback manifest expiration, generalized IPC
sender/frame/origin validation, process-selection redesign, UI redesign, unrelated IPC
hardening, unrelated persistence migrations, and Batches B2B/B2C.
