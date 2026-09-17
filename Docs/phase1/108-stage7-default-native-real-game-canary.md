# Phase 1 / Stage 7.3 §15 — Real-Game Canary Under the New Default

## Rerun scope, per mission §15's own reuse rule

Mission §15/§21 (Stage 7.2's original text) explicitly permits: "Do NOT unnecessarily relaunch all 3 games if scanner logic affecting read behavior did not change... At minimum after routing changes, run one real game again under NATIVE." This pass's only scanner-logic-affecting change relevant to a real game is the routing DEFAULT (the scan/read code paths themselves — `NativeScannerBackend`, native addon, Rust core — are byte-for-byte unchanged since doc 91's original 3-game canary). One real game was rerun, against the new default, with zero explicit mode override.

## Real evidence

Real `Start-Process` launch of `D:\SteamLibrary\steamapps\common\Bastion\Bastion.exe` (PID 3140), an 8-second stabilization wait, a real `LiveMemorySession` attach (using the same `nativeMemoryDriver`/`LiveMemorySession` production classes the Electron app itself uses) with **zero call to `setScannerRoutingMode`**, then one `scanExactViaBackend('uint32', 100)` call:

```
ATTACH: {"success":true,"guard":{"allowed":true,"reason":"Single-player waiver accepted (advisory: 0 remote connection(s) observed; not blocking)."}}
DEFAULT_MODE: NATIVE
SCAN_BACKEND: native
SCAN_MATCHES: 1381
SCAN_REGIONS: 854
SCAN_BYTES: 74288065
SCAN_TRUNCATED: true
SCAN_ELAPSED_MS: 362
DIAGNOSTICS: {"mode":"NATIVE","allowFallbackToLegacyOnNativeFailure":false,"lastOperation":{"operation":"exactScan","requestedMode":"NATIVE","effectiveBackend":"native","fellBackToLegacy":false,...},"operationCount":1,"fallbackCount":0}
DETACHED: true
```

| Field | Value |
|---|---|
| Game | Bastion |
| Exe | `Bastion.exe` |
| Arch | x64 (confirmed by successful attach via the same identity-verification path every other test uses) |
| Regions | 854 |
| Read bytes | 74,288,065 (~70.9 MiB) |
| Completeness | `complete_with_skipped_regions` (`truncated: true`) — consistent with doc 91's prior finding for this same game |
| Scan type | exact u32 |
| Matches | 1,381 |
| Duration | 362 ms |
| Backend selected | **native, with zero override** |
| Fallback | none (`fellBackToLegacy: false`) |

**This is the concrete, real-world proof of mission §2's "no environment variable/config trick required" and §10's "app start → no override → backend = NATIVE"**: a real, unmodified, commercially-shipped game process, attached through the exact production session/router classes, with no test-only configuration, defaults to native scanning.

Process closed cleanly (`Stop-Process -Force`) immediately after; confirmed no longer running via a follow-up `Get-Process` check. No write performed at any point.

## Required vs. achieved

**REAL-GAME NATIVE DEFAULT: 1/3** (Bastion only, per the explicit reuse rule above — Godlike Burger and Aegis Defenders were not relaunched, since no scan-logic change justifies repeating them; their doc 91 evidence under the (then-default) LEGACY/manually-set-NATIVE modes remains valid and is not superseded by anything this pass changed about the scan logic itself). If full independent re-verification of all 3 games under the literal new default is required for certification, that is a genuine, disclosed gap of this pass, not silently rounded up to 3/3.
