# Phase 4 — Clean-clone certification (HEAD 6a8967f)

**Authoritative current-HEAD packaging certification.**  
Supersedes `PHASE4_CLEAN_CLONE_CERTIFICATION_a435db0.md` for the “current HEAD” gate.

**Release decision:** still **RELEASE DENIED** (independent hostile re-audit remains open).

## Identity

| Field | Value |
|-------|-------|
| Exact commit | `6a8967f8c2cb552c909b9a16b2ee80958d24d8b7` |
| Message | `docs: recertify Phase 4 clean-clone at a435db0 and pin audit overrides in tests` |
| Clone root | `G:\ACTIVE_PROJECTS\_solith-phase4-clean-clone-6a8967f\solith` |
| Method | Empty external directory → `git clone --no-local` → checkout exact SHA |
| Checkout status | clean (`dirty_lines=0`) |
| Node / npm | `v22.23.1` / `10.9.8` |

## Delta from `a435db0`

```
Docs/Reports/PHASE4_CLEAN_CLONE_CERTIFICATION_a435db0.md
Docs/Reports/PHASE4_HYGIENE_STATUS.md
package.json  (wire dependency-security-overrides.test.ts into npm test)
tests/dependency-security-overrides.test.ts
```

Docs + CI test wiring only; no application runtime source changes.

## Command exits

| Step | Exit | Notes |
|------|-----:|-------|
| `npm ci` | **0** | |
| `npx tsc --noEmit` | **0** | |
| `npm test` (before electron build) | 1 | TrainerHost E2E cancelled: missing `dist-electron/host-entry.js` |
| `npm run build` | **0** | Verifier **29/29** |
| `npm test` (authoritative, after build) | **0** | **897 + 10 = 907** pass |
| Phase 3 destructive-boundary | **0** | **14/14** |
| Dependency override tests | **0** | **2/2** |
| Packaged smoke | **0** | **22/22** |
| Installer `/S` | **0** | |
| Launch / restart | **0** | PIDs alive |
| Uninstall `/S` | **0** | |
| `npm audit` | **0** vulns | |

### Authoritative test counts (post-build)

| Suite | tests | pass | fail | cancelled |
|-------|------:|-----:|-----:|----------:|
| Main | 897 | 897 | 0 | 0 |
| SQL | 10 | 10 | 0 | 0 |
| **Full** | **907** | **907** | **0** | **0** |

(Main grew by +2 vs `a435db0` due to `dependency-security-overrides.test.ts`.)

### Process note (clean-clone ordering)

Default `npm test` includes TrainerHost production-spawn E2E, which asserts `dist-electron/host-entry.js`. On a virgin tree that file does not exist until `build:electron` / `build`. Certification therefore treats **post-build `npm test`** as authoritative. A follow-up `scripts/ensure-electron-host-entry.mjs` on `pretest` removes this trap for future clones.

## Artifacts

| Artifact | Size (bytes) | SHA-256 |
|----------|-------------:|---------|
| `Solith Setup 2.4.0-alpha.2.exe` | 168535362 | `987546E450BD3D9FD07C1A58FFB7AC4A9399FB3D36E119E51EB5F69DA93F9F10` |
| `dist/win-unpacked/Solith.exe` | 232375296 | `75F236C1CFA14E2A9D1D4C7EF50EF8FDAC92AABF56EAEB8CB4F8DF931135C82D` |

## Install lifecycle

| Field | Value |
|-------|-------|
| Install location | `%LOCALAPPDATA%\Programs\Solith\Solith.exe` |
| Launch 1 | PID 12028 alive |
| Launch 2 | PID 32204 alive |
| Remaining processes after close | **0** |
| Install dir after uninstall | **absent** |
| AppData Solith paths | **absent** |

## Phase 4 gate

| Gate | Status |
|------|--------|
| Current HEAD clean-clone certification (`6a8967f`) | **Closed** |
| Phase 4 overall | **Closed** (pending only independent re-audit / release decision) |
| Release | **DENIED** |
