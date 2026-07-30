# Remaining limitations — NEW-1 / NEW-2

## Independent review findings — subsequently corrected (second pass)

An independent hostile reviewer (Phase 8) found two additional handlers in
the SAME liveness/ownership-only trust class as the six that were first
hardened, which were NOT in the originally authorized channel list and were
therefore initially left unhardened, pending an explicit scope decision.
**That decision was made and both were hardened in a second, narrowly-scoped
corrective pass** (see the 3 commits after `152a608` and
`independent-review.md`'s "Second corrective pass" section below) — this
does not erase the original `VERIFIED WITH CONDITIONS` verdict from the
first review; it records that both open conditions were subsequently closed
and re-verified.

- **`in-process-confirm-hook` / `in-process-rollback-hook`**
  (`electron/live-memory-ipc.ts`) — these call `installHookFromProposal`,
  which reaches `writeProcessBuffer()` in `src/core/in-process-script/hook-engine.ts`
  to write shellcode plus a jump patch directly into a live target process.
  Previously only `requireSession(event)` (liveness + ownership map) gated
  them — the exact NEW-1 pattern, on an arguably MORE destructive path than
  the injector-launch handlers that were hardened in the first pass. **Now
  hardened** with `requireTrustedSender(event)`, run before the existing
  session/gate/guard checks.
- **`trainer-host-rollback`** (`electron/main.ts`) — restores a game save
  file from backup; previously only `event.sender.isDestroyed()`. Its
  sibling `trainer-host-approve-and-write` was hardened in the first pass;
  this rollback counterpart was not, mirroring how `live-memory-rollback`
  was already hardened alongside `live-memory-confirm-write` in the base
  commit. **Now hardened** with the same `requireTrustedSender(event)`
  helper already used by `trainer-host-approve-and-write`.

All destructive/privileged channels in the NEW-1 finding's actual subsystem
(the V2 live-memory / injector-launch / in-process-hook / TrainerHost feature
area that the original audit named) now share the identical trusted-sender
mechanism — **16 channels total** (6 already hardened before this branch:
the freeze/rollback cluster; 10 hardened across this branch's two
implementation passes: `live-memory-issue-write-consent`,
`live-memory-confirm-write`, `in-process-propose-injector-launch`,
`in-process-issue-injector-consent`, `in-process-register-injector-helper`,
`in-process-confirm-injector-launch`, `trainer-host-approve-and-write`,
`in-process-confirm-hook`, `in-process-rollback-hook`,
`trainer-host-rollback`). Earlier drafts of this file said "10" without
naming the other 6 already-hardened channels, which read as an inconsistent
denominator against the ledger below — corrected here (found by the third,
final independent review). **Correction (found by the second narrow independent review):**
the sentence that previously stood here — "No further NEW-1 gaps are open as
of this pass" — was an overclaim about the codebase as a whole, not just the
authorized channel list, and was not true. See "Final same-class
destructive-handler audit" below for the corrected, complete picture: two
V1-era save-editor handlers (`restore-backup`, `apply-proposal`) have **zero**
sender check of any kind, and are a real, separately-tracked gap outside the
NEW-1 subsystem, not silently swept into "no further gaps."

These were surfaced during Phase 2 inventory but excluded from the first
pass's explicitly authorized "harden exactly these six channels +
trainer-host-approve-and-write" scope. The task owner then explicitly
authorized a second, narrowly-scoped corrective pass covering exactly these
three handlers (and nothing else), which is what closed them.

## Final same-class destructive-handler audit

Every `ipcMain.handle` registration in `electron/live-memory-ipc.ts` (42
channels) and `electron/main.ts` (44 channels) was re-enumerated and
classified (counts corrected here per the third independent review, which
found the previous draft's 41/45 was off by one in each direction).
Classifications used: `HARDENED — TRUSTED SENDER REQUIRED`,
`READ-ONLY / NON-DESTRUCTIVE`, `OUTSIDE NEW-1 CLASS — JUSTIFIED`,
`REMAINING DEFECT`.

### NEW-1 subsystem (`electron/live-memory-ipc.ts` — live-memory / research / in-process-hook / injector)

| Channel(s) | Classification |
|---|---|
| `live-memory-issue-write-consent`, `live-memory-confirm-write`, `live-memory-rollback`, `live-memory-freeze-propose`, `live-memory-freeze-issue-consent`, `live-memory-freeze-start`, `live-memory-freeze-stop`, `live-memory-freeze-status` | **HARDENED — TRUSTED SENDER REQUIRED** |
| `in-process-confirm-hook`, `in-process-rollback-hook` | **HARDENED — TRUSTED SENDER REQUIRED** (this pass) |
| `in-process-propose-injector-launch`, `in-process-issue-injector-consent`, `in-process-register-injector-helper`, `in-process-confirm-injector-launch` | **HARDENED — TRUSTED SENDER REQUIRED** |
| `live-memory-list-processes`, `live-memory-attach`, `live-memory-zero-input-prepare`, `live-memory-detach`, `live-memory-read`, `live-memory-propose-write`, `live-memory-scan-first*`, `live-memory-scan-next*`, `live-memory-read-many`, `live-memory-correlation-*`, `live-memory-list-controls`, `live-memory-resolve-*`, `live-memory-pointer-scan`, `live-memory-scan-aob`, `research:view`, `research:hex`, `research:pointer-analyze`, `research:resolve-path`, `research:snapshot-diff`, `in-process-propose-hook` | **READ-ONLY / NON-DESTRUCTIVE** — staging, scanning, or read-only; no live write/spawn occurs at these channels; consistent with why they were never in NEW-1's scope |
| `research:snapshot-save` | **OUTSIDE NEW-1 CLASS — JUSTIFIED** — writes a diagnostic snapshot file under the app's own `userData/research-sessions`, not a user's game save/config or process memory; L-tier (liveness-only), a real but low-severity gap, noted here rather than silently dropped |

Zero entries in this subsystem are `REMAINING DEFECT`.

**Note added per the third independent review (informational, not a NEW-1 defect):** `in-process-propose-hook`'s proposal store (`src/core/in-process-script/hook-engine.ts`'s module-level `proposals` map) is keyed by `proposalId` alone, not scoped by session — `installHookFromProposal` (called from the now-hardened `in-process-confirm-hook`) looks up a proposal by ID without checking which session staged it. This is a confused-deputy-shaped coupling between an unhardened staging channel and a hardened execution channel, but it is not independently exploitable: reaching `in-process-confirm-hook` still requires passing `requireTrustedSender(event)` as the trusted main window, and nothing lets an untrusted sender make the trusted window supply an attacker-chosen `proposalId`. Recorded for awareness in any future "beyond B1.1" hardening pass, not treated as a NEW-1 gap.

### NEW-1 subsystem (`electron/main.ts` — TrainerHost + V2 session monitor)

| Channel(s) | Classification |
|---|---|
| `trainer-host-approve-and-write`, `trainer-host-rollback` | **HARDENED — TRUSTED SENDER REQUIRED** |
| `trainer-host-start` | **LIFECYCLE — fixed-argv process spawn, non-destructive** (corrected from "READ-ONLY" per the third independent review: `host-supervisor.ts` spawns a child process here via `realSpawnFn(process.execPath, [entryPath], …)` with `shell: false` and a fixed, non-renderer-controlled argv — a real spawn, not a no-op, but not a destructive write and not attacker-influenceable) |
| `trainer-host-stop`, `trainer-host-get-status`, `trainer-host-read-field`, `trainer-host-propose-write` | **READ-ONLY / NON-DESTRUCTIVE** — lifecycle/read/staging; no destructive write happens until `-approve-and-write`, which is hardened |
| `v2-monitor-start`, `v2-monitor-stop`, `v2-monitor-get-state`, `v2-monitor-clear-timeline`, `v2-monitor-export-diagnostics` | **READ-ONLY / NON-DESTRUCTIVE** |

Zero entries in this subsystem are `REMAINING DEFECT`.

### Outside the NEW-1 subsystem (`electron/main.ts` — V1 legacy game-profile / save-editor feature)

`get-games`, `pick-game-folder`, `pick-game-executable`, `add-game`,
`update-game`, `scan-game`, `delete-game`, `get-recipes`, `create-recipe`,
`get-journal`, `log-event`, `get-settings`, `set-setting`, `delete-recipe`,
`get-backups`, `restore-backup`, `detect-save-files`, `pick-save-file`,
`parse-save`, `compare-saves`, `compare-saves-report`,
`create-proposal-for-edit`, `apply-proposal`, `suggest-data-edits`,
`discover-save-locations`, `get-save-locations`, `approve-save-location`,
`revoke-save-location`, `add-user-selected-location`, `check-game-running`,
`get-compatibility-profile`, `get-all-profiles` —
**OUTSIDE NEW-1 CLASS — JUSTIFIED.** This is Solith's pre-existing V1
game-profile/save editor. **The dividing line is provenance, not
implementation mechanism** — a correction made per the third independent
review, which pointed out that framing this as "file-based V1 vs.
memory/hook-based V2" is factually wrong: `trainer-host-approve-and-write`
and `trainer-host-rollback` (hardened, V2/TrainerHost) also do plain file
writes (`fs.writeFileSync`/`fs.copyFileSync` in
`src/core/trainer-host/write-save-field.ts`), structurally the same
operation as `apply-proposal`/`restore-backup` (unhardened, V1). The actual
boundary is: these V1 handlers were never named by the original NEW-1/NEW-2
audit and were never in scope for Batch B1.1 or either review pass on this
branch — full stop, regardless of whether they write memory or files. They
are tracked under the separate, still-`PENDING`
"Privileged IPC hardening beyond B1.1" roadmap item. Stating the boundary
as memory-vs-file risked a future reader using that false distinction to
justify leaving some other file-writing handler unhardened; stating it as
audit-provenance does not have that failure mode.

**This justification does not minimize the following real gap, flagged
explicitly rather than left implicit:** `restore-backup` and `apply-proposal`
are genuinely destructive (file restore / save-file write) and have **zero**
sender check of any kind — not `requireTrustedSender`, not even
`isDestroyed()`. `delete-game`, `delete-recipe`, and `revoke-save-location`
are also destructive with no sender check. `create-proposal-for-edit` is
staging-only (builds a proposal object, does not write) but also has zero
sender check. All of them do have their own non-identity protections
(`validateIpcPathSafety` scopes `apply-proposal`/`create-proposal-for-edit`
writes to within the game's own directory; Zod schema validation on every
payload), but none check who is calling. This is a real, pre-existing
security debt for a follow-up "Privileged IPC hardening beyond B1.1" pass —
it is explicitly NOT fixed by this branch, which is scoped to the NEW-1/NEW-2
finding only, and is recorded here so it cannot be mistaken for "no further
gaps."

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
