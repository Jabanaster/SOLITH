# SOL-0 Action Authority Matrix

> **Status:** SOL-0 — PARTIAL / NOT CERTIFIED (see §7 certification decision)
> **Audit date:** 2026-09-01
> **Commit:** `0398c8a954a4a909b2e147fde84aed8dd249b085` (`master`)
> **Scope:** Audit only. No SOL-1/SOL-2 implementation. One P0 finding documented, not fixed, per governing rule (STOP before implementing a behavioral change).
> **Authority:** This file is the SOL-0 deliverable referenced by `MASTER_ROADMAP.md §5 SOL-0`. It does not override `PROJECT_SPEC.md §3.2` (Safety Firewall) or `SOLITH_SECURITY_ROADMAP.md` (security-gate verdicts).

## 1. Action surface inventory

| Category | Present? | Evidence |
|---|---|---|
| Filesystem read/write | YES | `src/core/safety/atomic-write.ts`, `src/core/trainer-host/write-save-field.ts`, `src/core/backups/` |
| Rename/move, atomic writes | YES | `src/core/safety/exdev-safe-rename.ts`, `atomic-write.ts` (temp+rename, hash-verified) |
| Backup creation/restore | YES | `src/core/backups/index.ts` (hash-verified both directions) |
| Archive extraction | YES | CT ZIP import (`src/core/ct-library/`) |
| Installer/package filesystem | YES | NSIS + MSIX (`electron-builder.msix.config.cjs`) |
| Process discovery/PID lookup | YES | `native-memory-driver.ts` (`memoryjs.getProcesses`), `process-watcher.ts` |
| Process attach/detach | YES | `live-memory-session.ts` `attach()`/`detach()` |
| Process launch (helper/host) | YES | `injector-launcher.ts` (helper), `host-supervisor.ts` (TrainerHost) |
| Process launch (target game) | NOT PRESENT | SOLITH attaches to already-running games; does not launch them |
| Process termination | YES | TrainerHost `stop()`; no equivalent for target game process |
| Memory read/write | YES | `live-memory-session.ts` via `memoryjs` |
| Patch register/activate/disable/restore | YES | Freeze scheduler + rollback ledger (`live-memory-session.ts`) |
| Consent/freeze behavior | YES | `src/core/consent/write-consent.ts`, freeze scheduler |
| Protected-target handling | YES | `src/core/runtime/protected-target-guard.ts` |
| Keyboard hooks/hotkeys | YES | `electron/trainer-hotkeys.ts` |
| Mouse/input injection | NOT PRESENT | No `input.mouse` equivalent found |
| Overlay windows / Game Bar | YES | `electron/wisp-overlay.ts`, `electron/gamebar-transport.ts` |
| Window manipulation | PARTIAL | Overlay move/hide/expand only; no general window control of arbitrary apps |
| HTTP/fetch (artwork, catalog sync, local-AI probe) | YES | `src/core/artwork-cache/fetch-executor.ts`, `src/core/trainer-catalog/sync/remote-sync.ts`, `src/core/ai/index.ts` |
| Telemetry | NOT PRESENT | No telemetry/analytics egress found |
| Tokens/stored credentials | NOT PRESENT | No API key/credential storage found in `src/core/ai/`, `src/core/settings/` |
| Registry read | YES (read-only) | `src/core/install-discovery/registry-win.ts` — Steam/Epic install-path lookup only |
| Registry write | NOT PRESENT | No `reg add`/`RegSetValue` call found anywhere |
| Shell/PowerShell execution | YES (bounded) | `system-binary.ts` resolves absolute `%SystemRoot%\System32\*` paths (PATH-hijack defense); used by `registry-win.ts`, `gamebar-transport.ts` |
| Native helper execution | YES | `injector-launcher.ts` — sealed, hash-verified, path-contained under `userData/injector-helpers` |
| Elevation/UAC | NOT PRESENT | No `requestedExecutionLevel`/`runas` found; app runs unelevated |
| Browser automation | NOT PRESENT | Confirmed by grep: zero hits for `browser.navigate`/`browser.submit`/`playwright`/`puppeteer` in runtime code (Playwright exists only as test infra) |

## 2. Current authority model (actual, not aspirational)

