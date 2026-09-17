# Phase 1 / Stage 7.5 §1, §13 — Semgrep Verification

## Commit 6fcd0c5 — already present, no integration required

Mission §0 asked whether the separately-pushed Semgrep fix needed integrating. It does not:

```
$ git rev-parse HEAD
6fcd0c5dd193dc9293f94d2ef7eaddf95ade8466
$ git rev-parse origin/feature/solith-phase1-scanner-reconstruction
6fcd0c5dd193dc9293f94d2ef7eaddf95ade8466
$ git merge-base --is-ancestor 0fcc77d74c7de8ab494078816e21896796750dc6 HEAD  # -> true
```

`6fcd0c5` **is** the branch tip and local `==` remote at entry. The Stage 7.4 certified head `0fcc77d` is its parent. Nothing was cherry-picked, merged, or duplicated.

**SEMGREP FIX COMMIT 6fcd0c5: ALREADY PRESENT.**

## What 6fcd0c5 actually changed

Three files, 12 insertions, 1 deletion.

| File | Change |
|---|---|
| `.github/workflows/pr-windows.yml` | `dtolnay/rust-toolchain@stable` → `@6bed0761d98439e5a578e2877258200ad565ba87 # stable` |
| `scripts/build-scanner-napi-release.mjs` | 2 line-scoped `nosemgrep` suppressions + justification comment |
| `scripts/build-scanner-native-foundation.mjs` | 3 line-scoped `nosemgrep` suppressions + justification comment |

Against mission §1's expectations:

- **rust-toolchain action pinned to SHA** — yes, with the moving tag preserved as a trailing comment so the intent stays legible.
- **Windows npm spawn suppressions justified** — yes. The justification is static and checkable: `shell:true` is required because `CreateProcess` cannot launch `npm.cmd` directly (`shell:false` throws `ENOENT`), and every argument at these call sites is a hardcoded literal (`['install']`, `['run','build']`, `['run','build:debug']`, `['test']`) with no user input reaching the command line.
- **No broad security suppression** — confirmed. All five suppressions name the exact rule (`javascript.lang.security.audit.spawn-shell-true.spawn-shell-true`) and apply to the single following line. There is no file-level suppression, no `.semgrepignore` entry, no severity threshold change, and no rule disabled in configuration. The repository contains no Semgrep configuration file at all; CI uses the upstream `p/default` registry pack unmodified.
- **Build scripts still function on Windows** — confirmed this stage, see below.

The commit message says "three npm spawnSync calls" where the diff has five. That is an imprecise message, not a defect in the change.

## Local verification this stage

Semgrep is not packaged for Windows and was not present on this host; CI runs it on `ubuntu-latest`. It was installed into an isolated virtualenv (`python -m venv` + `pip install semgrep`, the same install path `semgrep.yml` uses) rather than into the machine's global environment, and run with the exact CI invocation.

### PR gate — the check that actually blocks PR #31

CI (`semgrep.yml`, `pull_request` branch): `semgrep scan --config p/default --error --metrics=off --baseline-commit "$BASE" .`

```
baseline = 4ab7433e4db242a1479244a992b18ed068d8fb8e  (== origin/master)
files changed vs baseline = 216
Ran 250 rules on 178 files: 0 findings.
 • Findings: 0 (0 blocking)
exit code 0
```

**SEMGREP LOCAL (PR gate): PASS — 0 findings, 0 blocking, across all 216 changed files.**

### Full-repo audit — the advisory, non-blocking job

CI (`semgrep.yml`, `push` branch): `semgrep scan --config p/default --metrics=off .` — note the absence of `--error`, so this job reports without failing.

Run in full: **81 findings**, distributed as:

| Rule | Count | Files |
|---|---|---|
| `path-join-resolve-traversal` | 44 | `backups/`, `scanner/`, `games/`, `saves/`, `database/`, `safety/`, `trainer-host/`, 2 scripts |
| `unsafe-formatstring` | 17 | `database/`, `saves/locations.ts`, `games/`, 4 electron modules, adapters |
| `spawn-shell-true` | 4 | `scripts/` (dev/tooling only) |
| `detect-child-process` | 4 | `scripts/dev.mjs`, `injector-launcher.ts`, `host-supervisor.ts`, `command-runner.ts` |
| `prototype-pollution-loop` | 6 | `adapters/json.ts`, `recipes/`, `saves/json-save-field.ts` |
| `detect-non-literal-regexp` | 3 | `release-artifact-utils.mjs`, `script-research/aob-parser.ts` |
| others | 3 | `hardcoded-hmac-key`, `npm-missing-minimum-release-age`, `react-dangerouslysetinnerhtml` |

**Every one of these is pre-existing and none is in a file this stage touched.** No finding appears in `src/core/live-memory/`, in `native/solith-scanner-core/src/bin/fixture.rs`, in either new test suite, or in either new script. That is why the PR gate above reports 0 while the full audit reports 81: the PR gate diffs against master.

These 81 are **not** claimed as fixed and **not** silently absorbed into this stage's verdict. Disposition: `SECURITY_FOLLOWUP_REQUIRED`, out of Phase 1 scanner scope, forward-assigned — see doc 133.

## Windows build verification after 6fcd0c5

Both suppressed build scripts were executed in full this stage, not merely inspected:

| Gate | Result |
|---|---|
| `npm run build:electron` (runs `build-scanner-napi-release.mjs`) | PASS — 33/33 output checks |
| `npm run verify:electron-output` | PASS — 33/33 |
| `npm run orphan-check` | PASS — no orphaned TrainerHost PID |
| `cargo build` / `cargo build --release` (native foundation path) | PASS |
| `npx electron-builder --dir` | PASS |

**WINDOWS NATIVE BUILD: PASS. ELECTRON BUILD: PASS.**

## Suppressions added this stage

None. This stage added no `nosemgrep` comment, no ignore entry, and no configuration change of any kind.
