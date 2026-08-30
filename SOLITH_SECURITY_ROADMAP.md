# SOLITH Security Completion Roadmap

> **Project:** SOLITH
> **Repository root:** `G:\ACTIVE_PROJECTS\SOLITH`
> **Intended release branch:** `master`
> **Verified branch (current security work):** `review/gate2-5-doc-audit` @ `317baf0ea573992dfa1a0cec2a30d6529b6ecee0` — **NOT `master` until merged.** Every Gate 2.4/2.4A/2.5 claim in this document applies only to that verified branch tip unless a later evidence record explicitly verifies another commit. `master` has not been rechecked against this work.
> **Current security verdict:** **BATCH B1.1 CONDITIONAL PASS**
> **Current program state:** Feature freeze active; release/security completion not yet granted
> **Purpose of this document:** Provide a single root-level roadmap showing what has been reported complete, what must still be independently verified in the repository, what remains pending, and the exact work required before SOLITH may be considered security-complete.
>
> **Canonical location note (2026-07-29):** This file at the repository root
> (`G:\ACTIVE_PROJECTS\SOLITH\SOLITH_SECURITY_ROADMAP.md`) is now the
> canonical roadmap. A prior cycle (Gate 2.2A) updated a copy at
> `G:\Downloads\SOLITH_SECURITY_ROADMAP.md` instead; that copy's content was
> used as the starting point for this file but is no longer the canonical
> location going forward. All future sessions must update this in-repository
> file.
>
> **Master Implementation Plan addendum (2026-08-30):** The owner authorized
> a new, broader "SOLITH MASTER IMPLEMENTATION PLAN" (MIP) as the
> authoritative go-forward sequencing for everything beyond the existing
> Batch B1.1 gate cycle — see the **`MASTER IMPLEMENTATION PLAN`** section
> appended at the end of this file. Its phases are numbered **MP-Phase-N**
> specifically to avoid colliding with this document's own pre-existing
> `Phase 0`–`Phase 15` gate ledger below, which remains the immutable,
> unmodified evidence trail for the B1.1 cycle — nothing in the MIP addendum
> changes any verdict, status, or evidence claim in the sections above it.
> Where an MIP item extends or builds on an existing gate here (e.g. MP-P0.9
> Wisp IPC authorization extends this document's own Phase 6.2 file/path
> authorization work), the MIP section says so explicitly rather than
> silently re-doing or re-numbering that work.
>
> **Documentation authority (2026-07-29):** This file is the **sole
> canonical source** for security-gate status, Batch B1.1 status, security
> verdicts, security residuals, and security promotion conditions. Where
> `ROADMAP.md` mentions security state, it links here rather than restating
> a verdict. Where a security-gate certification (Gate 2.x / Batch B1.1) is
> discussed alongside `README.md`'s feature-maturity certification levels
> (L0–L4), the two are unrelated systems — see `README.md`'s "Certification
> levels" section for its own disambiguation note. Prohibited-capability
> boundaries are owned by `PROJECT_SPEC.md §3.2 "STRICTLY PROHIBITED (The
> Safety Firewall)"`, not restated here.

---

## 1. How to Read This Roadmap

Every item uses one of the following statuses:

| Status | Meaning |
|---|---|
| **VERIFIED COMPLETE** | Supported by source inspection, reproducible commands, and retained evidence. |
| **REPORTED COMPLETE — VERIFY** | An agent reported completion, but the repository implementation, test wiring, or evidence must still be independently checked. |
| **PARTIAL** | Some controls exist and tests pass, but one or more required scenarios are missing. |
| **PENDING** | Work has not started or is not yet authorized. |
| **BLOCKED** | Work cannot proceed until a prerequisite, owner decision, or environment requirement is resolved. |
| **OWNER DECISION REQUIRED** | A residual risk needs explicit acceptance or rejection by the project owner. |
| **OUT OF SCOPE / PROHIBITED** | Must not be implemented in SOLITH. |

A phase is not complete merely because code exists. Completion requires:

1. Source implementation review.
2. Positive tests.
3. Negative tests.
4. Lifecycle and cleanup tests.
5. Supported-command test integration.
6. Stable source-state verification.
7. Evidence that matches the current repository state.
8. No unexplained security-sensitive changes.

---

# Phase 0 — Governance, Scope, and Safety Boundaries

## Phase 0.1 — Repository and authority model

**Status:** VERIFIED COMPLETE

Current governing constraints:

- Work only in `G:\ACTIVE_PROJECTS\SOLITH`.
- PowerShell is the expected shell; use `;`, not `&&`, for command chaining.
- Default mode is `READ_ONLY_VERIFY_REPORT` unless the user explicitly authorizes a milestone.
- Do not commit, push, merge, reset, clean, stash, restore, checkout, tag, publish, or release unless explicitly authorized.
- Preserve unrelated modified and untracked files.
- Feature freeze remains active.
- Security corrections, verification, evidence reconciliation, and release-gate work are permitted during the freeze.

## Phase 0.2 — Permanently prohibited capabilities

**Status:** VERIFIED COMPLETE AS POLICY — CONTINUOUSLY ENFORCE

SOLITH must not implement:

- Multiplayer targeting.
- Anti-cheat bypass.
- Kernel drivers.
- Packet capture.
- Unverified third-party executable execution.
- Host operating-system security-policy modification.
- Generic arbitrary-process termination exposed to renderer code.
- Hidden telemetry or unapproved cloud fallback.

## Phase 0.3 — Change-control discipline

**Status:** PARTIAL

Already established:

- Scope-specific authorization is required for each milestone.
- Security work is separated from unrelated cleanup.
- Evidence directories are used to preserve gate outputs.

Still required:

- Confirm all future milestones use an immutable before/after source-state manifest.
- Ensure no other editor or agent writes to the repository during security-gate capture.
- Require exact command lines, versions, timestamps, exit codes, totals, and raw output for each gate.
- Require explicit owner acceptance for residual risks; agents may only mark them `Proposed for acceptance`.

---

# Phase 1 — Security Surface Discovery and Reconciliation

## Phase 1.1 — IPC handler inventory

**Status:** REPORTED COMPLETE — VERIFY

Reported results:

- 149 real `ipcMain.handle` handlers.
- 0 `ipcMain.on` request handlers.
- One additional search hit was reportedly a comment rather than a handler.
- 149-row handler reconciliation produced.

Required verification:

- Re-run the handler inventory against the current source tree.
- Confirm each handler has a unique reconciliation row.
- Confirm no newly added handler is missing.
- Confirm event-only main-to-renderer channels are not misclassified as request handlers.

## Phase 1.2 — Preload exposure inventory

**Status:** REPORTED COMPLETE — VERIFY

Reported results:

- 154 preload-exposed methods.
- Five apparent orphans were reportedly main-to-renderer events rather than request-response APIs.

Required verification:

- Reconcile every preload method to a real handler or documented event.
- Remove dead or unsafe preload methods.
- Confirm no generic arbitrary-channel invoke wrapper exists.
- Confirm event listeners have safe registration and removal behavior.

## Phase 1.3 — Renderer call-site inventory

**Status:** REPORTED COMPLETE — VERIFY

Reported result:

- 222 renderer call sites.

Required verification:

- Re-run against the current source tree.
- Confirm every privileged renderer call maps to an authorized preload method.
- Identify renderer-controlled booleans, paths, PIDs, commands, or consent assertions.

## Phase 1.4 — Execution-site inventory

**Status:** REPORTED COMPLETE — VERIFY

Reported result:

- 10 execution sites.

Required verification:

- Identify every use of process creation, shell execution, executable launch, helper invocation, and external URL opening.
- Confirm no shell interpolation or arbitrary renderer command path exists.

## Phase 1.5 — Consent-gated handler inventory

**Status:** REPORTED COMPLETE — VERIFY

Reported result:

- 13 consent-gated handlers.

Required verification:

- Confirm consent is operation-bound, sender-bound, expiring, single-use where appropriate, and invalidated on cleanup.
- Confirm no renderer self-attestation is treated as consent.

## Phase 1 Exit Criteria

Phase 1 is complete only when:

- All counts are current.
- Every row has implementation and test references.
- No handler, preload method, renderer call, or execution site remains unexplained.
- Evidence is regenerated from the current source state.

---

# Phase 2 — High-Risk B1 and B1.1 Security Hardening

## Phase 2.1 — Initial B1 targeted controls

**Status:** REPORTED COMPLETE — VERIFY

Targeted operations:

- `live-memory-rollback`
- `live-memory-freeze-start`
- `registry-run-readonly-verification`

Reported initial outcome:

- B1 was downgraded from PASS to **CONDITIONAL PASS** after evidence contradictions were found.

Known original residuals:

- Freeze lacked fully operation-bound consent.
- Rollback lacked current-state comparison and expiration.
- Sender identity was weak/systemic.
- Registry verification trusted renderer self-attestation.

## Phase 2.2 — B1.1 operation-bound freeze consent

**Status:** REPORTED COMPLETE — VERIFY

Reported flow:

`live-memory-freeze-propose`
→ `live-memory-freeze-issue-consent`
→ `live-memory-freeze-start`

Required verification:

- Consent token binds to operation, owner, sender, process selection, and expiration.
- Replay fails.
- Wrong window fails.
- Wrong operation fails.
- Cleanup revokes pending and issued consent.

## Phase 2.3 — Rollback expected-state and ledger controls

**Status:** REPORTED COMPLETE — VERIFY

Reported controls:

- Expected-current-state comparison.
- 30-minute rollback TTL.
- Capacity of 50 entries.
- Reject-before-write when full.
- Expired entries purged first.

Required verification:

- Capacity is checked before mutation.
- Failed writes consume no capacity.
- Successful writes create exactly one record.
- Expired records cannot roll back.
- Cleanup clears records.
- No unexpired record is silently evicted.

## Phase 2.4 — Centralized sender validation

**Status:** REPORTED COMPLETE — VERIFY

Reported control:

- `requireTrustedSender` or equivalent centralized validation.

Required verification:

- Trusted sender identity is checked in the main process.
- Privileged handlers also enforce allowed window type.
- Child frames, DevTools frames, stale `webContents`, destroyed senders, and unauthorized URLs fail.
- URL checks use parsed canonical boundaries rather than raw prefix checks.

## Phase 2.5 — Main-owned process selection

**Status:** REPORTED COMPLETE — VERIFY

Reported control:

- Main-process selection registry with server-generated IDs.

Required verification:

- Renderer-supplied PID alone cannot authorize a process.
- Selection binds to window, PID, executable identity, path, creation time, and expiration.
- PID reuse is rejected.
- Reload, crash, navigation, recreation, and shutdown clear or invalidate selection.

## Phase 2.6 — Lifecycle cleanup coordinator

**Status:** REPORTED COMPLETE — VERIFY

Reported scenarios:

- Renderer crash cleanup.
- Application shutdown cleanup.
- Feature-disable cleanup.
- Multi-step cleanup failure containment.

Required verification:

- Future writes are blocked before cleanup starts.
- Remaining cleanup steps continue after one step fails.
- Cleanup produces sanitized `cleanup_started`, `cleanup_completed`, and `cleanup_failed` audit events.
- Cleanup is idempotent.
- One renderer’s failure does not stop another renderer’s valid operation.

## Phase 2.7 — TypeScript security-surface remediation

**Status:** VERIFIED COMPLETE WITH UNRELATED BASELINE REMAINING

Verified state:

- B1.1 security-surface TypeScript remediation passed.
- `npm run test:live-memory` passed 221/221 at the time of verification.
- Full Electron TypeScript still had 31 diagnostics across 13 files.
- No new B1.1 lifecycle, sender-validation, selection-registry, consent-store, or cleanup diagnostic remained.

Known unrelated baseline:

- Electron TypeScript: 31 diagnostics across 13 files.
- `GameLibrary.tsx` trailing whitespace at the established locations.

## Phase 2.8 — Node 22 stable verification

**Status:** VERIFIED COMPLETE

Verified environment:

- Node `v22.23.1`
- npm `10.9.8`
- Runtime path: `.tools\node-v22.23.1-win-x64\node.exe`

Verified results:

- `npm test`: 1,034/1,034 passed at that gate.
- `npm run test:live-memory`: 221/221 passed.
- Main TypeScript: PASS.
- Electron TypeScript: expected baseline failure only.
- `git diff --check`: expected unrelated baseline failure only.
- Stable source state was captured and retained.

## Phase 2.9 — Raw-byte rollback integrity

**Status:** REPORTED COMPLETE — VERIFY (now running through supported commands as of Gate 2.1 — see Phase 3.2/3.3). **Gate 2.2A finding (2026-07-29): all rollback/write/freeze verification prior to Gate 2.2A ran only against `FakeMemoryDriver` or non-writing packaged scenarios — no prior gate ever exercised a real `WriteProcessMemory` against a real process. A real defect (see Phase 3.12) meant every real write silently no-op'd. Gate 2.2A fixed this at the Node-ABI level and Gate 2.2A.1 (2026-07-29) completed Electron-ABI/packaged verification; see Phase 3.12.**

Reported implementation:

- `MemoryDriver` extended to expose raw-buffer write support.
- Exact pre-write and post-write bytes retained for rollback TTL.
- Current memory bytes compared byte-for-byte before rollback.
- Exact bytes restored in one write.
- Existing numeric safety checks retained as an additional layer.
- A partial-mutation bug discovered during testing was reportedly fixed.

Reported test result:

- 19/19 dedicated raw-byte rollback tests passed by direct invocation.

Required verification:

- Review `types.ts`, `native-memory-driver.ts`, `live-memory-session.ts`, and fake driver changes.
- Confirm no sequential typed-write plus raw-write partial mutation remains.
- Confirm buffers are cleared on success, rejection, expiration, detach, crash, shutdown, and feature disable.
- Confirm raw bytes never appear in logs, snapshots, evidence, or thrown errors.
- Confirm every supported data type has explicit width and endianness handling.

## Phase 2.10 — Gate 2 packaged build

**Status:** VERIFIED PARTIAL — SUPERSEDED IN PART BY GATE 2.1 (see Phase 3.4–3.10)

Reported and accepted:

- Unpacked Windows package built successfully.
- Native `memoryjs` rebuilt for packaged Electron ABI.
- Packaged application booted.
- Existing smoke suite passed 23/23.

Originally incomplete (six scenarios) — Gate 2.1 status per scenario:

- Real packaged renderer-crash lifecycle certification — **REPORTED COMPLETE — VERIFY** (Phase 3.5).
- Real packaged shutdown certification — **PARTIAL, narrowed scope** (Phase 3.6).
- Real packaged feature-disable certification — **still PENDING** (Phase 3.7).
- Real packaged window identity/navigation lifecycle certification — **still PENDING** (Phase 3.8).
- Real packaged process restart/PID-reuse certification — **REPORTED COMPLETE — VERIFY, simulated not natural reuse** (Phase 3.9).
- Real packaged cleanup-failure containment certification — **REPORTED COMPLETE — VERIFY** (Phase 3.10).

## Phase 2.11 — Orphaned security-test discovery

**Status:** REPORTED COMPLETE — VERIFY (RESOLVED as of Gate 2.1 — see Phase 3.2)

