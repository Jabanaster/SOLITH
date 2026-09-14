# Phase 1 / Stage 4 — Fresh-Worktree / Reproducibility Check

## Method

Same discipline as Stage 2/3 (docs 18, 26): a disposable, detached git worktree created at the exact Stage 4 candidate SHA, entirely separate from the working tree this stage's development happened in.

```
git worktree add --detach /g/ACTIVE_PROJECTS/solith-phase1-stage4-repro-check afc4c3a
```

`afc4c3a` is `perf(scanner): benchmark scan-session refinement engine` — the last implementation commit before the Stage 4 evidence-docs commit, i.e. the actual candidate state being certified, consistent with Stage 2/3's own ordering convention.

## A real environment issue hit and resolved (not a code defect)

The initial `git worktree add` attempt failed with `Filename too long` while checking out unrelated, pre-existing long-path files under `Docs/Security/Evidence/BatchB1_1_Closeout/...` (from this repository's own history, unrelated to any Stage 4 change). Resolved by enabling `core.longpaths` for the operation:

```
git -c core.longpaths=true worktree add --detach ...
```

A separate authoring mistake (not a tooling issue) happened first: an initial `git worktree add` invocation used a backslash-separated Windows-style path (`G:\ACTIVE_PROJECTS\solith-phase1-stage4-repro-check`) from this session's Bash tool, which does not preserve backslashes as path separators — Bash consumed them, and git ended up creating a mis-named directory (`ACTIVE_PROJECTSsolith-phase1-stage4-repro-check`) nested *inside* the current repository instead of as a sibling directory. Caught immediately (the worktree's contents were unreachable at the intended path), cleaned up via `Remove-Item -Recurse -Force` (PowerShell, which handles the resulting long paths more gracefully than a `rm -rf` through the Bash/MSYS layer) plus `git worktree prune`, and redone with a forward-slash path — recorded here transparently rather than silently redone, per this project's own established "document real mistakes, don't hide them" convention (see Stage 3 doc 25's two caught-and-fixed bugs).

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

- `cargo test` (solith-scanner-core): **50 unit + 15 exact-scan integration + 8 fixture integration + 17 session integration = 90/90 pass.**
- `npm install` (isolated napi package): succeeds, `found 0 vulnerabilities`.
- `napi build --platform` (debug): succeeds.
- `npm test` (napi-layer integration suite): **23/23 pass**, including all 11 new Stage 4 session JS tests.
- Script's own final verification: confirmed the `.node` file exists at the expected path.

Identical pass/fail counts to every prior run of the same commands in the original development tree (doc 32) — no hidden local state was silently relied upon.

## Cleanup

```
git worktree remove /g/ACTIVE_PROJECTS/solith-phase1-stage4-repro-check --force
```

Confirmed via `git worktree list` afterward: the disposable worktree is gone; the repository's registered worktree for this branch remains at the correct commit, unaffected.

## Full existing suite (separately verified, not part of the fresh-worktree check)

The full existing 1781/1781+10/10 JS/TS suite, both typechecks, and both application builds were re-verified in the main development tree after all Stage 4 implementation commits (doc 32) — not re-run inside the disposable worktree itself, for the same scoping reason Stage 2/3 gave (doc 18/26): that would require rebuilding the entire Electron/Vite toolchain's `node_modules` from scratch there, which is unrelated to what this specific check exists to verify (the *native* toolchain's fresh-clone reproducibility).

## What this does and does not prove

Same caveats as Stage 2/3's own docs: this proves the exact command sequence a fresh contributor or CI would run succeeds identically from a checkout containing nothing but this stage's committed files, with Cargo/npm's global package caches still warm (not a from-zero-network-cache CI run — the pinned dependency set changed only by adding `windows-sys` as a **dev**-dependency of `solith-scanner-core`, the exact same crate/version already vendored as a main dependency, so no new crate was fetched). It does not prove packaged-Electron-app loading (still explicitly out of scope) or non-Windows behavior (still Windows-only by design). It additionally does not prove `git worktree add` is robust to arbitrarily long repository paths in general — the long-path issue encountered and resolved above is a known, general Windows/git characteristic of this repository's history, unrelated to Stage 4, and worth the wider project fixing at some point (e.g. via `git config core.longpaths true` set once, repository-wide) rather than re-discovering per stage.