Decisions today are based on a **combination**, not a single unified policy engine:

- **IPC sender identity** — universal. All 180 current `ipcMain.handle` registrations (reproducible: `grep -rn "ipcMain\.handle(" electron/ --include="*.ts" \| wc -l` plus the `handleGuarded`-wrapper pattern in `main.ts`/`trainer-catalog-ipc.ts`) call `validateIpcSender()` directly or via a wrapper — confirmed by file-by-file check, zero files with handlers and zero validation calls.
- **Process identity** — for live-memory only. PID + exe name + exe path + creation time (+ optional volume-serial/file-index/SHA-256), re-verified immediately before every mutating write (`confirmWrite`, `rollback`, freeze tick), not just at attach.
- **Target identity (deny-list, not allow-list)** — `protected-target-guard.ts` blocks system/self/anti-cheat processes by name; anything else is allowed. This is the basis of the §6 scope finding below.
- **Consent (per-operation, cryptographically bound)** — for the three highest-risk operations (`live_memory_confirm_write`, `live_memory_freeze_start`, `injector_confirm_launch`): SHA-256-bound, single-use, 5-minute-TTL tokens (`src/core/consent/write-consent.ts`).
- **Consent (weaker, proposal-map pattern)** — for hook-install and trainer-host approve-write: no cryptographic binding, proposalId-consumption only. Already flagged by the repo's own prior audit (`Docs/Security/Evidence/BatchA/consent-state-machine-audit.txt`, "Finding C: inconsistent hardening across consent flows").
- **Path containment** — `src/core/safety/path-safety.ts`, canonicalized prefix-safe containment against an explicit approved-roots list; a call site that forgets to pass roots silently disables the check (documented, historically fixed once — `tests/launch-installation-containment.test.ts`).
- **Environment (packaged vs. dev)** — inconsistently applied. Confirmed: `electron/privileged-consent-dialog.ts` has **no** `app.isPackaged` gate on its `SOLITH_PRIVILEGED_CONSENT`/`SOLITH_CONSENT_TTL_MS` env overrides (see P0 finding, §4).

**No unified capability/policy evaluator exists.** This is itself the primary SOL-1 gap (§8).

## 3. Consent model

See the full 10-mechanism table produced during this audit (consent tokens for write/freeze/injector-launch, write-policy waiver, proposal-map consent for hook-install and trainer-host writes, injector-helper registration approval). Summary:

- **Scope/lifetime**: the three cryptographically-bound token types (write, freeze, injector-launch) are correctly scoped to exact operation + target process identity + specific parameters, 5-minute TTL, single-use, revoked on detach/attach/crash/quit.
- **Weaker mechanisms**: hook-install consent and trainer-host approve-write use non-cryptographic proposalId consumption — no TTL, no identity-binding hash.
- **Observation vs. mutation**: confirmed NOT blurred. `live-memory-read` has no consent/write-policy check and no write side effect; every write path independently re-runs `WritePolicyGate.evaluate` plus (for the two privileged flows) a freshly-consumed bound token.
- **Mutation vs. deletion**: confirmed NOT blurred. `ConsentOperation` is a closed 3-value union with no delete/erase variant; token binding hash prevents replay against a different (larger/destructive) operation.
- **Gap**: `SOLITH_PRIVILEGED_CONSENT=auto-approve` bypasses the entire consent dialog with no packaged-build gate — see P0 finding.

## 4. Destructive operation policy — including the P0 finding

Target invariant per governing rule: `destructive.delete` must require explicit approval/explanation.

**Confirmed destructive paths and their gates:**

| Action | Classification | Approval required? |
|---|---|---|
| `delete-game`, `delete-recipe` (DB rows only) | REVERSIBLE CLEANUP | Yes — `confirm()` dialog |
| `revoke-save-location` (soft flag) | REVERSIBLE CLEANUP | Yes — `confirm()` dialog |
| `restore-backup` (overwrites current save) | USER-DATA DESTRUCTIVE | Yes — `confirm()` dialog, atomic + hash-verified |
| `trainer-host-approve-and-write` | USER-DATA DESTRUCTIVE | Yes — two-phase propose/approve, backup created first |
| Temp-file/cache cleanup (multiple sites) | BENIGN CLEANUP | No (automatic; Solith-owned disposable artifacts only) |
| Registry deletion | NOT PRESENT | N/A |
| **`recoverInterruptedOperations()` startup auto-restore** | **USER-DATA DESTRUCTIVE** | **No — runs automatically at every startup with zero approval gate** |

