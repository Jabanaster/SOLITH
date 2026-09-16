# Phase 1 — Final Reproducibility, Flake Gate and Remote CI

Covers mission §21 (full local verification), §22 (fresh worktree), §23 (remote CI) and the repeatability gate. Supersedes doc 135's forward-looking sections; doc 135's per-stage reproducibility history remains accurate.

Code-final SHA: **`30436d0ea8c45bf9b680b44a626240ece9a8c881`**.

## §21 — Full local verification

Run against the code-final SHA in the primary worktree.

| Gate | Result |
|---|---|
| `cargo fmt --check` | PASS |
| `cargo clippy --release --all-targets -- -D warnings` | PASS |
| `cargo test --release` | **185 passed, 0 failed, 1 ignored** |
| NAPI clean build + `node --expose-gc --test` | **52/52** |
| `npm test` (JS/TS) | **1988/1988**, plus **10/10** |
| `npm run test:live-memory` | **487/487** |
| renderer typecheck (`tsc -p tsconfig.json`) | PASS |
| electron typecheck (`tsc -p tsconfig.electron.json`) | PASS |
| `npm run build:vite` | PASS |
| `npm run build:electron` | PASS |
| `npm run verify:electron-output` | PASS — 33/33 |
| `npm run orphan-check` | PASS |
| `npx electron-builder --dir` | PASS |
| packaged native scan proof | PASS |
| packaged fuzzy scan proof | PASS |
| `npm audit` | **0 vulnerabilities** |
| Semgrep, exact CI gate | **NOT RUN LOCALLY** — see below |
| pointer real-process suite | PASS — 8/8 |
| D01 truth-reporting suite | PASS — 52/52 |
| fuzzy fixture + real + packaged | PASS |
| real-game coverage | PASS — doc 139 |

Test counts against the Stage 7.5 baseline: JS/TS 1904 → **1988**, live-memory 403 → **487**. No suite shrank.

### Semgrep, stated honestly

**Local Semgrep did not run.** `pip install semgrep` fails on this machine with `WinError 10013` reaching `pypi.org`, and the npm wrapper fetches the same blocked binary at postinstall. This is a network policy on the host, not a sandbox restriction — retrying with the sandbox disabled produced the identical failure.

The gate itself is **not** waived: `semgrep.yml` runs the exact same configuration on every push, and **Semgrep passes remotely at the code-final SHA** (below). The remote run is the authoritative gate and is the one CI blocks on. What is missing is the local pre-check, and it is recorded as missing rather than reported as passed.

## §22 — Fresh worktree

`git worktree add --detach` at the exact candidate SHA, outside both the primary worktree and the read-only shipping tree. Before any command runs, all six artifact paths are asserted **absent**:

- `native/solith-scanner-napi/solith-scanner-napi.win32-x64-msvc.node`
- `native/solith-scanner-core/target/`, `native/solith-scanner-napi/target/`
- `dist/`, `dist-electron/`, `node_modules/`

Nothing is copied in. The native addon is produced only by `npm run build:electron`'s own auto-build path — the same path a clean clone or a CI runner takes.

| Run | SHA | Result |
|---|---|---|
| 1 | `8cb2ad9` | **18/18 PASS** |
| 2 | `c63d349` | superseded mid-run and cancelled — see below |
| 3 | **`30436d0`** (code-final) | **18/18 PASS** |

Gates in each run: `npm ci`, both typechecks, `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test --release`, debug `cargo build` for the napi fixture, `build:electron`, `verify:electron-output`, the napi suite, `build:vite`, `orphan-check`, `npm test`, `test:live-memory`, `npm audit`, `electron-builder --dir`, and both packaged proofs.

**Run 2 was cancelled deliberately, not because it failed.** While it was in flight, probing the real driver's behavior against a dead process turned up the defect recorded in `30436d0` — `getRegions` returning empty rather than throwing. Continuing a fresh-worktree run against a SHA that was already known to be superseded would have produced evidence for a commit nobody would ship. It was stopped and re-run at the final SHA instead.

**FRESH WORKTREE AT THE CODE-FINAL SHA: PASS.** Every binary, every bundle and both packaged proofs were produced from source inside the clean worktree.

## Repeatability / flake gate

Critical suites run repeatedly at the code-final SHA. No intermittent failure accepted.

| Suite | Runs | Result |
|---|---|---|
| pointer real-process | 3 | 3/3 PASS |
| fuzzy real-process | 3 | 3/3 PASS |
| rollback matrix | 3 | 3/3 PASS |
| failure injection (real + closeout) | 3 | 3/3 PASS |
| full `test:live-memory` | 3 | 3/3 PASS (478/478 at the time, 487/487 after the final fix) |

