# Independent hostile re-audit — HEAD `08fffd8`

**Date:** 2026-07-25  
**Scope:** Verify Phase 1–3 repairs and Phase 4 hygiene by reading **implementation + assertions**, not repair narratives.  
**Auditor stance:** Adversarial. Prefer residual risk over congratulation.  
**Commit:** `08fffd8be383017d4d615a5eef44ee3fd32715b2`  
**Working tree:** clean  

## Verdict

| Gate | Re-audit result |
|------|-----------------|
| Phase 1 — Data integrity | **Provisionally accepted** (minor residual durability caveats) |
| Phase 2 — Security repairs | **Provisionally accepted with residual findings** |
| Phase 3 — Injector destructive boundary | **Provisionally accepted with residual findings** |
| Phase 4 — Hygiene / certification chain | **Accepted as closed** (docs-only HEAD delta does not reopen runtime cert) |
| **Release** | **DENIED** |

Phases 1–3 remain **provisionally** closed: core claimed defects are fixed in code and covered by tests that exercise the real gate logic, but several residual issues prevent unconditional release clearance.

Critical suites re-executed under Node 22.23.1 for this re-audit: injector boundary, safety-honest-gates, write-policy, dependency overrides, version consistency — **37/37 pass**.

---

## Phase 1 — Data integrity

### Claim: sql.js persists atomically (temp + rename)

| Field | Assessment |
|-------|------------|
| Status | **VERIFIED** |
| Evidence | `atomicWriteFileSync` in `src/core/database/index.ts` (temp sibling → `renameSync`); `exportAndPersistToDisk` is the sole disk persist path and calls it |
| Tests | `tests/safety-honest-gates.test.ts` proves replace + no leftover `.tmp` |
| Residual | No `fsync` before rename (power-loss durability still OS-dependent). Crash between write and rename leaves orphan `.tmp`, not a truncated live DB — acceptable for the stated defect |

### Claim: snapshot listener failures are not silently swallowed

| Field | Assessment |
|-------|------------|
| Status | **VERIFIED** |
| Evidence | `MemoryManager.emitSnapshot` catches, audits `snapshot_listener_failed:…`, returns `{ ok:false, error }`; confirm/safeWrite surfaces `snapshotError` |
| Residual | Audit entry uses `waiverAssumedForAudit(true)` inside the failure path even when the call may not have been approved — honesty of that flag on abort is **WEAK**, not a silent-success bug |

---

## Phase 2 — Security repairs

### Claim: write-policy defaults are fail-closed

| Field | Assessment |
|-------|------------|
| Status | **VERIFIED** |
| Evidence | `defaultTrainerWritePolicyContext` / `researchProbeWritePolicyContext` set `singlePlayerWaiverAccepted: false`, `userApproved: false`; gate denies both |
| Tests | `tests/live-memory/write-policy.test.ts`, `write-policy-gate.test.ts` assert deny-by-default |

### Claim: MemoryManager does not fail-open writes

| Field | Assessment |
|-------|------------|
| Status | **VERIFIED** for library defaults; **WEAK** at IPC boundary |
| Evidence | `proposeWrite` / `confirmWrite` require `options.userApproved === true`; waiver pulled from `session.isOfflineConfirmed()` |
| Residual | **RES-SEC-001:** `electron/live-memory-ipc.ts` hardcodes `{ userApproved: true }` on `live-memory-propose-write` and `live-memory-confirm-write`. Any successful IPC invoke is treated as explicit approval. There is no consent token / second factor in the payload. Under contextIsolation this is a product design choice, **not** the old fail-open default — but it means “approval” is not independently evidenced beyond “renderer called the channel.” |

### Claim: AI connection test no longer always succeeds

| Field | Assessment |
|-------|------------|
| Status | **VERIFIED** (no longer fake-success) |
| Evidence | `testAIConnection` probes `/api/tags` or `/v1/models`; empty/unreachable/non-http fail closed |
| Tests | empty + unreachable cases in `safety-honest-gates.test.ts` |
| Residual | **RES-SEC-002:** HTTP 200 with arbitrary body still counts as success (no schema check). Acceptable for local connectivity UX; not a cryptographic integrity check |

---

## Phase 3 — Injector destructive boundary

Implementation reviewed: `injector-launcher.ts`, `guards.ts`, `charter.ts`, IPC wiring in `live-memory-ipc.ts`, suite `tests/injector-destructive-boundary.test.ts` (14 cases).