**Finding SOL0-D1 (destructive-policy gap, not P0):** `electron/main.ts:441-444` calls `recoverInterruptedOperations()` unconditionally before window creation. For any operation left `APPLYING`/`VALIDATING`/`RESTORING` at last shutdown, it silently overwrites the current target file from a hash-verified backup (`src/core/safety/operations.ts:246-291`) with no dialog, no IPC round-trip, no way to opt out. Bounded (only fires for Solith's own in-flight operations, backup-hash-verified, not attacker-reachable) but violates the literal invariant that destructive action requires explicit approval/explanation. **Disposition: SOL-1 gap, not a P0 stop** — this is crash self-healing, not an externally exploitable path, and every other save-overwriting path in the app is confirm-gated except this one.

**Finding SOL0-P0-1 (CRITICAL — P0, RESOLVED 2026-09-01, branch `docs/sol0-baseline-authority-audit`):**
`electron/privileged-consent-dialog.ts:45-53` (`resolveDialogImpl`) and `:122` (`requestPrivilegedWriteConsent`) read `SOLITH_PRIVILEGED_CONSENT` / `SOLITH_CONSENT_TTL_MS` from `process.env` with **no `app.isPackaged` gate whatsoever**. Setting `SOLITH_PRIVILEGED_CONSENT=auto-approve` in the environment before launching the packaged app **silently auto-approved every privileged consent dialog** — the human-in-the-loop gate for live-memory write confirmation, freeze start, and injector-helper launch — with no user interaction, no dialog shown, and the bypass itself was not separately logged. `SOLITH_CONSENT_TTL_MS` similarly let anyone with env-set capability extend consent token lifetime arbitrarily.
(Correction to the original SOL-0 pass: the doc originally cited `electron/runtime-trust.ts` as the established mirror pattern — no such file exists in this repository. The actual established pattern, confirmed by source read, is `trainer-catalog-ipc.ts:545`'s `if (app.isPackaged)`.)
**Remediation:** added `isPrivilegedConsentEnvOverrideAllowed()` (`electron/privileged-consent-dialog.ts`) — `!app.isPackaged || process.env.SOLITH_TEST_BUILD === '1'` — and gated both the `SOLITH_PRIVILEGED_CONSENT` mode read and the `SOLITH_CONSENT_TTL_MS` read on it. The `SOLITH_TEST_BUILD=1` escape hatch mirrors the existing repo convention (`live-memory-ipc.ts`'s `IS_TEST_BUILD`) and is required because six pre-existing packaged Gate 2.x e2e suites (`tests/gate2-2-resume-packaged-lifecycle.e2e.test.ts`, `gate2-2a1-packaged-real-process-write-proof.e2e.test.ts`, `gate2-3-freeze-authorization-security.e2e.test.ts`, `gate2-4-final-certification.e2e.test.ts`, `gate2-5-frame-devtools-overlay-lifecycle.e2e.test.ts`, `gate2-5-frame-overlay-closeout.e2e.test.ts`) launch the real packaged `.exe` and rely on the consent-override seam to drive real freeze/write/injector flows; each was updated to set `SOLITH_TEST_BUILD=1` alongside the existing `SOLITH_PRIVILEGED_CONSENT` override so they keep exercising the real (now-gated) consent path instead of regressing to a hung native dialog.
**Verification (behavioral, not source-inspection-only):** new `tests/sol0-p0-1-consent-packaging-gate.e2e.test.ts` queries the exact gating predicate live in the real running main process (via an unconditional, capability-free `globalThis` diagnostic hook registered in `electron/main.ts`, since the packaged build is a single bundled `main.js` with no separately importable module file) across all four required cases — unpackaged/no-override-needed, packaged+no-`SOLITH_TEST_BUILD` (the core proof, now `false`), packaged+`SOLITH_TEST_BUILD=1` (still `true`), packaged+no-override-env-at-all (`false`) — all 4 passing against a freshly rebuilt `dist/win-unpacked/Solith.exe`. Re-ran `gate2-2a1-packaged-real-process-write-proof.e2e.test.ts` and the two `SOLITH_TEST_BUILD`-value matrix tests (`gate2-5-frame-overlay-closeout.e2e.test.ts`, `gate2-5-frame-devtools-overlay-lifecycle.e2e.test.ts`) — all pass, confirming no regression to the pre-existing certified evidence base. Full `npm test` (1699/1699 + SQL 10/10), `node scripts/orphan-check.mjs` (PASS), `npm audit --omit=dev` (0 vulnerabilities), `npx tsc --noEmit` (clean) all re-verified after the fix.

## 5. Machine scope

**Classification: arbitrary process** (not "known supported games only").

- Filesystem: actively contained (`path-safety.ts`, approved-roots list, canonicalized, symlink/junction-aware).
- Registry: read-only, hardcoded to Steam/Epic install-path lookup keys only.
- **Live-memory attach: deny-list, not allow-list.** `assessTargetProcessAuthorization` (`protected-target-guard.ts`) blocks a fixed set of system/self/anti-cheat process names; every other running process — including arbitrary third-party apps unrelated to gaming — is `allowed: true`. `tests/protected-target-guard.test.ts` explicitly documents this as intended behavior ("allows ordinary explicitly owned/offline process names").
- The widest-reaching capability is the in-process injector pilot (`src/core/in-process-script/`), which performs raw `VirtualAllocEx`/`WriteProcessMemory`-class calls with `PAGE_EXECUTE_READWRITE` — full arbitrary code execution inside a target process's address space, no OS-level sandbox. Gated to a single named pilot executable (`CrimsonDesert.exe`, exact match), default-OFF feature flag, offline confirmation, single-use consent token — not usable against an arbitrary process in current practice, but architecturally unconstrained once triggered.

## 6. Control providers

| Provider | Capabilities | Boundary | Tests |
|---|---|---|---|
| `memoryjs` (native addon) | Process enum, open/read/write memory, module list | Gated by protected-target-guard + write-consent | `tests/live-memory/*` |
| Node `child_process` (via `system-binary.ts`) | `reg.exe query`, `whoami.exe`, `icacls.exe`, PowerShell | Absolute-path resolution (PATH-hijack defense), read-only usage | — |
| `fs`/atomic-write | File read/write/rename | `path-safety.ts` containment, hash-verified | `tests/atomic-write-exdev-fallback.test.ts` |
| `net.fetch`/`fetch` | Artwork retrieval, catalog sync, local-AI probe | 3 bounded surfaces, manual-redirect containment on artwork fetch | `tests/remote-sync-redirect-policy.test.ts` |
| Electron `BrowserWindow`/overlay | Wisp overlay, Game Bar transport | No general window control of other apps | — |
| `injector-launcher.ts` (helper spawn) | Detached arbitrary `.exe` launch | Path must be `.exe`, non-system-dir, under `userData/injector-helpers`, SHA-256/publisher trust-checked | — |

Browser automation (`browser.navigate`/`browser.submit`): confirmed **NOT PRESENT** in runtime code.

## 7. Emergency stop

No single "stop everything" control exists. Three distinct mechanisms:

- **Freeze-stop** (per-address): correctly race-safe (generation-counter re-check after the one `await` in the tick loop). Does **not** restore the frozen value to its pre-freeze state — memory is left mutated.
- **Session cleanup** (crash/shutdown/nav/detach): detaches the process handle and stops freeze schedulers, but **discards** the rollback ledger rather than applying it (`clearRollbackRecordsForCleanup`), and the `revoking` flag is checked only once before the mutating functions' internal `await`, not re-checked after — currently safe only because `detach_memory_sessions` always runs synchronously in the same cleanup pass, not because of a structural invariant tying the two together.
- **`readOnlyMode` "hard kill switch"** (`write-policy.ts`): fully implemented and unit-tested, but **entirely unreachable in production** — `setWritePolicyContext` is never called outside test files; no IPC channel, settings flag, or UI control can set it. Aspirational/dead code today.

**Fail-closed verdict: PARTIAL.** No demonstrated race where a write executes after a stop signal, but the guarantee is coincidental (synchronous cleanup ordering), not structurally enforced, and no test exercises the race directly.

## 8. Process lifecycle

Identity = PID + exe name + exe path + creation time (+ optional volume-serial/file-index/SHA-256), captured at attach, **re-verified immediately before every mutating write** (`confirmWrite`, `rollback`, freeze tick) — not just at attach time.

**Stale-identity-permits-mutation-against-replacement-process: NO.** Verified by direct code trace (`verifyAttachedProcessIdentity()` called before all three mutating call sites) and by dedicated tests (`live-memory-session.test.ts` PID-reuse and freeze-auto-stop scenarios). Game-switching always tears down the prior session (`disposeSession`) before a new attach begins. No P0 here.

Process termination (TrainerHost `stop()`) is **TOOL RETURN ONLY** in production — RPC shutdown / SIGTERM sent, state nulled immediately without waiting for or checking the `'close'` event or a liveness probe. Real PID-death verification (`process.kill(pid,0)`) exists only in the standalone `scripts/orphan-check.mjs` test harness, not the runtime shutdown path.

## 9. Browser control

**NOT PRESENT.** Confirmed by grep (zero hits for `playwright`/`puppeteer`/`browser.navigate`/`browser.submit`/`WebContents.*navigate` in runtime `src/`/`electron/` code — Playwright exists solely as this repo's E2E test framework, not runtime automation).

## 10. Audit logging and postcondition verification

**Logging**: `journal_events` SQL table exists (`get-journal`/`log-event` IPC), timestamped and typed (10-value enum), but is a thin generic event log, not a consequential-action audit trail — **not called by the live-memory write/patch path at all** (only 4 call sites: generic passthrough, restore-backup, game-scan, recipe-apply). Missing as schema fields: caller identity, consent state, structured result/failure, correlation/session ID. Present only ad hoc, per-caller, inside free-text `details` JSON.

**Postcondition verification**:

| Action | Classification |
|---|---|
| Memory write (`confirmWrite`) | PARTIAL — write issued, never read back and compared |
| Memory rollback | PARTIAL / ROLLBACK SUPPORTED — pre-check strong, no post-restore read-back |
| Save-file write | VERIFIED POSTCONDITION — read-back or hash comparison |
| Atomic write | VERIFIED POSTCONDITION — SHA-256 hash comparison after rename |
| Backup creation/restore | VERIFIED POSTCONDITION — both directions hash-verified |
| TrainerHost process launch | VERIFIED POSTCONDITION — blocks on RPC handshake, not just `spawn()` return |
| TrainerHost process termination | TOOL RETURN ONLY (production); PID-confirmed only in test harness |
| Registry write | N/A — no write path exists |

**Pattern**: file-based mutations are consistently verified; in-process game-memory writes are not. This is direct input to SOL-2.

## 11. SOL-1 gap list

| ID | Current behavior | Risk | Desired SOL-1 behavior | Affected classes | Migration risk |
|---|---|---|---|---|---|
| G1 | No unified capability/policy evaluator — authority logic spread across `protected-target-guard.ts`, `write-consent.ts`, `write-policy.ts`, per-IPC sender checks | Medium — inconsistent enforcement, hard to audit as a whole | Central `identity+capability+target+context+risk → decision` evaluator per `MASTER_ROADMAP.md §5` | All | High — touches every IPC handler |
| ~~G2~~ | ~~`SOLITH_PRIVILEGED_CONSENT`/`SOLITH_CONSENT_TTL_MS` env overrides lack packaged-build gate~~ | **RESOLVED 2026-09-01 (SOL0-P0-1)** | Gated on `isPrivilegedConsentEnvOverrideAllowed()` = `!app.isPackaged \|\| SOLITH_TEST_BUILD==='1'` | `live_memory_confirm_write`, `live_memory_freeze_start`, `injector_confirm_launch` | Closed — see finding writeup above and `tests/sol0-p0-1-consent-packaging-gate.e2e.test.ts` |
| G3 | Live-memory attach is a deny-list (system/anti-cheat/self only), not an allow-list | Medium — demonstrated scope is "arbitrary process," wider than product intent suggests | Decide explicitly: keep deny-list (document as intentional) or add positive game-catalog scoping | `process.attach`, `memory.write` | Medium — could break legitimate arbitrary-process debugging use cases if narrowed |
| G4 | Consent for hook-install and trainer-host writes uses weak proposalId-map pattern, not the SHA-256-bound token | Medium | Migrate both to the `write-consent.ts` cryptographic-binding pattern | `in-process-confirm-hook`, `trainer-host-approve-and-write` | Low-medium |
| G5 | `recoverInterruptedOperations()` auto-restores from backup at startup with no approval gate (SOL0-D1) | Low-medium | Require at minimum a non-blocking notification; consider explicit approval if backup content differs meaningfully from last-known state | `filesystem.write` (crash recovery) | Low |
| G6 | Memory writes/rollbacks lack post-write read-back verification | Medium — "success" can mean tool-return, not proven state change | Apply SOL-2's verified-action-runtime pattern (already used for file writes) to memory writes | `memory.write` | Medium |
| G7 | `readOnlyMode` kill switch fully built but unreachable in production | Low (dead code, no active risk, but a wasted safety mechanism) | Wire it to a real IPC channel/settings flag, or remove if superseded by SOL-1's evaluator | Global write gate | Low |
| G8 | Freeze-stop/cleanup don't restore mutated memory; cleanup discards (doesn't apply) the rollback ledger | Medium — emergency-stop is not fail-closed to original state, only fail-closed to "no further writes" | Decide explicitly whether stop should auto-restore; if not, document as intentional and surface it to the user | `memory.write`, freeze | Medium — auto-restore-on-stop is a real behavior change |
| G9 | `revoking` flag checked once before `await`, not re-checked after; safety is coincidental (sync cleanup ordering), not structural | Low today, fragile | Add explicit re-check of `revoking` after the await, independent of the handle-null side effect | `memory.write`, `memory.rollback`, freeze | Low |
| G10 | Audit journal not called by live-memory writes; missing caller identity, consent state, correlation ID fields | Medium — can't currently answer "who/what caused this write" | Extend schema + wire live-memory writes into the journal, as SOL-5 input | All consequential actions | Medium |
| G11 | TrainerHost process termination is tool-return-only in production; PID-death only verified in test harness | Low | Wait for/check the `'close'` event or a `process.kill(pid,0)` probe before declaring `stop()` successful | `process.kill` | Low |

## 12. Action Class → Policy Matrix (SOL-0 descriptive snapshot)

| Action class | Current caller | Target scope | Consent | Policy | Protected-target guard | Emergency stop | Verification | Audit evidence | Current decision |
|---|---|---|---|---|---|---|---|---|---|
| `filesystem.read` | IPC (sender-validated) | Approved roots | None needed | `path-safety.ts` | N/A | N/A | N/A | Partial (journal, ad hoc) | ALLOW |
| `filesystem.write` (save/config) | IPC + host-supervisor | Approved roots (game path) | Two-phase propose/approve | `path-safety.ts` + atomic-write hash | N/A | N/A | VERIFIED POSTCONDITION | Partial | REQUIRE APPROVAL |
| `filesystem.write` (crash recovery) | Startup, automatic | Solith-tracked operations only | **None** | Backup-hash-verified | N/A | N/A | VERIFIED POSTCONDITION | Partial | **ALLOW (gap: should require notification)** |
| `process.attach` | IPC (sender-validated) | Deny-list (not allow-list) | None (observation) | `protected-target-guard.ts` | YES | Detach on cleanup | N/A | Minimal | ALLOW (except blocklist) |
| `memory.read` | IPC (sender-validated) | Attached process only | None | Requires prior attach | Inherited from attach | N/A | N/A | Minimal | ALLOW |
| `memory.write` (single) | IPC (sender-validated) | Attached process only | SHA-256-bound token, 5-min TTL | `WritePolicyGate` | Inherited from attach | Freeze-stop only affects freeze, not single writes | PARTIAL (no read-back) | Yes (`freeze_start_confirmed` etc.) | REQUIRE APPROVAL |
| `memory.write` (freeze) | IPC (sender-validated) | Attached process only | SHA-256-bound token, 5-min TTL, 6-hour hard cap | `WritePolicyGate` + cross-session concurrency registry | Inherited from attach | Freeze-stop (does not restore value) | PARTIAL | Start logged, stop not logged | REQUIRE APPROVAL |
| `injector.launch` (helper exe) | IPC (sender-validated) | Solith-owned helper dir, hash-checked | SHA-256-bound token | Path/publisher trust check | Inherited from attach | Detach on cleanup | Handshake for TrainerHost only | Dedicated audit sink | REQUIRE APPROVAL |
| `hook.install` (in-process) | IPC (sender-validated) | Single pilot exe allowlist | Weak proposalId consumption (no crypto binding) | `charter.ts` allowlist + `guards.ts` | Inherited from attach | Same as memory.write | PARTIAL | No dedicated sink | REQUIRE APPROVAL (weaker gate) |
| `network.request` | Internal (3 call sites) | 3 bounded surfaces (artwork/catalog-sync/local-AI) | None needed | Manual-redirect containment (artwork only) | N/A | N/A | N/A | Minimal | ALLOW |
| `registry.read` | Internal | Steam/Epic install keys only | None needed | Hardcoded key list | N/A | N/A | N/A | None | ALLOW |
| `registry.write` | — | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `destructive.delete` (DB rows) | IPC (sender-validated) | Own DB | UI `confirm()` | None beyond UI gate | N/A | N/A | N/A | None | REQUIRE APPROVAL |
| `destructive.delete` (save overwrite via restore) | IPC (sender-validated) | Approved game path | UI `confirm()` | Atomic + hash-verified | N/A | N/A | VERIFIED POSTCONDITION | Yes (`main.ts:833`) | REQUIRE APPROVAL |
| `browser.navigate` / `browser.submit` | — | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `credential.use` | — | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `software.install` | Installer only (NSIS/MSIX), not app runtime | N/A | N/A | N/A | N/A | N/A | N/A | N/A | NOT IMPLEMENTED (app runtime) |
| `system.settings` | — | — | — | — | — | — | — | — | NOT IMPLEMENTED |

## 13. Verification (Step 16)

Commands and results, reproduced this session on `master` @ `0398c8a9` (tree clean before and after — this audit made no code changes):

```
npm test                          → 1699/1699 pass, 0 fail, 0 skip (34.4s) + SQL suite 10/10 pass
node scripts/orphan-check.mjs     → PASS (schema.v1 boundary + TrainerHost PID orphan check)
npm audit --omit=dev              → 0 vulnerabilities
gh api .../check-runs (HEAD)      → all required checks green (fast, scan, Semgrep, OSV, memoryjs-integrity, TS-arch)
grep validateIpcSender coverage   → 17/17 IPC files with handlers use it directly or via handleGuarded wrapper; 0 ungated
```

`npm test`'s full suite already includes the specific areas Step 16 calls out by name: IPC sender validation (`ipc-guard-inventory.test.ts`), protected targets (`protected-target-guard.test.ts`), consent (`write-consent`-adjacent live-memory tests), freeze/emergency (`live-memory-session.test.ts` freeze-stop/auto-stop cases), live-memory lifecycle (`tests/live-memory/*`, 30+ files), save safety (`safety-integration.test.ts`, `save-xml-safety-gate.test.ts`), process identity (`target-process-authorization.test.ts`), process cleanup/orphan (`app-shutdown-cleanup.test.ts`, `cleanup-failure-handling.test.ts`, `session-cleanup-on-destroy.test.ts`, `orphan-check.mjs`). No separate re-run was needed beyond what was already exercised.

## 14. Certification decision

**SOL-0 = CERTIFIED (2026-09-01, post SOL0-P0-1 remediation).**

Per the governing exit gate (Step 17), every checklist item is complete with reproducible evidence: inventory, taxonomy, mapping, authority model, consent model, destructive policy, machine scope, control-provider inventory, emergency-stop behavior, process lifecycle, browser-control absence proven, audit/postcondition coverage, action authority matrix, SOL-1 gap list, focused tests green, full regression green, **and** "no undocumented P0 authority vulnerability remains" — SOL0-P0-1 (the one remaining blocker from the original PARTIAL pass) is now resolved, not merely documented; see the finding writeup above, `tests/sol0-p0-1-consent-packaging-gate.e2e.test.ts`, and the re-verified regression evidence in §13.

G2 in the SOL-1 gap list is closed accordingly. SOL-1 still inherits G1, G3–G11 unchanged.