Reported finding:

- Seven pre-existing test files and one new rollback-byte test file were not wired into `npm test` or `npm run test:live-memory`.
- The seven pre-existing files reportedly passed 20/20 by direct invocation.
- The new rollback-byte file reportedly passed 19/19 by direct invocation.

Required verification:

- Identify the exact eight files.
- Verify why each is excluded.
- Integrate them into supported test commands without duplicate execution or broad accidental inclusion.

Gate 2.1 reported this as done — all eight files, plus a ninth
(`gate2-1-test-build-hooks.test.ts`, added by Gate 2.1 itself), are now
wired into `test`/`test:live-memory`. Independent verification against the
current repository is still required per this roadmap's own methodology
(an agent report is not a substitute for re-checking `package.json` and
re-running the commands).

## Phase 2 Exit Criteria

B1.1 may become unconditional PASS only when:

- All eight orphaned tests run through supported commands.
- Raw-byte rollback tests pass through the normal regression gate.
- Real packaged lifecycle certification passes for all six missing scenarios.
- No unresolved B1.1 security risk remains.
- Evidence is complete, reproducible, and tied to a stable source state.

---

# Phase 3 — Gate 2.1 Test Integration and Packaged Lifecycle Certification

## Phase 3.1 — Confirm explicit authorization

**Status:** VERIFIED COMPLETE

Explicitly authorized exceptions:

- Narrow `package.json` test-script edits.
- Narrow test-runner configuration edits.
- Test-build-only hooks where necessary.
- Controlled packaged lifecycle harness.
- Spawn and terminate only dedicated test processes created by the harness.

## Phase 3.2 — Identify and integrate orphaned tests

**Status:** REPORTED COMPLETE — VERIFY

Reported work performed:

1. Identified the exact eight orphaned test files (7 pre-existing +
   `rollback-byte-integrity.test.ts` from Gate 2):
   `tests/live-memory/app-shutdown-cleanup.test.ts`,
   `tests/live-memory/cleanup-failure-handling.test.ts`,
   `tests/live-memory/feature-disable-cleanup.test.ts`,
   `tests/live-memory/renderer-crash-cleanup.test.ts`,
   `tests/live-memory/rollback-float-integrity.test.ts`,
   `tests/live-memory/rollback-byte-integrity.test.ts`,
   `tests/ct-preview-receipt.test.ts`, `tests/wisp-preferences.test.ts`.
2. All eight ran directly first (39/39 pass) to confirm a clean baseline
   before touching `package.json`.
3. Wired the six `live-memory` files into `test:live-memory`; wired
   `ct-preview-receipt.test.ts` and `wisp-preferences.test.ts` into `test`.
4. A ninth file, `tests/live-memory/gate2-1-test-build-hooks.test.ts`
   (new this cycle — proves the Phase 3.4 test-only hooks are absent by
   default), was also wired into `test:live-memory`.
5. Reported diff to `package.json` limited to exactly the two script-value
   lines edited; re-parsed as valid JSON; no dependency, build-system,
   release, or metadata change.
6. Re-ran the supported commands: `npm run test:live-memory` **257/257**
   (was 221), `npm test` **1,040/1,040** — 1,030 + 10 (was 1,034; net +6
   from the two newly-wired files in the main `test` script).

