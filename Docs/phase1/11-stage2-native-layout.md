# Phase 1 / Stage 2 — Native Project Layout

## Existing repository Rust conventions (inspected before scaffolding)

`native/solith-readonly-scanner/` is the one pre-existing Rust crate in this repository: a standalone binary crate (`Cargo.toml` with `[[bin]]`, no library target), `edition = "2021"`, `license = "MIT"`, `publish = false`, depending on `windows-sys = "0.61"` (feature-gated under `[target.'cfg(windows)'.dependencies]`) plus `serde`/`serde_json`. No top-level Cargo workspace exists — each crate under `native/` is a fully independent Cargo project. Its build is wired into `package.json`'s `build:scanner` script (`scripts/build-readonly-scanner.mjs`), which is Windows-only-guarded, runs `cargo build --release`, verifies the output exists, then copies it into `dist-electron/`.

Stage 2 follows this convention directly rather than introducing a workspace: two new, independent Cargo crates under `native/`, each with its own `Cargo.toml`/`Cargo.lock`, no shared workspace manifest — consistent with the one existing precedent, and avoiding a workspace-wide `Cargo.lock` that would force every native crate (including the unrelated, already-certified `solith-readonly-scanner`) to resolve dependencies in lockstep.

## New layout

```
native/
  solith-readonly-scanner/     (pre-existing, untouched — Stage 2 does not modify it)
  solith-scanner-core/         (new — pure Rust library crate)
    Cargo.toml
    src/
      lib.rs                    public API surface (re-exports)
      error.rs                  ErrorKind + ScannerError (typed error hierarchy, mission §12)
      target.rs                 TargetArchitecture, HandleStatus, TargetDescriptor, ProcessHandle (RAII)
      region.rs                 RegionKind, CommitState, Region, enumerate_regions()
      policy.rs                 RegionSelectionPolicy (enumeration/selection separation, mission §8)
      chunk.rs                  ChunkPlanConfig, ChunkSpec, plan_chunks() — pure, OS-independent
      reader.rs                 ChunkReadStatus, ChunkReadResult, read_region_chunked(_with_progress),
                                 read_regions_chunked(_with_progress)
      completeness.rs           ScanCompleteness, SkipReason, SkippedRange, ScanMetrics (mission §11)
      cancellation.rs           CancellationToken (mission §15)
      bin/
        fixture.rs               real spawned-process test/benchmark fixture (test-only, not packaged)
        bench_reader.rs          Stage 2 native-reader benchmark (mission §25)
    tests/
      fixture_integration.rs    real spawned-process integration tests (mission §18)
  solith-scanner-napi/          (new — thin napi-rs adapter, cdylib)
    Cargo.toml
    build.rs                    napi_build::setup()
    src/lib.rs                  #[napi] surface: NativeScanTarget, ScanCancellationHandle,
                                 ScanProgressHandle, debug_echo_u64, Js* data shapes
    package.json                isolated napi/JS package (own node_modules, own package-lock.json)
    index.js / index.d.ts       generated JS/TS glue (committed — portable, not machine-specific)
    solith-scanner-napi.win32-x64-msvc.node   generated native addon (gitignored — build output)
    test/
      native-scan-target.test.js  real napi-layer integration tests, node:test, against the compiled addon
```

## Crate responsibility split (mission §4)

`solith-scanner-core` — **must not depend on Electron or Node** (verified: its `Cargo.toml` has zero napi/electron/node dependencies; `cargo build` succeeds standalone). Contains platform abstractions (region model, chunk planner), region enumeration, the chunked reader, completeness primitives, metrics, and the native error model — exactly the mission's specified contents, no more.

`solith-scanner-napi` — thin adapter only. Contains **zero scanner algorithm code**: every `#[napi]` function/method body either delegates directly into a `solith_scanner_core` call or converts between Rust and JS-facing types (`Region` ↔ `JsRegion`, `ScanCompleteness` ↔ `JsCompleteness`, `u64` ↔ `BigInt`). Responsibilities actually present: JS/TS type conversion (`*_to_js`/`js_to_*` functions), BigInt conversion (every address/byte-count field), async task scheduling (`ReadRegionTask: Task`), a cancellation-wiring interface (`ScanCancellationHandle`), a progress-plumbing interface (`ScanProgressHandle`), and `Result`→JS-error mapping (`to_napi_err`).

## Why not one crate

A single crate exposing `#[napi]` directly on core logic was rejected: it would make `solith-scanner-core`'s correctness (chunk planning, completeness accounting) untestable without the napi-rs macro/build toolchain and a Node runtime, defeating the pure-Rust unit/property-test layer (mission §19) that needs to run in plain `cargo test` with no Node dependency at all. The two-crate split is the mechanism, not just documentation, that enforces the mechanics/policy *and* core/adapter boundaries mission §3/§4 require.

## Build artifact discipline (mission §22)

- `native/**/target/` (both crates' Cargo build output) — already covered by the pre-existing root `.gitignore` entry, unchanged.
- `native/solith-scanner-napi/*.node` (the compiled addon) — new `.gitignore` entry added this stage; never committed.
- `native/solith-scanner-napi/node_modules/` — covered by the pre-existing global `node_modules/` `.gitignore` rule.
- `index.js`/`index.d.ts` — committed. These are portable JS/TS glue generated by `napi build`, containing no machine-specific binary data (they `require()` the `.node` file by a computed platform-triple filename at runtime) — safe and appropriate to commit, unlike the addon itself.
