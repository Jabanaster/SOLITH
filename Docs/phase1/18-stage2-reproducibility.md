# Phase 1 / Stage 2 — Fresh-Clone / Reproducibility Check

## Method

Per the mission's explicit instruction not to certify reproducibility only from an already-warmed development tree: a disposable git worktree was created at the final Stage 2 candidate commit, entirely separate from the working tree this stage's development happened in.

```
git worktree add --detach G:\ACTIVE_PROJECTS\solith-phase1-repro-check 69e74b2d4e8515e3b4cb87c344aa76ad2718a292
```

`69e74b2` is `test: add Stage 2 native-reader benchmarks` — the last implementation commit before this evidence-docs commit, i.e. the actual candidate state being certified. A git worktree checkout, unlike simply re-running commands in the existing directory, produces a genuinely fresh working copy (only tracked, committed files — no `target/`, no `node_modules/`, no `.node` binary, since all three are absent from the commit by design, per doc 11's build-artifact discipline) while still sharing the local object database, which is the closest equivalent to a true fresh `git clone` obtainable without network access to the (not-yet-pushed) remote.

## Verified absence of pre-existing state

Before running anything, confirmed directly:
```
native/solith-scanner-core/target       — does not exist
native/solith-scanner-napi/node_modules — does not exist
native/solith-scanner-napi/*.node       — does not exist
```

## Build and test, from the fresh worktree, via the repository-supported command

```
npm run build:scanner-native-foundation
```

(the same, single, documented entry point a fresh contributor would use — not a hand-assembled sequence of internal commands).

## Result

- `cargo test` (solith-scanner-core): **16/16 unit + 8/8 integration = 24/24 pass.**
- `npm install` (isolated napi package): succeeds, `found 0 vulnerabilities`.
- `napi build --platform` (debug): succeeds, produces `index.js`/`index.d.ts`/`solith-scanner-napi.win32-x64-msvc.node`.
- `npm test` (napi-layer integration suite): **5/5 pass.**
- Script's own final verification (`existsSync(builtAddon)`): confirmed the `.node` file exists at the expected path.

Identical pass/fail counts to every prior run of the same commands in the original development tree (docs 13/15) — no hidden local state (a stray environment variable, a manually-placed file, a previously-cached build artifact outside version control) was silently relied upon.

## Cleanup

```
git worktree remove G:\ACTIVE_PROJECTS\solith-phase1-repro-check --force
```

Confirmed via `git worktree list` afterward: the disposable worktree is gone; the repository's registered worktree for this branch (`G:/ACTIVE_PROJECTS/solith-phase0-convergence`) is unaffected and remains at the same commit.

## What this does and does not prove

**Proves**: the exact command sequence a fresh contributor (or CI, on a machine with the Rust toolchain and Node already installed) would run, run from a checkout containing nothing but this stage's committed files, succeeds identically to the development-tree run. Cargo's and npm's own package caches (`~/.cargo/registry`, npm's global cache) were still warm on this machine during this check — this verifies "no repo-local hidden state," not "works with zero network access to crates.io/npm on a machine that has never built this project before." A true CI-from-scratch run (empty Cargo/npm caches) is expected to additionally download the pinned dependency versions listed in doc 14, which this check did not need to exercise since they were already cached.

**Does not prove**: that the eventual packaged Electron app correctly loads this addon (Stage 2 does not wire it into the packaged app at all — see doc 09's migration ladder and the mission's own §20 boundary) or that the fresh-clone property holds on a non-Windows machine (this crate is Windows-only by design, matching the project's own packaging target; `build:scanner-native-foundation` explicitly no-ops on non-Windows platforms rather than failing).
