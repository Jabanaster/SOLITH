# Phase 1 / Stage 7.5 §17 — Remote CI

## Result

**Every required remote check is green at `97e51b57517c513b19afa89b4e2f084013e3c0fb`.**

| Check | Workflow | Status |
|---|---|---|
| **PR Windows** — Windows native and Electron gate | `pr-windows.yml` | **success** |
| **Semgrep** | `semgrep.yml` | **success** |
| CI Fast | `ci-fast.yml` | success |
| PR Static | `pr-static.yml` | success |
| Gitleaks | `gitleaks.yml` | success |
| OSV-Scanner | `osv-scanner.yml` | success |
| Vendored memoryjs integrity | `memoryjs-integrity.yml` | success |

7 of 7 runs completed, 7 of 7 successful. No stale run was accepted: every result above is from the head SHA itself, not inherited from an ancestor. No check was skipped, disabled, or excused.

`PR Windows` runs the full canonical gate on a real `windows-latest` runner: Rust fmt, Rust clippy with `-D warnings`, `npm ci`, both TypeScript checks, `build:electron`, `verify:electron-output`, `orphan-check`, `cargo test --release`, a separate debug `cargo build` for the napi fixture, the napi suite with `--expose-gc`, and `npm test`.

## What this closes

Doc 121 recorded Stage 7.4 as `REMOTE_CI_CERTIFICATION: FAIL`. Two separate problems were behind that, and both are now resolved.

### 1. Semgrep — closed by `6fcd0c5`, verified here

A mutable action tag and three (in fact five) unsuppressed `spawn-shell-true` findings in the native build scripts. Fixed before this stage began; doc 123 records the verification. Remote Semgrep is green at both `252a34c` and `97e51b5`.

### 2. `PR Windows` — an intermittent failure found and fixed this stage

`PR Windows` failed at `252a34c` with:

> Test "1 — successful native exact scan, then rollback to LEGACY, then back to NATIVE" ... generated asynchronous activity after the test ended. This activity created the error "Error: write EPIPE" and would have caused the test to fail, but instead triggered an uncaughtException event.

**Cause.** Every fixture-spawning test tears down the same way:

```ts
try { child.stdin.write('exit\n'); } catch { /* already gone */ }
child.kill();
```

That `catch` does not do what it appears to. `stream.write()` does not report a broken pipe synchronously — it emits an asynchronous `'error'` event — so when the fixture has already died, the EPIPE arrives after the `try` block has completed. With no `'error'` listener on the stream, Node escalates it to an `uncaughtException`; because it lands after the test function has returned, the runner attributes it to the test and fails the entire file.

Whether it fires at all depends on how quickly the child dies relative to the write. That is why it is intermittent, and why a loaded shared runner surfaces it far more often than a developer machine.

**It is not a Stage 7.5 regression.** The run history on this branch:

| SHA | `PR Windows` |
|---|---|
| `fb5f7d0` | failure |
| `ff10505` | failure |
| `af5a0bd` | success |
| `0fcc77d` | success |
| **`6fcd0c5`** (Stage 7.5 entry) | **failure** |
| `252a34c` | failure |
| **`97e51b5`** | **success** |

It reproduces at `6fcd0c5` — the commit this stage started from, with none of this stage's work present. Two passes and four failures across six runs is the profile of a race, not of a deterministic break.

**It was still fixed rather than noted.** Mission §17 allows no "pre-existing failure" exception for a required remote check, and a required check that fails most of the time is a broken gate whoever introduced it.

**Fix** (`97e51b5`). An `'error'` listener on `child.stdin` in all 12 fixture-spawning files, so the EPIPE is handled instead of fatal. This suppresses nothing meaningful: a fixture that has already been told to exit has no further output any caller is waiting on, every assertion in these tests runs before teardown, and the stdout-side reject path that detects an unexpected fixture response is untouched. Verified with `scanner-backend-rollback-matrix.test.ts` 7/7 on three consecutive runs and the full live-memory suite at 403/403.

## Local ≡ remote

```
local  HEAD : 97e51b57517c513b19afa89b4e2f084013e3c0fb
remote HEAD : 97e51b57517c513b19afa89b4e2f084013e3c0fb
```

Pushed normally, non-force. No history was rewritten, and no prior Phase 1 commit was squashed.

## Pull requests

Both remain **OPEN** and **NOT MERGED**, unchanged by this stage beyond the new commits pushed to #31's existing head branch:

| PR | Base | Head | State |
|---|---|---|---|
| #31 | `master` | `feature/solith-phase1-scanner-reconstruction` | OPEN, not merged |
| #29 | `master` | `feature/solith-canonical-convergence-phase0` | OPEN, not merged |

## Dependabot

GitHub reported on push: **18 vulnerabilities on the default branch — 12 high, 4 moderate, 2 low.** This independently confirms the count this mission was given, and it is recorded rather than acted on.

None of these blocks any required check above. They are **not** claimed as fixed: `npm audit` reporting 0 against the current lockfile is a different tool over a different surface and is not evidence about Dependabot's findings. Classified `SECURITY_FOLLOWUP_REQUIRED` / `OUT_OF_PHASE1_SCANNER_SCOPE` and forward-assigned in doc 133 (FA-6).

## Documentation commits after this SHA

Docs 128, 129, 130 and 136 are committed after `97e51b5` by necessity — a document cannot record a CI result that has not happened yet. Those commits change only `Docs/phase1/**`; they touch no production code, no test, no script, no workflow and no manifest. The CI result for the final documentation SHA is appended to doc 130's certification table.
