# Phase 1 / Stage 3 — Fresh-Clone / Reproducibility Check

## Method

Same discipline as Stage 2 (doc 18): a disposable, detached git worktree created at the exact Stage 3 candidate SHA, entirely separate from the working tree this stage's development happened in.

```
git worktree add --detach G:\ACTIVE_PROJECTS\solith-phase1-stage3-repro-check 4c6004f83547b8f85723450d2aa6bace8bb4f8c1
```

`4c6004f` is `perf(scanner): benchmark native exact scan engine` — the last implementation commit before the Stage 3 evidence-docs commit, i.e. the actual candidate state being certified (docs are not part of "implementation" for this check's purposes, consistent with the mission's ordering: "after implementation is committed... create a disposable fresh worktree").

## Verified absence of pre-existing state

```
native/solith-scanner-core/target       — does not exist
native/solith-scanner-napi/node_modules — does not exist
native/solith-scanner-napi/*.node       — does not exist
```

Confirmed before running anything — no dependence on untracked native artifacts or the main worktree's own build output (mission §3.19's explicit requirements).

## Build and test, via the repository-supported command

```
npm run build:scanner-native-foundation
```

## Result

- `cargo test` (solith-scanner-core): **35 unit + 15 exact-scan integration + 8 fixture integration = 58/58 pass.**
- `npm install` (isolated napi package): succeeds, `found 0 vulnerabilities`.
- `napi build --platform` (debug): succeeds.
- `npm test` (napi-layer integration suite): **12/12 pass**, including all 7 new Stage 3 exact-scan JS tests.
- Script's own final verification: confirmed the `.node` file exists at the expected path.

Identical pass/fail counts to every prior run of the same commands in the original development tree (docs 20/23) — no hidden local state was silently relied upon.

## Cleanup

```
git worktree remove G:\ACTIVE_PROJECTS\solith-phase1-stage3-repro-check --force
```

Confirmed via `git worktree list` afterward: the disposable worktree is gone; the repository's registered worktree for this branch remains at the correct commit, unaffected.

## Full existing suite (separately verified, not part of the fresh-worktree check)

The full existing 1781/1781+10/10 JS/TS suite, both typechecks, and both application builds were re-verified in the main development tree after all Stage 3 commits (doc 23) — not re-run inside the disposable worktree itself, since that would require also rebuilding the entire Electron/Vite toolchain's `node_modules` from scratch there, which is unrelated to what this specific check exists to verify (the *native* toolchain's fresh-clone reproducibility). This mirrors Stage 2's own doc 18 scoping decision, applied consistently.

## What this does and does not prove

Same caveats as Stage 2's doc 18: this proves the exact command sequence a fresh contributor or CI would run succeeds identically from a checkout containing nothing but this stage's committed files, with Cargo/npm's global package caches still warm (not a from-zero-network-cache CI run, which was not re-exercised since the pinned dependency set is unchanged from Stage 2 — see doc 22, no new napi-rs or crates.io dependency was added this stage). It does not prove packaged-Electron-app loading (still explicitly out of scope, mission §3.17) or non-Windows behavior (still Windows-only by design).
