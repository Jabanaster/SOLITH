# Solith 2.0.0 Release Evidence

**Date:** 2026-07-12  
**Branch:** `master`  
**Package:** `resourceforge@2.0.0`  
**Product:** Solith  

## Milestones delivered (M–Q)

- Live trainer parity (overlay, hotkeys, memory_write)
- Trainer Library (1000+ seed, remote sync, Steam art)
- schema.v1 definitions (guard, YAML export/compile/import)
- Catalog → live memory + save-field TrainerHost routing
- Milestone Q UX (F1–F12, hybrid launch, drift modal, Discovery → Library)

## Bundled curated games (schema.v1)

| Game | Mode |
|------|------|
| Stardew Valley | Save-field controls (4 fields) |
| Palworld | Live memory (3 pinned) |
| Atomfall | Live memory (3 pinned) |
| Avowed | Live memory (2 pinned) |
| Undisputed | Live memory (2 pinned) |
| Dredge | Live memory (2 pinned) |
| Crimson Desert | Live memory (2 pinned) |

## Gate results

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | PASS |
| `npm test` | PASS 586/586 |
| `test:milestone-e` | PASS 15/15 |
| `test:milestone-j` | PASS 5/5 |
| `npm run build` | PASS — `Solith Setup 2.0.0.exe` |
| `verify-release-artifacts.mjs` | PASS 20/20 |
| `validate-packaged-host.mjs` | PASS 23/23 (prior run) |

## Installer artifacts

- `dist/Solith Setup 2.0.0.exe` (local build)
- `dist/Solith Setup 2.0.0.exe.blockmap`
- **GitHub release assets uploaded:** `v2.0.0-solith-accepted` (2026-07-12)

## Deliberately out of scope (post-2.0)

- Connection baselines without live measurement (KI-017)
- JSON save-field writes (read/propose only)
- Thousands of community pointer paths (metadata catalog only)
- Real-game memory writes without per-session user approval
