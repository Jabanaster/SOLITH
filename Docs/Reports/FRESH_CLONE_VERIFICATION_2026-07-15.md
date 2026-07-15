# Fresh-clone verification — 2026-07-15 (current CI snapshot)

**Status:** PASS baseline for CI Fast count drift check  
**Tags locked:** `v2.1-shell-polish` @ `0928d29` · `v2.2-wemod-adoption` @ `6ddefb8`  
**Stabilization note:** Catalog search isolation fix keeps `npm test` green at **656/656** (verified 2026-07-15).

## Context

Reproducibility gate for Windows checkout: run clean-tree commands on repo root
`G:\ACTIVE_PROJECTS\ResourceForge` (not any legacy alternate path).

## Environment

| Item | Value |
|------|--------|
| OS | Windows 10.0.26200 |
| Repo | `G:\ACTIVE_PROJECTS\ResourceForge` |
| CI verifier | `.github/workflows/ci-fast.yml` → this file |

## Gate results

| Gate | Result | Notes |
|------|--------|-------|
| `npx tsc --noEmit` | **PASS** | exit 0 |
| `npm test` | **PASS** | 656/656 |
| `npm run build:electron` | **PASS** | 19/19 verify-electron-output (`preload.cjs`) |
| `npm run build` | **PASS** | historical pack at gate; re-run before release |
| `npm run test:accessibility` | **PASS** | exit 0 (historical evidence) |
| `node scripts/validate-packaged-host.mjs` | **PASS** | exit 0 (historical evidence) |
| `node scripts/orphan-check.mjs` | **PASS** | exit 0 |

Bound stdout (historical full log): `Docs/Reports/GATE_OUTPUT_2026-07-15.txt`

## Also locked

| Tag | Commit |
|-----|--------|
| `v1-milestone-l-research-lab-accepted` | `cdd8c51` |
| `v1-milestone-m-in-process-pilot-accepted` | `97326d7` |
| `v2.1-shell-polish` | `0928d29` |
| `v2.2-wemod-adoption` | `6ddefb8` |

See `Docs/Reports/SHELL_POLISH_ACCEPTANCE_SUMMARY.md`, `Docs/Reports/V2_2_WEMOD_ADOPTION_TAG_LOCK.md`.
