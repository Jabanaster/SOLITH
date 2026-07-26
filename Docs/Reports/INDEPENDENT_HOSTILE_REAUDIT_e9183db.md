# Independent hostile re-audit — HEAD `e9183db`

**Date:** 2026-07-26  
**Scope:** Verify residual trust-boundary repairs after `5eea539` by reading **implementation + packaged artifact**, not repair narratives.  
**Auditor stance:** Adversarial. Prefer residual risk over congratulation.  
**Commit:** `e9183dbc987c5635e3d640ac1136380a70b23e0b`  
**Message:** `fix: privileged consent dialog, sealed helpers, fail-closed identity`  
**Working tree at package:** clean of Wisp float WIP (held in stash; not part of this commit)  
**Packaged artifact:** `dist/Solith Setup 2.4.0-alpha.2.exe`  
**SHA-256:** `DB2B4C41AC58E729FB23474878BC913B2CD20DAD1CA24F9471E52D0D6FBD3B1A`  
**Packaged presence:** `app.asar` embeds `requestPrivilegedWriteConsent`, sealed-helper charter text, `injector-helpers` + manifest seal language, consent token binding.

## Verdict

| Gate | Re-audit result |
|------|-----------------|
| Privileged consent ceremony | **Materially fixed** (main-process dialog / test double) |
| Helper executable trust | **Improved; residual** (HMAC seal ≠ signed/publisher allowlist) |
| Live process identity | **Improved; residual** (fail-closed path+start; enrichment still OS-script) |
| Electron IPC E2E | **Fixed** (9 Playwright cases on production entry) |
| **Release** | **DENIED** |

## Prior residual disposition (`5eea539` → `e9183db`)

| ID | Status now | Notes |
|----|------------|-------|
| RES-SEC-006 | **FIXED** | Issue handlers call `requestPrivilegedWriteConsent` / `requestPrivilegedApproval` (`dialog.showMessageBox`). Renderer cannot assert approval into a token. Env/test doubles only for automation. |
| RES-SEC-007 | **IMPROVED / PARTIAL** | Attach + confirm require complete path + creation time (fail-closed). Volume serial / file index / exe hash compared when recorded at attach. Query no longer dies on `Get-Volume` hang; start-time handles CIM `DateTime`. Still PowerShell/`Get-CimInstance`, not a native Win32 identity handle. |
| RES-SEC-008 | **IMPROVED / PARTIAL** | Helpers must match sealed `manifest.json` + `manifest.seal` under `injector-helpers`. Registration requires privileged approval. Seal is HMAC with an **in-binary key** — forgeable by anyone who can write `userData` and extracts the key. Not Authenticode + signed shipping manifest / hardcoded hash allowlist. |
| RES-TEST-003 | **FIXED** | `tests/electron-consent-boundary.e2e.test.ts` — preload surface, deny mint, reject tokens, register deny/approve+seal, write approve/replay, privileged deny, PID-exit identity fail-closed, TTL expiry, injector launch+audit JSONL, forced online deny. **9/9 passed.** |

## Credibly repaired in this commit

- Main-process privileged consent dialog for memory write, injector consent, and helper registration.
- Consent binding includes identity fields + current/requested values (writes) or helper path/hash (injector).
- Sealed helper manifest gate on propose/confirm (directory alone is insufficient).
- Fail-closed attach when path or creation time missing; fixed empty `startTimeIso` on CIM DateTime.
- Full Electron IPC E2E on `dist-electron/main.js` with `SOLITH_PRIVILEGED_CONSENT` doubles.
- Wisp float WIP excluded from commit and from the hashed installer rebuild.

## Still blocks release

1. **Helper trust is not release-grade executable trust.** HMAC seal key ships in the asar. A local adversary who can write `{userData}/injector-helpers` can forge `manifest.seal`. Need at least one of: hardcoded approved hashes, signed shipping manifest, or Authenticode publisher bind + privileged registration that records publisher.
2. **Process identity remains best-effort OS scripting.** Required fields fail closed (good), but enrichment and re-read still depend on PowerShell/CIM rather than a stronger native identity structure on every confirm.
3. **IPC sanitize collapses many deny reasons** to generic fallbacks (e.g. online block → `in_process_confirm_injector_failed`). Functional deny works; operator-visible evidence is weaker than the audit JSONL.
4. **No Authenticode verification requirement** for helpers even when publisher is queried at registration.

## Verification record

| Check | Result |
|-------|--------|
| Security commit | `e9183db` (Wisp excluded) |
| Full `npm test` | **923/923** (913 + 10) |
| Electron verifier | **29/29** |
| Electron smoke | **6/6** |
| Consent-boundary E2E | **9/9** |
| Clean package rebuild | Pass |
| Installer SHA-256 | `DB2B4C41AC58E729FB23474878BC913B2CD20DAD1CA24F9471E52D0D6FBD3B1A` |

## Decision

| Item | Status |
|------|--------|
| Hostile re-audit of `e9183db` + package | **Completed** |
| Trust-boundary repairs | **Real and substantial** |
| Release | **DENIED** |

Next repair focus if pursuing release clearance: replace HMAC-userData seal with a shipping signed/hash-pinned helper allowlist (and/or Authenticode publisher bind), and optionally native Win32 identity re-read without silent metadata loss.