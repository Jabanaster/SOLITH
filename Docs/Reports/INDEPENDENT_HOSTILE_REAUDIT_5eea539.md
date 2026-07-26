# Independent hostile re-audit — HEAD `5eea539`

**Date:** 2026-07-25  
**Scope:** Verify residual security repairs claimed after `08fffd8` re-audit by reading **implementation + packaged artifact**, not repair narratives.  
**Auditor stance:** Adversarial. Prefer residual risk over congratulation.  
**Commit:** `5eea539399b479bde4178fe6f39da02e9bcc4c7f`  
**Message:** `fix: bind destructive writes and injector launch to consent artifacts`  
**Working tree at audit:** clean of security WIP (Wisp held in `stash@{0}`; not part of this commit)  
**Packaged artifact:** `dist/Solith Setup 2.4.0-alpha.2.exe`  
**SHA-256:** `A37B52D081E9B50772581BE97DE62CA395C4D74F7B087321387199B6CB18B5CA`  
**Packaged presence:** `app.asar` main/preload contain `issue-write-consent`, `issue-injector-consent`, `injector-helpers`, `injector-audit.jsonl`, `verifyAttachedProcessIdentity`

## Verdict

| Gate | Re-audit result |
|------|-----------------|
| Phase 1 — Data integrity | **Provisionally closed** (unchanged) |
| Phase 2 — Security | **Improved; residual blockers remain** |
| Phase 3 — Injector boundary | **Improved; residual blockers remain** |
| Phase 4 — Hygiene | **Closed** (unchanged) |
| **Release** | **DENIED** |

## Prior residual disposition

| ID | Status now | Notes |
|----|------------|-------|
| RES-SEC-001 | **FIXED (artifact)** / **PARTIAL (UX)** | Confirm requires consumed consent token + binding. Issue channel still renderer-triggered (`userConfirmed: true`) with no privileged modal. |
| RES-SEC-003 | **FIXED** with caveats | Confirm calls `verifyAttachedProcessIdentity` (name + path + creation time when available). Degrades if OS metadata missing. |
| RES-SEC-005 | **FIXED to helpers-root** / **PARTIAL** | Must live under `userData/injector-helpers`. Not a signed/SHA allowlist. |
| RES-SEC-004 | **FIXED** | JSONL sink `userData/logs/injector-audit.jsonl`. |
| RES-SEC-002 | **FIXED** | Ollama `models[]` / LM Studio `data[]` schema checks. |
| RES-TEST-001 | **FIXED** | Deterministic system-path classifier test. |
| RES-TEST-002 | **PARTIAL** | Real fixture process + schema proof; not full Electron renderer→ipcMain attach E2E. |

## New residuals

| ID | Severity | Summary | Blocks release? |
|----|----------|---------|-----------------|
| RES-SEC-006 | Medium | Consent issuance lacks privileged-side visible confirmation dialog | Yes for “independently proven consent” |
| RES-SEC-007 | Low–Med | Path/creation-time identity best-effort via PowerShell | Yes for unconditional PID-reuse claims |
| RES-SEC-008 | Medium | Any `.exe` dropped into `injector-helpers` remains launchable (hash-pinned) | Yes if claiming signed-only helpers |
| RES-TEST-003 | Medium | No Electron renderer→ipcMain consent-chain integration test | Yes if claiming full IPC E2E |

## Credibly repaired

- No IPC hardcoded `userApproved: true` on memory confirm.
- Short-lived single-use binding tokens.
- Live identity hook on injector confirm + helpers-root + hash.
- Durable injector JSONL audit.
- Dedicated fixture process integration proof.
- AI probe schema validation.
- Packaged installer from this commit embeds the new channels.

## Still blocks release

1. Privileged visible consent ceremony still missing.
2. Helper policy is directory-scoped, not signer/allowlist-scoped.
3. Full Electron IPC E2E against live pilot attach still absent.
4. Identity metadata can degrade to name-only.

## Verification record (pre-commit)

| Check | Result |
|-------|--------|
| `git diff --check` | Pass |
| `tsc --noEmit` | Pass |
| Security-focused suite | **66/66** |
| Full `npm test` | **921/921** (911 + 10) |
| Electron verifier | **29/29** |
| Electron smoke | **6/6** |
| Packaged asar channel scan | Pass |

## Decision

| Item | Status |
|------|--------|
| Hostile re-audit of `5eea539` + package | **Completed** |
| Residual repairs | **Real and substantial** |
| Release | **DENIED** |
