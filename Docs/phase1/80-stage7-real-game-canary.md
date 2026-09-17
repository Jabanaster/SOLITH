# Phase 1 / Stage 7 — Real-Game Canary

## §7.30 — not performed this stage

Stardew Valley is not installed on this machine (only its `%AppData%` save-data folder exists — the executable is absent from Steam's `steamapps/common` and every other checked install location). Real, currently-installed, single-player-capable alternatives confirmed present via `steamapps/common`: **Crusader Kings III**, **Going Medieval**, **Starfield**, **AdVenture Communist**. None was launched, attached to, or scanned this stage.

No row of the required per-game table (game / exe / architecture / eligible regions / bytes scanned / completeness / scan type / matches / duration / legacy result / native result / difference classification) is populated. This is recorded as a real, explicit, unmet gate item — see doc 87's certification gate evaluation — not as a partially-satisfied or reinterpreted requirement.

The closest available evidence this stage substitutes is the real-process defect-closure proof in doc 76, against `native/solith-scanner-core/target/release/solith-scanner-fixture.exe` — a real spawned Windows process with real, independently-verified `VirtualAlloc`'d memory, but not a real game. It is offered as evidence that the underlying mechanism works against real OS memory, not as satisfying §7.9/§7.30's specific requirement for authorized real game processes.
