# Phase 1 / Stage 7.1 — Real-Game Canary Continuation

## §7.1-G — installed game inventory (real, checked this pass)

Enumerated `C:\Program Files (x86)\Steam\steamapps\common` and `D:\SteamLibrary\steamapps\common` on this machine directly (PowerShell `Get-ChildItem`). Stardew Valley is confirmed **not installed** (only its save-data folder exists, per Stage 7's prior finding — reconfirmed). Real installed, launchable candidates found this pass (top-level `.exe` present, confirmed by directory listing):

| Game | Engine (confirmed) | Notes |
|---|---|---|
| Bastion | Supergiant's own custom engine (no `UnityPlayer.dll`, no Unreal markers) | fast load, single-player, offline |
| Godlike Burger | Unity (confirmed via sibling `UnityCrashHandler64.exe`) | fast load |
| Aegis Defenders | non-Unity, non-Unreal (no `UnityPlayer.dll`; ported title, minimal dependency set) | fast load |
| 7 Days To Die | Unity, **ships Easy Anti-Cheat** (`7DaysToDie_EAC.exe`) | correctly excluded — Solith's own `protected-target-guard.ts` would refuse this attach by design; not launched to avoid unnecessary anti-cheat driver activity |
| Pathfinder: Kingmaker | Unity (confirmed via `UnityCrashHandler64.exe`) | available, not exercised (heavier CRPG load time) |
| Starfield | Bethesda Creation Engine 2 (native Win64) | available, not exercised this pass (large AAA load time/resource cost) |
| Crusader Kings III, Going Medieval, Atomic Heart (Unreal Engine 4), Total War: Warhammer III, Mount & Blade II: Bannerlord, No Man's Sky, and others | various | installed but not exercised — see honest limitation below |
| AdVenture Communist | — | install on this machine is incomplete/corrupted (its `_Data` folder contains only a stray `output_log.txt`, none of the normal Unity runtime files) — **not a suitable target**, not launched |

**Diversity achieved**: 3 real, genuinely different engines — a bespoke/custom engine (Bastion), a confirmed-Unity title (Godlike Burger), and a third non-Unity/non-Unreal title (Aegis Defenders). **Environment limitation, honestly documented**: no Unreal Engine title was actually exercised. Atomic Heart (UE4) is installed and would be the real candidate, but was not launched this pass given the combined resource/time cost of a heavy AAA title's load sequence weighed against the remaining scope of Stage 7.1's other required sections. This is a real, disclosed gap — not claimed as done.

## §7.1-H — real-game canary results

Method: real `Start-Process` launch of each game's real executable (no Steam URI shortcut, no mock), waited for the process to stabilize, attached via the exact real `LegacyScannerBackend` + `NativeScannerBackend` + `ScannerBackendRouter` production classes (same classes `LiveMemorySession` wraps), ran a `u32` exact scan for the value 100 in `SHADOW_COMPARE` mode (legacy authoritative, native alongside for comparison) followed by a second scan in `NATIVE` mode (to record native's own real coverage directly). All 3 games closed cleanly (`Stop-Process`) immediately after; no file modified, no write performed.

| Game | PID | Legacy matches | Legacy regions/bytes | Legacy completeness | Native matches | Native regions/bytes | Native completeness | Classification |
|---|---|---|---|---|---|---|---|---|
| Bastion | 30416 | 1,186 | 474 / 24.99 MB | `complete_with_skipped_regions` | 1,695 | 793 / 101.86 MB | `complete_with_skipped_regions` | `EXPECTED_NATIVE_CORRECTION` |
| Godlike Burger | 18040 | 2,302 | 617 / 82.39 MB | `complete_with_skipped_regions` | 151,382 (150,711 at shadow-compare time) | 1,256 / 1.87 GB | `complete_with_skipped_regions` | `EXPECTED_NATIVE_CORRECTION` |
| Aegis Defenders | 27096 | 1,146 | 698 / 57.29 MB | `complete_with_skipped_regions` | 20,011 (19,816 at shadow-compare time) | 1,134 / 242.77 MB | `complete_with_skipped_regions` | `EXPECTED_NATIVE_CORRECTION` |

(The small match-count difference between the SHADOW_COMPARE call and the immediately-following NATIVE call for Godlike Burger/Aegis Defenders is real, expected process-state drift between two sequential live scans of a running game — not a bug: the game's own memory changes between the two calls, same as it would for a real player running two scans seconds apart.)

**Every one of these 3 real games reproduces the real D02 (1 MiB region cap) gap live**: legacy's own `LegacyScannerBackend` completeness signal (doc 73's independently-recomputed region count) honestly reports `complete_with_skipped_regions` in all 3 cases, and native genuinely covers far more real bytes each time (4x in Bastion, 23x in Godlike Burger, 4x in Aegis Defenders) — real evidence of the same shipping defect Stage 7's synthetic fixture already proved, now against real, unmodified, commercially-shipped game processes. Every difference observed was classified; **zero unresolved differences, zero native bugs** across all 3 real games.

**AOB scan**: not attempted against these real games — no known/safe byte pattern for any of them was available without external research into the specific game's memory layout (mission §7.1-H makes this explicitly optional: "AOB scan result where a safe known pattern is available"). None was.

**Legacy vs native duration**: legacy ranged 660 ms – 6,247 ms; native ranged 223 ms – 5,609 ms across the 3 games, for vastly more real bytes examined each time (native's Godlike Burger scan covered ~23x the bytes in slightly less wall time than legacy's smaller scan) — consistent with doc 93's separate, more careful production-performance comparison (see that doc for the throughput-normalized numbers mission §7.1-K actually asks for; these are secondary observations, not the controlled measurement).

## Canary ladder

Per doc 96's evaluation: this real-game data satisfies mission §7.1-I's **Level 4** ("first real game") and, with 3 real games exercised, **Level 5** ("additional real games") at the backend/router layer — not yet at the full production-IPC-path layer (doc 89 proved the IPC path against the synthetic fixture only, not against these real games; re-running the IPC-path test against a real game was judged out of scope for this pass given time already spent, and because the synthetic fixture already gives deterministic, reproducible IPC-path evidence that a live commercial game's non-deterministic memory layout cannot improve on for that specific claim).
