# Dependency audit triage — Phase 4

**Date:** 2026-07-25  
**Node / npm:** 22.23.1 / 10.9.8  
**Package:** `solith@2.4.0-alpha.2`  
**Scan command:** `npm audit` (full tree) and `npm audit --omit=dev`  
**Forbidden action observed:** `npm audit fix --force` was **not** used (would have proposed downgrading `electron-builder` 26.x → 25.1.8).

## Executive result

| Scope | Before targeted overrides | After overrides |
|-------|---------------------------|-----------------|
| Full tree High | **17** | **0** |
| Production tree (`--omit=dev`) | **0** | **0** |
| Packaged app SoT deps | sql.js + memoryjs + React UI libs — **no audit High** | unchanged |

Root cause of the “17 High” count: **two leaf advisories**, with npm marking **fifteen additional packaging/build packages** as High solely because they transitively depend on those leaves.

### Remediation applied (targeted, not a batch upgrade)

`package.json` `overrides`:

- `postcss` → `8.5.23` (fixes GHSA-r28c-9q8g-f849; was 8.5.15 via Vite/tsup)
- `brace-expansion` → `5.0.8` (fixes GHSA-mh99-v99m-4gvg across nested minimatch trees)

Did **not** change Electron, React, Vite, or `memoryjs` majors. Did **not** downgrade `electron-builder`.

Verification after install: `npm audit` → `found 0 vulnerabilities`; `npm test` → 905/905; `npx tsc --noEmit` → 0; `npm run build:electron` verifier green.

---

## Leaf advisories (authoritative)

### L1 — `brace-expansion` ≤5.0.7

| Field | Evidence |
|-------|----------|
| Package / vulnerable version | `brace-expansion@5.0.7` (also nested 1.1.16 / 2.1.2 before override) |
| Advisory | [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg) — DoS via unbounded expansion (CWE-400/770), CVSS 7.5 |
| Direct or transitive | **Transitive** |
| Production or development path | **Development / packaging only** (`electron-builder` → `app-builder-lib` → `minimatch` / `@electron/asar` / `dir-compare` / `filelist`) |
| Ships in packaged app? | **No** — `npm audit --omit=dev` clean; asar inventory does not include these toolchain packages as runtime deps |
| Reachability from Solith-controlled inputs | Build-time only. Requires attacker-controlled brace patterns during packaging/install tooling. End-user packaged Solith does not execute this code path on game/save inputs |
| Fixed version | `5.0.8` |
| Upgrade / replacement impact | npm `overrides` force `5.0.8` under all nested `minimatch` copies; electron-builder 26.15.3 retained |
| Mitigation if unfixed | N/A after override |
| **Disposition** | **fix** (override to 5.0.8) |

### L2 — `postcss` ≤8.5.17

| Field | Evidence |
|-------|----------|
| Package / vulnerable version | `postcss@8.5.15` |
| Advisory | [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849) — path traversal via `sourceMappingURL` auto-loading (CWE-22), CVSS 7.5 |
| Direct or transitive | **Transitive** |
| Production or development path | **Development only** (`vite@8.0.16`, `tsup@8.5.1`) |
| Ships in packaged app? | **No** — build-time CSS tooling; not a runtime production dependency |
| Reachability from Solith-controlled inputs | Only if a developer build processes untrusted CSS/source maps. Release packaging uses first-party stylesheets |
| Fixed version | `≥8.5.18` (pinned override `8.5.23`) |
| Upgrade / replacement impact | Override only; Vite/React/Electron unchanged |
| Mitigation if unfixed | N/A after override |
| **Disposition** | **fix** (override to 8.5.23) |

---

## Propagated High markers (npm package-level, no unique advisory)

These fifteen packages were reported High **only** because they depend on L1/L2 (empty `via` advisory arrays). After L1/L2 fixes they clear together.

For each: **path = development/packaging**, **ships in packaged app = no**, **production audit = not present**, **npm’s suggested “fix” of electron-builder@25.1.8 = rejected** (SemVer major downgrade / uncontrolled packaging toolchain change).

