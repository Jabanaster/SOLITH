# Phase 1 / Stage 7 — Build / CI Integration

## §7.18 — build pipeline integration

Stage 2 deliberately left the native build additive-only (`scripts/build-scanner-native-foundation.mjs`: debug build, isolated `npm install`, never invoked by `npm run build`). This stage integrates it into the real pipeline:

1. **Root dependency**: `package.json` gains `"solith-scanner-napi": "file:native/solith-scanner-napi"`. `npm install` at the root now creates a real `node_modules/solith-scanner-napi` symlink, giving the addon normal Node module resolution (`require('solith-scanner-napi')`) from anywhere in the codebase — the same mechanism every other native dependency (e.g. `memoryjs`) already relies on, instead of a hand-authored relative-path guess (which would have needed different literal `../` counts for dev-unbundled vs. tsup-bundled contexts — a real, avoided class of bug; see doc 78's discussion of why a naive `new URL('../../../...', import.meta.url)` approach, as used for the pre-existing vendored `memoryjs` fallback, does not correctly generalize across bundling depths).
2. **New script**: `scripts/build-scanner-napi-release.mjs` — `npm install` (idempotent) + `napi build --platform --release` inside `native/solith-scanner-napi`, verifying the `.node` output exists, mirroring `scripts/build-readonly-scanner.mjs`'s existing conventions exactly (Windows-only, verify-don't-assume).
3. **Wired into `build:electron`**: `"build:electron": "npm run build:scanner && node scripts/build-scanner-napi-release.mjs && tsup ... && node scripts/verify-electron-output.mjs"`. A fresh checkout's `npm run build:electron` now builds the native addon automatically — no manual pre-build step.
4. **`verify-electron-output.mjs`** gained 4 new checks (now 33 total, was 29): the addon file exists/size-sane on Windows, and — the strongest check — it actually `require()`s successfully via node_modules resolution and exposes `NativeScanTarget`. Ran and passed (33/33) as part of this stage's own verification.

Proven end to end: `npm run build:electron` from the current working state (native addon already built once earlier this session) completes and passes all 33 checks; `npm run build` (the full production build, including `electron-builder`) completes and produces a working packaged app (doc 78). A from-absolute-zero fresh-worktree run (deleting all native build artifacts first) was not separately re-timed this stage — see doc 86.

## §7.19 — CI preparation

**Not done this stage.** Existing CI workflows (`.github/workflows/ci-fast.yml`, `ci-nightly.yml`, `pr-static.yml`, `pr-windows.yml`, `gitleaks.yml`, `memoryjs-integrity.yml`, `osv-scanner.yml`, `semgrep.yml`) were located and confirmed to already exist, but none was read in detail or modified to add Rust fmt/clippy/test, napi build/test, or native-addon-aware build steps. PR #29 remains untouched. This is an honest, explicit gap — mission §7.19's "avoid exploding GitHub Actions usage unnecessarily" and "use existing Windows/self-hosted strategy if already canonical" both require reading the existing workflows carefully before adding anything, which was not done this stage due to time. No CI file was modified.
