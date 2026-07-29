# Batch B1 — Verification-Only Correction Pass

Date: 2026-07-27
Supersedes the disposition claims (not the code-change facts) in `finding-revalidation.md`. This document does not repeat file:line detail already established there; it adds the matrices, honest gap disclosure, and corrected verdict the original report was missing.

No production code beyond the tests listed in section 1 was added in this pass. This is verification + documentation, per instruction.

---

## 0. Corrected test totals (resolves the 986 vs 976 contradiction)

**986 was wrong. 976 is correct.** The 986 figure was a narrated estimate made mid-session before a precise count existed; it was never checked against actual command output. Every number below was captured fresh, twice, in this pass, with exit codes.

| Suite | Exact command | Tests | Suites | Pass | Fail | Cancelled | Skipped | Todo | Exit code |
|---|---|---|---|---|---|---|---|---|---|
| TypeScript compile | `npx tsc --noEmit -p tsconfig.json` | — | — | — | — | — | — | — | **0** (empty output) |
| Targeted (new/changed files only) | `npx tsx --test tests/live-memory-rollback-freeze-ipc-validation.test.ts tests/live-memory/session-cleanup-on-destroy.test.ts tests/live-memory/live-memory-session.test.ts tests/live-memory/memory-manager.test.ts` | 69→**73** (4 new tests added this pass) | 8 | **73** | 0 | 0 | 0 | 0 | **0** |
| Full live-memory suite (24 files) | see `tests-run-v2.txt` for the full 24-file command | **206** (was 202; +4 new tests) | 19 | **206** | 0 | 0 | 0 | 0 | **0** |
| Full registry/headless suite (12 files) | see `tests-run-v2.txt` | 36 | 12 | 36 | 0 | 0 | 0 | 0 | **0** |
| Full repository suite, part 1 (126 files, the `tsx --test` portion of `package.json`'s `"test"` script before its `&&`) | `npx tsx --test tests/core.test.ts ... tests/injector-process-integration.test.ts` (126 files) | **966** | 163 | **966** | 0 | 0 | 0 | 0 | **0** |
| Full repository suite, part 2 (`&&`-chained) | `npx tsx --test tests/sql-parameter-binding.test.ts` | 10 | 1 | 10 | 0 | 0 | 0 | 0 | **0** |
| **Full repository suite, combined** | (part 1 + part 2 — `package.json`'s `"test"` script runs both, chained with `&&`, and is blocked in this sandbox only by an unrelated Node-version pretest gate; the two `tsx --test` invocations underneath it were run directly) | **976** | 164 | **976** | **0** | 0 | 0 | 0 | **0** + **0** |

Run twice, independently, in this pass: identical results both times (966/966 and 10/10). **976/976 is the single authoritative full-suite number.** `tests-run.txt` and `verification-final.txt` have been corrected to assert only this number as the final total — "986" appears nowhere in those two files any more, and appears in this document only in this correction note explaining why it was wrong.

The 4 new tests added in this pass (documented in section 2 below) are counted in the "73" and "206" figures above.

---

## 1. Baseline-versus-Batch-B1 file classification

Full raw evidence: `baseline-files.txt` (git status captured **before** any Batch B1 edit — timestamped 22:38 on 2026-07-26, preserved from the original session), `batchb1-owned-diff.txt`, `preexisting-diff-preserved.txt`.

| File | Baseline status | Classification | Basis |
|---|---|---|---|
| `electron/live-memory-ipc.ts` | not listed (clean) | **Batch B1 only** | `git diff` shows the whole diff; nothing pre-existing to mix with |
| `electron/registry-verification-ipc.ts` | not listed (clean) | **Batch B1 only** | same |
| `src/core/live-memory/live-memory-session.ts` | not listed (clean) | **Batch B1 only** | same |
| `src/core/live-memory/memory-manager.ts` | not listed (clean) | **Batch B1 only** | same |
| `src/core/live-memory/types.ts` | not listed (clean) | **Batch B1 only** | same |
| `tests/live-memory/live-memory-session.test.ts` | not listed (clean) | **Batch B1 only** | same |
| `tests/live-memory/memory-manager.test.ts` | not listed (clean) | **Batch B1 only** | same |
| `src/core/live-memory/session-cleanup.ts` | did not exist | **New Batch B1 file** | new |
| `tests/live-memory/session-cleanup-on-destroy.test.ts` | did not exist | **New Batch B1 file** | new |
| `tests/live-memory-rollback-freeze-ipc-validation.test.ts` | did not exist | **New Batch B1 file** | new |
| `electron/ipc-validation.ts` | `M ` (staged only) | **Batch B1 only** (for the unstaged diff) | `git diff` (working tree vs index) isolates unstaged content; both hunks verified Batch B1 |
| `src/app/pages/RegistryExplorerPage.tsx` | `M ` (staged only) | **Batch B1 only** (for the unstaged diff) | same — single 1-line hunk, verified Batch B1 |
| `electron/preload.ts` | `MM` (staged **and** unstaged) | **Pre-existing plus Batch B1 edits (mixed)** | 3 hunks in unstaged diff; hunks 1 and 3 are Batch B1, hunk 2 (`wispOverlaySetExpanded`/`MoveBy`/`SetInteractive`) is pre-existing — see `preexisting-diff-preserved.txt` |
| `package.json` | `MM` | **Mixed** | 3 hunks; `test:install-discovery` hunk is pre-existing; the `test:live-memory`/`test` hunks are single long JSON-string lines containing a pre-existing baseline string PLUS a Batch B1 substring insertion (git diffs whole lines, not substrings — the insertion is verified by exact string search, not by hunk isolation) |
| `src/types/global.d.ts` | `MM` | **Mixed** | 7 hunks; only hunks 2 (`liveMemoryRollback` type) and 4 (`userSelectedProcess`) are Batch B1; the other 5 (`liveMemoryListProcesses` signature, `wispOverlay*`/`trainerHotkeys*`/`trainerCatalog*` additions, install-discovery identity fields) are pre-existing |
| `tests/csp-static.test.ts`, `tests/packaged-smoke.test.ts`, `vite.config.ts`, `src/configure-zod-csp.ts` | not listed (clean) at Batch B1 baseline | **NOT Batch B1 — excluded** | Discovered modified/created during this verification pass with timestamps (23:48–23:50) that postdate this session's own edits. This session made zero references to CSP/vite/configure-zod-csp at any point. Presumed concurrent/independent work; left untouched. |

**Corrected claim: "no unrelated file touched"** — this claim was previously made without baseline proof and is now WITHDRAWN in that unqualified form. The corrected, provable claim is: **no file was touched by Batch B1 that Batch B1 did not intend to touch**, and 4 files (`tests/csp-static.test.ts`, `tests/packaged-smoke.test.ts`, `vite.config.ts`, `src/configure-zod-csp.ts`) changed during this session's wall-clock window from a source other than Batch B1's own edits — confirmed by content and by absence from this session's tool-call history, not merely asserted.

---

## 2. Rollback binding matrix

| Binding | Bound? | Mechanism / evidence |
|---|---|---|
| Proposal ID | **Yes** | Sole lookup key into `confirmedWrites` |
| PID | **Yes (indirectly)** | `verifyAttachedProcessIdentity()` compares `handle.pid === target.pid` and re-queries the live OS process |
| Process creation time / stable identity | **Yes** | Same call compares `startTime`, `executablePath`, `volumeSerialNumber`, `fileIndex`, `exeSha256` against the live-queried process — a PID-reuse scenario (new process, same number) fails this because path/start-time won't match |
| Executable identity | **Yes** | Same mechanism |
| Active attachment/session | **Yes** | `requireBundle(event)` requires an attached session bound to `event.sender.id`; `rollback()` also requires `this.handle && this.target` |
| Address | **Yes** | Stored in the `confirmedWrites` manifest, never accepted from the caller (this was the core fix) |
| Length | **Yes (via dataType)** | `dataType` (int32/float/etc.) is stored in the manifest and implies byte length; not separately re-validated as a raw byte count, but not renderer-suppliable either |
| Original bytes (`valueBefore`) | **Yes** | Stored in the manifest, used as the restore value |
| **Expected current bytes (compare-and-swap against `valueAfter`)** | **NO — confirmed gap** | `rollback()` does not re-read current memory and compare it to `manifest.valueAfter` before writing `valueBefore`. **New test added this pass proves it**: `KNOWN GAP: rollback does not verify the current memory value still matches the confirmed write before restoring — it will overwrite an intervening change` (passes, demonstrating current behavior). This is not an authorization bypass (the write is still bound to a real confirmed write on the correctly-identified process) but it is a real data-integrity gap: an intervening change (game logic, a concurrent freeze, a second write to the same address) is silently clobbered with no detection. |
| Requesting window | **Yes** | `event.sender.id` session ownership, established at attach time, never renderer-suppliable |
| **Consent decision (fresh, for the rollback operation itself)** | **NO — confirmed gap** | Rollback relies on the *original* write's consent chain (the confirm that created the ledger entry required a `consentToken`), but issuing the rollback itself requires no fresh consent artifact and no native dialog. This mirrors the existing "undo my last action" UX intent but is architecturally weaker than confirm-write. |
| **Expiration** | **NO — confirmed gap** | No TTL exists on `confirmedWrites` entries. **New test added this pass proves it**: `KNOWN GAP: a confirmed write remains rollback-able indefinitely — there is no expiration/TTL, only the 50-entry FIFO cap` (passes). A confirmed write from an arbitrarily long time ago remains rollback-able as long as it hasn't been evicted by the 50-entry cap or the session hasn't been detached. |
| Single-use state | **Yes** | Entry deleted from `confirmedWrites` on successful rollback; verified by the existing replay test |

### New/verified tests added this pass (all passing, all in `tests/live-memory/live-memory-session.test.ts`)

| Scenario requested | Test | Result |
|---|---|---|
| Process restart with same PID | `rollback fails closed against a same-PID process restart (path + start time both changed, PID unchanged)` | **PASS** — fails closed |
| Attachment replacement | Covered by existing `rollback ledger is cleared on detach` (detach clears the ledger; a subsequent attach to a different process cannot see the old session's confirmed writes) | **PASS** |
| Executable identity mismatch | Covered by existing `rollback fails closed when the attached process identity no longer matches` | **PASS** |
| Current-memory mismatch | `KNOWN GAP: rollback does not verify the current memory value...` | **FAILS TO PROTECT** — documented gap, not fixed in this pass |
| Ledger eviction | `rollback ledger evicts the oldest confirmed write once the 50-entry cap is exceeded (FIFO)` | **PASS** — evicted entries fail the same generic "unknown or already rolled back" error as a forged proposalId; there is no distinct "this was evicted" signal to the caller |
| Detach and reattach | Covered by existing `rollback ledger is cleared on detach` | **PASS** |
| Rollback after renderer reload | Not directly testable at the `LiveMemorySession` unit level (reload is a `webContents` navigation event, not something the session object observes) — see section 4 for the architectural reasoning: a reload does **not** fire `webContents.on('destroyed', ...)`, so the session and its ledger survive a reload untouched. This is not a new gap introduced by this pass; it was true before Batch B1 for every stateful IPC session in the codebase (live-memory sessions, V2 monitor sessions, TrainerHost) and is a pre-existing architectural characteristic, not something scoped to these 3 handlers. | Documented, not fixed |
| Rollback after proposal expiration | `KNOWN GAP: a confirmed write remains rollback-able indefinitely...` | **FAILS TO PROTECT** — no expiration exists at all; documented gap |

### Verdict impact

The arbitrary-manifest primitive (the original, most severe finding) **is closed** — an attacker can no longer supply their own address/value/dataType. But three of the requested bindings (expected-current-value check, fresh consent, expiration) are **confirmed absent**, not merely "deferred as a separate architectural item" the way the freeze consent gap is. **This downgrades `live-memory-rollback` from "FIXED" to "PARTIALLY FIXED — core primitive closed, data-integrity and freshness gaps remain."**

---

## 3. Ledger behavior (50-entry FIFO)

| Question | Answer |
|---|---|
| Why 50 was selected | **No principled derivation — this was an arbitrary round number chosen by this session, not derived from a documented project policy, measured usage pattern, or threat model.** Stated plainly rather than retrofitting a justification. |
| Scope of the limit | Per `LiveMemorySession` instance, i.e., per attached session (per `event.sender.id`, i.e., per renderer window that has an active attach). Not per-process, not application-wide. Two different windows attached to the same target process would each get their own independent 50-entry ledger. |
| Eviction behavior | FIFO — `confirmedWrites.keys().next().value` (Map insertion order) is deleted when size would exceed 50, verified by the new eviction test. |
| User-visible behavior after eviction | **Silent.** An evicted entry's `proposalId` returns the exact same `"Unknown or already rolled back write."` error as a forged/never-confirmed proposalId or an already-consumed one. The caller (and therefore the end user, depending on how the UI surfaces this) cannot distinguish "this was evicted because you made 50+ writes" from "this proposalId is simply wrong" or "you already undid this." Confirmed by the new eviction test. |
| Audit behavior | The `MemoryAuditLog` records every `confirmWrite`/`rollback` call as it happens (append-only JSONL), independent of the in-memory `confirmedWrites` map. Eviction from the in-memory ledger does **not** delete or touch the audit log — the historical record of that write's occurrence and value is preserved in `logs/memory-audit.jsonl`, only the ABILITY to roll it back in-app is lost. |
| Can eviction be deliberately triggered/forced by an attacker to hide a write? | **Yes, in principle.** A renderer that can call `live-memory-confirm-write` 50+ times in a row (each requiring its own native-dialog consent token, so this is not a silent/automatable attack under the current architecture — each of the 50 evicting writes still needs a user to click "Approve" in a real OS dialog) could push an earlier confirmed write out of rollback range. Given the native-dialog requirement on every evicting write, this is not a practical silent-attack vector, but it IS a real mechanism: the ledger cap can be exhausted by volume, and there's no user-facing signal when it happens. |
| Memory-scrubbing of sensitive byte arrays | The stored `LiveWriteManifest` entries (`address`, `dataType`, `valueBefore`, `valueAfter`, `proposalId`, `appliedAt`) are small JS numbers/strings — not raw byte buffers. There is no separate "sensitive byte array" being retained; the values are the same numeric before/after values already returned to the renderer at confirm time and already written to the audit log. No additional scrubbing concern beyond what already existed for `pendingProposals` (which has the identical shape and was never scrubbed either). |
| Cleanup on detach | **Yes** — `confirmedWrites.clear()` added to `detach()` in this pass, verified by the "ledger cleared on detach" test. |
| Cleanup on process exit | **Indirect only.** Nothing observes target-process exit as a discrete event; the *next* attempted operation (rollback, freeze tick, etc.) would call `verifyAttachedProcessIdentity()`, which fails closed once the process is gone, but the ledger itself is not proactively cleared just because the target exited while the session sits idle. |
| Cleanup on renderer destruction | **Yes, added this pass** — `wireSessionCleanupOnDestroy` calls `disposeSession()` on `webContents.on('destroyed', ...)`, which calls `session.detach()`, which clears `confirmedWrites`. See section 4 for exactly which renderer-lifecycle events this does and does not cover. |
| Cleanup on app shutdown | Not explicitly wired for live-memory sessions specifically; process termination (`app.quit()`) ends the Node process entirely, which trivially "clears" all in-memory state including the ledger, but there's no graceful pre-shutdown hook analogous to `trainer-hotkeys`'/`wisp-overlay`'s `app.on('will-quit', ...)` cleanup registered for live-memory sessions. Not a security gap (the state is gone either way) but noted for completeness since it was explicitly asked about. |

---

## 4. Freeze limits and cleanup matrix

### Bound rationale — stated honestly, not retrofitted

| Parameter | Value | Justification |
|---|---|---|
| Minimum interval | 50ms | **Pre-existing** — this was already in `LiveMemoryFreezeStartSchema` before Batch B1 touched anything; this pass only added the *same* bound at the session level (defense in depth). No new rationale to give; inherited as-is. |
| Maximum interval | 5000ms (5s) | **Pre-existing**, same as above. |
| Maximum duration | 6 hours | **Arbitrary, chosen by this session.** No documented project policy on maximum trainer-session length was found to derive this from. Chosen as "long enough to not interrupt a normal multi-hour play session, short enough to eventually self-terminate a forgotten freeze" — a judgment call, not a measured or policy-derived value. Should be treated as provisional. |
| Maximum concurrent freezes **per process** | **Not enforced** — only per-session-instance (one freeze per `LiveMemorySession` object, i.e., per attached renderer window). Two different renderer windows (main window + wisp overlay window, both of which share the same `preload.cjs` and therefore the same `window.electronAPI` surface — confirmed via `electron/main.ts`/`electron/wisp-overlay.ts` `preload:` paths) could each independently attach to the **same** target PID and each start their own freeze at the same or different addresses. Nothing detects or prevents this. |
| Maximum concurrent freezes **globally** | **Not enforced**, same reasoning — no cross-session registry of active freezes exists. |
| Configurable? | The 6-hour cap is only overridable via a test-only seam (`_setMaxFreezeDurationMsForTests`) not reachable from IPC/renderer — not user-configurable in the shipped app. The 50–5000ms interval bounds are likewise fixed in code, not user-configurable. |
| Can multiple renderer windows bypass limits? | **Yes, for the "one freeze per session" concurrency limit specifically** — see "per process" row above. The per-freeze interval/duration bounds still apply individually to each window's own freeze; they cannot be widened by using a second window, only *duplicated*. |

### Cleanup coverage matrix

| Event | Covered? | Mechanism |
|---|---|---|
| `stopFreeze()` (explicit user stop) | **Yes** | Pre-existing, unchanged |
| Consent/online-guard re-check fails mid-freeze | **Yes** | Pre-existing, unchanged (`stopFreezeInternal('guard_blocked')`) |
| Process identity changes / process exits | **Yes** | Pre-existing, unchanged (`verifyAttachedProcessIdentity()` re-checked every tick; new test added this pass explicitly names this scenario) |
| Max duration exceeded | **Yes — new this pass** | `stopFreezeInternal('max_duration_exceeded')` |
| `session.detach()` (explicit detach) | **Yes** | Pre-existing, unchanged |
| **Renderer window destroyed** (`webContents.on('destroyed', ...)`) | **Yes — new this pass** | `wireSessionCleanupOnDestroy` → `disposeSession()` → `session.detach()` |
| **Renderer reload / navigation** | **NO — confirmed gap, not covered** | Electron's `webContents` `'destroyed'` event does **not** fire on a page reload or in-page navigation — the same `webContents` object survives. A reload wipes the renderer's own JS state (so it "forgets" it had a freeze running) but the main-process session, and any active freeze, keeps running untouched. This is a real, confirmed gap: the freeze would keep writing indefinitely with no UI able to reference or stop it until the window itself is closed, `live-memory-detach` is somehow called again, the max-duration cap eventually fires, or the process exits. |
| **Render-process crash** | **Partially — untested, likely covered by 'destroyed'** | Electron typically fires `webContents.on('destroyed', ...)` when the renderer process crashes and the WebContents is torn down, which *would* trigger cleanup via the same listener — but this was not empirically tested in this pass (would require an actual Electron process crash, out of scope for unit tests and the "do not attach to live processes" constraint). Documented as "expected to work, not verified." |
| **Window replacement** (e.g. `mainWindow` variable reassigned to a new `BrowserWindow` without destroying the old one) | **Not applicable in current code** — `electron/main.ts`'s `createWindow()` is only ever called once at startup in the reviewed code path; there is no observed "replace mainWindow without destroying the old one" pattern. Not tested because no such code path exists to test. |
| **App shutdown** (`app.on('will-quit')`) | **No explicit hook for live-memory freezes** — same as ledger cleanup (section 3): process termination ends everything implicitly, but there is no graceful pre-quit stop-all-freezes hook the way `trainer-hotkeys`/`wisp-overlay` have for their own resources. Not a security gap (process death stops the freeze loop trivially) but a real gap in "deterministic, observable cleanup" if a future feature needed to flush/log state before quitting. |
| **Target-process exit** | **Yes** | Same mechanism as "process identity changes" above — the next tick's `verifyAttachedProcessIdentity()` call fails once the process is gone, stopping the freeze with `identity_mismatch`. |
| **Attachment replacement** (same session re-attaches to a different process while freeze was active on the old one) | **Yes, indirectly** | `startFreeze()` refuses to start a second freeze while one is active (`this.freeze?.active` guard) but does not itself prevent `attach()` from being called again in a way that changes `this.target`. In practice, `disposeSession()` is called before every attach in `electron/live-memory-ipc.ts` (line ~102/~200: `disposeSession(event.sender.id)` precedes `bindSessionBundle`), which calls `detach()` on the OLD session object first, which calls `stopFreezeInternal('detached')` — so re-attaching does stop a prior freeze, but via the IPC-layer's dispose-then-recreate pattern, not via any check inside `startFreeze` itself. |
| **Consent revocation while active** | **Not a discrete mechanism, but covered by re-checked guard** | There's no "revoke consent" IPC channel for a running freeze; the closest analog is the per-tick `evaluateWriteConsent` re-check (loss of the online-guard waiver stops the freeze). A user cannot "revoke" mid-freeze consent for that specific write the way they might expect a per-operation consent token to work — because no per-operation consent token exists for freeze-start at all (see section 5). |
| **Feature-flag (`v2LiveModeEnabled`) disabled while a freeze is active** | **NOT verified — likely gap** | Nothing in `startFreeze`'s tick loop re-checks `isTrainerCapabilityEnabled('v2LiveModeEnabled')`. Once a freeze is running, disabling the feature flag would not stop it — the flag is only checked at the IPC entry point when `live-memory-freeze-start` is first invoked, not on every subsequent tick the way the online-guard consent check is. This was not tested or fixed in this pass; documented as a newly-identified gap. |

---

## 5. Freeze authorization reassessment (the consent gap)

**The critique is correct, and I am revising the verdict accordingly rather than defending the original PASS.**

Batch A explicitly named "no consentToken required unlike write-consent flow" as the defining characteristic of `live-memory-freeze-start`'s **high** risk rating (see the original Batch A note, preserved verbatim in `Docs/Security/Evidence/BatchA/ipc-channel-reconciliation.csv`, row 25 — unmodified by this session, see section 9). This session's own `finding-revalidation.md` reported the exact same gap as still present after the fix and characterized it as "deferred," then the top-level chat summary rounded that up to an unqualified "BATCH B1 PASS." **That rounding was wrong.** A confirmed, high-severity, Batch-A-defining control gap that remains open cannot support an unconditional pass, regardless of how much unrelated hardening was done around it.

I did not find a documented project policy stating explicit per-operation consent is or is not required for repeated memory writes specifically (as distinct from single writes). In the absence of an explicit policy either way, the more conservative and internally-consistent reading is: `live-memory-confirm-write` (a single write) requires a native-dialog consent token; `live-memory-freeze-start` (an indefinitely-repeating write to the same effect, arguably higher-impact since it persists) requires none. That asymmetry is the gap, and it was not closed in this pass.

**This is the single largest reason the verdict below is CONDITIONAL PASS, not PASS.**

---

## 6. Registry-verification trust and sender-validation reassessment

### 6a. `userSelectedProcess: z.literal(true)` — reassessed

The critique is correct: **this proves only that the renderer sent the literal value `true`; it does not prove a human selected that specific process.** I mischaracterized this in the original report by calling it an honest "confirmation flag" without being explicit that it is a self-attestation, not server-verified state. Correcting that characterization now.

What it **does** accomplish: it closes the specific, concrete defect that existed before this pass — the handler previously hardcoded `selectedByUser: true` **regardless of what the renderer sent**, so the underlying library check (`assertExplicitProcessSelection`) was unconditionally satisfied no matter what. After this pass, a renderer that omits or sends `false` for this field is rejected by schema validation before the handler runs at all. That is a real, verified improvement (see `RegistryRunVerificationSchema` tests, all passing) — but it is a floor-raise (closing a "the check always passed no matter what" defect), not the creation of genuine server-verified authorization.

What it does **not** accomplish, and what the critique correctly demands: binding to actual main-process-maintained state such as a process-selection record created by the main process itself, a short-lived operation identifier, or a timestamp/expiration. **No such mechanism exists for this handler, and none was built in this pass** — building one would mean designing a new stateful "process selection" primitive (something like write-consent.ts's token store, but for process selection rather than writes), which is materially new production architecture, not a verification-pass-appropriate change, and was correctly out of scope under "do not begin another batch."

**Corrected disposition: the hardcoded-bypass defect is FIXED; the underlying trust model (a renderer-supplied boolean asserting user intent) is UNCHANGED and remains weak, consistent with — not worse than — the rest of this codebase's `z.literal(true)` pattern (e.g. `userConfirmedOffline` on `live-memory-attach` has the identical trust characteristic and always has).**

### 6b. Sender validation — reassessed

The critique is correct: `event.sender.isDestroyed()` is a liveness check (the WebContents object hasn't been torn down), not an identity/authorization check (which BrowserWindow, which frame, which origin).

Investigation performed this pass:
- **Searched the entire codebase for any existing BrowserWindow/frame/origin validation pattern**: `grep -rn "webContents.id ===|frame.url|senderFrame|isMainFrame|mainWindow.webContents ===|event.senderFrame" electron/*.ts` → **zero matches across all 149 Batch-A-audited handlers.** No handler in this codebase does deeper sender validation than `isDestroyed()` plus session-ownership-by-`sender.id`. This is a systemic, codebase-wide architectural characteristic — not something unique to, or introduced by, these 3 handlers.
- **Checked how many privileged windows exist and what they load**: `electron/main.ts` creates `mainWindow`; `electron/wisp-overlay.ts` creates `wispOverlayWindow`. **Both use the identical preload script** (`preload: path.join(moduleDirectory, 'preload.cjs')` in both files), meaning both windows expose the full `window.electronAPI` surface, including all 3 target handlers. Both windows load only Solith's own bundled content — `mainWindow.loadFile(.../dist/index.html)` (or `http://localhost:3000` in dev) and `wispOverlayWindow.loadURL('file://.../dist/index.html#wisp-overlay')` (or the same local dev server in dev) — never a remote or third-party URL.
- **Confirmed hardening that does exist**: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` on both windows (`electron/main.ts:222-224`, `electron/wisp-overlay.ts:166-168`) — this is renderer-process hardening (prevents a loaded web page from reaching Node/Electron internals directly), not IPC-sender-origin validation.

**What this means concretely**: the app's actual threat model, evidenced by its own code, is "a Solith-authored window (main or overlay) is trusted; the risk is a compromised dependency bundled into that trusted window's own JS," not "a hostile third-party frame or window." Under that model, `webContents.id`-based session ownership (already present, unchanged by this pass) is the load-bearing control against cross-session interference, and it does what it's designed to do. It does **not**, and was never designed to, protect against a compromised dependency running *inside* an already-trusted window — which is exactly the class of threat Batch A's original findings (and this pass's own "compromised renderer" framing in `finding-revalidation.md`) were written against.

**Building real BrowserWindow/frame/origin validation for only these 3 handlers, when zero of the other 146 audited handlers have it, would be architecturally inconsistent and is a new codebase-wide security primitive, not a fix scoped to 3 handlers.** Per "do not begin another batch," this was not implemented. It is documented here as a genuine, currently-unaddressed limitation — one that applies to the entire IPC surface, not specifically to Batch B1's targets, and is out of scope for a 3-handler batch.

**Unauthorized-window/unauthorized-frame tests were not added**, because there is currently no code path to distinguish "authorized" from "unauthorized" for these tests to exercise — writing tests against non-existent validation logic would only assert that the (absent) check is absent, which the honest documentation above already states plainly.

---

## 7. Read-only verification — proven, not asserted

Re-reading the full call chain (`electron/registry-verification-ipc.ts` → `src/core/runtime/headless-verification-worker.ts` → `src/core/runtime/headless-verification.ts` → `src/core/runtime/windows-readonly-process-module-reader.ts`) to answer each point directly:

| Question | Answer, with citation |
|---|---|
| Exact executable | **None is launched.** No `child_process.spawn`/`exec`/`execFile` call exists anywhere in this call chain (verified by `grep -n "spawn(\|exec(\|execFile(" ` across all 4 files above — zero matches). |
| Exact argument array | N/A — no external process is started. |
| `shell` setting | N/A |
| Working directory | N/A |
| Environment | The `node:worker_threads.Worker` (`new Worker(workerPath(), { type: 'module' })`, `electron/registry-verification-ipc.ts`) runs inside the **same OS process** as the Electron main process — a V8 isolate/thread, not a separate process. It inherits the main process's environment implicitly (there is no separate env to configure), and there is no shell or argv injection surface because there is no shell. |
| Timeout | `RunVerificationSchema`/`RegistryRunVerificationSchema`: `timeoutMs` bounded `1_000`–`120_000`, default `30_000`. Enforced by `runWorker()`'s own `setTimeout(() => { void worker.terminate(); reject(...) }, timeoutMs + 1_000)`. |
| Output cap | `windows-readonly-process-module-reader.ts`: `DEFAULT_MAX_READ_BYTES = 1024 * 1024` (1MB) per single `readModuleBytes` call, enforced by `if (length > this.maxReadBytes) throw ...`. |
| Exit-code handling | `runWorker()`: `worker.once('exit', (code) => { if (code !== 0) { ...; reject(new Error(...)) } })`. |
| Process-tree termination | Not applicable in the traditional sense (no child OS process tree exists) — `worker.terminate()` tears down the V8 worker thread on timeout or completion; there is no separate process tree to walk/kill. |
| Input source | `pid`, `executableName`, `executablePath` come from the IPC payload (renderer-supplied, schema-validated); the `registry` payload is validated by `validateLoadedRegistry()` before use. |
| PID validation | `RegistryRunVerificationSchema`: `pid: z.number().int().positive()`. |
| Process-identity validation | `windows-readonly-process-module-reader.ts` `openWindowsReadOnlyProcessSession()`: after opening the PID, it calls `driver.getProcessExecutableName(handle)` and throws `ambiguous_process` if the **live-queried** executable name doesn't match the caller-claimed `executableName` — the claimed identity is cross-checked against the OS, not merely trusted. |
| Registry access, if any | **None.** No `HKEY_*`/`reg.exe`/WMI-registry call exists anywhere in this file or its dependency chain (re-confirmed this pass by re-reading all 4 files in the call chain in full — this matches, and does not merely repeat unverified, the Batch A `registry-operations-audit.txt` finding). |
| Memory access, if any | **Read-only.** `ReadOnlyProcessModuleDriver` interface (`windows-readonly-process-module-reader.ts:36-42`) exposes exactly: `openProcess`, `closeProcess`, `getProcessExecutableName`, `getModules`, `readBuffer`. **No `writeMemory`/`writeBuffer` member exists on this interface at all** — it is structurally impossible to write through it, not merely unused. |
| Mutation-capable APIs reachable from the worker | None found. The worker's only capability surface (`WindowsReadOnlyProcessModuleSession` class) implements `getModules()` and `readModuleBytes()` and nothing else; `close()` releases the handle. |
| Additional defense found | `assessProtectedTarget()` blocks known anti-cheat/protected-module targets before any read is permitted (pre-existing, unchanged). |

**This section is a demonstration, with file/function citations, not a restatement of the channel's name.** The "read-only, no shell/exec surface" characterization stands as proven, not merely asserted, and was not weakened by anything found in this pass.

---

## 8. Remaining risks (consolidated, honest, ranked)

1. **HIGH — freeze-start has no per-operation consent token.** Batch A's defining high-risk characteristic for this handler remains open. (Section 5)
2. **MEDIUM — rollback has no expected-current-value check.** Silently overwrites intervening changes to the same address. Not an authorization bypass, but a real data-integrity gap. (Section 2)
3. **MEDIUM — rollback ledger has no expiration**, only a 50-entry FIFO cap with silent, indistinguishable eviction. (Sections 2, 3)
4. **MEDIUM — freeze does not survive-check against renderer reload/navigation**; a reload leaves an active freeze running with no UI reference to it. (Section 4)
5. **MEDIUM — freeze concurrency is enforced only per session-instance**, not per-target-process or globally; two Solith windows (main + overlay, confirmed to share the same preload/API surface) can each independently freeze the same process. (Section 4)
6. **LOW-MEDIUM — registry-verification's `userSelectedProcess` is a renderer self-attestation**, not server-verified state; closes a concrete prior defect (hardcoded bypass) but does not constitute real authorization. (Section 6a)
7. **LOW-MEDIUM — no handler in the entire codebase (146 others, plus these 3) does BrowserWindow/frame/origin sender validation** beyond liveness + session-ownership-by-id. Systemic, not specific to Batch B1, but real. (Section 6b)
8. **LOW — freeze's max-duration/interval bounds and the rollback ledger's 50-entry cap are arbitrary judgment calls**, not derived from documented policy. (Sections 3, 4)
9. **LOW — no feature-flag re-check during an active freeze's tick loop**; disabling `v2LiveModeEnabled` mid-freeze does not stop it. (Section 4, newly identified this pass)

None of these 9 items were fixed in this pass, per its verification-only scope. All are documented with enough specificity to be picked up as concrete Batch B2 items if the user authorizes further work.

---

## 9. Batch A history preservation

`Docs/Security/Evidence/BatchA/ipc-channel-reconciliation.csv` has been **reverted to byte-identical content** with its state immediately before this Batch B1 work began (verified via `diff` against a backup taken at the start of the original edit — zero differences after revert). The in-place edit made earlier in this batch (which rewrote the Status/Verified-safe/Batch-B-priority columns for 3 rows) was a mistake per the critique and has been undone.

In its place: `Docs/Security/Evidence/BatchB1/batcha-disposition-updates.csv` — a **separate** file containing, for exactly the 3 affected rows (handler #24 `live-memory-rollback`, #25 `live-memory-freeze-start`, #95 `registry-run-readonly-verification`): the Batch A original values verbatim (unchanged), plus new Batch-B1-only disposition columns. Batch A's own evidence file is now immutable again; the disposition lives alongside it, not inside it.