| # | Package | Installed (pre-fix) | Why High | Disposition |
|---|---------|------------------------|----------|-------------|
| 1 | `electron-builder` | 26.15.3 (**direct** devDependency) | depends on `app-builder-lib` / `dmg-builder` | **fix via L1/L2 overrides** (keep 26.15.3) |
| 2 | `app-builder-lib` | 26.15.3 | depends on asar/universal/ejs/minimatch tree | **fix via L1/L2 overrides** |
| 3 | `@electron/asar` | 3.4.1 | depends on `glob` / `minimatch` → brace-expansion | **fix via L1 override** |
| 4 | `@electron/universal` | 2.0.3 | depends on asar / dir-compare / minimatch | **fix via L1 override** |
| 5 | `dir-compare` | 4.2.0 | depends on minimatch → brace-expansion | **fix via L1 override** |
| 6 | `dmg-builder` | 26.15.3 | depends on app-builder-lib | **fix via L1/L2 overrides** |
| 7 | `electron-builder-squirrel-windows` | 26.15.3 | depends on app-builder-lib / electron-winstaller | **fix via L1 override** |
| 8 | `electron-winstaller` | (via squirrel) | depends on asar / temp | **fix via L1 override** |
| 9 | `ejs` | 3.1.10 | depends on jake → filelist → minimatch | **fix via L1 override** |
| 10 | `jake` | 10.9.4 | depends on filelist | **fix via L1 override** |
| 11 | `filelist` | 1.0.6 | depends on minimatch | **fix via L1 override** |
| 12 | `glob` | 7.2.3 | depends on minimatch | **fix via L1 override** |
| 13 | `minimatch` | 3.1.5 / 5.1.9 / 9.0.9 / 10.2.5 | depends on brace-expansion | **fix via L1 override** |
| 14 | `rimraf` | 2.6.3 | depends on glob | **fix via L1 override** |
| 15 | `temp` | 0.9.4 | depends on rimraf | **fix via L1 override** |

**Note on “production-reachable High”:** Prior to overrides, **zero** High findings existed in `npm audit --omit=dev`. No High finding was production-reachable in the shipped dependency set; the release-blocker concern was **unclassified** High noise plus build-toolchain exposure, not a shipped runtime CVE.

---

## Other dependency decisions (unchanged)

| Package | Decision | Rationale |
|---------|----------|-----------|
| `better-sqlite3` | Removed | Dead; sql.js is SoT |
| `sql.js` | Retained (production) | Active DB |
| `memoryjs` | Retained (production) | Native live-memory; Electron rebuild verified |

### `memoryjs` fresh rebuild evidence

- Clean-clone `npm ci` / `electron-builder install-app-deps` rebuilt `vendor/memoryjs-3.5.1-patched` under Electron 42.4.1 (see Phase 4 clean-clone certification).
- Local reinstall after overrides again completed `preparing/finished moduleName=vendor/memoryjs-3.5.1-patched`.
- Artifact: `vendor/memoryjs-3.5.1-patched/build/Release/memoryjs.node` (rebuilt 2026-07-25).

---

## Node 22 / version pinning proof

| Control | Evidence |
|---------|----------|
| `.nvmrc` | `22` |
| `package.json` engines | `>=22 <23` |
| `.npmrc` | `engine-strict=true` |
| Script gate | `scripts/check-node.mjs` on `pretest` / `prebuild` |
| CI fast | `node-version-file: '.nvmrc'` |
| CI nightly | `node-version-file: '.nvmrc'` |
| Version SoT | `2.4.0-alpha.2` + `tests/version-consistency.test.ts` |
| Node 24 rejection | `node scripts/check-node.mjs` under v24.15.0 exits **1** |

---

## Disposition summary

| Count | Disposition |
|------:|-------------|
| 2 leaf advisories | **Fixed** via targeted overrides |
| 15 propagated High package markers | **Cleared** as consequence of leaf fixes (were never unique CVEs) |
| Production-reachable High | **None identified** (`npm audit --omit=dev` was already 0) |

**Dependency-security gate for Phase 4 triage:** satisfied for the reported 17 High findings (classified + remediated without `--force`).  
**Release:** remains **DENIED** for independent reasons outside this triage (prior audit blockers / readiness), but this item is no longer “17 unclassified Highs.”
