# Phase 1 / Stage 7.4 §16 — Full 3/3 Real-Game Default-Native Canary

## Why all 3, this time (not the Stage 7.3 reuse rule)

Stage 7.3's mission §15/§21 reuse rule ("do NOT unnecessarily relaunch all 3 games if scanner logic affecting read behavior did not change") applied because only the routing *default* changed, not the scan logic itself. This stage genuinely changed scan-affecting logic — new primitive wire types reaching the native backend, and AOB routing added for feature-resolver/hook-engine callers — so mission §16 explicitly requires the full 3/3 re-run, and this document supersedes doc 108's 1/3 disposition rather than relying on it.

## Method

Real `Start-Process` launches of each game's real installed executable (Steam library), an 8-10 second stabilization wait, a real `LiveMemorySession` attach (the same `nativeMemoryDriver`/`LiveMemorySession` production classes the Electron app itself uses) with **zero call to `setScannerRoutingMode`**, then one `scanExactViaBackend('uint32', 100)` call — identical methodology to doc 108's Bastion run, applied to all 3 games this time. No writes performed at any point. Every process closed cleanly and verified closed afterward.

## Real evidence

| Field | Bastion | Godlike Burger | Aegis Defenders |
|---|---|---|---|
| Exe | `Bastion.exe` | `Godlike Burger.exe` | `AegisDefenders.exe` |
| PID (actual game process; 2 of 3 games run through a launcher, confirmed via `Get-Process` before attaching) | 1568 | 12804 | 4864 |
| Default mode | NATIVE | NATIVE | NATIVE |
| Backend selected | native, zero override | native, zero override | native, zero override |
| Regions | 857 | 239 | 450 |
| Bytes read | 72,928,046 (~69.6 MiB) | 77,618,709 (~74.0 MiB) | 150,854,444 (~143.9 MiB) |
| Matches | 1,182 | 10,000 (cap reached) | 10,000 (cap reached) |
| Completeness | `complete_with_skipped_regions` (`truncated: true`) | `resource_limit` (`truncated: true`, `DEFAULT_MAX_MATCHES` cap) | `resource_limit` (`truncated: true`, cap) |
| Duration | 393 ms | 256 ms | 418 ms |
| Fallback | none (`fellBackToLegacy: false`) | none | none |

All three: zero override, `allowFallbackToLegacyOnNativeFailure: false` throughout, `operationCount: 1`, `fallbackCount: 0`.

## Required vs achieved

**REAL-GAME NATIVE DEFAULT: 3/3.** Every real, unmodified, commercially-shipped game process this operation has ever tested against, attached through the exact production session/router classes, with no test-only configuration, defaults to native scanning — concrete, current-pass, real-world proof of mission §11's "no override → backend = NATIVE" for exact-value scanning specifically (AOB-routed feature resolution against a real, non-fixture game process was not additionally exercised this pass beyond the fixture-based real-process proof in doc 115 — a genuine, disclosed scope boundary: none of these three games' available catalog definitions were exercised as live AOB-signature feature resolutions during this specific canary run).
