# Residual Security Repair Follow-up (post `08fffd8` re-audit)

**Status:** Repairs implemented in working tree · **Release still DENIED** until hostile re-audit of a clean commit + packaged artifact.

## Residual → repair mapping

| Residual | Repair |
| --- | --- |
| RES-SEC-001 IPC `userApproved: true` | Short-lived single-use consent tokens (`src/core/consent/write-consent.ts`). IPC propose stages only; `live-memory-issue-write-consent` / `in-process-issue-injector-consent` issue tokens after UI confirm; confirm consumes token bound to operation/session/PID/exe/address/value. |
| RES-SEC-003 PID reuse | `verifyAttachedProcessIdentity()` now re-checks basename, executable path, and creation time (attach captures path/startTime; native driver queries live OS identity). Injector confirm requires `verifyLiveIdentity` callback. |
| RES-SEC-005 broad helper policy | Helpers must live under `{userData}/injector-helpers` (plus existing non-system `.exe` + hash checks). |
| RES-TEST-002 no IPC/process proof | `tests/injector-process-integration.test.ts` builds a dedicated fixture `.exe`, runs propose→consent→confirm→spawn→JSONL audit→cleanup, plus path-change denial and IPC schema consent requirements. |
| Ephemeral injector audit | `setInjectorAuditSink` appends to `userData/logs/injector-audit.jsonl` from Electron IPC. |
| Soft system-dir test | Deterministic classifier assertion via `isWindowsSystemExecutablePath`. |
| AI probe HTTP 200 | Ollama requires `models[]`; LM Studio requires `data[]`. |
| Snapshot `waiverAssumed` honesty | Already uses call-state `userApproved` on snapshot failure path. |

## Still required for release clearance

1. Hostile re-audit against a **clean commit** (not dirty WIP).
2. Packaged artifact smoke of the same commit.
3. Optional: full Electron renderer→attach→injector E2E against a live `CrimsonDesert.exe` pilot session (integration test covers the privileged core without requiring that game process).

## Release

**DENIED.**
