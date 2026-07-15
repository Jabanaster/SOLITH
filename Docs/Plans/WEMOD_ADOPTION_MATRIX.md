# WeMod Adoption Matrix — Solith

**Status:** Snapshot after AA–AG · Date: 2026-07-15  
**Baseline:** `master` @ `6ddefb8` · tags `v2.1-shell-polish` / `v2.2-wemod-adoption` · L/M research & in-process locks

One-page adopt / adapt / reject vs WeMod product shape.

| Capability | Stance | Solith implementation |
|------------|--------|------------------------|
| Launcher install scanning | **Adopt** | Steam VDF/ACF · Epic manifests · GOG registry → `installed_games` |
| Installed / running badges | **Adapt** | Library Running/Installed badges + filters/sort + process toast → Trainer Deck |
| Per-game cheat deck | **Adapt** | `TrainerDeckPage` — save-field + gated live memory |
| Version / stale detection | **Adopt** | `trainer-health` hash prefix mismatch → Stale / Needs re-verify |
| Hotkeys + overlay | **Adopt** | Global bindings + per-game overlay presets (bundled 7) |
| Process-detect attach | **Adapt** | Attach to running PID (not launch-only) |
| Notify / demand | **Adapt** | Local SQLite demand counters — no cloud Boosts |
| Community definitions | **Exceed** | schema.v1 · CT import · Research Lab · Dumpspace |
| Proprietary trainer blobs | **Reject** | No WeMod/MrAntiFun binary store; no auto-download of trainers |
| Online / multiplayer cheating | **Reject** | Offline guard fail-closed |
| Injection stealth / anti-cheat bypass | **Reject** | Hard AGENTS boundaries; in-process pilot Crimson Desert only, flag OFF |

## Milestone rollup

| Phase | Status |
|-------|--------|
| AA Install discovery | Done |
| AB Library badges | Done (installed + running badges, filters, sort, drag-exe) |
| AC Trainer Deck | Done |
| AD Health / stale | Done |
| AE Process detect | Done |
| AF Demand + repair | Done |
| AG Smoke + matrix | Done · tag `v2.2-wemod-adoption` @ `6ddefb8` |

## Explicitly next (not AG)

- LIVE: baselines / restart-verify / L3+ cert (S, U)
- Commercial binary `canWrite` (X) — fixtures only until approved
- Offline sweep polish merge (`cursor/offline-sweep-after-v2-2`) when ready