Still required (per this roadmap's own methodology): independent
re-verification of the `package.json` diff and re-run of both commands
against the current repository — an agent report alone does not satisfy
this.

## Phase 3.3 — Certify raw-byte rollback through supported commands

**Status:** REPORTED COMPLETE — VERIFY

Reported: `rollback-byte-integrity.test.ts` (19 tests, covering identical
bytes, one-bit/one-byte mismatch, NaN payload mismatch, signed zero,
infinity, float/double precision boundaries, uint32 max, int64
unsafe-integer rejection, boolean N/A documentation, concurrent external
mutation, expired record, failed current-byte read, failed rollback write,
buffer cleanup on detach/cleanup-revocation, ledger-full reject, failed
initial write retains nothing, one atomic restore write) now executes as
part of `npm run test:live-memory` rather than only by direct invocation.

## Phase 3.4 — Packaged harness architecture

**Status:** REPORTED COMPLETE — VERIFY

Reported implementation: `tests/packaged-lifecycle-gate2-1.e2e.test.ts`,
launching the real `dist/win-unpacked/Solith.exe` with an isolated
temp userData/appData directory and `SOLITH_TEST_BUILD=1`.

Three narrow test-only hooks reported added, all gated on
`process.env.SOLITH_TEST_BUILD === '1'` and throwing otherwise:

| Hook | File | Purpose |
|---|---|---|
| `__setTestProcessIdentityOverride` / `__clearTestProcessIdentityOverrides` | `src/core/live-memory/windows-process-identity.ts` | Simulates PID-reuse / identity mismatch (real OS PID recycling cannot be forced deterministically) |
| `__setTestForcedCleanupFailureStep` / `__clearTestForcedCleanupFailureSteps` | `electron/live-memory-ipc.ts` | Forces one named cleanup step to throw, to prove containment |
| `__testHasSessionForOwner` (read-only) | `electron/live-memory-ipc.ts` | Session-presence introspection — needed because a crashed renderer's own JS context can no longer be queried afterward |

Also reported: `__solithQueryWindowsProcessIdentity` /
`__solithCompareProcessIdentity` exposed on `globalThis` (same gate, same
two functions, no new behavior) purely because Electron's
`electronApp.evaluate()` sandbox rejects dynamic `import()`.

Reported compliance with the four hook requirements:

- Unavailable in normal production builds — env-var gated; **caveat
  reported, not hidden:** the hook code is still compiled into the shipped
  binary, inert unless the env var is set, rather than built as a fully
  separate test-only artifact. Narrower than a literal build-variant split.
- Enabled only in a clearly identified test build — `SOLITH_TEST_BUILD=1`.
- Exposes no generic renderer-controlled process interface — all three
  hooks are main-process-only (`globalThis`), never exposed via IPC or
  `contextBridge`.
- Tested as absent from normal builds — `gate2-1-test-build-hooks.test.ts`
  (3/3 pass) asserts every setter throws and every `globalThis` entry is
  `undefined` when `SOLITH_TEST_BUILD` is unset.

Process-spawn/kill: reported as using only dedicated
`node -e 'setInterval(...)'` child processes the harness itself creates
and kills; reported verified no leftover process after the run via
`Get-CimInstance`/`Get-Process` (external to the harness's own assertions).

## Phase 3.5 — Packaged renderer-crash certification

**Status:** REPORTED COMPLETE — VERIFY (narrowed proof set)

Reported proof, against the real packaged app:

- Attach a real spawned test process, confirm session exists
  (`__testHasSessionForOwner` → `true`).
- `webContents.forcefullyCrashRenderer()` on the real window.
- Confirm session for that owner is gone (`__testHasSessionForOwner` →
  `false`).

Not reported/not attempted: consent-revoked / selection-revoked /
rollback-cleared as *separately itemized* assertions (session removal is
used as the composite proxy — cleanup-coordinator's per-step behavior is
proven separately in Phase 3.10, not re-proven here per scenario); "other
renderer's freeze remains active" (single-window harness, not exercised).

## Phase 3.6 — Packaged shutdown certification

**Status:** PARTIAL — narrowed scope, reported and disclosed as narrowed

Reported proof: `electronApp.close()` (triggering `will-quit`) resolves
within 15 seconds with no hang, run immediately after a full attach/crash
lifecycle in the same session.

Reported gap, not hidden: the harness's one trusted window's renderer was
already crashed by Phase 3.5's scenario before this scenario ran (a second
ad-hoc `BrowserWindow` is not registered in
`trusted-sender-registry.ts` and cannot exercise privileged IPC without
further engineering), so this run certifies "`will-quit` exits cleanly, no
hang" rather than "an IPC-attached session was active at the exact instant
of quit." The following from the original required-scenario list remain
**not exercised**: `before-quit` specifically, active freeze during
shutdown, pending consent during shutdown, active process selection during
shutdown, rollback record present during shutdown, controlled forced
termination.

## Phase 3.7 — Packaged feature-disable certification

**Status:** VERIFIED COMPLETE (Gate 2.2 Resume, 2026-07-29). Real freeze proven active against
the Gate 2.2 fixture (applies frozen value + restores after external mutation), then
`v2LiveModeEnabled` disabled through the real, existing `setSetting` IPC; freeze stopped with
`stopReason === 'feature_disabled'` exactly; no further writes; old proposal ID rejected;
re-enabling did not restart the freeze. See
`Docs/Security/Evidence/BatchB1_1_Closeout/Gate2_2_Resume/packaged-feature-disable-final-matrix.csv`.
A pre-existing, unrelated defect was discovered while building this scenario — see Phase 3.13
below (R-2.2-RESUME-001).

Reported reason: certifying "stop reason exactly `feature_disabled`" for a
real *active freeze* requires a real freeze running against a known
writable memory address in a real target process. No fixture executable
with such a known address exists in this repository. Building one reliably
in a single session was judged out of scope for a security-critical
write-authorization surface (same class of judgment call as Gate 2's
original disclosure). Continues to be covered only by
`feature-disable-cleanup.test.ts` (deterministic-fake driver), now at
least wired into `test:live-memory` per Phase 3.2.

## Phase 3.8 — Packaged window identity and navigation certification

**Status:** PARTIAL (Gate 2.2 Resume, 2026-07-29). VERIFIED COMPLETE: main-window reload (stale
proposal/consent/session rejected after reload, webContents ID unchanged per Electron behavior);
unauthorized navigation (privileged IPC unavailable/rejected from unapproved local content;
returning to trusted content does not restore old authority). PENDING (disclosed, not attempted):
full window recreation without app quit (architecturally not a real Windows code path for this
single-window app — `window-all-closed` unconditionally quits; equivalent coverage via
restart-based Phase 3.6/4.1-4.5 proofs), overlay identity boundaries (overlays are on-demand UI
features, out of single-session scope), same-prefix/encoded-path/traversal navigation sub-cases
(no realistic distinct target exists in this packaged app's own asar), and child-frame/DevTools
boundaries (structural code-review confidence only — DevTools is not enabled in the production
candidate by design). See
`Docs/Security/Evidence/BatchB1_1_Closeout/Gate2_2_Resume/packaged-window-identity-final-matrix.csv`.

Reported reason: same as Phase 3.7 — real window-recreation/navigation
scenarios exercising an *active* privileged operation need the same
missing real-target-process fixture. Continues to be covered only by
`trusted-sender-registry.test.ts` and `session-cleanup-on-destroy.test.ts`
(deterministic-fake, already wired).

## Phase 3.9 — Process restart and PID-reuse certification

**Status:** REPORTED COMPLETE — VERIFY (simulated, not natural, PID reuse — explicitly labeled as such)

Reported proof: a real dedicated test process is spawned, its real PID
captured, the process killed, then the Phase 3.4 identity-override hook
is used to make that same real PID report a different executable identity
on the next query — exercising the real `queryWindowsProcessIdentity` /
`compareProcessIdentity` fail-closed path against a simulated mismatch.
Natural PID reuse was not obtained (expected — cannot be forced
deterministically) and is not claimed as having been obtained.

Not reported/not attempted from the original scenario list: valid
selection → termination → replacement → stale-selection-rejection as a
full IPC-level round trip (this was exercised at the identity-function
level, not via a full `liveMemoryAttach`→terminate→reattach IPC sequence).

## Phase 3.10 — Cleanup-failure containment certification

**Status:** REPORTED COMPLETE — VERIFY (one step exercised, not all eight)

Reported proof, against the real packaged app: `revoke_consent_tokens`
forced to throw via the Phase 3.4 hook during a real `liveMemoryDetach()`
call; session still fully removed; a subsequent `liveMemoryRead` still
rejected (future writes/reads stay blocked despite the forced failure).

Not reported/not attempted: forced failure in the other seven listed
steps (proposal revocation, scheduler stop, session detach, rollback
cleanup, process-selection cleanup, trusted-window cleanup, audit sink) —
only `revoke_consent_tokens` was exercised against the real app this
cycle. All eight (including this one) remain covered by
`cleanup-failure-handling.test.ts` (deterministic-fake, now wired per
Phase 3.2), which does exercise multiple steps.

## Phase 3.13 — Gate 2.2 Resume: shutdown, feature-disable, reload/navigation certification, and regression

**Status:** SUBSTANTIALLY COMPLETE — REPORTED, VERIFY.

Authorized 2026-07-29 as "Gate 2.2 Resume" to complete the remaining Gate 2.2 packaged lifecycle
scope using the existing Gate 2.2 fixture and the native write path fixed/packaged-verified in
Gate 2.2A/2.2A.1.

### New finding: renderer freeze-start IPC wiring is broken (R-2.2-RESUME-001)

`src/app/pages/LiveMemoryTrainerPage.tsx` calls `electronAPI.liveMemoryFreezeStart({address,
dataType, value, intervalMs})`, but `electron/live-memory-ipc.ts`'s `'live-memory-freeze-start'`
handler now requires `{proposalId, consentToken}` (a prior "Batch B1.1" rework per existing code
comments), and no `liveMemoryFreezePropose`/`liveMemoryFreezeIssueConsent` preload methods are
exposed at all. **The shipped renderer currently has no working path to start a freeze.** This
predates Gate 2.2 entirely and is not a regression from any gate in this engagement — discovered,
not introduced, while building the Phase 3.7/4 real-freeze scenarios. Worked around for
verification purposes via one new narrow test-only hook,
`__testStartFreezeForOwner` (`electron/live-memory-ipc.ts`, `SOLITH_TEST_BUILD=1`-gated,
unreachable via any IPC/contextBridge), which calls the exact same production functions
(`proposeFreeze`, `requestPrivilegedWriteConsent`, `manager.freezeStart`) the real, currently
broken flow would call. **Owner decision required**: whether/when to fix the renderer's actual
freeze-start wiring (a real end-user-facing defect, separate from this certification work).

### Results

- **Active-session shutdown (Phase 3.6/4, all sub-scenarios)**: VERIFIED COMPLETE. Real active
  freeze proven (2+ ticks via external-mutation-then-restore) before each shutdown case. Normal
  main-window close and application quit are the SAME event chain on this single-window Windows
  app (`window-all-closed → app.quit()`) — disclosed, not hidden. Covered: normal
  close/app-quit revokes all state and blocks further writes; shutdown with pending
  (unconfirmed) consent rejects after restart; shutdown with an active attach/selection rejects
  after restart; shutdown with a confirmed rollback record rejects after restart; controlled
  forced termination (SIGKILL) leaves no further writes reaching the fixture.
- **Mid-freeze feature-disable (Phase 3.7)**: VERIFIED COMPLETE (see Phase 3.7 above).
- **Window reload / unauthorized navigation (Phase 3.8)**: PARTIAL — reload and navigation
  boundary VERIFIED COMPLETE; recreation-without-quit, overlay, some navigation sub-cases, and
  child-frame/DevTools boundaries PENDING with disclosed architecture/scope reasons (see
  Phase 3.8 above).
- **Normal-build hook absence**: VERIFIED COMPLETE, including the new
  `__testStartFreezeForOwner` hook (confirmed `undefined` in a normal launch).
- **Regression of prior packaged controls**: VERIFIED COMPLETE — Gate 2.1's 5 scenarios,
  Gate 2.2A.1's packaged write proof, and packaged smoke (23/23) all re-run clean against this
  cycle's rebuilt candidate.
- **Full regression gate**: `npm test` 1,040/1,040, `test:live-memory` 257/257, main TypeScript
  0 diagnostics, Electron TypeScript 31/13 (unchanged baseline), `git diff --check`
  `GameLibrary.tsx` only (unchanged baseline).

Evidence: `Docs/Security/Evidence/BatchB1_1_Closeout/Gate2_2_Resume/` (baseline captures,
fixture/shutdown/feature-disable/window-identity/hook-absence/regression matrices, packaged
build output, full regression outputs, control-provenance, remaining-risks, verification-final).

## Phase 3.14 — Gate 2.3: restore the real packaged freeze authorization flow

**Status:** VERIFIED COMPLETE (this cycle, 2026-07-29) — REPORTED, VERIFY.

Authorized as "Gate 2.3" specifically to resolve R-2.2-RESUME-001 — the
renderer's real freeze-start wiring was broken, so Gate 2.2 Resume's freeze
scenarios only proved lifecycle behavior via a test-only hook, not the real
production authorization path.

### Root-cause finding

The main-process IPC handlers for freeze propose/issue-consent/confirm
(`electron/live-memory-ipc.ts`'s `'live-memory-freeze-propose'`,
`'live-memory-freeze-issue-consent'`, `'live-memory-freeze-start'`) were
**already fully implemented and correct** — trusted-sender validation,
session ownership, feature-flag re-checks, identity re-verification, a real
privileged consent dialog, and a `{proposalId, consentToken}`-only confirm
schema were all already in place. The entire defect was in the
**preload/renderer layer**: `electron/preload.ts`'s `liveMemoryFreezeStart`
sent the legacy `{address, dataType, value, intervalMs}` payload directly to
the confirm-start channel (guaranteed schema rejection), and no
`liveMemoryFreezePropose`/`liveMemoryFreezeRequestConsent` preload methods
existed at all.

### Repair

- `electron/preload.ts`: added `liveMemoryFreezePropose`,
  `liveMemoryFreezeRequestConsent`; fixed `liveMemoryFreezeStart` to
  `{proposalId, consentToken}`. Legacy signature REMOVED outright (it never
  had a working call path to preserve).
- `src/types/global.d.ts`: matching type repair.
- `src/app/pages/LiveMemoryTrainerPage.tsx` (2 call sites) and
  `src/app/hooks/useGameCheatSession.ts` (1 call site): rewired to the real
  propose → requestConsent → start sequence, preserving the existing
  single-click "Start Freeze"/toggle-freeze UX.
- `electron/live-memory-ipc.ts`'s `__testStartFreezeForOwner` test-only hook
  (added in Gate 2.2 Resume) REMOVED from source entirely — no longer needed.

### Certification

Fresh packaged rebuild. Against the real Gate 2.2 fixture and the real
packaged `Solith.exe`, using ONLY the renderer-facing `electronAPI` surface
(no test hook): propose → real privileged consent (pre-existing
`SOLITH_PRIVILEGED_CONSENT` test seam, not a new bypass) → confirmed start →
real freeze ticks → external mutation → restore confirmed → stop → no
further writes → proposal/token replay rejected → fabricated proposal/token
rejected → legacy payload rejected. `tests/gate2-2-resume-packaged-lifecycle.e2e.test.ts`
re-run in full (10/10 pass) with its `attachAndFreeze` helper rewired to the
real flow — active-session shutdown/quit, mid-freeze feature-disable, and
controlled forced termination all now use the real production sequence, the
latter two launched WITHOUT `SOLITH_TEST_BUILD` to prove the real flow needs
no test assistance. New `tests/gate2-3-freeze-authorization-security.e2e.test.ts`
(3/3 pass) proves legacy-payload rejection, proposal/token replay rejection,
and fabricated-credential rejection. Full regression clean (`npm test`
1,040/1,040, `test:live-memory` 257/257, TypeScript/`git diff --check`
baselines unchanged, re-confirmed a second time after restoring the Node-22
ABI native addon post-packaging).

Two items disclosed rather than fabricated as independently proven this
cycle: renderer-crash cleanup not re-exercised specifically with a real-flow
freeze (code path unchanged from Gate 2.1/2.2 Resume); wrong-owner
proposal/token not independently e2e-tested with two concurrent windows
(ownership model unchanged from the write flow, already relied upon in every
prior gate). Carried forward unchanged: overlay boundaries, full window
recreation without quit, navigation sub-cases 9.2–9.5, child-frame/DevTools
boundaries (identical to R-2.2-RESUME-002/003/004), and the unrelated
Electron TypeScript/GameLibrary.tsx baselines.

**R-2.2-RESUME-001: RESOLVED.**

Evidence: `Docs/Security/Evidence/BatchB1_1_Closeout/Gate2_3/` (baseline
captures, gap-trace docs, preload/renderer/proposal/consent/sender-boundary/
lifecycle-revocation matrices, packaged build output, packaged real-flow and
security-matrix test runs, regression outputs, control-provenance,
remaining-risks, verification-final).

## Phase 3.15 — Gate 2.4: final ownership, window, frame, and navigation certification

**Status:** VERIFIED COMPLETE (for all explicitly authorized, attempted scope)

Certification-only milestone — no production IPC handler, preload API, or
sender-validation code was modified. One new test file added:
`tests/gate2-4-final-certification.e2e.test.ts`.

A fresh packaged candidate was built independently of Gate 2.3's own
evidence and used to re-run the full real production freeze flow
(propose → consent → confirmed start → 2+ ticks → external mutation →
restore → stop → no-further-write → replay rejection) plus a fresh rerun of
Gate 2.3's own 3-test security suite — both pass. A freeze started
exclusively via the real production sequence was proven to stop cleanly and
revoke its proposal/token when the owning renderer was forcefully crashed
(`R-2.3-001 RESOLVED`). Cross-window ownership isolation was proven against
a second real, live trusted window (the Wisp overlay) — it could not
request consent for or start the main window's proposal, while the main
window completed its own operation normally; a true two-*main*-window test
is not constructible since only one `'main'`-type window exists in this
application's architecture, disclosed explicitly rather than fabricated
(`R-2.3-002 RESOLVED`, narrowed). Main-window recreation without quit is
architecturally **NOT APPLICABLE** on Windows (`window-all-closed` always
calls `app.quit()` on this platform). Overlay permission boundaries,
canonical URL boundaries (same-prefix sibling, encoded slash/backslash/
dot-dot, malformed percent-encoding, protocol mismatch), and frame
boundaries (`not_main_frame` rejection) were compiled from the existing,
extensive `tests/trusted-sender-registry.test.ts` unit coverage plus new
packaged navigation sub-case tests (9.2 encoded-path, 9.4 same-prefix
sibling directory, 9.5 unapproved local HTTP origin), extending the existing
9.1/9.6 coverage. Test-hook inventory re-confirmed: the one privileged hook
(Gate 2.2 Resume's freeze-start hook) remains structurally removed from
source; the remaining 4 hooks remain gated behind
`SOLITH_TEST_BUILD === '1'` (a strict string-equality check — no other value
can satisfy it) and absent from a normal-build launch (re-confirmed live).
Full regression clean: packaged smoke 23/23, Gate 2.3 rerun 3/3, Gate 2.4
suite 5/5, Gate 2.2 Resume lifecycle rerun 10/10, Gate 2.2A.1 native write
proof rerun 1/1, `npm test` 1,040/1,040, `test:live-memory` 257/257,
TypeScript/`git diff --check` baselines unchanged.

Disclosed rather than fabricated as tested this cycle: DevTools-frame
rejection (harness limitation, unchanged from R-2.2-RESUME-004/R-2.3-003);
non-DevTools child-`<iframe>` live packaged test (time-scoped out; the
underlying check is generic and already unit-tested); overlay
destroy/recreate cycle not independently re-instantiated against a live
packaged overlay (mechanism already proven generically and for the main
window); `SOLITH_TEST_BUILD` non-`'1'` values (`0`/`false`/malformed) not
independently relaunched after an ad-hoc verification script failed outside
the Playwright harness (the absent case IS proven live; the guard is a
structural strict-equality check regardless).

**Session-handling error, disclosed:** a pre-existing untracked file
(`test_output.txt`, present before this session began) was deleted in error
via a blanket cleanup command while removing unrelated ad-hoc scratch
scripts, without being read first. Not recoverable via git (never tracked).
Unrelated to Gate 2.4's security scope; reported to the user directly.

**R-2.3-001: RESOLVED. R-2.3-002: RESOLVED (narrowed).**

Evidence: `Docs/Security/Evidence/BatchB1_1_Closeout/Gate2_4/` (baseline
captures, independent Gate 2.3 reverification matrix, renderer-crash/
owner-isolation/window-recreation/overlay-permission/canonical-URL/
navigation-boundary/frame-boundary/DevTools-boundary matrices, test-hook
inventory, packaged final regression matrix, regression outputs,
control-provenance, remaining-risks, verification-final).

## Phase 3.15A — Gate 2.4A: deleted-file recovery and scope-integrity reconciliation

**Status:** GATE 2.4A CONDITIONAL RECONCILIATION

Follow-up milestone to Gate 2.4's disclosed session-handling error. Read-only
investigation cycle: no production code, test code, `package.json`, or
CI/release-workflow file was modified; no file was deleted, restored, checked
out, reset, cleaned, stashed, committed, pushed, merged, or tagged.

Investigated the unauthorized deletion of `test_output.txt` exhaustively:
recursive filesystem search across `G:\ACTIVE_PROJECTS`, `G:\Downloads`,
`%TEMP%`, `%LOCALAPPDATA%\Temp` (zero matches); PowerShell PSReadLine history,
Git Bash history, VS Code local-history metadata (70 entries), and the Windows
Recycle Bin (zero matches — the `rm -f` delete bypassed the Recycle Bin
entirely). No script, test, or config file anywhere in the repository ever
referenced this filename. Classified **NOT RECOVERABLE**; no reconstructed
or guessed-content replacement was created.

Diffed Gate 2.4's own baseline status snapshot against the current repository
status and confirmed `test_output.txt` is the **only** path removed since
Gate 2.4 began — every other difference is an authorized Gate 2.4/2.4A
addition (the new test file and new evidence files). No other unauthorized
deletion or modification was found. Because the deleted file had zero
references in any build, test, or packaging script, its loss is proven to have
had **no effect** on Gate 2.4's test results, test totals, packaged-build
identity, or security conclusions — Gate 2.4's functional results remain tied
to a stable, reproducible source state.

Corrected three Gate 2.4 evidence files with additive notices (no raw evidence
rewritten): `verification-final.txt` (formal scope-integrity verdict: FAIL),
`changed-files.txt` (deletion noted), `remaining-risks.md` (recovery/impact
findings layered onto the existing R-2.4-007 disclosure). Formal statement
replacing any prior "files and processes left behind: none" claim: *no
harness-created process remained, but Gate 2.4 caused one unauthorized
deletion of a pre-existing untracked file.*

**Gate 2.4 functional status: REPORTED COMPLETE — VERIFY. Gate 2.4 scope integrity: CONDITIONALLY RECONCILED.**

Evidence: `Docs/Security/Evidence/BatchB1_1_Closeout/Gate2_4A_Integrity/` (16
files: baseline/current status and diff captures, recovery-candidates,
file-origin-analysis, recovery-decision, scope-integrity matrix, verification-
impact, evidence-corrections, changed-files, remaining-risks,
verification-final).

## Phase 3.16 — Gate 2.5: final frame, DevTools, and overlay lifecycle closeout

**Status:** REPORTED COMPLETE — VERIFY

Gate 2.5 independently reviewed Gate 2.4 raw evidence and ran live packaged
child-frame, stale-frame, genuine DevTools-context, Wisp destruction/recreation,
and exact test-build-guard variant tests. The first live overlay run found a
real B1.1 defect: the freeze-stop and freeze-status IPC handlers did not apply
the trusted-sender/window-type guard already used by freeze proposal, consent,
start, and rollback. A trusted Wisp overlay reached those handlers and received
session-level results instead of `unauthorized_window_type`.

The production correction is intentionally narrow: `electron/live-memory-ipc.ts`
now calls the existing `requireTrustedSender(event)` guard in exactly
`live-memory-freeze-stop` and `live-memory-freeze-status`. No allow-list,
validator, consent, process-selection, URL, identity, rollback, or cleanup
control was weakened. A new non-npm-wired packaged harness,
`tests/gate2-5-frame-overlay-closeout.e2e.test.ts`, exercises the real packaged
boundary without adding a production control surface.

Reported final results:

- Gate 2.4 independent review: key renderer-crash, owner-isolation, navigation,
  overlay, and normal-build-hook claims independently reproduced; aggregate
  Gate 2.4 functional label remains `REPORTED COMPLETE — VERIFY`.
- Child frames: same-origin, trusted-looking, untrusted local file,
  cross-origin local HTTP, and nested frames expose no usable own or
  parent-accessible privileged bridge. The generic `not_main_frame` guard
  remains defense in depth.
- Stale frames: removed, navigated, and parent-reload retained references fail;
  prior proposal, consent, selection, rollback, and operation state remains
  revoked by the prior lifecycle suite.
- DevTools: a genuine detached tools context, opened only in an explicit
  test candidate, has no preload bridge, renderer Node access, or trusted
  Solith window identity.
- Wisp recreation: the actual overlay was created, destroyed, and recreated;
  the new webContents identity differed, the old page was unusable, and all
  seven main-only operations rejected both before and after recreation.
- Test hooks: eight inventory rows (seven retained main-process-only global
  functions and one removed freeze-start hook). Absent and nine non-`1`
  values expose zero hooks; exact `1` exposes seven; renderer mutation cannot
  activate the guard.
- Final packaged regression: 49/49 PASS, including packaged smoke 23/23.
- `npm test`: 1,040/1,040 PASS (1,030 main plus 10 SQL).
- `npm run test:live-memory`: 257/257 PASS.
- Main TypeScript: PASS, zero diagnostics.
- Electron TypeScript: unchanged excluded baseline, 31 diagnostics/13 files.
- `git diff --check`: unchanged excluded GameLibrary.tsx lines 286/303 only.
- Electron output verifier: 29/29 PASS; packaged build PASS.

No owner acceptance was inferred. BATCH B1.1 remains CONDITIONAL PASS because
the documented Electron TypeScript and GameLibrary diff-check conditions remain
undisposed. Release remains DENIED. Exact next milestone: owner disposition of
remaining B1.1 conditions; if cleanup is authorized, begin the separate Electron
TypeScript baseline milestone. Do not begin Batch B2/B2A as part of this gate.

Evidence: `Docs/Security/Evidence/BatchB1_1_Closeout/Gate2_5/`.
## Phase 3.11 — Gate 2.1 regression and evidence gate

**Status:** REPORTED COMPLETE — VERIFY

Reported results, all under the recorded Node `v22.23.1` runtime:

| Command | Result |
|---|---|
| `npm test` | **1,040/1,040**, exit 0 |
| `npm run test:live-memory` | **257/257**, exit 0 |
| `tsc --noEmit -p tsconfig.json` (main) | exit 0, 0 diagnostics |
| `tsc --noEmit -p tsconfig.electron.json` | exit 2, 31 diagnostics/13 files — reported byte-identical (zero diff) to the established baseline |
| `git diff --check` | exit 2, `GameLibrary.tsx:286`/`303` only — reported matching established baseline exactly |
| `git status` / `git diff --name-only` / `git diff --stat` | reported reviewed; only the two authorized files (`windows-process-identity.ts`, plus the already-dirty `package.json`/`live-memory-ipc.ts`) show new hunks; index reported empty throughout |

Reported evidence location:
`Docs/Security/Evidence/BatchB1_1_Closeout/Gate2_1/` (31 files, including
`verification-final.txt`, `remaining-risks.md`, `control-provenance.csv`,
`tests-summary.csv`).

## Phase 3.12 — Gate 2.2 packaged lifecycle continuation, Gate 2.2A native write-path remediation, and Gate 2.2A.1 packaged verification

**Status:** Gate 2.2 (remaining lifecycle scenarios) — may now resume. Gate 2.2A — REPORTED COMPLETE — VERIFY (Node-ABI). Gate 2.2A.1 — REPORTED COMPLETE — VERIFY (Electron-ABI + packaged).

### Gate 2.2 (packaged lifecycle continuation)

Authorized 2026-07-29 to build a dedicated safe local memory fixture
(`tests/fixtures/gate2-2-memory-fixture`, a small .NET console app pinning
one int32 sentinel and reporting its own pid/address/value via a local
status file) and certify the two scenarios left PENDING by Gate 2.1
(feature-disable mid-freeze, window-identity/navigation — Phases 3.7, 3.8).
Phase 3 of that work (verifying the fixture against the real
`nativeMemoryDriver`) surfaced that **writes never actually landed** —
`driver.writeMemory` returned normally but the fixture's independently-
observed value never changed. Per the agent's own explicit disclosure
(validated, not corrected, by the owner), Gate 2.2's remaining lifecycle
scenarios were paused rather than built on top of an unproven write path.
As of Gate 2.2A.1 (below), the native write path is fixed and verified
under both Node and Electron ABIs, packaged, and behaviorally confirmed —
Phases 3.7 and 3.8 may now resume using the existing fixture, but have
**not yet been run**.

### Gate 2.2A (native write-path remediation, Node-ABI)

Root cause (two defects in vendored `memoryjs`,
`vendor/memoryjs-3.5.1-patched/`):

1. `process::openProcess` always opened handles with
   `PROCESS_QUERY_INFORMATION | PROCESS_VM_READ` only — no
   `PROCESS_VM_WRITE`/`PROCESS_VM_OPERATION` — so every write was
   structurally impossible regardless of the JS layer.
2. `writeMemory` (`memory.h`) discarded `WriteProcessMemory`'s return value;
   the JS binding (`memoryjs.cc`) never checked or propagated failure.
   Writes silently no-op'd and reported success to JavaScript.

Fix (reported, see `Docs/Security/Evidence/BatchB1_1_Closeout/Gate2_2A_NativeWrite/`):

- `process.h`/`process.cc`: `openProcess(pid, errorMessage, requestWriteAccess=false)`
  — write rights granted only when explicitly requested; default unchanged;
  `PROCESS_ALL_ACCESS` never requested.
- `memoryjs.cc`: `openProcess()` binding accepts an optional boolean 2nd
  argument (backward compatible) to request a write-capable handle.
- `memory.h`: all `writeMemory` overloads now return `bool` (success + full
  byte count written, so a short write counts as failure) plus a Win32
  error code out-param.
- `memoryjs.cc`: `writeMemory()`/`writeBuffer()` bindings check the result
  and throw `write_failed:<code>` on failure — no memory values, addresses,
  consent tokens, or paths in the error.
- `native-memory-driver.ts`: `openProcess(pid)` now requests write access.

Native addon rebuilt for Node 22.23.1 ABI via `node-gyp rebuild` using the
trusted runtime (build succeeded; pre-existing unrelated pointer-truncation
warnings only). Real-process verification against the Gate 2.2 fixture
(18/18 pass, via the real `nativeMemoryDriver` and `LiveMemorySession`, not
`FakeMemoryDriver`): failure modes 4/4, direct write+restore 2/2, freeze
4/4, rollback 4/4, access-rights checks 4/4. Regression gate clean
(`npm test` 1,040/1,040, `test:live-memory` 257/257, TypeScript/`git diff
--check` baselines unchanged). At the end of this cycle, the packaged
Electron-ABI addon had **not** been rebuilt with the fix (R-2.2A-001) —
resolved below by Gate 2.2A.1.

Evidence: `Docs/Security/Evidence/BatchB1_1_Closeout/Gate2_2A_NativeWrite/`
(18 files).

### Gate 2.2A.1 (Electron-ABI rebuild, packaged verification, roadmap reconciliation — this cycle, 2026-07-29)

Authorized as a narrow continuation to close R-2.2A-001. Work performed:

1. Determined the real Electron ABI empirically (launched Electron with
   `ELECTRON_RUN_AS_NODE=1` and read `process.versions`): Electron 42.4.1,
   `modules` (NODE_MODULE_VERSION) 146, arch x64, platform win32.
2. Rebuilt the vendored `memoryjs` addon for that ABI via
   `node-gyp rebuild --target=42.4.1 --arch=x64 --dist-url=https://electronjs.org/headers`
   using the trusted Node 22 runtime and headers from
   `artifacts.electronjs.org`. Build succeeded (no new warnings beyond the
   pre-existing, unrelated pointer-truncation ones).
3. Loaded the rebuilt addon under the **real Electron 42.4.1 runtime**
   (`ELECTRON_RUN_AS_NODE=1`, not a Node substitute) and re-ran the full
   Gate 2.2A 18-check write/failure/freeze/rollback suite against the
   Gate 2.2 fixture: **18/18 pass**.
4. Ran the project's existing packaging pipeline
   (`build:vite` → `build:electron` → `dist:dir`). electron-builder's own
   `@electron/rebuild` step re-prepared the vendored module for the
   packaged output during this run.
5. The packaged copy of `memoryjs.node` did not byte-match the standalone
   Electron-ABI rebuild (expected: separate compiler invocations embed
   different PE timestamps for identical source — not a defect, see
   `failure-classification.csv`). Resolved by **directly loading the exact
   packaged file** under Electron and behaviorally exercising both original
   defects against the real fixture: a read-only handle's write now throws
   `write_failed:5` (`ERROR_ACCESS_DENIED`) instead of silently no-op'ing,
   and a write-capable handle's write actually lands and is independently
   observed via the fixture. Confirmed present, not the old stale
   235,008-byte pre-fix binary.
6. Packaged smoke suite: **23/23 pass**, unchanged from established baseline.
7. New `tests/gate2-2a1-packaged-real-process-write-proof.e2e.test.ts` (not
   wired into any npm script) ran a full real end-to-end attach → read →
   propose/issue-consent/confirm write → fixture-observed change →
   read-back → restore → invalid-address failure sequence against the
   packaged `dist/win-unpacked/Solith.exe`, using the project's
   pre-existing `SOLITH_PRIVILEGED_CONSENT=auto-approve` test seam (no new
   hook). **1/1 pass.**
8. Inventoried every `memoryjs.node` copy on disk: the vendor build output
   and the packaged copy hash-identically to each other; no stale pre-fix
   binary remains in the active packaged candidate. The vendor build
   output was then explicitly rebuilt back to the Node-22 ABI so the
   Node-based regression gate could run.
9. Full regression gate (Node 22.23.1): `npm test` 1,040/1,040,
   `test:live-memory` 257/257, main TypeScript 0 diagnostics, Electron
   TypeScript 31/13 (unchanged baseline), `git diff --check`
   `GameLibrary.tsx` only (unchanged baseline).

Evidence: `Docs/Security/Evidence/BatchB1_1_Closeout/Gate2_2A_1_PackagedNative/`
(baseline captures, ABI info, rebuild logs/hashes, Electron-runtime and
packaged verification matrices, packaged smoke/build output, native-binary
inventory, regression outputs, control-provenance, remaining-risks,
verification-final).

**Provenance note (Gate 2.2A.2, 2026-07-29):** the Gate 2.2A.1 report's binary-hash
comparisons referenced two different vendor-tree snapshots (before vs. after
electron-builder's own internal rebuild step overwrote the same file path)
under the same generic label, which read as an apparent contradiction.
Fully reconciled — see
`Docs/Security/Evidence/BatchB1_1_Closeout/Gate2_2A_2_Provenance/` for the
complete binary timeline and hash-comparison tables. Verdict: PROVENANCE
RECONCILED — FUNCTIONALLY EQUIVALENT, NOT BYTE IDENTICAL. No PASS verdict
changes as a result — the shipped packaged binary was independently
behaviorally verified to contain the fix.

**R-2.2A-001: RESOLVED.** The packaged application now contains the
Gate 2.2A native write-path fix, behaviorally verified, packaged-smoke
verified, and end-to-end real-process-write verified.

**Corrected Gate 2.2A verdicts (per explicit owner correction, 2026-07-29):**

```text
Gate 2.2A implementation and Node-ABI verification: PASS
Gate 2.2A packaged verification (Gate 2.2A.1): PASS
Overall Gate 2.2A verdict: GATE 2.2A NATIVE WRITE REMEDIATION PASS
Batch B1.1: CONDITIONAL PASS
Gate 2.2 remaining lifecycle scenarios (Phases 3.7, 3.8): may resume (not yet run)
```

## Phase 3 Exit Criteria

- All orphaned tests are integrated. — **Reported met.**
- Raw-byte rollback is covered by supported commands. — **Reported met.**
- All six packaged lifecycle scenarios pass. — **NOT met.** 4 of 6
  reported complete (crash, PID-reuse/simulated, cleanup-failure, and
  shutdown in narrowed form); feature-disable and window-identity/
  navigation (Phases 3.7, 3.8) may now resume (native-write blocker
  resolved as of Gate 2.2A.1) but have not yet been run.
- Normal production package contains no test-only hook. — **NOT strictly
  met.** Hooks are compiled in but env-gated/fail-closed; not a literally
  separate build variant. Reported and disclosed, not hidden.
- B1.1 can be promoted from CONDITIONAL PASS to PASS. — **NOT yet.** Phase
  3 exit criteria are not fully satisfied; verdict remains CONDITIONAL
  PASS (see Final Current Verdict).
- **Gate 2.2A/2.2A.1 addendum (2026-07-29):** a real native write-path
  defect was found and fixed (Phase 3.12) — every real write via
  `nativeMemoryDriver` had been silently failing since before Gate 2 (all
  prior write/freeze/rollback verification ran only against
  `FakeMemoryDriver` or non-writing packaged scenarios). Fixed and
  re-verified for BOTH the Node-ABI test runtime (Gate 2.2A) AND the
  Electron-ABI packaged application (Gate 2.2A.1) this cycle.

---

# Phase 4 — Electron TypeScript Baseline Cleanup

[Completion note, later session, Claude Sonnet: Phases 4.1-4.3 below are the
original pre-cleanup planning record and describe the historical 31/13
baseline; their `Status: PENDING` markers are preserved as written and were
NOT edited in place. The work they describe has since been completed and
independently reviewed twice: Electron TypeScript now independently
reproduces 0 diagnostics, with no new ignores, exclusions, or weakened
compiler settings beyond one documented, justified exclusion of an orphaned
dead file (`electron/run-compat-test.ts`). See `owner-decision-package.md`
OD-2.5-001 for the full provenance chain and current status. This note does
not authorize B1.1 promotion, release, or any claim about `master`.]

## Phase 4.1 — Freeze and classify the 31-diagnostic baseline

**Status:** PENDING

Required work:

- Capture exact 31 diagnostics and 13 files.
- Classify each as:
  - genuine defect
  - typing drift
  - obsolete code
  - environment mismatch
  - generated type issue
  - unrelated current-tree edit
- Confirm no B1.1 diagnostic is hidden inside the baseline.

## Phase 4.2 — Atomic remediation batches

**Status:** PENDING

Repair in small, independently verified groups:

- Electron main-process typing.
- Preload typing.
- Registry typing.
- Wisp/overlay typing.
- Application utility typing.
- Remaining isolated files.

Each batch requires:

- Exact before/after diagnostic counts.
- No behavior changes unless required.
- Relevant tests.
- `git diff --check` clean for touched files.

## Phase 4.3 — Full Electron typecheck clean gate

**Status:** PENDING

Exit criteria:

- Electron TypeScript exits 0.
- Main TypeScript exits 0.
- No new ignores, exclusions, or weakened compiler settings.

---

# Phase 5 — Dirty-Tree and Release-Gate Hygiene

## Phase 5.1 — `GameLibrary.tsx` whitespace cleanup

**Status:** PENDING

Known locations:

- `GameLibrary.tsx` line 286.
- `GameLibrary.tsx` line 303.

Required work:

- Fix only the whitespace defect.
- Confirm no semantic change.
- Run `git diff --check`.

## Phase 5.2 — Security change provenance

**Status:** PENDING

Classify every changed and untracked path as:

- security implementation
- security test
- evidence
- unrelated pre-existing work
- generated artifact
- prohibited change
- uncertain

Do not revert or delete unrelated work automatically.

## Phase 5.3 — Candidate source-state stabilization

**Status:** PENDING

Before every final gate:

- Pause other agents and editors.
- Capture full tracked/untracked/staged/unstaged hashes.
- Observe a quiet window.
- Run tests.
- Capture after-command and final quiet-window hashes.

---

# Phase 6 — Batch B2 Privileged IPC Hardening

## Phase 6.1 — Handler-by-handler authorization model

**Status:** PENDING

For every privileged handler verify:

- Trusted sender.
- Allowed window type.
- Top-frame enforcement.
- Canonical URL validation.
- Schema validation.
- Feature flag.
- Operation-specific authorization.
- Timeout/cancellation.
- Sanitized audit event.
- Sanitized error response.

## Phase 6.2 — File and path authorization

**Status:** PENDING

Verify all file operations for:

- Canonicalization.
- Approved roots.
- Traversal rejection.
- Symlink/junction escape rejection.
- UNC/device path restrictions.
- Read/write/delete/rename/execute separation.
- Explicit consent for destructive actions.

Priority surfaces:

- Save editor.
- Backups.
- CT library.
- Trainer catalog.
- Install discovery.
- Recipes.
- External trainer research.
- Registry import/export.
- File launch/reveal operations.

## Phase 6.3 — Process and command execution

**Status:** PENDING

For every execution site:

- Remove shell interpolation.
- Use argument arrays.
- Enforce executable allowlists.
- Reject renderer-supplied arbitrary commands.
- Enforce timeouts and output limits.
- Bind execution to user-authorized operations.
- Prevent environment-secret leakage.
- Prevent user-writable helper replacement.

## Phase 6.4 — Registry operations

**Status:** PENDING

Verify:

- Read and mutation paths are separated.
- Hive/path allowlists.
- Value-type validation.
- No command delegation.
- Operation-bound consent for writes.
- Rollback/export before mutation where appropriate.
- 32-bit/64-bit registry-view correctness.

## Phase 6 Exit Criteria

- Every privileged handler has implementation, authorization, negative tests, lifecycle tests, and evidence.
- No renderer-controlled data can independently grant authority.

---

# Phase 7 — Preload, Renderer, and BrowserWindow Boundaries

## Phase 7.1 — Preload API minimization

**Status:** PENDING

- Remove dead methods.
- Reject arbitrary channel names.
- Freeze exposed API surfaces where appropriate.
- Ensure safe listener cleanup.
- Prevent event spoofing.

## Phase 7.2 — BrowserWindow hardening

**Status:** PENDING

Verify every window uses appropriate settings:

- `contextIsolation: true`
- `nodeIntegration: false`
- sandbox where compatible
- no remote module
- restricted navigation
- restricted new-window creation
- trusted preload
- packaged DevTools policy
- CSP
- no privileged remote content

## Phase 7.3 — External URL handling

**Status:** PENDING

- Allow only approved protocols.
- Reject `file:`, `javascript:`, `data:`, and unsafe custom schemes.
- Validate hostnames.
- Require explicit user action.
- Never place secrets in URLs.

---

# Phase 8 — Secrets, Logs, Privacy, and Offline Guarantees

## Phase 8.1 — Repository credential scan

**Status:** PENDING

Scan:

- tracked files
- staged changes
- unstaged changes
- untracked files
- logs
- fixtures
- evidence
- configs
- generated outputs

Search for:

- API keys
- tokens
- passwords
- private keys
- connection strings
- consent tokens
- raw memory values
- sensitive paths

## Phase 8.2 — Audit and application log review

**Status:** PENDING

Verify:

- Redaction before serialization.
- Size and retention limits.
- No raw memory values.
- No consent tokens.
- No save contents.
- No registry secrets.
- Safe behavior when audit storage fails.

## Phase 8.3 — Offline/local-first privacy certification

**Status:** PENDING

Confirm:

- No hidden telemetry.
- No unapproved analytics.
- No background upload.
- No cloud fallback.
- No external model calls without explicit configuration and consent.
- No automatic submission of saves, logs, trainer data, or registry data.

---

# Phase 9 — Dependency and Supply-Chain Security

## Phase 9.1 — Dependency inventory

**Status:** PENDING

Record:

- Direct dependencies.
- Development dependencies.
- Native modules.
- Bundled binaries.
- Licenses.
- Package origins.
- Lockfile integrity.

## Phase 9.2 — Vulnerability disposition

**Status:** PENDING

Classify each finding:

- Production-exploitable.
- Development-only.
- Unreachable.
- False positive.
- Requires upgrade.
- Requires replacement.
- Proposed for acceptance.

No broad dependency upgrades during feature freeze without explicit authorization.

## Phase 9.3 — Build and package integrity

**Status:** PENDING

Verify:

- Deterministic installation.
- No unexpected postinstall behavior.
- No runtime downloads.
- No writable search-path hijacking.
- No loading code from user-controlled locations.
- Packaged resource integrity.

---

# Phase 10 — Native Helper and Executable Security

## Phase 10.1 — Helper inventory

**Status:** PENDING

For each helper or bundled executable record:

- Expected path.
- Version.
- Hash/signature.
- Owner.
- Purpose.
- Invocation arguments.
- Output parser.

## Phase 10.2 — Execution hardening

**Status:** PENDING

Verify:

- Exact path invocation.
- No current-directory search.
- No user-writable replacement.
- Strict argument construction.
- Timeout and termination.
- Output-size limits.
- Safe crash cleanup.
- No elevation unless explicitly approved.

## Phase 10.3 — Obsolete helper removal

**Status:** PENDING

Remove dormant or obsolete helpers rather than leaving latent execution paths.

---

# Phase 11 — Save, Backup, Registry, and Data-Integrity Safety

## Phase 11.1 — Save editing

**Status:** PENDING

Verify:

- Original backup before mutation.
- Atomic write strategy.
- Format validation.
- Size limits.
- Concurrency handling.
- Corruption detection.
- Rollback and recovery.
- No write outside selected save.

## Phase 11.2 — Backup and restore

**Status:** PENDING

Verify:

- Path containment.
- Archive traversal protection.
- Duplicate handling.
- Restore preview.
- Overwrite consent.
- Integrity hashes.
- Partial-failure rollback.
- No unsafe executable restoration.

## Phase 11.3 — Registry mutation safety

**Status:** PENDING

Verify:

- Exact-value rollback.
- Type preservation.
- Export before mutation where appropriate.
- No broad subtree deletion.
- Idempotent recovery.

---

# Phase 12 — Security Negative and Abuse Testing

## Phase 12.1 — IPC abuse suite

**Status:** PENDING

Test:

- malformed payloads
- oversized payloads
- wrong sender
- wrong window
- child frame
- stale `webContents`
- navigation race
- expired consent
- replayed consent
- wrong operation ID
- wrong process
- PID reuse

## Phase 12.2 — Path and input abuse suite

**Status:** PENDING

Test:

- traversal
- symlink/junction escape
- UNC/device paths
- null bytes
- Unicode normalization
- long paths
- malformed registry paths
- command-injection strings

## Phase 12.3 — Lifecycle and failure suite

**Status:** PENDING

Test:

- repeated cleanup
- shutdown during write
- audit failure
- partial rollback
- feature disable during operation
- renderer crash during authorization
- restart with stale state

Minimum per privileged control:

- positive test
- unauthorized test
- malformed-input test
- lifecycle test
- failure-containment test

---

# Phase 13 — Full Packaged Windows Security Certification

## Phase 13.1 — Supported environment matrix

**Status:** PENDING

Test on supported Windows configurations:

- Clean launch.
- Upgrade install.
- Restricted user.
- Paths with spaces.
- Non-ASCII username/path.
- Offline mode.
- Blocked network.
- Missing helper.
- Modified helper.
- Corrupted config.
- Corrupted save.

## Phase 13.2 — Packaged lifecycle matrix

**Status:** PENDING

Re-run all security-critical lifecycle scenarios in the actual packaged application.

## Phase 13.3 — Installer and uninstaller behavior

**Status:** PENDING

Verify:

- Safe install locations.
- No privilege escalation surprises.
- No orphaned sensitive data.
- No removal of unrelated user data.
- Correct cleanup and rollback.

---

# Phase 14 — Evidence Reconciliation and Release-Control Gate

## Phase 14.1 — Documentation-to-source reconciliation

**Status:** PENDING

Confirm current counts for:

- IPC handlers.
- Preload methods.
- Renderer call sites.
- Execution sites.
- Consent-gated handlers.
- Security test files.

## Phase 14.2 — Evidence integrity review

**Status:** PENDING

Confirm:

- Every PASS has raw output.
- No selected subset is represented as a full test suite.
- No prior evidence was overwritten.
- Evidence matches the current source hashes.
- No contradictory verdicts remain.

## Phase 14.3 — Final verification gate

**Status:** PENDING

Minimum commands:

```powershell
& $Node22 $NpmCli test
& $Node22 $NpmCli run test:live-memory
& $Node22 ".\node_modules\typescript\bin\tsc" --noEmit
& $Node22 ".\node_modules\typescript\bin\tsc" -p ".\tsconfig.electron.json" --noEmit
git diff --check
```

Also run every dedicated security suite and packaged lifecycle suite created in Phases 3 through 13.

## Phase 14.4 — Final dirty-tree classification

**Status:** PENDING

Classify every remaining path and produce a release candidate manifest.

---

# Phase 15 — Final Security Verdict

## Phase 15.1 — SECURITY PASS criteria

Use **SECURITY PASS** only when all are true:

- B1.1 is PASS.
- All privileged IPC handlers are authorized and tested.
- File/path boundaries are enforced.
- Process execution is constrained.
- Preload and BrowserWindow boundaries are hardened.
- No unresolved critical or high defect remains.
- Secrets and logs are clean.
- Dependency risks are dispositioned.
- Save, backup, and registry mutations are recoverable.
- Packaged Windows certification passes.
- Full supported-environment test gate passes.
- Evidence is complete and internally consistent.

## Phase 15.2 — SECURITY CONDITIONAL PASS criteria

Use only when:

- No exploitable critical or high defect remains.
- Remaining risks are limited and documented.
- Each remaining risk is explicitly accepted by the owner.
- Mitigation, owner, and follow-up milestone are recorded.

## Phase 15.3 — SECURITY FAIL criteria

Use when any of these remains:

- Privileged IPC authorization bypass.
- Arbitrary process or command execution.
- Path-containment bypass.
- Unauthorized registry mutation.
- Replayable consent.
- Renderer crash leaves privileged writes active.
- PID reuse bypasses identity validation.
- Unsafe helper execution.
- Secret exposure.
- Destructive mutation without reliable backup or rollback.
- Packaged application differs materially from tested controls.
- Critical evidence gap.

---

# Immediate Execution Order

## Now

1. **Phase 3.7:** Real-packaged feature-disable mid-freeze certification (may now resume — native-write blocker resolved).
2. **Phase 3.8:** Real-packaged window-identity/navigation certification (may now resume — same blocker resolved).
3. **Phase 3.11 (re-run):** Full Gate 2.2 regression and evidence gate once Phases 3.7/3.8 complete.

## After B1.1 becomes PASS

4. **Phase 4:** Electron TypeScript baseline cleanup.
5. **Phase 5:** Whitespace and dirty-tree release hygiene.
6. **Phase 6:** Batch B2 privileged IPC hardening.
7. **Phase 7:** Preload, renderer, and BrowserWindow security.
8. **Phase 8:** Secrets, logs, and local-first privacy.
9. **Phase 9:** Dependency and supply-chain security.
10. **Phase 10:** Native helper security.
11. **Phase 11:** Save, backup, registry, and data integrity.
12. **Phase 12:** Negative and abuse testing.
13. **Phase 13:** Full packaged Windows security certification.
14. **Phase 14:** Evidence reconciliation and release gate.
15. **Phase 15:** Final security verdict.

---

# Current High-Level Status Table

| Area | Status | Release Blocking? |
|---|---|---:|
| Security surface discovery | REPORTED COMPLETE — VERIFY | Yes |
| B1 targeted hardening | REPORTED COMPLETE — VERIFY | Yes |
| B1.1 lifecycle/identity controls | REPORTED COMPLETE — VERIFY | Yes |
| Node 22 stable verification | VERIFIED COMPLETE | No |
| Raw-byte rollback implementation | REPORTED COMPLETE — VERIFY | Yes |
| Raw-byte tests in supported commands | REPORTED COMPLETE — VERIFY (Gate 2.1) | Yes |
| Orphaned test-wiring gap (8→9 files) | REPORTED COMPLETE — VERIFY (Gate 2.1) | Yes |
| Packaged build and smoke | REPORTED COMPLETE — VERIFY (Gate 2.5 build PASS; smoke 23/23; full packaged regression 49/49) | Yes |
| Packaged lifecycle, frame, DevTools, and overlay closeout | REPORTED COMPLETE — VERIFY (Gate 2.5 final packaged regression 49/49) | Yes |
| Test-only hook hygiene | REPORTED COMPLETE — VERIFY (8 inventory rows; 7 retained main-process-only functions; removed freeze-start hook; exact guard variants live-tested) | Yes |
| Native memory write-path (real WriteProcessMemory) | REPORTED COMPLETE — VERIFY (Gate 2.2A Node-ABI + Gate 2.2A.1 Electron-ABI/packaged, both PASS) | Yes |
| Renderer freeze authorization flow | REPORTED COMPLETE — VERIFY (R-2.2-RESUME-001 resolved in Gate 2.3; Gate 2.5 full packaged rerun PASS) | Yes |
| Electron TypeScript baseline | PENDING (unchanged, re-confirmed identical) | Yes |
| `git diff --check` baseline | PENDING (unchanged, re-confirmed identical) | Yes |
| Privileged IPC hardening beyond B1.1 | PENDING | Yes |
| BrowserWindow/preload hardening | PENDING | Yes |
| Secrets/logs/privacy certification | PENDING | Yes |
| Dependency/supply-chain review | PENDING | Yes |
| Data mutation safety | PENDING | Yes |
| Full packaged Windows certification | PENDING | Yes |
| Evidence reconciliation | PENDING | Yes |
| Final security verdict | PENDING | Yes |

---

# Required Root-Level Maintenance Rule

This roadmap should be updated after every security milestone. Each update must:

1. Change only the affected phase status.
2. Add exact evidence paths.
3. Add exact test totals and command names.
4. Record any owner decision.
5. Preserve prior history rather than silently rewriting it.
6. Never promote a phase to complete based solely on an agent summary.
7. Require implementation and evidence verification against the current repository.

## Mandatory: update this roadmap at the end of every SOLITH session

**Every session that touches SOLITH — implementation, verification, gate
work, or evidence review — must update this file
(`G:\ACTIVE_PROJECTS\SOLITH\SOLITH_SECURITY_ROADMAP.md`, the canonical
in-repository copy) before the session ends.** At minimum, each
end-of-session update must:

1. Append a dated entry to the **Session Update Log** below (never delete
   or rewrite a prior entry).
2. Update the status of every phase item the session actually touched,
   using the status vocabulary defined in Section 1 — never mark
   something `VERIFIED COMPLETE` on the strength of the same session's own
   report.
3. Update the **Current High-Level Status Table** and **Final Current
   Verdict** if either changed.
4. Record exact evidence paths and exact test totals for anything
   reported in that session.
5. Record any new owner decision, or explicitly note that none was made.

---

# Session Update Log

| Date | Session / Gate | What changed | Verdict after session |
|---|---|---|---|
| 2026-07-28 | Gate 2.1 — Test-Gate Integration and Packaged Lifecycle Certification | Wired 8 orphaned tests (+ 1 new) into `test`/`test:live-memory` (Phase 2.11, 3.2, 3.3 resolved); added 3 narrow `SOLITH_TEST_BUILD=1`-gated test-only hooks (Phase 3.4); certified 4 of 6 packaged lifecycle scenarios for real against `dist/win-unpacked/Solith.exe` (renderer crash, simulated PID-reuse, cleanup-failure containment — Phases 3.5, 3.9, 3.10) plus shutdown in narrowed form (Phase 3.6); feature-disable and window-identity/navigation real-packaged certification remain PENDING (Phases 3.7, 3.8); full regression re-run clean (`npm test` 1,040/1,040, `test:live-memory` 257/257, TypeScript/`git diff --check` baselines unchanged, 0 diff vs. Gate 2). Evidence: `Docs/Security/Evidence/BatchB1_1_Closeout/Gate2_1/` (31 files). | BATCH B1.1 CONDITIONAL PASS (unchanged verdict class; narrowed further, not reversed) |
| 2026-07-29 | Gate 2.2 (paused) + Gate 2.2A — Native Memory Write-Path Remediation (Node-ABI) | Built `tests/fixtures/gate2-2-memory-fixture` (.NET, pinned int32 sentinel + status file) for Gate 2.2; Phase 3 verification surfaced that real writes via `nativeMemoryDriver` were silently no-op'ing — root cause: vendored `memoryjs` opened handles without `PROCESS_VM_WRITE`/`PROCESS_VM_OPERATION`, and discarded `WriteProcessMemory`'s result entirely. Gate 2.2 paused; user explicitly authorized Gate 2.2A to fix it. Fixed `vendor/memoryjs-3.5.1-patched/lib/{process.h,process.cc,memory.h,memoryjs.cc}` (minimum-rights write-capable handle opt-in; every write now checked for success+full-byte-count and thrown as `write_failed:<code>` on failure) and `src/core/live-memory/native-memory-driver.ts` (requests write access at attach). Rebuilt the native addon for Node 22.23.1 ABI; Electron-ABI/packaged rebuild NOT done this cycle. Re-verified 18/18 real-process checks against the fixture. Full regression clean. Evidence: `Docs/Security/Evidence/BatchB1_1_Closeout/Gate2_2A_NativeWrite/` (18 files) and `Gate2_2/` (fixture + Phase 1-3 evidence). This session also updated a non-canonical `G:\Downloads\SOLITH_SECURITY_ROADMAP.md` copy instead of this in-repository file — corrected in the next session below. | BATCH B1.1 CONDITIONAL PASS (narrowed by R-2.2A-001: packaged addon not yet rebuilt with the fix; not reversed) |
| 2026-07-29 | Gate 2.2A.1 — Electron-ABI Rebuild, Packaged Verification, and Canonical Roadmap Reconciliation | Determined the real Electron ABI empirically (Electron 42.4.1, modules/ABI 146, x64). Rebuilt the vendored `memoryjs` addon for that ABI via node-gyp using Electron's real headers; validated it under the real Electron runtime against the fixture (18/18 pass). Ran the full packaging pipeline (`build:vite`/`build:electron`/`dist:dir`); confirmed the packaged binary contains the fix via direct behavioral verification (not just hash comparison, since two compiler invocations of identical source differ in embedded PE timestamps). Packaged smoke: 23/23 pass (unchanged baseline). New end-to-end packaged real-process write proof (`tests/gate2-2a1-packaged-real-process-write-proof.e2e.test.ts`, not npm-wired) against `dist/win-unpacked/Solith.exe` using the project's pre-existing `SOLITH_PRIVILEGED_CONSENT=auto-approve` seam: 1/1 pass (attach, read, propose/consent/confirm write, fixture-observed change, read-back, restore, invalid-address failure). Inventoried all `memoryjs.node` copies — no stale pre-fix binary remains in the packaged candidate; restored the vendor build output to Node-22 ABI afterward. Full regression clean (`npm test` 1,040/1,040, `test:live-memory` 257/257, TypeScript/`git diff --check` baselines unchanged). **This session also created/reconciled this canonical root-level roadmap file** (the prior cycle had updated only a `G:\Downloads` copy). Evidence: `Docs/Security/Evidence/BatchB1_1_Closeout/Gate2_2A_1_PackagedNative/` (24 files). R-2.2A-001 resolved. Gate 2.2's remaining lifecycle scenarios (Phases 3.7, 3.8) may now resume. | BATCH B1.1 CONDITIONAL PASS (GATE 2.2A NATIVE WRITE REMEDIATION now fully PASS — packaged verification gap closed; B1.1's own remaining conditions, unrelated baselines, and Gate 2.2's unrun lifecycle scenarios all remain open, not reversed) |
| 2026-07-29 | Gate 2.2A.2 — Native Binary Provenance Reconciliation | Reconciled an apparent contradiction in Gate 2.2A.1's evidence (packaged binary reported as both hash-matching and hash-mismatching "the Electron-ABI rebuild"). Reconstructed the full binary timeline (7 states): the standalone manual rebuild was superseded in place by electron-builder's own internal `@electron/rebuild` step before packaging copied anything out — both original statements were correct, just referring to two different snapshots of the same shared build-output path at two different times. No native source changed; no rebuild performed. Corrected 3 evidence files with additive clarification notices (no historical data rewritten) and added a provenance note to this roadmap. Evidence: `Docs/Security/Evidence/BatchB1_1_Closeout/Gate2_2A_2_Provenance/` (7 files). | PROVENANCE RECONCILED — FUNCTIONALLY EQUIVALENT, NOT BYTE IDENTICAL; BATCH B1.1 CONDITIONAL PASS (unchanged) |
| 2026-07-29 | Gate 2.2 Resume — Complete Remaining Packaged Lifecycle Certification | Discovered a real, pre-existing, unrelated defect: the renderer's `liveMemoryFreezeStart` preload call sends the wrong payload shape for the current IPC schema, and no freeze propose/issue-consent preload methods exist at all — the shipped UI cannot start a freeze through its own API (R-2.2-RESUME-001, owner decision required on remediation timing). Added one narrow test-only hook (`__testStartFreezeForOwner`, `electron/live-memory-ipc.ts`, `SOLITH_TEST_BUILD=1`-gated) calling the same production functions the real flow would call, to unblock real-freeze certification. Rebuilt the packaged test candidate. Certified all 6 required active-session shutdown sub-scenarios (unified normal-close/app-quit per disclosed single-window-Windows-app architecture), mid-freeze feature-disable (real freeze + real `setSetting` IPC + exact `feature_disabled` stop reason), main-window reload identity, and unauthorized-navigation revocation — all against the real packaged app and the real Gate 2.2 fixture. Window recreation-without-quit, overlay boundaries, some navigation sub-cases, and child-frame/DevTools boundaries left PENDING with disclosed architecture/scope reasons. Regression of all prior packaged controls (Gate 2.1's 5 scenarios, Gate 2.2A.1's write proof, packaged smoke 23/23) and the full Node-based gate (`npm test` 1,040/1,040, `test:live-memory` 257/257, TypeScript/`git diff --check` baselines unchanged) all passed clean. Evidence: `Docs/Security/Evidence/BatchB1_1_Closeout/Gate2_2_Resume/` (18 files). | BATCH B1.1 CONDITIONAL PASS (Gate 2.2's core lifecycle scope substantially closed; new R-2.2-RESUME-001 owner decision pending; unrelated baselines and a few disclosed PENDING sub-scenarios remain) |
| 2026-07-29 | Gate 2.3 — Restore the Real Packaged Freeze Authorization Flow | Resolved R-2.2-RESUME-001. Root cause: the main-process propose/issue-consent/confirm IPC handlers were already correct; only `electron/preload.ts` (legacy `liveMemoryFreezeStart` payload shape, no propose/request-consent methods) and 3 renderer call sites (`LiveMemoryTrainerPage.tsx` x2, `useGameCheatSession.ts` x1) were broken/missing. Fixed preload (added `liveMemoryFreezePropose`/`liveMemoryFreezeRequestConsent`, corrected `liveMemoryFreezeStart` to `{proposalId,consentToken}`, removed the legacy signature outright) and rewired all 3 renderer call sites to the real propose→consent→start sequence behind the existing single-click UX. Removed the Gate 2.2 Resume `__testStartFreezeForOwner` test-only hook from source entirely (no longer needed). Rebuilt the packaged candidate; certified the full real production flow end-to-end against the real Gate 2.2 fixture with NO test hook (propose→real consent→confirmed start→2+ ticks→external-mutation restore→stop→no further writes→proposal/token replay rejected→fabricated credential rejected→legacy payload rejected). Re-ran `tests/gate2-2-resume-packaged-lifecycle.e2e.test.ts` in full (10/10 pass) with its freeze helper rewired to the real flow — shutdown/quit, feature-disable, and forced termination now all exercise the real flow, the latter two launched WITHOUT `SOLITH_TEST_BUILD`. New `tests/gate2-3-freeze-authorization-security.e2e.test.ts` (3/3 pass) proves legacy-payload/replay/fabricated-credential rejection. Full regression clean (`npm test` 1,040/1,040, `test:live-memory` 257/257, TypeScript/`git diff --check` baselines unchanged), re-confirmed a second time after restoring the Node-22 ABI native addon post-packaging. Evidence: `Docs/Security/Evidence/BatchB1_1_Closeout/Gate2_3/` (24 files). | BATCH B1.1 CONDITIONAL PASS (R-2.2-RESUME-001 RESOLVED; unrelated baselines and the previously-disclosed PENDING sub-scenarios — overlay, window recreation, navigation edge cases, child-frame/DevTools — remain, plus two newly-disclosed narrower residuals R-2.3-001/002) |
| 2026-07-29 | Gate 2.4 — Final Ownership, Window, Frame, and Navigation Certification | Certification-only milestone; no production code modified (one new test file: `tests/gate2-4-final-certification.e2e.test.ts`). Built a fresh packaged candidate independent of Gate 2.3's own evidence; independently re-ran the full real freeze flow plus Gate 2.3's own 3-test suite (both pass). Resolved R-2.3-001: renderer crash mid real-flow freeze stops writes and revokes proposal/token. Resolved R-2.3-002 (narrowed): a real second trusted window (Wisp overlay) cannot use the main window's proposal/consent/freeze; a true two-main-window test is architecturally not constructible (only one `'main'`-type window exists) and this was disclosed rather than fabricated. Classified main-window recreation as architecturally NOT APPLICABLE on Windows (`window-all-closed` always calls `app.quit()`). Compiled canonical-URL and frame-boundary evidence from the existing, extensive `tests/trusted-sender-registry.test.ts` unit suite; added new packaged navigation sub-case tests (9.2 encoded-path, 9.4 sibling-directory, 9.5 unapproved local HTTP), extending 9.1/9.6. Re-confirmed all 5 test-only hooks remain gated/absent in normal builds. Full regression clean: packaged smoke 23/23, Gate 2.3 rerun 3/3, Gate 2.4 suite 5/5, Gate 2.2 Resume lifecycle rerun 10/10, native write proof rerun 1/1, `npm test` 1,040/1,040, `test:live-memory` 257/257, TypeScript/`git diff --check` baselines unchanged. Disclosed rather than fabricated: DevTools-frame and non-DevTools child-frame live tests (harness limitations, unchanged from prior gates), overlay destroy/recreate cycle not independently re-instantiated, `SOLITH_TEST_BUILD` non-`'1'` value variants not independently relaunched (guard is a structural strict-equality check regardless). **Session-handling error disclosed:** a pre-existing untracked file (`test_output.txt`) was deleted in error via a blanket cleanup command without being read first; not recoverable via git; unrelated to Gate 2.4's security scope. Evidence: `Docs/Security/Evidence/BatchB1_1_Closeout/Gate2_4/` (34 files). | BATCH B1.1 CONDITIONAL PASS (unchanged — no exploitable defect found; R-2.3-001/002 RESOLVED; remaining conditions are the same pre-existing, disclosed, non-regression items: unrelated baselines, DevTools/child-frame harness limitations) |
| 2026-07-29 | Gate 2.4A — Deleted-File Recovery and Scope-Integrity Reconciliation | Read-only follow-up to Gate 2.4's disclosed deletion of pre-existing untracked `test_output.txt`. Exhaustively searched for recovery: recursive filesystem search (`G:\ACTIVE_PROJECTS`, `G:\Downloads`, `%TEMP%`, `%LOCALAPPDATA%\Temp`), PowerShell PSReadLine history, Git Bash history, VS Code local-history metadata (70 entries), and the Windows Recycle Bin — zero matches in every location; no script/test/config file anywhere in the repository ever referenced the filename. Classified **NOT RECOVERABLE**; no guessed-content replacement created. Diffed Gate 2.4's own baseline status snapshot against current status and confirmed `test_output.txt` is the *only* path removed since Gate 2.4 began — no other unauthorized deletion or modification exists. Because the file had zero script references, its loss is proven to have had no effect on Gate 2.4's test results, test totals, packaged-build identity, or security conclusions. Corrected 3 Gate 2.4 evidence files with additive notices (no raw evidence rewritten) and formalized Gate 2.4's scope-integrity verdict as FAIL while its functional verdict remains VERIFIED. No production code, test code, `package.json`, or CI/release-workflow file touched; no git-mutating command run. Evidence: `Docs/Security/Evidence/BatchB1_1_Closeout/Gate2_4A_Integrity/` (16 files). | GATE 2.4A CONDITIONAL RECONCILIATION; BATCH B1.1 CONDITIONAL PASS (unchanged — no functional or security regression found or introduced) |

| 2026-07-29 | Gate 2.5 — Final Frame, DevTools, and Overlay Lifecycle Closeout | Owner waived the Claude-model requirement and authorized Codex to execute. Independently reviewed Gate 2.4 raw evidence; added a narrow packaged harness for same-origin/trusted-looking/untrusted-file/local-HTTP/nested children, removed/navigated/reloaded stale frames, genuine detached DevTools, actual Wisp destroy/recreate, and exact `SOLITH_TEST_BUILD` variants. Initial live overlay run found that freeze-stop/status lacked the existing main-window sender guard; added `requireTrustedSender(event)` to exactly those two handlers. Final coherent packaged regression 49/49 PASS (smoke 23/23), `npm test` 1,040/1,040 PASS, `test:live-memory` 257/257 PASS, main TypeScript PASS, Electron TypeScript unchanged 31 diagnostics/13 files, diff-check unchanged GameLibrary lines 286/303. Evidence: `Docs/Security/Evidence/BatchB1_1_Closeout/Gate2_5/`. No commit/push or owner risk acceptance. | GATE 2.5 REPORTED COMPLETE — VERIFY; BATCH B1.1 CONDITIONAL PASS; RELEASE DENIED |
| 2026-07-29 | Gate 2.5 — Independent Reconfirmation (separate session, Claude Sonnet) | Discovered this branch (`review/gate2-5-doc-audit`) already contained a full prior Gate 2.5 attempt by a different agent (Codex, committed 317baf0) before this session began, including a real security fix (missing `requireTrustedSender` guard on `live-memory-freeze-stop`/`live-memory-freeze-status`, already applied). Rather than accepting that report on faith, independently rebuilt a fresh packaged candidate (exeSHA256=3d23858497ff75f56edacc726a29752feb0e27c0f4f7a80b227354f040565e68) and reran the full Gate 2.5 scope with a new test file (`tests/gate2-5-frame-devtools-overlay-lifecycle.e2e.test.ts`): child-frame rejection (data:/untrusted-local-file/about:blank, no preload bridge in any child frame), stale/destroyed-frame rejection, DevTools boundary (real detached DevTools webContents probed via `executeJavaScript`, confirmed no preload bridge), Wisp overlay destroy+recreate (harness-forced `BrowserWindow.destroy()` since `toggleWispOverlay()` itself only hides, not destroys — disclosed), `SOLITH_TEST_BUILD` 8-variant matrix (all fail closed except the exact `'1'` control), and independent reproduction of the freeze-stop/status fix against the real overlay — all 6/6 new tests pass, rerun twice for stability. Full regression: packaged smoke 23/23, Gate 2.4 rerun 5/5, Gate 2.3 rerun 3/3, Gate 2.2 Resume rerun 10/10 (one transient stall isolated and confirmed as a flake, not a regression), Gate 2.2A.1 write-proof rerun 1/1 (48/48 packaged total), `npm test` 1,040/1,040, `test:live-memory` 257/257, main TypeScript 0 diagnostics, Electron TypeScript unchanged 31/13, `git diff --check` exit 0 (GameLibrary.tsx's baseline issue is now inside HEAD's committed history, not the unstaged diff). No production code modified this session. Terminated 4 orphaned harness-created Solith.exe processes found mid-session after a transient test stall (confirmed harness-created via `--user-data-dir` command-line match). Evidence: `Docs/Security/Evidence/BatchB1_1_Closeout/Gate2_5/` (appended/updated, prior evidence preserved with addendum notices, not overwritten). | GATE 2.5 REPORTED COMPLETE — VERIFY (unchanged, independently reconfirmed); BATCH B1.1 CONDITIONAL PASS (unchanged); RELEASE DENIED |
| 2026-07-29 | Residual-Risk and Documentation Reconciliation Review (same session, Claude Sonnet) | Read-only review reconciling apparent conflicts across the two Gate 2.5 sessions' evidence: confirmed 48/48 vs. 49/49 packaged totals are both individually correct for two different suite files and packaged-candidate hashes, not a stale number; confirmed "8 inventory rows" vs. "5 currently-defined hooks" both decompose to the identical 7 retained test-only functions plus 1 removed hook, just grouped by row-count vs. by-purpose; classified the overlay destroy/recreate residual (R-2.5-001) as an accepted architecture fact, not a security defect or B1.1 blocker; reconfirmed the branch-vs-`master` self-correction already present in `verification-final.txt`; confirmed the Gate 2.5 aggregate `REPORTED COMPLETE — VERIFY` wording is internally consistent (mirrors Gate 2.4's own convention), not stale; separated actual B1.1 blockers (Electron TypeScript baseline, branch/merge, final owner promotion decision) from disclosure-only items; produced a 5-item owner-decision package (OD-2.5-001 through 005, adding branch-merge and documentation-consolidation as new items). Zero files modified — confirmed via unchanged `git status --short --untracked-files=all` count (74) before and after. | No verdict change; findings fed directly into the following Canonical Documentation Reconciliation session |
| 2026-07-29 | Canonical B1.1 Documentation Reconciliation (same session, Claude Sonnet) | Implemented this file's own prior review recommendations: added explicit branch-authority language (verified branch `review/gate2-5-doc-audit` @ `317baf0e`, not `master`, stated with full hash) to this file's header; added an explicit documentation-authority note naming this file as the sole canonical security-status source, `ROADMAP.md` as product-direction owner (linking here rather than restating verdicts), `PROJECT_SPEC.md §3.2` as the sole prohibited-capability source, and the README L0–L4 feature-maturity scale as a distinct system from Gate/Batch security certification; corrected the "Final Current Verdict" block's bare `49/49` packaged total to name its exact suite file and candidate hash and cross-reference the separate `48/48` result instead of letting either imply a single combined number; updated `Docs/Security/Evidence/BatchB1_1_Closeout/Gate2_5/owner-decision-package.md` with OD-2.5-004 (branch merge/release-line verification) and OD-2.5-005 (documentation consolidation, this session) and explicit PENDING/NOT AUTHORIZED status wording on OD-2.5-001/002/003; deduplicated the prohibited-capability list in `AGENTS.md` (now references `PROJECT_SPEC.md §3.2` instead of restating it) and added the same reference plus a certification-terminology disambiguation note to `README.md`; added a security-roadmap link plus the same branch caveat to `ROADMAP.md`'s "Current Baseline" section. No production code, test, or evidence file touched; no commit, merge, branch, or B1.1/release promotion performed. Electron TypeScript cleanup remains a separate, untouched Codex workstream. [Superseded: the owner later reassigned this control to a Claude Sonnet session — see the Addendum below and `owner-decision-package.md` OD-2.5-001.] | Gate 2.5: REPORTED COMPLETE — VERIFY (unchanged); BATCH B1.1 CONDITIONAL PASS (unchanged); RELEASE DENIED (unchanged); documentation authority now explicit across all 5 in-scope files |
---

# Final Current Verdict

```text
BATCH B1.1 CONDITIONAL PASS
OVERALL SOLITH SECURITY: NOT COMPLETE
RELEASE/SECURITY COMPLETION: DENIED
LAST COMPLETED MILESTONE: GATE 2.5 — FINAL FRAME, DEVTOOLS, AND OVERLAY
  LIFECYCLE CLOSEOUT (reported 2026-07-29).
GATE 2.4 FUNCTIONAL STATUS: REPORTED COMPLETE — VERIFY.
GATE 2.4 SCOPE INTEGRITY: CONDITIONALLY RECONCILED.
GATE 2.5 RESULT: REPORTED COMPLETE — VERIFY.

Gate 2.5 independently reproduced the key Gate 2.4 renderer-crash,
wrong-owner, navigation, overlay, and normal-build-hook conclusions. Live
packaged child frames had no usable own or parent-accessible privileged
bridge. Removed, navigated, and parent-reload frame references failed.
A genuine detached DevTools context had no preload bridge, Node access, or
trusted Solith identity. The actual Wisp overlay was destroyed and recreated
with a new webContents identity; the old page was unusable.

The initial overlay run exposed a real B1.1 defect: freeze-stop and
freeze-status lacked the existing main-window sender/window-type guard.
Gate 2.5 added requireTrustedSender(event) to exactly those two handlers.
After correction, all seven main-only operations rejected from both the
initial and recreated overlays.

Final verification (Codex session's own candidate,
exeSHA256=0aec0dc0f5cdefc8d2c01dd4873b5722d4516fc068df8b37687586bd3ad2c602,
suite tests/gate2-5-frame-overlay-closeout.e2e.test.ts): packaged regression
49/49 PASS; packaged smoke 23/23; Gate 2.5 focused 7/7; npm test 1,040/1,040;
test:live-memory 257/257; main TypeScript PASS; Electron output verifier
29/29; packaged build PASS. (A separate Claude Sonnet addendum session below
independently reran this scope against a different freshly rebuilt
candidate and a differently scoped Gate 2.5 suite, producing 48/48 — see
that addendum; both totals are individually correct for their own suite
file and candidate hash and must not be merged into one bare number.) The
unrelated Electron TypeScript baseline was, at the time of this Gate 2.5
report, 31 diagnostics across 13 files. [Historical pre-cleanup baseline —
not the current state. Current independently reproduced state: 0
diagnostics, achieved and independently reviewed twice by a later session.
See the "Final-decision checklist (post-cleanup)" addendum below and
`owner-decision-package.md` OD-2.5-001. This does not authorize B1.1
promotion, release, or any claim about `master`.] git diff --check remains
limited to the unrelated GameLibrary.tsx lines 286 and 303.

No unresolved exploitable Gate 2.5 defect remains in the tested Windows x64
candidate. B1.1 is not promoted because the remaining documented conditions
have not been explicitly accepted by the owner. No risk acceptance was
inferred. No commit, push, merge, tag, publication, or release occurred.

OWNER DECISION REQUIRED: dispose of the remaining B1.1 conditions. If
cleanup is authorized, the exact next milestone is the separate Electron
TypeScript baseline cleanup and re-verification. Do not begin Batch B2 or
B2A under Gate 2.5.
```

## Addendum (2026-07-29, same day, separate session — Claude Sonnet)

The Gate 2.5 section and verdict above were authored by a different agent
session (its own evidence says "Model: Codex") on this same
`review/gate2-5-doc-audit` branch, committed as `317baf0` before this
addendum session began. This session (Claude Sonnet, as the operator
required) independently reran the full Gate 2.5 scope against a freshly
rebuilt packaged candidate rather than accepting the above report on faith:
the freeze-stop/freeze-status fix, child-frame/stale-frame/DevTools/overlay-
recreation boundaries, and the `SOLITH_TEST_BUILD` guard were all
reproduced with new tests (`tests/gate2-5-frame-devtools-overlay-lifecycle.e2e.test.ts`,
6/6 pass, rerun twice) and a full regression rerun (48/48 packaged, 1,040/1,040
npm, 257/257 live-memory, TypeScript/diff-check baselines unchanged). No
new defect was found; no production code was modified by this addendum
session. One correction: the repository root's actual branch is
`review/gate2-5-doc-audit`, not `master` as stated in the Gate 2.5 section
above — this does not change any verdict. See
`Docs/Security/Evidence/BatchB1_1_Closeout/Gate2_5/verification-final.txt`'s
own addendum section for full detail. Verdict unchanged: BATCH B1.1
CONDITIONAL PASS; RELEASE DENIED; OWNER DECISION REQUIRED as stated above.

## Addendum (2026-07-29, third session — Claude Sonnet, Canonical Documentation Reconciliation)

This addendum implements the documentation-consolidation and branch-authority
recommendations from this session's own prior residual-risk review. **No
security verdict changed. No production code, test, or evidence file was
modified.** Only this file's header (branch-authority language, documentation
authority note) and the "Final Current Verdict" packaged-total wording above
were edited, plus `Docs/Security/Evidence/BatchB1_1_Closeout/Gate2_5/owner-decision-package.md`
(new OD-2.5-004/OD-2.5-005 entries and status clarifications), `ROADMAP.md`,
`AGENTS.md`, and `README.md` (cross-reference/authority edits only — see each
file's own change for detail).

**Documentation authority is now explicit:** this file (`SOLITH_SECURITY_ROADMAP.md`)
is the sole canonical source for security-gate/Batch-B1.1 status; `ROADMAP.md`
owns product direction and links here instead of restating verdicts;
`PROJECT_SPEC.md §3.2` is the sole canonical source for prohibited-capability
language; `AGENTS.md` references that section rather than duplicating it;
`README.md` retains a user-facing summary but defers to `PROJECT_SPEC.md` on
conflict, and its L0–L4 feature-maturity scale is explicitly disambiguated
from Gate/Batch security certification.

**Status, unchanged by this addendum:**
Gate 2.5: `REPORTED COMPLETE — VERIFY` (aggregate; individual scenarios remain
individually `VERIFIED COMPLETE` in their own matrices).
Batch B1.1: `CONDITIONAL PASS`.
Release: `DENIED`.
Batch B2/B2A: prohibited.
Verified branch: `review/gate2-5-doc-audit` @ `317baf0ea573992dfa1a0cec2a30d6529b6ecee0`
— not `master`.
Electron TypeScript baseline cleanup: the owner explicitly reassigned this
control to a Claude Sonnet session, superseding the Codex assignment recorded
in the changelog above. A Claude Sonnet session performed the cleanup
(31→0 diagnostics) and a subsequent corrective pass addressing independent-
review findings; see `owner-decision-package.md` OD-2.5-001 for the full
provenance chain and current status (technically resolved; owner disposition
still required). Codex's assignment remains limited to the separate Wisp
workstream only.

**Final-decision checklist (post-cleanup)** (nothing below is authorized to
proceed automatically — each step requires its own explicit owner
authorization when reached):

1. Record the exact commit for the Electron TypeScript cleanup (performed by
   a Claude Sonnet session in this same working tree; see OD-2.5-001).
2. Confirm the Electron TypeScript diagnostic count reaches the
   owner-authorized target (baseline going in: 31 diagnostics/13 files;
   achieved: 0 diagnostics, independently reviewed twice).
3. Run the required scoped verification commands against that result.
4. Confirm no Gate 2.4/2.5 security behavior regressed as a side effect of
   the cleanup.
5. Reconcile the Electron TypeScript cleanup's exact commit with this Gate
   2.5 review branch (`review/gate2-5-doc-audit` @ `317baf0e`) — the cleanup
   was performed directly in this same working tree, not on a separate
   branch.
6. Obtain explicit owner authorization before any merge or promotion step.
7. Merge only through that explicitly authorized process — no session may
   merge, rebase, or push on its own initiative.
8. Identify the resulting `master` commit after merge.
9. Re-run the required final checks against that actual `master` commit —
   no claim in this document transfers to `master` before this step.
10. Only then may the owner decide whether Batch B1.1 becomes an
    unconditional pass.

No step above has been started by this session.

---

# MASTER IMPLEMENTATION PLAN

**Authorized:** 2026-08-30, by the owner in chat, superseding prior ad-hoc
sequencing for all go-forward work. Everything above this section is the
pre-existing Batch B1.1 gate ledger and is untouched by this addendum.

**Numbering:** Sections below use `MP-Phase-N` / `MP-P0.N` to avoid
colliding with this document's own `Phase 0`–`Phase 15` above. "MP-Phase 1"
and "MP-Phase 2" are the Master Implementation Plan's Phase 1 and Phase 2 —
NOT this document's own existing Phase 1/Phase 2, which mean something
different and remain unchanged above.

**Advanced Tool Tier carve-out:** MP-§0.1's ban on DLL injection, manual
mapping, and renderer hooks as part of SOLITH's *normal* architecture does
NOT retroactively revoke `PROJECT_SPEC.md §3.1`'s pre-existing, explicitly
authorized Internal Engine (in-process DLL injection / VEH hooks / HWBP).
That capability is reclassified as SOLITH's one **Advanced Tool Tier**
exception — narrowly scoped, never default, never "normal" architecture,
gated behind explicit per-target user opt-in. See `PROJECT_SPEC.md §3.1` for
the authoritative wording. Any future in-process hooking proposal must clear
the same bar before being added, and never as default/normal architecture.

## MP-§0. PROGRAM RULES

These rules govern MP-Phase 1 onward.

### MP-§0.1 Safety architecture

SOLITH must remain: external to the target game process; normal-user by
default; read-only until explicit mutation authorization; fail-closed on
protected/unsupported targets; deterministic for security-sensitive
decisions; recoverable after crashes, shutdowns, updates, and interrupted
writes; usable without AI; usable without cloud services; local-first;
auditable.

SOLITH must not make the following part of its **normal** architecture
(see the Advanced Tool Tier carve-out above for the one pre-existing,
explicitly authorized exception): DLL injection, manual mapping, kernel
drivers, anti-cheat bypass, stealth/evasion, memory hiding, renderer hooks,
input interception, arbitrary Cheat Engine Lua execution, arbitrary Auto
Assembler execution, arbitrary Python pickle execution, AI-controlled
memory writes, AI-controlled filesystem writes, protected-trainer
decryption, save encryption/key-extraction bypass.

### MP-§0.2 Licensing gate

Allowed for source incorporation: MIT, BSD-2-Clause, BSD-3-Clause,
Apache-2.0, ISC, similarly permissive licenses after review.

Normally reject: GPL, AGPL, LGPL, MPL under the project's strict current
policy, no license, unclear license, contradictory license, unverified
generated datasets, community data with incompatible redistribution terms.

Every dependency must receive: (1) root license verification, (2)
dependency-license closure, (3) capability audit, (4) activity/maintenance
check, (5) Windows compatibility check, (6) supply-chain review.

### MP-§0.3 Definition rule

A trainer definition describes intent and resolution. It never grants
execution authority by itself. Runtime mutation always passes through:
**definition → resolution → evidence → policy → user authorization →
MutationLease → NativeHost**.

## MP-Phase 1 — Security and Authority Closeout

**Priority:** P0. **Gate:** nothing major should be built on top of SOLITH
until this phase passes.

| # | Item | Status |
|---|---|---|
| MP-P0.1 | Packaged-runtime boundary (no `--dev`/`SOLITH_DEV`/dev-server routing/test overrides in production; unsafe `ELECTRON_USER_DATA_PATH` behavior removed) | **PENDING** |
| MP-P0.2 | Uninstall data protection (`deleteAppDataOnUninstall: false`, disposable/durable split, uninstall + reinstall recovery tests) | **PARTIAL — REVERSAL NEEDED**: `package.json`'s `build.nsis` currently sets `"deleteAppDataOnUninstall": true`, the opposite of this requirement |
| MP-P0.3 | Recovery storage split (disposable cache/thumbnails/scans/logs vs. durable Recovery Ledger/receipts/backup ownership/trusted catalog/definitions/research metadata) | **PENDING** |
| MP-P0.4 | `MutationTransactionService` — one authoritative 15-step save/file mutation pipeline; no save provider writes directly to a path | **PENDING** — no such service exists; current save writes go through `src/core/safety/atomic-write.ts` (single-file, no canonical-handle/reparse/lock pipeline) |
| MP-P0.5 | Handle-based path authorization (canonical handles, volume/file identity, reparse checks, symlink/junction/mount-point/hardlink/rename-race defenses) | **PARTIAL** — `src/core/safety/path-safety.ts` canonicalizes + symlink-resolves + containment-checks paths, but is string-path-based, not OS-handle-based; TOCTOU between check and use is not closed |
| MP-P0.6 | Optimistic concurrency (file ID/volume ID/hash/size/generation revalidated immediately before commit; abort on drift) | **PARTIAL** — `src/core/safety/atomic-write.ts` has an `expectedOldValue` compare-before-write, scoped to single save-field writes, not a general session-level OCC model |
| MP-P0.7 | `CloudSaveMutationGuard` (NONE/POSSIBLE/ACTIVE/UNKNOWN states for Steam/GOG/Xbox/Epic/unknown managed storage) | **PENDING** |
| MP-P0.8 | Multi-file save transactions (`SaveSlotGroup` — primary/metadata/checksum/profile/inventory files commit or roll back together) | **PENDING** |
| MP-P0.9 | Wisp IPC authorization (every handler validates sender identity, window role, channel, runtime payload schema) | **PARTIAL** — `electron/sender-validation.ts` + `src/core/security/trusted-sender-registry.ts` provide a general trusted-sender/window-role check already used by `wisp-consent-ipc.ts` and others; needs an explicit audit that every Wisp channel actually calls it (not assumed) |
| MP-P0.10 | Electron window capability matrix (READ/FILE_READ/MUTATION/PROCESS_READ/PROCESS_WRITE/NETWORK/UI_CONTROL per window/preload surface) | **PARTIAL** — `trusted-sender-registry.ts`'s per-`SolithWindowType` registry is a real precursor; not yet framed as an explicit capability matrix, and coverage across every IPC channel is unverified |
| MP-P0.11 | Electron hardening (context isolation, sandbox, nodeIntegration off, strict navigation, deny-by-default permission handlers, external URL allowlist, narrow custom protocol, CSP, split preloads, Electron fuses, packaged route validation) | **PENDING VERIFICATION** — `tests/electron.smoke.test.ts` already asserts `nodeIntegration: false`/`contextIsolation: true`/single-instance-lock per the build-verification script; Electron fuses (`@electron/fuses`) not yet confirmed present |
| MP-P0.12 | Full Phase-1 adversarial certification (path-race, junction, symlink, file-replacement race, cloud-replacement race, interrupted-transaction recovery, uninstall/reinstall recovery, unauthorized-Wisp-sender, packaged-dev-override, malicious-navigation tests) | **PENDING** — depends on MP-P0.1–MP-P0.11 landing first |

## MP-Phase 2 — Windows Lifecycle and Process Authority

| # | Item | Status |
|---|---|---|
| MP-2.1 | `SystemLifecycleController` (suspend/resume/lock/unlock/logout/shutdown/restart/Fast User Switching/remote-session-disconnect/game-exit/game-restart/NativeHost-crash/app-update) | **PENDING** — closest existing analog is `src/core/v2/lifecycle/{evaluator,timeline,types}.ts` + `src/core/v2/session-monitor.ts`, scoped to the attached-game lifecycle, not Electron/OS session lifecycle |
| MP-2.2 | Mutation authority lifecycle (revoke active MutationLeases + stop freeze loops + stale live addresses on suspend/lock/session-disconnect/game-exit/NativeHost-fault) | **PENDING** |
| MP-2.3 | Session generation (`sessionGeneration` incremented on any runtime-identity change; stale-generation responses discarded) | **PENDING** for the general Electron/OS lifecycle — Adaptive Wisp already has its own analogous `sessionGeneration` tracker (`src/core/adaptive-wisp/session-context.ts`) scoped to the attached live-memory session; this item generalizes the pattern beyond Wisp |
| MP-2.4 | `ProcessIdentity v2` (PID + creation time + full image path + architecture + fingerprint; never trust PID alone) | **PARTIAL (v1, narrower scope)** — `src/core/live-memory/windows-process-identity.ts` already does PID-reuse mitigation (exe hash, volume serial, file index, start time) for the attached game process; needs porting/extending to Electron helper/NativeHost processes |
| MP-2.5 | NativeHost Job Object (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, no silent breakaway) | **PENDING** — no Job Object usage found anywhere in the repo |
| MP-2.6 | `LifecycleRecoveryJournal` (session/lifecycle-state/active-target/active-transaction/trainer-generation/clean-shutdown-state; startup reconciliation before trainer activation) | **PENDING** |

## MP-Phase 2 certification

Suspend/resume, lock/unlock, logout, shutdown, restart, Fast User
Switching, PID reuse, game crash/restart, NativeHost crash, SOLITH crash,
power-loss simulation, updater-triggered quit — all **PENDING**, blocked on
MP-2.1–MP-2.6 landing first.

## Execution order

Per the plan's own "First Execution Block": **MP-P0.1 → MP-P0.12 in order**,
full adversarial certification before MP-Phase 2 work begins, full MP-Phase
2 certification before MP-Phase 3 (NativeHost v2) begins. No step is
claimed complete or certified until it has real source implementation,
positive tests, negative tests, and lifecycle/cleanup tests — matching this
document's own "how to read this roadmap" completion bar above.

**MP-Phase 3 through MP-Phase 11, and MP-Phase 13 through MP-Phase 22**
(NativeHost v2 RPC/framing, Definition Schema v2/EvidenceGraph, Hub Trust
Platform, Scanner v2, Pointer Map v2, Research Snapshots, Semantic Signature
Engine, Cheat Engine interoperability, Trainer Platform v2, Save Platform
v2, Engine Provider SPI, RPG Maker/scripted engines, AI Research Assistant,
Store/Save Location Intelligence, Supply Chain/Release Hardening, Fuzzing,
Performance Certification, Real-Game Certification, Final Product
Experience) are recorded as **PLANNED, NOT STARTED**, sequenced strictly
after MP-Phase 1 and MP-Phase 2 certify — not expanded here item-by-item to
avoid this document ballooning past its role as the security/lifecycle gate
ledger; each item gets its own certification entry here only once work on
it actually begins.

**MP-Phase 12 — Wisp Visual SDK and Input** is the one exception, expanded
in full below: the owner supplied a materially more detailed "SOLITH / Wisp
— Visual SDK Integration Plan" (2026-08-30) covering this exact territory
in far greater depth than the original plan's terse "12.1 TrainerBinding /
12.2 InputContext / 12.3 Controller / 12.4 BindingConflictGraph / 12.5 Wisp
modes / 12.6 Overlay profiles" sketch. Per owner direction, that newer,
more detailed plan is the authoritative version of MP-Phase 12 — its own
phase numbering (0-5) is renamed MP-12.0 through MP-12.5 below to fit this
document's namespace; nothing from the original terse sketch is lost — every
item in it maps onto a concept in the merged version (TrainerBinding →
ActionRegistry-routed commands; InputContext → per-action context gating;
Controller → unchanged; BindingConflictGraph → ShortcutRegistry's
ConflictResolver; Wisp modes/Overlay profiles → unchanged, now sitting
alongside Dockview/workspace concerns).

### MP-Phase 12 — Wisp Visual SDK and Input

**Purpose:** unify Wisp's action system, consent-aware interaction model,
hotkey management, runtime visualization, plugin isolation, and technical
diagnostics into one coherent platform rather than a collection of
independent trainer/runtime controls.

**Highest-value technologies:**

| Area | Recommendation | Priority |
|---|---|---|
| Core UI | shadcn/ui + Base UI or React Aria + Tailwind + CVA | Critical |
| Tokens | Style Dictionary + DTCG + OKLCH | Critical |
| Icons | Lucide | High |
| Motion | Motion + reduced-motion policy | High |
| Local state | Zustand | Critical |
| Async/runtime state | TanStack Query | Critical |
| Actions | ActionRegistry | Critical |
| Hotkeys | ShortcutRegistry + ConflictResolver | Critical |
| Activity | ActivityService | Critical |
| Structured consent | StructuredPrompt / Questionnaire pattern | Critical |
| Docking | Dockview | High |
| Technical diagnostics | TechnicalDataSDK + LogViewer + TraceTimeline | Critical |
| History | HistoryService | High |
| Plugin UI | Lit + Shadow DOM + PluginProtocol | Critical long-term |
| Plugin security | Sandbox + CSP + Trusted Types + capability manifests | Critical long-term |
| Multi-window | WindowStateService + WindowChromeService | High |
| Accessibility | AccessibilityContract + React Aria where useful | High |
| Performance | Tracy + Perfetto | High |
| GPU rendering | WebGPU only for specialized visual/debug surfaces | Optional |
| Professional color/media | OpenColorIO/OpenImageIO | Skip |

**Core architecture:**

```text
Wisp operation
    ↓
ActionRegistry
    ↓
Consent / Capability Policy
    ↓
ShortcutRegistry
    ↓
Runtime
    ↓
ActivityService
    ↓
TechnicalDataSDK / Audit
```

Every significant Wisp action resolves through the same semantic action
layer, whether invoked by a button, hotkey, command palette, automation, AI
surface, or plugin (e.g. `Enable Infinite Ammo`, `Attach to Game`, `Switch
Profile`, `Resolve Binding Conflict`, `Open Runtime Diagnostics`). This is
the concrete mechanism by which `MP-P0.9` (Wisp IPC authorization) and the
existing Adaptive Wisp consent architecture's proposal→approval flow
generalize into a first-class action/consent layer, rather than remaining
one-off per-feature wiring.

**Project-specific components to build:** `GameIdentityBadge`,
`TrainerEntryCard`, `BindingConflictView`, `ConsentCard`,
`GameSessionTimeline`, `RuntimeHealthPanel`, `HotkeyEditor`,
`AdapterDiagnosticsPanel`, `CapabilityGrantCard`, `ProcessAttachmentStatus`.

**What to incorporate:** shadcn-owned application chrome; Base UI for
general primitives or React Aria for especially complex accessible
controls; Style Dictionary/DTCG tokens for one visual language across
trainer, overlay, settings, and diagnostics; ActionRegistry as the
authoritative command layer; ShortcutRegistry with per-game profiles and
deterministic conflict handling; ActivityService for attach/detach, game
switching, scanning, adapter state, generation changes, and background
work; StructuredPrompt for consent, capability approval, ambiguity
resolution, and repair choices; TechnicalDataSDK for runtime/session/
binding/process data; Dockview for advanced power-user workspace layouts;
Lit/Shadow DOM for isolated trusted extension UI; sandboxed
iframe/process/worker boundaries for untrusted plugins; Trusted Types and
CSP for hardened host rendering; Tracy and Perfetto for stutter/performance
investigations.

**What to avoid:** routing trainer actions independently from hotkeys;
giving plugins direct unrestricted DOM, process, filesystem, USB, HID, or
window access; using WebGPU for ordinary app chrome; bringing
OpenColorIO/OpenImageIO into SOLITH unless a future feature genuinely
handles professional media; creating separate ad hoc consent dialogs per
feature (the existing `WispConsentDialog`/`WispConsentQueue` architecture is
the one canonical consent surface — `StructuredPrompt` generalizes it, it
does not compete with or replace it with a second parallel dialog system).

#### MP-12.0 — Visual Foundation

Establish DTCG token source; add Style Dictionary build; standardize shadcn
component ownership; standardize Lucide; add theme, density, high-contrast,
and reduced-motion tokens; create core accessibility and presentation
contracts. **Status: PLANNED, NOT STARTED.**

#### MP-12.1 — Actions and Hotkeys

Implement `ActionRegistry`; implement `ShortcutRegistry`; add
`ConflictResolver`; move every trainer/runtime command behind
`ActionRegistry`; add per-game hotkey profiles; ensure actions expose
capability and consent requirements. **Status: PLANNED, NOT STARTED** — the
existing `trainer-hotkey-registration.ts`/quick-slot-controller lifecycle
work is a real precursor (see the Adaptive Wisp Phase 1-2 closeout above)
but is not yet generalized into an `ActionRegistry`.

#### MP-12.2 — Runtime Experience

Implement `ActivityService`; implement `StructuredPrompt`; add
`GameSessionTimeline`; add `RuntimeHealthPanel`; add `BindingConflictView`;
add `LogViewer` and technical diagnostics. **Status: PLANNED, NOT STARTED**
— the existing `WispConsentDialog`/`WispConsentQueue` is a real, already-
certified precursor to `StructuredPrompt` for the consent case specifically.

#### MP-12.3 — Workspace and History

Add Dockview; add configurable power-user workspace; add `HistoryService`
for editable profiles/configuration; add multi-window state and recovery.
**Status: PLANNED, NOT STARTED.**

#### MP-12.4 — Plugin Platform

Implement `PluginProtocol`; add Lit-based trusted plugin surfaces; add
sandboxed untrusted plugin surfaces; add capability manifests; add CSP/
Trusted Types enforcement; add plugin accessibility and localization
contracts. **Status: PLANNED, NOT STARTED** — this is the one MP-12 item
with direct security-boundary implications; it must not begin before
MP-Phase 1's Electron capability-matrix/hardening work (MP-P0.10/MP-P0.11)
certifies, since a plugin sandbox built on an uncertified capability model
inherits that gap.

#### MP-12.5 — Performance Certification (Wisp)

Instrument major runtime operations with Tracy; export/inspect traces with
Perfetto; add performance budgets; add regression traces for attach,
detach, game switch, trainer activation, and adapter reload. **Status:
PLANNED, NOT STARTED.**

**Gate:** per this document's own execution rule, no MP-Phase 12 work
begins before MP-Phase 1 and MP-Phase 2 certify — MP-12.4 (Plugin Platform)
additionally requires MP-P0.10/MP-P0.11 specifically, even within MP-Phase
12's own eventual execution window.