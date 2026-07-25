# Phase 4 hygiene status

**Date:** 2026-07-25  
**Phase 4 packaging/hygiene:** **CLOSED**  
**Full clean-clone cert commit:** `6a8967f`  
**Current `master` HEAD (docs + pretest ensure):** `5d06c25` — option-2 verified  
**Release:** **DENIED**  
**Independent hostile re-audit:** **OPEN** (next gate)

## Status table

| Gate | Status |
|------|--------|
| Phase 1 — Data integrity | Provisionally closed |
| Phase 2 — Security repairs | Provisionally closed |
| Phase 3 — Destructive boundary | Provisionally closed |
| Phase 4 — Hygiene | **Closed** |
| Phase 4 — Node/dependencies | **Closed** |
| Phase 4 — Clean-clone at `a435db0` | Closed (historical) |
| Phase 4 — Full HEAD certification (`6a8967f`) | **Closed** — `PHASE4_CLEAN_CLONE_CERTIFICATION_6a8967f.md` |
| Phase 4 — Post-cert HEAD `5d06c25` (option 2) | **Closed** — docs/pretest-only delta; see below |
| Independent hostile re-audit | **Open** |
| Release | **DENIED** |

## `6a8967f` full certification highlights

- Empty-tree clone, Node 22.23.1, `npm ci` 0, `tsc` 0
- Authoritative `npm test` after electron build: **907/907**
- Build verifier **29/29**, packaged smoke **22/22**
- Install → launch → restart → uninstall clean; audit **0**
- Installer SHA-256 `987546E450BD3D9FD07C1A58FFB7AC4A9399FB3D36E119E51EB5F69DA93F9F10`

## `5d06c25` option-2 proof (docs + pretest ensure only)

Delta vs `6a8967f`: certification report, hygiene status rewrite, `scripts/ensure-electron-host-entry.mjs`, `pretest` wire-up.

Clean clone of `5d06c25`:

| Step | Exit |
|------|-----:|
| `npm ci` | 0 |
| Dependency override tests | 0 |
| `npm test` on virgin tree (no `dist-electron`; pretest ensure rebuilt host-entry) | 0 — **907/907** |
| `tsc` | 0 |
| `npm run build` (29/29) | 0 |
| Installer produced | `Solith Setup 2.4.0-alpha.2.exe` SHA-256 `554D4D263E3D3BE4E182A2404735A3D064911C7B9FD903A3297A18A1E1DFC892` |

## Next

Independent hostile re-audit of Phases 1–3 assertions and Phase 4 evidence. Release remains denied until that passes.
