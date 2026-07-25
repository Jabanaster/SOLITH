# Phase 4 — Clean-clone certification

**Verdict for Phase 4 packaging evidence:** PASS (recorded below)  
**Release decision:** still **RELEASE DENIED** pending independent re-audit of Phases 1–3 assertions and any remaining product readiness gates outside Phase 4 scope.

## Identity

| Field | Value |
|-------|-------|
| Exact commit | `64322a76514b1e95b7c0ce6cd149b14afaa60a06` |
| Message | `chore: purge ResourceForge, pin Node 22, enforce version SoT` |
| Clone root | `G:\ACTIVE_PROJECTS\_solith-phase4-clean-clone\solith` |
| Source clone method | `git clone --no-local` from local working tree into an empty external directory, then `git checkout` exact SHA |
| Working-tree status at checkout | clean (detached HEAD at candidate commit) |
| Node | `v22.23.1` (`G:\ACTIVE_PROJECTS\_tooling\node-v22.23.1-win-x64`) |
| npm | `10.9.8` |

## Command sequence and exit codes

| Step | Command | Exit |
|------|---------|------|
| Clone + checkout | `git clone --no-local …` / `git checkout 64322a7…` | 0 |
| Clean status | `git status --porcelain` empty | 0 |
| Activate Node 22 | PATH prefix to portable Node 22.23.1 | — |
| Install | `npm ci` | **0** |
| Typecheck | `npx tsc --noEmit` | **0** |
| Full suite | `npm test` (rerun with file redirect; first Tee-Object run cancelled 4 TrainerHost E2E children) | **0** |
| Phase 3 destructive-boundary | `npx tsx --test tests/injector-destructive-boundary.test.ts` | **0** |
| Renderer build | `npm run build:vite` | **0** |
| Electron build | `npm run build:electron` (verifier **29/29**) | **0** |
| Full packaging | `npm run build` | **0** |
| Packaged smoke | `npm run test:packaged-smoke` | **0** (22/22) |
| Installer install | `Solith Setup 2.4.0-alpha.2.exe /S` | **0** |
| Installed launch | start `Solith.exe` (PID alive) | **0** |
| Close | `Stop-Process` | **0** |
| Restart | start again (PID alive) then close | **0** |
| Uninstall | `Uninstall Solith.exe /S` | **0** |
| Cleanup verify | install dir gone; AppData Solith dirs absent; 0 Solith processes | **0** |

## Test counts

| Suite | tests | pass | fail | cancelled |
|-------|------:|-----:|-----:|----------:|
| Main (`npm test` first half) | 895 | 895 | 0 | 0 |
| SQL | 10 | 10 | 0 | 0 |
| **Full** | **905** | **905** | **0** | **0** |
| Phase 3 destructive-boundary | 14 | 14 | 0 | 0 |
| Packaged smoke | 22 | 22 | 0 | 0 |

## Build notes

- Electron output verifier: **29/29**
- Native rebuild during package: `vendor/memoryjs-3.5.1-patched` only (no `better-sqlite3`)
- NSIS artifact name matched SoT: `Solith Setup 2.4.0-alpha.2.exe`
- No ResourceForge-named artifacts produced

## Artifacts

| Artifact | Size (bytes) | SHA-256 |
|----------|-------------:|---------|
| `dist/Solith Setup 2.4.0-alpha.2.exe` | 168535066 (~160.7 MiB) | `090D0E85ECD7401E85BAE0968EAA1A4C7B4084BD4229F0054077DB268257E4E5` |
| `dist/win-unpacked/Solith.exe` | 232375296 | `569811D19375DD00632BC87D28E042FADD16AEA63A9614CC7C4AD29669C38657` |

## Install lifecycle

| Field | Value |
|-------|-------|
| Installation location | `C:\Users\chase\AppData\Local\Programs\Solith\` |
| Launch 1 | PID 36076 alive (`Solith`) |
| Launch 2 (restart) | PID 28300 alive (`Solith`) |
| Remaining processes after shutdown | **0** |
| Install dir after uninstall | **absent** |
| `%APPDATA%\Solith` / `%LOCALAPPDATA%\Solith` after uninstall | **absent** |

### Core demo workflow evidence

- Packaged smoke exercised live IPC against the packaged binary: `getGames`, `getSettings`, `addGame`, `parseSave` (JSON fixture), Trainer/compatibility channels, clean exit.
- Installed binary launch/restart confirmed process start without depending on the developer `dist` tree used only as the installer source built inside the clean clone.

## Dependency audit snapshot

- `npm audit` after `npm ci`: **17 high** (documented in `Docs/Reports/DEPENDENCY_AUDIT_PHASE4.md`; not auto-force-fixed).

## Final repository status (source tree)

After Phase 4 commits on `master`:

- `HEAD` = `64322a76514b1e95b7c0ce6cd149b14afaa60a06` (plus this certification commit when recorded)
- Dirty entries before certification doc commit: **none**
- Certification clone directory is **outside** the repo and is not committed

## Phase 4 exit checklist

| Criterion | Status |
|-----------|--------|
| Wisp coherent (not expanded) | PASS |
| `master` clean after commits | PASS |
| ResourceForge contamination purged (active tree) | PASS |
| One version SoT + automated test | PASS (`2.4.0-alpha.2`) |
| Node 22 local + CI | PASS |
| Dead `better-sqlite3` removed | PASS |
| Fresh clone `npm ci` | PASS |
| Full build/tests/package/install/launch/restart/uninstall | PASS |
| Packaged artifact verified (smoke + hashes) | PASS |
| No reliance on prior `node_modules` / `dist` / local DBs | PASS (clean clone) |
