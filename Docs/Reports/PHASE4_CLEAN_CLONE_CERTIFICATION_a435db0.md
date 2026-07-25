# Phase 4 — Clean-clone certification (HEAD a435db0)

**Supersedes packaging evidence in** `PHASE4_CLEAN_CLONE_CERTIFICATION.md` **for commit `64322a7`.**  
That earlier run remains historical; **this report is the current packaging certification** after dependency-security overrides.

**Release decision:** still **RELEASE DENIED** (independent re-audit / product readiness remain open).

## Identity

| Field | Value |
|-------|-------|
| Exact commit | `a435db01c8e95777825bcc27a2ceff95babc3906` |
| Message | `fix: triage and clear npm audit High findings via targeted overrides` |
| Clone root | `G:\ACTIVE_PROJECTS\_solith-phase4-clean-clone-a435db0\solith` |
| Method | Empty external directory → `git clone --no-local` → checkout exact SHA |
| Checkout status | clean (`dirty_chars=0`) |
| Node / npm | `v22.23.1` / `10.9.8` (portable toolchain) |

## Command exits

| Step | Exit |
|------|-----:|
| `npm ci` | 0 |
| `npx tsc --noEmit` | 0 |
| `npm test` (stable rerun after first-run TrainerHost cancel flake) | 0 |
| Phase 3 destructive-boundary (14) | 0 |
| `npm run build` (verifier 29/29) | 0 |
| `npm run test:packaged-smoke` (22) | 0 |
| Installer `/S` | 0 |
| Launch / restart (process alive) | 0 |
| Uninstall `/S` | 0 |
| `npm audit` in clean clone | 0 vulnerabilities |

### Test counts (stable rerun)

| Suite | tests | pass | fail | cancelled |
|-------|------:|-----:|-----:|----------:|
| Main | 895 | 895 | 0 | 0 |
| SQL | 10 | 10 | 0 | 0 |
| **Full** | **905** | **905** | **0** | **0** |
| Phase 3 boundary | 14 | 14 | 0 | 0 |
| Packaged smoke | 22 | 22 | 0 | 0 |

**Note:** The first `npm test` in this clone cancelled 4 TrainerHost E2E children (`pass 891 / cancelled 4`) under cold electron extract contention. Immediate rerun in the same clean tree was **905/905 cancelled 0**. Certification treats the stable rerun as authoritative and records the flake.

## Artifacts

| Artifact | Size (bytes) | SHA-256 |
|----------|-------------:|---------|
| `Solith Setup 2.4.0-alpha.2.exe` | 168533826 | `A950C7BD3C95EF11439E9B0705D89E1DA65A317F04E2F273D1E70BDA9E512696` |
| `dist/win-unpacked/Solith.exe` | 232375296 | `CBA7C15D6E899E941ED934C89A6E268654DCF412DAF002B132A1DF1DF64B6699` |

## Install lifecycle

| Field | Value |
|-------|-------|
| Install location | `C:\Users\chase\AppData\Local\Programs\Solith\Solith.exe` |
| Launch 1 | PID 33144 alive |
| Launch 2 (restart) | PID 20016 alive |
| Remaining Solith processes after close | **0** |
| Install dir after uninstall | **absent** |
| `%APPDATA%\Solith` / `%LOCALAPPDATA%\Solith` | **absent** |

Core demo/IPC proof: packaged smoke exercised `getGames`, `getSettings`, `addGame`, `parseSave`, trainer/compatibility IPC against the packaged binary (22/22).

## Hygiene gates re-proven at this commit

| Gate | Evidence |
|------|----------|
| Wisp finish (no expansion) | Wired overlay/IPC/assets/tests; `companion-wisp` + onboarding branding tests pass; no new Wisp features in this cert |
| ResourceForge purge | Case-insensitive active-tree search clean (no unjustified `ResourceForge` / `rf-*` prefixes) |
| Version SoT | `2.4.0-alpha.2`; `tests/version-consistency.test.ts` pass |
| Dependency overrides | Clean-clone `npm audit` → 0; overrides remain required for advisory containment |
| No prior tree required | Fresh clone `npm ci` only |

## Final source-tree status

Source `master` after recording this report + override regression tests will note the new HEAD in the follow-up commit. Certification clone is outside the repo and not committed.