**KNOWN FLAKY CERTIFICATION TESTS: 0.**

### The one flake found and fixed this closeout

`pointer-scanner-real-process.test.ts`'s depth-3 discovery case passed 3/3 in isolation and failed once under full-suite load. The cause was the **default** `maxTotalScans` of 25, close enough to what the planted chain actually needs (~7 scans, measured) that a different allocator layout can exhaust the budget before level 3.

That is a legitimate `scan_budget_exhausted` result — the scanner was right — but it made a *discovery* assertion depend on allocator luck. The budget is now explicit in the test, and the test additionally asserts the run did **not** end on the budget, so a future shortfall fails loudly instead of silently weakening the assertion. Diagnosed, not retried.

This is the third instance of the same class in Phase 1 (doc 128's u8 wire-type assertion, doc 124's fixture duplicate pattern, this one). All three were found by running the suite under real load rather than in isolation, which is the argument for keeping both modes in the gate.

## §23 — Remote CI

**Every required remote check is green at `30436d0ea8c45bf9b680b44a626240ece9a8c881`.**

| Check | Workflow | Status | Duration |
|---|---|---|---|
| **PR Windows** — Windows native and Electron gate | `pr-windows.yml` | **pass** | 6m57s |
| **Semgrep** | `semgrep.yml` | **pass** | 34s |
| **CI Fast** | `ci-fast.yml` | **pass** | 8m05s |
| PR Static — TypeScript and architecture checks | `pr-static.yml` | pass | 23s |
| Gitleaks | `gitleaks.yml` | pass | 8s |
| OSV-Scanner | `osv-scanner.yml` | pass | 18s |
| Vendored memoryjs integrity | `memoryjs-integrity.yml` | pass | 8s |

7 of 7 required checks pass. No stale run was accepted: every result above is from the head SHA itself, not inherited from an ancestor. No check was skipped, disabled or excused.

(`scan-full` reports `skipping` by design — it is the push-event branch of the OSV workflow and does not run on a pull request. `CodeRabbit` is an optional third-party reviewer, not a required check.)

`PR Windows` runs the full canonical gate on a real `windows-latest` runner: Rust fmt, clippy with `-D warnings`, `npm ci`, both TypeScript checks, `build:electron`, `verify:electron-output`, `orphan-check`, `cargo test --release`, a separate debug `cargo build` for the napi fixture, the napi suite with `--expose-gc`, and `npm test`.

It is worth noting that `PR Windows` was an intermittently-failing gate for most of this branch's history (doc 129: four failures in six runs, including the Stage 7.5 entry commit). It has now passed at `97e51b5`, `2e5cfa8`, `c63d349` and `30436d0` — four consecutive green runs since the EPIPE teardown repair.

## Local ≡ remote

```
local  HEAD : 30436d0ea8c45bf9b680b44a626240ece9a8c881
remote HEAD : 30436d0ea8c45bf9b680b44a626240ece9a8c881
worktree    : clean
```

Pushed normally, non-force. No history was rewritten and no prior Phase 1 commit was squashed.

## Pull requests

Both remain **OPEN** and **NOT MERGED**:

| PR | Base | Head | State |
|---|---|---|---|
| #31 | `master` | `feature/solith-phase1-scanner-reconstruction` (`30436d0`) | OPEN, not merged |
| #29 | `master` | `feature/solith-canonical-convergence-phase0` (`3b8c1c3`) | OPEN, not merged |

## Dependency security

GitHub reports **18 vulnerabilities on the default branch — 12 high, 4 moderate, 2 low**, unchanged from doc 129.

Dependency-path analysis, as the second mission's §26 requires rather than a blanket deferral: none of the 18 blocks any required check above, and `npm audit` against this branch's current lockfile reports **0 vulnerabilities**. Those two facts are not in conflict and neither is evidence about the other — Dependabot scans the **default branch's** manifest set, `npm audit` scans **this branch's** resolved lockfile. They are different trees.

The findings are therefore **not claimed as fixed**. They are classified `SECURITY_FOLLOWUP_REQUIRED` / `OUT_OF_PHASE1_SCANNER_SCOPE` and forward-assigned to Phase 13 (doc 133, FA-6). Two of the open PRs (#28, #30) are Dependabot's own upgrade proposals and remain unmerged by instruction.

## Documentation commits after this SHA

Docs 139 (amended), 142 and any later amendment are committed after `30436d0` by necessity — a document cannot record a CI result that has not happened yet. Those commits change only `Docs/phase1/**`: no production code, no test, no script, no workflow, no manifest. The code-final SHA and the certified SHA are therefore the same for every gate that exercises code.
