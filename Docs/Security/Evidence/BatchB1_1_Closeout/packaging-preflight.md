# Packaging Preflight

Date: 2026-08-01
Read-only/preparatory inspection only — no package was built in this phase.
Source SHA inspected: `fa482c8c1917bbe3990d878a67f3f00cdc33364d` (`integration/b1-1-closeout`)

## electron-builder configuration (`package.json` → `build`)

- `appId`: `com.solith.app`, `productName`: `Solith`, `directories.output`: `dist`
- `files`: `dist-electron/**/*`, explicitly excludes `!dist-electron/**/*.map` — source maps are not shipped.
- `asarUnpack`: `node_modules/sql.js/**`, `dist-electron/host-entry.js`, `dist-electron/headless-verification-worker.js`, `dist-electron/solith-readonly-scanner.exe` — scoped to files that genuinely need filesystem access outside the asar; no broad unpack.
- `extraResources`: `demo-game/`, `data/trainer-catalog-seed.json` — both intentional bundled fixtures, not secrets or local paths.
- `win.target`: `nsis` only. No signing block (`certificateFile`/`certificatePassword`/`signtoolOptions`/`CSC_*`) present anywhere in `package.json` or in any `electron-builder.*` config file — no production credentials are configured, so none can be accidentally invoked by a default `electron-builder` run.
- No `"publish"` key configured — a default `electron-builder` invocation will not attempt to upload or publish anywhere.
- `asar` key not overridden — electron-builder default (`true`) applies.

## Origin/URL trust

- `mainAllowedUrlPrefixes` in `electron/main.ts` is gated on `isDev` (`--dev` CLI arg or `SOLITH_DEV=1` env var). When not dev, the only trusted prefix is the packaged `file://` route to the bundled `dist/index.html` — confirmed by direct source read (`electron/main.ts:295-317`). No development origin can be trusted in a packaged build under default launch conditions.

## Test-only / debug surfaces

- `SOLITH_TEST_BUILD` guards test-only IPC handlers in `electron/live-memory-ipc.ts` (`__testHasSessionForOwner`, `__setTestForcedCleanupFailureStep`, `__clearTestForcedCleanupFailureSteps`) behind `process.env.SOLITH_TEST_BUILD === '1'` runtime checks — inert unless that env var is explicitly set at launch. This is a pre-existing, previously Gate-2.5-evidenced pattern (`Docs/Security/Evidence/BatchB1_1_Closeout/Gate2_5/test-hook-env-variant-raw-results.json`, `test-hook-final-inventory.csv`), not introduced or altered by this session.
- `electron/startup-timing.ts` (new this integration) is gated on `SOLITH_STARTUP_TRACE === '1'`, silent by default — logs only an event name and a `performance.now()` offset, no accumulation, no PII.
- `scripts/measure-startup.mjs` is a diagnostic harness, not wired into `npm run build` or `electron-builder`'s `files` list — it is a repo-root dev script, not packaged.

## No production output can include (checked)

- `SOLITH_TEST_BUILD=1` runtime behavior — inert by default, requires explicit env var at launch, not baked into the build.
- Test-only IPC handlers — present in source but fail-closed unless the env var is set.
- Local development URLs — excluded from trust surface when `isDev` is false; not the default `loadFile` target.
- Debug bypasses — none found beyond the above, both explicitly gated.
- Scratch measurement data — `measure-startup.mjs` output is not part of `files`; nothing under `/tmp` or scratch paths is referenced by the build.
- Test certificates / private keys — none present in the repository or build config.
- Local machine paths — none hardcoded in `electron/main.ts`, `package.json` build block, or `tsup.config.ts` (not independently re-audited line-by-line beyond grep sweep in this phase).
- Development logs — `startup-timing.ts` marks are opt-in only via env var, not written to disk.

## Verdict

```
PACKAGING PREFLIGHT: PASS WITH CONDITIONS
```

Conditions: this is a config/source-level preflight only — it does not substitute for Phase 11 (candidate-specific Gate 2.5 packaged verification), which requires an actual built and hashed candidate. No package was produced in this phase; none is authorized in this run (Phase 9 requires separate owner authorization naming exact SHA/version/architecture/signing mode).
