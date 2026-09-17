# Phase 1 / Stage 5 — Fresh-Worktree / Reproducibility Check

## Method

Same discipline as Stage 2/3/4 (docs 18, 26, 35): a disposable, detached git worktree created at the exact Stage 5 candidate SHA, entirely separate from the working tree this stage's development happened in.

```
git -c core.longpaths=true worktree add --detach /g/ACTIVE_PROJECTS/solith-phase1-stage5-repro-check 8bc1a65
```

`8bc1a65` is `perf(scanner): benchmark byte/string/AOB pattern scanning` — the last implementation commit before this stage's own evidence-docs commit, i.e. the actual candidate state being certified, consistent with every earlier stage's own ordering convention.

`core.longpaths=true` was applied proactively this time (Stage 4 doc 35 already identified this repository's history contains long-path files under `Docs/Security/Evidence/BatchB1_1_Closeout/...` unrelated to any scanner work) — the checkout completed without the `Filename too long` failure Stage 4 hit, and without repeating Stage 4's own backslash-path authoring mistake (a forward-slash path was used from the start).

## Verified absence of pre-existing state

```
native/solith-scanner-core/target       — does not exist
native/solith-scanner-napi/node_modules — does not exist
native/solith-scanner-napi/*.node       — does not exist
```

Confirmed before running anything — no dependence on untracked native artifacts or the main worktree's own build output.

## Build and test, via the repository-supported command

```
npm run build:scanner-native-foundation
```

## Result

- `cargo test` (solith-scanner-core): **76 unit + 15 exact-scan integration + 8 fixture integration + 20 pattern-scan integration + 17 session integration = 136/136 pass.**
- `npm install` (isolated napi package): succeeds.
- `napi build --platform` (debug): succeeds.
- `npm test` (napi-layer integration suite): **39/39 pass**, including all 16 new Stage 5 pattern JS tests.
- Script's own final verification: confirmed the `.node` file exists at the expected path.

Identical pass/fail counts to every prior run of the same commands in the original development tree (doc 42) — no hidden local state was silently relied upon.

## Cleanup

```
git worktree remove /g/ACTIVE_PROJECTS/solith-phase1-stage5-repro-check --force
```

Confirmed via `git worktree list` afterward: the disposable worktree is gone; every other registered worktree in this repository (several dozen, from unrelated prior sessions) remains listed and unaffected, and this branch's own registered worktree remains at the correct commit.

## Full existing suite (separately verified, not part of the fresh-worktree check)

The full existing 1781/1781+10/10 JS/TS suite, both typechecks, and both application builds were re-verified in the main development tree after all Stage 5 implementation commits (doc 42) — not re-run inside the disposable worktree itself, for the same scoping reason every earlier stage gave: that would require rebuilding the entire Electron/Vite toolchain's `node_modules` from scratch there, which is unrelated to what this specific check exists to verify (the *native* toolchain's fresh-clone reproducibility).

## What this does and does not prove

Same caveats as every earlier stage's own doc: this proves the exact command sequence a fresh contributor or CI would run succeeds identically from a checkout containing nothing but this stage's committed files, with Cargo/npm's global package caches still warm (not a from-zero-network-cache CI run — no new crate or npm package was added this stage at all, so the dependency set is byte-for-byte identical to Stage 4's already-verified one). It does not prove packaged-Electron-app loading (still explicitly out of scope) or non-Windows behavior (still Windows-only by design).
