# Remaining Risks - Batch B1.1

## Accepted Residual Risks

### 1. Consent Dialog Spoofing (Low)
**Risk**: A compromised renderer could theoretically overlay a fake dialog on top of the real native dialog.
**Mitigation**: Native Electron dialogs are rendered by the browser process, not the renderer. The dialog title and button order are fixed. The binding hash is verified server-side on confirm.
**Acceptance**: This is a platform-level trust boundary; no practical mitigation within Electron architecture.

### 2. PID Reuse Race Window (Low)
**Risk**: Between process exit and PID reuse by OS, a freeze tick could theoretically write to a new process with the same PID.
**Mitigation**: 
- Freeze tick re-verifies full process identity (executable path, start time, volume serial, file index, exe SHA-256) on every iteration
- PID reuse with identical executable path AND start time AND volume serial AND file index AND exe hash is astronomically unlikely
**Acceptance**: Defense-in-depth identity check on every tick reduces window to near-zero.

### 3. Consent Token TTL (Medium)
**Risk**: 5-minute TTL on consent tokens means a user could approve, walk away, and return to find token expired.
**Mitigation**: TTL is a security boundary (limits blast radius of stolen tokens). User must re-approve.
**Acceptance**: Usability trade-off for security; 5 minutes is sufficient for normal workflow.

### 4. Freeze Concurrency Limits (Low)
**Risk**: Hard limits (8 per process, 32 global) could block legitimate multi-stat freezes in complex games.
**Mitigation**: Limits are judgment calls, not derived from measured usage. Can be increased if real-world usage demands it.
**Acceptance**: Current limits allow freezing health, ammo, stamina, mana, etc. simultaneously — well beyond typical use.

### 5. Rollback Ledger Capacity (Low)
**Risk**: 50-entry ledger could fill in a long session with many confirmed writes.
**Mitigation**: 
- Ledger only blocks NEW confirms when full of VALID (non-expired) entries
- Expired entries are purged automatically before capacity check
- Typical session unlikely to accumulate 50 un-rolled-back writes
**Acceptance**: Failing loudly (rejecting confirm) is strictly safer than silently losing rollback capability.

### 6. Process Selection TTL (Low)
**Risk**: 5-minute TTL on process selections may require re-selection during extended debugging.
**Mitigation**: Selections are reusable within TTL; verification re-checks identity at runtime regardless.
**Acceptance**: 5 minutes balances convenience with bounding stale selection risk.

### 7. Sender Validation URL Prefix Matching (Low)
**Risk**: `startsWith` prefix matching on allowed URLs could allow sub-path navigation to unexpected pages.
**Mitigation**: Registered prefixes are specific (dev server origin, file:// app.asar path). No open redirects in app.
**Acceptance**: Prefix matching is standard for SPA navigation within same origin.

### 8. Feature Flag Check Injection (Low)
**Risk**: `_injectFreezeFeatureFlagCheck` is a testing seam; if misused in production could disable freeze protection.
**Mitigation**: Only set by IPC layer at session bind time; not exposed to renderers.
**Acceptance**: Internal API, not a public surface.

## Out of Scope for B1.1
- Kernel-level memory protection (requires driver, explicitly out of scope per PROJECT_SPEC.md)
- Anti-cheat interaction (explicitly out of scope)
- Multiplayer/online game targeting (explicitly prohibited)
- Hardware-backed attestation (not available in Electron context)