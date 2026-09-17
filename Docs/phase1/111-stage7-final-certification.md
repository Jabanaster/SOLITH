# Phase 1 / Stage 7.3 — Final Certification Gate

## Legacy caller inventory reverify (mission §16 of Stage 7.2, folded into 7.3)

Rerun: `grep -rn "scanFirst(\|scanAobInProcess(\|scanFirstRegions(" src/core/live-memory/*.ts src/core/in-process-script/*.ts electron/*.ts`, excluding test files and the `LegacyScannerBackend` adapter. **Result: identical caller set to doc 97's inventory. Zero new direct legacy-scanner bypasses introduced this pass.** Every production code change this pass touched `LiveMemorySession`'s new operation registry, `ScannerBackendRouter`'s default/shadow-control fix, and the IPC/preload/type layers around the two already-routed operations (exact scan, AOB scan) — none of it added a new caller of `scanFirstRegions`/`scanAobInProcess`.

**LEGACY CALLERS UNKNOWN: 0.**

## Certification gate, item by item (mission's exact Stage 7.3 §27 list)

| # | Requirement | Status |
|---|---|---|
| 1 | NATIVE is production default | **MET** — doc 106, proven at unit/IPC/real-game levels |
| 2 | LEGACY is explicit rollback only | **MET** — for the two migrated operations (exact scan, AOB scan via `scanAobViaBackend`); doc 107 |
| 3 | No silent fallback | **MET** — `allowFallback` remains `false` by default, unchanged and reconfirmed |
| 4 | Production cancellation works | **MET** — real, genuine mid-flight cancellation proven (doc 102) |
| 5 | Rollback 8/8 | **MET** — doc 103 |
| 6 | Full failure injection passes | **PARTIAL** — 10/16 cases now real-evidenced (doc 104); 4 cases (wrong/corrupt addon, addon load failure as a real artifact, access denied) remain synthetic or uncovered; 2 (corrupt snapshot metadata, unsupported snapshot version) not applicable/out of scope |
| 7 | Real-process parity complete | **PARTIAL** — new rows added (doc 105); the full 10-primitive × 15-case × 13-pattern matrix remains far from exhaustive, honestly unchanged from doc 94's disclosed gap |
| 8 | Native bugs 0 | **MET** — across every real-process/real-IPC/real-game test this entire operation has ever run, including every new test this pass |
| 9 | Unresolved real differences 0 | **MET** — same |
| 10 | Default 10k result cap preserved | **MET** — unchanged, reconfirmed via `scanner-backend-rollback-matrix.test.ts` case 7's explicit-cap test |
| 11 | Bounded IPC passes | **MET** — unchanged from doc 92, no giant payload introduced by the new cancellation channels (they return only an `operationId` string or a poll result already capped by the existing result-bounding logic) |
| 12 | Exact int64/u64 through full shipping boundary | **PARTIAL** — i64 fully proven through the default route with zero override (doc 107); u64 remains provable only at the backend layer — no `uint64` wire type exists |
| 13 | `>1 MiB` through shipping path passes | **MET** — doc 107, zero override |
| 14 | Unaligned through shipping path passes | **PARTIAL** — u32 and i64 dimensions proven; u16 dimension genuinely untestable (no wire type) — doc 107 |
| 15 | AOB through shipping consumers passes | **NOT MET** — only the one migrated consumer (`scanAobViaBackend`) is proven; `feature-resolver.ts`, `signature-engine.ts`, and `hook-engine.ts` remain unmigrated real production AOB call sites — doc 107 |
| 16 | 3/3 real games pass under default NATIVE | **PARTIAL** — 1/3 (Bastion) reverified under the literal new default this pass, per the mission's own reuse rule (no scan-logic change justified relaunching all 3); doc 108 |
| 17 | Packaged app defaults NATIVE | **MET** — packaged real-scan smoke passes (both primary and fresh worktree); default-NATIVE routing is a session/router-level guarantee proven separately and ships unchanged in the package |
| 18 | Fresh build defaults NATIVE | **MET** — doc 110, real, zero-override proof in a genuinely fresh worktree |
| 19 | Native CI gates exist | **MET** — doc 109, `pr-windows.yml` extended, every new step locally validated |
| 20 | Remote CI green | **BLOCKED, NOT A CODE FAILURE** — see below |
| 21 | Legacy callers unknown 0 | **MET** — reconfirmed above |
| 22 | 1 MiB shipping defect closed | **MET** — doc 107 |
| 23 | Alignment shipping defect closed | **NOT MET** — doc 107 (u16 dimension untestable) |
| 24 | AOB shipping defect closed | **NOT MET** — doc 107 (unmigrated real callers) |
| 25 | int64 shipping defect closed | **NOT MET** — doc 107 (u64 dimension untestable via IPC) |
| 26 | Pointer depth correctly remains open | **MET** — untouched |
| 27 | ROADMAP untouched, shipping tree untouched, PR #29 unmerged, zero Stage-7 P0/P1 defects | **MET** — all four reconfirmed at every checkpoint this pass; no Stage-7-introduced defect was left unresolved (the SHADOW_COMPARE control-forwarding gap this pass itself found was fixed within the same pass, before being left open) |

## Remote CI — blocked by an account issue, not a code issue

PR #31 was opened against `master` specifically to trigger `pr-windows.yml`'s new native gates. **Every check on that PR failed within 2-6 seconds**, before any step ran. `gh run view` for the Windows job shows the actual cause:

> "The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings"

This is a GitHub Actions billing/account issue on the repository owner's account, unrelated to any code in this pass. It cannot be fixed by any change to this repository's source, workflow YAML, or CI configuration — it requires the account holder to resolve billing in GitHub's own settings. Every new CI step this pass added was independently validated locally (doc 109) against the exact commands the workflow runs, which is the strongest verification available without a working remote runner.

**REMOTE CI: BLOCKED (account billing issue) — not evaluated as PASS or FAIL, since no job executed.**

## Verdict

**NOT_COMPLETE.**

Of 27 gate items: 16 MET, 6 PARTIAL, 4 NOT MET, 1 BLOCKED by an external account issue. This pass closed one of four named shipping defects (1 MiB) with full, zero-override, real production-path proof; built and proved a genuine production cancellation contract with real mid-flight interruption; completed the full 8-case rollback matrix; closed 3 failure-injection gaps; and switched the production default to NATIVE with real evidence at the unit, IPC, packaged-build, fresh-worktree, and real-running-game levels. The three remaining shipping defects (alignment, AOB, int64/u64) are each left open for a specific, real, named reason — two structural wire-schema gaps (no `uint16`/`int16`, no `uint64`) and one set of genuinely unmigrated production AOB callers — not a hedge or an unexplained gap.

## Final state

RUST TESTS: 185/185 (1 ignored)
NAPI TESTS: 52/52
FULL JS/TS: 1836/1836 + 10/10
TYPECHECK: renderer PASS, electron PASS
BUILDS: vite PASS, electron PASS (33/33 verifier checks), native/package PASS
NPM AUDIT: 0
PACKAGED SMOKE: PASS (primary + fresh worktree, independently recomputed SHA-256 both times)
FRESH WORKTREE: PASS
ROADMAP MODIFIED: NO
PR #29: OPEN, NOT MERGED (untouched)
PHASE 1 PR: #31 (opened this pass, CI-trigger only, NOT MERGED)
SHIPPING WORKTREE: unchanged (same branch, same 4 pre-existing untracked files)

STOP.

DO NOT START STAGE 8 AUTOMATICALLY.
DO NOT MERGE ANY PR.
