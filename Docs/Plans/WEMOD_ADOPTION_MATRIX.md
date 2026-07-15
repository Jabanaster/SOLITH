# WeMod Adoption Matrix — Solith

**Status:** Snapshot after AA–AG · Date: 2026-07-15  
**Baseline:** `master` @ `f5db0f6` · shell polish tag `v2.1-shell-polish` · L/M research & in-process locks

One-page adopt / adapt / reject vs WeMod product shape.

| Capability | Stance | Solith implementation |
|------------|--------|------------------------|
| Launcher install scanning | **Adopt** | Steam VDF/ACF · Epic manifests · GOG registry → `installed_games` |
| Installed / running badges | **Adapt** | Library filter + process toast → Trainer Deck (evidence/cert, not opaque QA) |
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
| AB Library badges | Done (installed + running toast) |
| AC Trainer Deck | Done |
| AD Health / stale | Done |
| AE Process detect | Done |
| AF Demand + repair | Done |
| AG Smoke + matrix | Done (packaged-smoke 22/22; this matrix; overlay bounds table) |

## Explicitly next (not AG)

- LIVE: baselines / restart-verify / L3+ cert (S, U)
- Tag `v2.2-wemod-adoption` only after user **TAG IT**
- Commercial binary `canWrite` (X) — fixtures only until approved
