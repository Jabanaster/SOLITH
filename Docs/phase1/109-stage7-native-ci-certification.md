# Phase 1 / Stage 7.2/7.3 §14/§18 — Native CI Gates

## What was missing (doc 101's disclosed gap)

Before this pass: `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test`, and the napi JS test suite (`node --expose-gc --test`) were never run in any GitHub Actions workflow — confirmed by grep across every `.github/workflows/*.yml` file returning zero hits for `cargo`/`napi`/`rust` except one comment noting the Rust scanner is compiled (not tested) as a side effect of `npm ci`'s postinstall.

## What changed

`.github/workflows/pr-windows.yml` — the one existing job that already runs on `windows-latest` with the native toolchain in its dependency chain (`npm ci` triggers the napi/Rust build via postinstall) — extended with:

1. `dtolnay/rust-toolchain@stable` (with `rustfmt`, `clippy` components), added early, before `npm ci`.
2. `cargo fmt --check` (working-directory `native/solith-scanner-core`).
3. `cargo clippy --release -- -D warnings` (same directory).
4. `cargo test --release` (same directory), placed after `npm run build:electron` (so the release-profile target directory the addon build already populated is reused, not rebuilt from scratch).
5. `cargo build` (debug profile, no `--release`) — required because the napi JS test suite looks for the fixture binary under `target/debug/`, which only a debug build produces (doc 100's disclosed fresh-worktree finding).
6. `node --expose-gc --test test/*.test.js` (working-directory `native/solith-scanner-napi`).

No new workflow file was created — per mission's own explicit instruction ("Do not create wasteful duplicate workflows... Prefer extending an existing Windows/native workflow"). Existing steps (root/electron TypeScript checks, `build:electron`, `verify:electron-output`, `orphan-check`, `npm test`) are unchanged and preserved in their original order, with the new Rust/napi steps interleaved at the points where their real dependencies (toolchain before any cargo command; the release build before `cargo test --release`; the debug build before napi tests) are actually satisfied.

## Local validation of every new step (mirrors the CI script exactly)

| Step | Local result |
|---|---|
| `cargo fmt --check` | clean |
| `cargo clippy --release -- -D warnings` | clean, 0 warnings |
| `cargo test --release` | **185/185** (1 documented ignore) |
| `cargo build` (debug) | clean |
| `node --expose-gc --test test/*.test.js` (napi) | **52/52** |
| YAML syntax | validated locally via both `js-yaml` and `python3 -c "import yaml; yaml.safe_load(...)"` — both parse cleanly, 16 steps in the `windows` job |

## Trigger

`pr-windows.yml` triggers on `pull_request: branches: [master]` — i.e. these gates run automatically once a PR targeting `master` exists for this branch, not on a direct push to `feature/solith-phase1-scanner-reconstruction` (unchanged trigger condition, not modified this pass). A Phase 1 PR is opened this pass specifically to exercise this (see the final certification response for the PR number) — not merged, per every standing instruction in this operation.

## CI truth table (rechecked)

| Gate | Status |
|---|---|
| Rust fmt | **PASS** (now wired, validated locally) |
| Rust clippy | **PASS** (now wired, validated locally) |
| Rust test | **PASS** (now wired, validated locally) |
| napi build | AUTOMATIC_REQUIRED (unchanged — via `build:electron`) |
| napi tests | **PASS** (now wired, validated locally) |
| TypeScript (renderer) | AUTOMATIC_REQUIRED (unchanged) |
| TypeScript (electron) | AUTOMATIC_REQUIRED (unchanged, PR-to-master only) |
| JS/TS (`npm test`) | AUTOMATIC_REQUIRED (unchanged) |
| Electron build/package | AUTOMATIC_REQUIRED (unchanged) |

**Remote CI PASS/FAIL for this exact commit is reported in the final certification response once the branch is pushed and the PR's checks reach a terminal state** — this document records the workflow definition and its local-equivalent validation, not a claim of an already-observed green remote run before that push happens.