| # | Claim | Status | Notes |
|---|-------|--------|-------|
| 1 | Mutable proposal identity | **VERIFIED** | `cloneProposal` on store + return; mutation test proves confirm uses stored path |
| 2 | PID binding propose+confirm | **VERIFIED** (IPC) / **WEAK** (OS) | Propose/confirm require matching PID; IPC supplies `session.getAttachedPid()` not renderer PID. **RES-SEC-003:** confirm does not re-call `verifyAttachedProcessIdentity()` — PID reuse TOCTOU remains |
| 3 | Live online-state on confirm | **VERIFIED** | `evaluateOnlineGuard` + IPC `observeAttachedRemoteConnections()`; online-count test asserts deny |
| 4 | Expiry / TTL | **VERIFIED** | 10 min TTL; expired proposal test; consumed on expiry deny |
| 5 | Replay after success | **VERIFIED** | delete on successful spawn; replay → unknown proposal |
| 6 | Failed-spawn retry | **VERIFIED** | spawn failure leaves proposal; denial audited |
| 7 | Denial/success auditing | **VERIFIED** (in-process) | `getInjectorLaunchAudit`; **WEAK** durability — memory-only, capped at 200, lost on restart (**RES-SEC-004**) |
| 8 | Executable allowlisting | **VERIFIED** for *attached game* | Pilot list `CrimsonDesert.exe` only. Helper path is any non-system `.exe` (**RES-SEC-005** — intentional research helper model, still high blast radius) |
| 9 | System-directory rejection | **VERIFIED** code / **WEAK** test | Classifier real; test soft-passes if `notepad.exe` missing (`assert.ok(true); return`) — **RES-TEST-001** |
| 10 | Path/hash integrity | **VERIFIED** | re-hash on confirm; tamper test |
| 11 | Waiver + explicit approval | **VERIFIED** | gate checks both; IPC ANDs session offline + propose checkbox; confirm uses session offline + payload approval |
| 12 | IPC evidence structure | **VERIFIED** vs prior weakness | Session-derived attach identity + live remote observe; not renderer-supplied PID/exe |

### What the “14/14” tests actually prove

- They prove **gate logic** with `setInjectorSpawnForTests` (mock spawn).
- They do **not** prove a real OS process was created, nor end-to-end Electron IPC integration.
- That is sufficient for a unit destructive-boundary gate; it is **not** a substitute for packaged/IPC E2E of injector launch (**RES-TEST-002**).

---

## Phase 4 — Hygiene claims (spot check)

| Claim | Status |
|-------|--------|
| Version SoT `2.4.0-alpha.2` + consistency test | **VERIFIED** |
| Node 22 engines / `.nvmrc` / check-node / CI `node-version-file` | **VERIFIED** |
| `postcss`/`brace-expansion` overrides + audit-zero test | **VERIFIED** |
| ResourceForge active-tree purge | **VERIFIED** (prior search; no regression re-litigated here) |
| Wisp finished without expansion | **ACCEPTED** (coherent wiring present; out of scope to expand) |
| Clean-clone chain `6a8967f` full + `5d06c25` option-2; `08fffd8` docs-only | **ACCEPTED** — docs-only HEAD does not invalidate runtime cert |

---

## Residual findings (must not be waved as “closed”)

| ID | Severity | Summary | Blocks release? |
|----|----------|---------|-----------------|
| RES-SEC-001 | Medium | Memory write IPC hardcodes `userApproved: true` | Yes, until product decides IPC≡consent is acceptable and documents threat model |
| RES-SEC-002 | Low | AI probe accepts any HTTP 200 | No |
| RES-SEC-003 | Medium | Injector confirm lacks live OS re-verify of attached exe identity (PID reuse) | Yes for unconditional injector clearance |
| RES-SEC-004 | Low–Med | Injector audit is ephemeral RAM only | No for alpha; yes if “auditability” is release-grade claim |
| RES-SEC-005 | Medium | Any non-system `.exe` can be spawned once Crimson Desert is attached | Yes unless research-helper threat model is explicit in release notes |
| RES-TEST-001 | Low | System-dir test can no-op if notepad absent | No (fix test) |
| RES-TEST-002 | Medium | Phase 3 suite never spawns a real process / never hits IPC | Yes if release claims “E2E destructive proof” |

---

## Decision

| Item | Status |
|------|--------|
| Independent hostile re-audit | **Completed** against `08fffd8` |
| Phase 1–3 provisional closure | **Maintained** (repairs real; residuals documented) |
| Phase 4 | **Closed** (unchanged) |
| Release | **DENIED** |

### Recommended next work (not started)

1. Decide and document IPC≡approval threat model **or** require an explicit consent artifact on write IPC.  
2. Re-verify attached process executable name/PID liveness on injector confirm.  
3. Persist injector audit to disk (or stop claiming durable auditability).  
4. Harden system-dir test; add IPC-level injector boundary test if release needs E2E proof.  
5. Explicitly bound helper-exe allow policy in charter/release notes.
