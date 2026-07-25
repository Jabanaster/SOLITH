# Dependency audit — Phase 4

**Date:** 2026-07-24  
**Node:** 22.23.1  
**Package:** `solith@2.4.0-alpha.2`

## Decisions

| Package | Decision | Rationale |
|---------|----------|-----------|
| `better-sqlite3` | **Removed** | Not imported by shipped application code. Persistence SoT is `sql.js`. Present only as leftover packaging/external config and obsolete `electron/compat-test*.ts` probes (deleted). |
| `sql.js` | **Retained (production)** | Active database backend. |
| `memoryjs` | **Retained (production)** | Native live-memory adapter; rebuilt under Electron via `electron-builder install-app-deps`. |
| `@types/react`, `@types/react-dom`, `typescript` | **devDependencies** | Build/type tooling, not runtime. |
| `@types/node` | **Pinned to ^22** | Aligns with supported Node major. |

## Vulnerability scan (`npm audit`)

Recorded after `better-sqlite3` removal under Node 22:

- `npm audit` reported **17 high** severity findings in the dependency tree (exact IDs/time-variant; re-run `npm audit` for current detail).
- No automatic `npm audit fix --force` applied during Phase 4 (can introduce breaking changes unrelated to release hygiene).
- Unresolved findings remain **documented, not claimed fixed**. They are a release blocker only if a subsequent security review maps them to reachable production attack surface; Phase 4 does not assert that mapping.

## Native rebuild

Post-install rebuild under Electron 42.4.1 completed for `vendor/memoryjs-3.5.1-patched` only. No `better-sqlite3` rebuild step remains.
