# Phase 1 — Final Reproducibility

Phase-wide synthesis. The Stage 7.5 fresh-worktree run itself is doc 128; this document records what reproducibility has meant across Phase 1 and what the current, end-of-phase position is.

## Per-stage reproducibility record

Every stage ran its own fresh-worktree or fresh-clone check rather than inheriting the previous stage's claim.

| Stage | Reproducibility doc | Result at the time |
|---|---|---|
| 2 | 18 | PASS |
| 3 | 26 | PASS |
| 4 | 35 | PASS |
| 5 | 45 | PASS |
| 6 | 69 | PASS |
| 7 | 86 | PASS |
| 7.2 | 100 | PASS — found the `target/debug` fixture gap that CI now covers with a separate `cargo build` |
| 7.3 | 110 | PASS |
| 7.4 | 120 | PASS |
| **7.5** | **128** | see doc 128 |

Doc 100's finding is worth keeping visible: the napi JS suite looks for the fixture binary under `target/debug`, which `cargo test --release` does not produce. That was discovered by a fresh worktree and nothing else, and it is why `pr-windows.yml` runs a separate debug `cargo build`. It is the clearest evidence in Phase 1 that these runs are load-bearing rather than ceremonial.

## What "no hidden artifact dependency" is verified against

Each fresh-worktree run asserts these are **absent** before any command runs, then builds them from source only through canonical scripts:

- `native/solith-scanner-napi/solith-scanner-napi.win32-x64-msvc.node`
- `native/solith-scanner-core/target/`
- `native/solith-scanner-napi/target/`
- `dist/`, `dist-electron/`, `node_modules/`

No artifact is ever copied in from the working worktree. The native addon is produced by `npm run build:electron`'s own auto-build path, which is the same path a developer or CI would take from a clean clone.

## Current-truth test counts

Stated as current, not inherited. Historical per-stage counts remain in their own stage documents and are not restated here as if they were current.

| Suite | Current count |
|---|---|
| Rust (`cargo test --release`, `native/solith-scanner-core`) | 185 passed, 0 failed, 1 ignored |
| NAPI (`node --expose-gc --test test/*.test.js`) | 52 passed, 0 failed |
| JS/TS (`npm test`) | 1904 passed, 0 failed, plus 10 passed in the SQL-parameter-binding run |
| live-memory (`npm run test:live-memory`) | 403 passed, 0 failed |
| renderer typecheck (`tsc --noEmit`) | PASS |
| electron typecheck (`tsc -p tsconfig.electron.json --noEmit`) | PASS |
| Vite build | PASS |
| Electron build (`build:electron`) | PASS — 33/33 output checks |
| Native addon build | PASS |
| Package (`electron-builder --dir`) | PASS |
| Packaged native scan proof | PASS |
| Packaged fuzzy scan proof | PASS |
| `orphan-check` | PASS |
| `npm audit` | 0 vulnerabilities |
| Semgrep (CI PR-gate configuration) | 0 findings, 0 blocking |

The one ignored Rust test is long-standing and stage-documented; it is not a silent skip.

### Why these counts differ from Stage 7.4's

Stage 7.4 recorded Rust 185/185 (1 ignored), NAPI 52/52, JS/TS 1869 + 10. Rust and NAPI are unchanged. JS/TS moved 1869 → 1904 (+35), accounted for exactly: 23 fixture-matrix cases + 4 real-process fuzzy cases + 8 failure-injection-closeout cases. live-memory moved 368 → 403 by the same 35.

The Stage 7.4 live-memory figure also included **2 failures** that doc 121 did not record — see doc 131's correction and doc 132's D16.

## Stage 5 corpus policy — unchanged and not contradicted

Restated here only to confirm nothing in the Phase 1 closeout documents disturbs it:

- **Current reproducible corpus: 111,467** — the sole certification denominator.
- **Historical certified run: 120,245** — preserved permanently as `HISTORICAL_CERTIFIED_RUN_COUNT_UNRECONCILED` (doc 54).
- **100% supported-valid grammar coverage** against the current reproducible corpus (doc 56).
- The ≈4,714 / ≈4,064 proportional estimates of the 8,778 gap remain explicitly **non-authoritative forensic arithmetic**, used in no certification calculation (docs 49, 54).

No document numbered 122-136 introduces a corpus count, a denominator, or a gap estimate. Doc 54's prohibition on further estimation of the 8,778 gap is honored.

## Position

Local reproducibility is established at the Stage 7.5 candidate: a clean worktree at the exact SHA, with every build artifact verified absent beforehand, reaches a green state through canonical commands only. Remote CI is recorded separately in doc 129, because a local pass is not a substitute for it and Stage 7.4's own history (doc 121: local PASS, remote FAIL) is the reason that distinction is kept sharp.
