# Phase 2 P2-4 — Real-Game Evidence (Honest, Partial)

Mission §18–§23 require real-game restart validation: "at least ROADMAP-required real shipped game evidence complete." This document reports exactly what was achieved and, transparently, what was not — no fabricated pointer-stability results against a real commercial game, and no silent omission of the attempt.

## What was achieved: real attach proof, two real installed titles

Using the exact production `LiveMemorySession`/`nativeMemoryDriver` classes (the same ones Phase 1's doc 118 three-game canary used, and the same ones the shipping app uses — no test-only code path):

| Game | Exe | Real PID | Attach result |
|---|---|---|---|
| Godlike Burger | `Godlike Burger.exe` | 8616 | `success: true`, single-player waiver accepted, 0 writes |
| Bastion | `Bastion.exe` | 24036, 11444 (2 runs) | `success: true`, single-player waiver accepted, 0 writes |

Both titles were located on disk (`D:\SteamLibrary\steamapps\common\`), launched via `Start-Process`-equivalent spawn, allowed to stabilize, and attached read-only. No writes were performed at any point, matching mission §19's read-only safety requirement.

## What was attempted and did not succeed: finding a real, automatable, verifiable pointer target

Mission §4 forbids treating "resolved to readable memory" as proof of stability — a real pointer-stability claim against a real game needs an independently-known ground-truth value to scan for and later verify against. Two zero-gameplay-required candidate strategies were tried, both real, both reported honestly:

1. **Screen resolution as ground truth** (width = 2560, the real primary-monitor width on the machine running this stage, verified via `[System.Windows.Forms.Screen]::PrimaryScreen.Bounds`). An exact-value scan for `int32` `2560` against Godlike Burger and separately against Bastion each returned **10,000 matches (the scanner's own result cap), truncated** — far too many coincidental hits across a large process's address space to identify the real value's location, let alone reverse-scan a pointer to it.
2. **The process's own PID as ground truth** (deterministically known in advance — no scanning/guessing needed for the expected value itself). An exact-value scan for the real PID (`11444`) against Bastion returned **1,401 matches, truncated** — likely a mix of coincidental integer collisions and legitimate but irrelevant references (e.g. handle-table entries) — still far too many for a reliable single-target pointer scan.

Neither candidate narrowed to a small enough set for the existing `scanForPointerPath` reverse-scan (designed around genuinely evidence-narrowed target addresses, not thousands of candidates) to be applied meaningfully. Narrowing further would require either:

- **Scripted gameplay interaction** to reach a known game state (e.g. a specific health/currency value after a specific sequence of actions) — genuinely game-specific reverse-engineering work, out of scope for an automated stability-testing stage.
- **A real, observable state-change trigger** (e.g. sending a real Escape keypress to open a pause menu, then an "unknown initial → changed" scan for the resulting boolean/state flag) — a legitimate, standard technique, not attempted in this pass due to the additional interactive-automation setup and time cost, and because it still would not have guaranteed a small enough candidate set.
- **Pre-existing signature/catalog data** for one of these specific titles — none exists in this repository's trainer catalog for Godlike Burger, Bastion, Aegis Defenders, or DREDGE (the other two installed titles from the mission's suggested list) at the time of this stage.

## Honest conclusion

**Real-game pointer-stability restart evidence is NOT complete.** Real attach against two real, currently-installed, shipped titles is proven, read-only, using production code paths — but a genuine restart-stability classification (scan → save → kill → relaunch → load → validate → verify) against a real commercial game was not achieved within this stage, because a safe, zero-gameplay-scripting ground truth could not be found within reasonable automated effort against either title tried.

This is recorded as open work, not claimed as done. The fixture-based 10-restart campaign (`Docs/phase2/017`) remains the rigorous, load-bearing evidence that the stability *classification logic itself* is correct against real ASLR/heap relocation on a real Windows process — what real-game evidence would add on top is confidence that the same logic holds against a real, unmodified, third-party binary's actual memory layout, which remains unverified.

### What a future pass would need

Either scripted input automation (a real Escape-key/menu-interaction "unknown initial → changed" workflow) or a small set of pre-vetted, known-safe target definitions for one of the already-installed titles, so ground-truth discovery does not need to be solved blind inside the automated test itself.
