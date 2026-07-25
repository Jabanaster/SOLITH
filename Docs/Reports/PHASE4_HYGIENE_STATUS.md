# Phase 4 hygiene status — post a435db0 recert

**Date:** 2026-07-25  
**Decision:** **RELEASE DENIED**  
**Independent re-audit:** still open (not claimed closed by this document)

## Status table

| Item | Status | Evidence |
|------|--------|----------|
| Node 22 alignment | Closed (provisional → reinforced) | Portable 22.23.1; engines; `.nvmrc`; CI `node-version-file`; Node 24 rejected |
| Dead `better-sqlite3` | Closed | Removed; sql.js SoT |
| Dependency vulnerability triage | Closed | 0 `npm audit`; report `DEPENDENCY_AUDIT_PHASE4.md` |
| Override regression coverage | Closed | `tests/dependency-security-overrides.test.ts` pins overrides + asserts audit 0 |
| Full tests under Node 22 | Closed | 905/905 at source and clean-clone rerun |
| Wisp finish/revert | **Closed (finish)** | Coherent foundation only; tests green; no feature expansion |
| ResourceForge purge | **Closed** | Active-tree search clean at `a435db0` |
| Single version SoT | **Closed** | `2.4.0-alpha.2` + consistency test |
| Clean committed checkpoint | Closed when follow-up commit lands clean | — |
| Full clean-clone certification | **Closed for `a435db0`** | `PHASE4_CLEAN_CLONE_CERTIFICATION_a435db0.md` |
| Package/install/restart/uninstall proof | **Closed for `a435db0`** | Same report |
| Independent re-audit | **Open** | Required before release |

## Caveat retained

npm `overrides` for `postcss` / `brace-expansion` remain a containment mechanism. Install + build + the new override/audit tests must stay green; a future parent bump can break compatibility even while advisories stay resolved.
