# Phase 2 P2-10 — Adaptive Scan Planner: Final Certification

Branch `feature/solith-phase2-p2-10-adaptive-scan-planner`, worktree isolated per the "ONE ACTIVE CLAUDE SESSION = ONE WORKTREE" rule. Starting SHA `e1260f57ee28d940ebab1f33b22c9cdbd051a719` (== `origin/master` at mission start, containing P2-6-through-P2-9's canonical merge plus concurrent Phase 4 trainer-model work through P4-9). Final commit `bc7f704cd660b012b11b0524ec3374ee0b1eafbf`.

## What was built

A genuine, measurement-driven adaptive scan planner (D13), not a static decision tree:

- **`ScanRegionProfile`** — measured from `driver.getRegions()`: eligible region count/bytes, module-backed/private/mapped byte breakdown, largest region size.
- **`ScanTelemetry`** — measured per executed scan: regions considered/scanned/skipped, eligible/scanned bytes, elapsed wall-clock time, result count, coverage state, partial/failed read counts. Recorded into a bounded (FIFO, cap 20) `AdaptiveScanTelemetryStore` living on `LiveMemorySession` — restart/session isolation comes from the pre-existing "new `LiveMemorySession` per attach" invariant, not a new identity-keyed cache.
- **`planAdaptiveScan`** (pure, no I/O) — with no prior telemetry, classifies the measured profile (`MODULE_HEAVY_PROFILE` / `PRIVATE_HEAVY_PROFILE` / `UNIFORM_PROFILE`) and orders regions accordingly (`private_first` in the heavy cases); with prior telemetry, reacts to the previous scan's real result count (`PRIOR_CANDIDATE_SET_SMALL` narrows total-byte budget and orders private-first; `PRIOR_CANDIDATE_SET_LARGE` switches to `largest_first` with a tighter match cap) and to a high partial/failed-read rate (`HIGH_PARTIAL_READ_RATE` halves the region-size cap). Every branch is driven by a measured field, never by a scan-type label.
- **`planReferenceScan`** — deterministic full-coverage baseline (§9), ignores profile/telemetry, used for correctness-equivalence proof and as the safe fallback (§15).
- **Orchestration** (`adaptive-scan-orchestration.ts`) — executes a plan region-by-region, yielding between regions (genuine mid-scan cancellation, which the legacy `scanFirst` path it extends does not have), records real telemetry.
- **Canonical scanner extension** — `ScanBounds.regionOrder` (additive, default `'as_enumerated'` preserves every pre-existing caller byte-for-byte) on `selectScannableRegions`/`scanFirst`.
- **IPC** — `live-memory-adaptive-scan-start`/`-telemetry-get`, sharing the existing `live-memory-scan-cancel`/`-poll` operationId contract.
- **UI** — `AdaptiveScanPanel.tsx` mounted in Advanced Scan Mode: strategy, structured reasons, measured telemetry, results, bounded scan history.

## Genuine adaptation — concrete evidence (§23)

From `adaptive-scan-planner-real-process.test.ts`, a real spawned `solith-scanner-fixture.exe` process, real `LiveMemorySession`/`nativeMemoryDriver`:

```
SCAN 1 (initial, real profile — no prior telemetry)
  eligible regions:  50
  eligible bytes:    19,349,504
  module-backed:     229,376
  private:           19,050,496
  strategy:          PRIVATE_FIRST
  reasons:           NO_PRIOR_TELEMETRY, PRIVATE_HEAVY_PROFILE

SCAN 2 (follow-up, same attach — scan 1's real telemetry as prior)
  prior result count: 1  (from scan 1's own real measured outcome)
  strategy:            NARROWED_BY_PRIOR_CANDIDATES
  reasons:              PRIOR_CANDIDATE_SET_SMALL
  maxTotalBytes:        tightened to scan 1's own scanned-byte count

WHY STRATEGY CHANGED: scan 1 measured only 1 real match (<=500 threshold),
so scan 2's plan reacted with PRIOR_CANDIDATE_SET_SMALL instead of
scan 1's own NO_PRIOR_TELEMETRY branch — cross-checked against an
independent pure-function oracle fed scan 1's exact recorded telemetry
(`assert.deepEqual(scan2.plan, expected)`), not merely "some plan came
back looking plausible."
```

This satisfies §12 (initial adaptation from a real measured profile), §13 (follow-up adaptation from real prior telemetry), and §23 (concrete before/after table) simultaneously, against real OS memory, not a synthetic scenario.

## Correctness preserved (§9)

Same real-process test: adaptive mode (private-first order) and reference mode (OS-enumeration order) found the exact same address for the same planted value — reordering changed which region was visited first, never which regions were eligible or what was found.

## Real bug found and fixed during this mission

An IPC serialization defect: the `adaptiveScan` branch of `serializeScanOperationResult` nested the scan result under a second `result` key, which collided with the poll handler's own top-level `result` field — the renderer received `plan`/`telemetry` correctly but `matches`/`completeness` ended up at `pollResponse.result.result.matches` instead of `pollResponse.result.matches`, silently orphaning them. The engine-level tests (which call the orchestration directly, never through IPC) could not have caught this; the real-process UI e2e test did, on its first run, before packaging. Fixed by flattening the branch to match every other kind's shape.

## Test results

| Gate | Result |
|---|---|
| Unit tests (planner/store/orchestration) | 25/25 |
| `scanFirst regionOrder` regression (new) | 3/3, plus all pre-existing `memory-scanner.test.ts` cases unaffected |
| Real-process fixture stability sweep | **10/10** (original worktree) + **10/10** (fresh worktree) |
| Real-process UI e2e | 10/10 in a settled-host sweep (one isolated blip in an earlier, noisier batch of 8 — documented, not hidden, matching this repo's established disclosure convention for host-load-sensitive Playwright/Electron interactions) + **3/3** fresh-worktree confirmation |
| Packaged UI e2e | **3/3** (original worktree, first attempt clean) + **3/3** (fresh worktree, first attempt clean) |
| `test:live-memory` | 647/647 (646 pass, 1 pre-existing platform-gated skip), 0 fail, 0 cancelled — both worktrees |
| root `npm test` | 2223/2223 (2222 pass, 1 pre-existing skip), 0 fail, 0 cancelled — both worktrees |
| Renderer typecheck | PASS — both worktrees |
| Electron typecheck | PASS — both worktrees |
| `npm run build` (vite + electron + package) | PASS, 33/33 `verify-electron-output.mjs` checks, signed NSIS installer — both worktrees |
| Native (Rust) | NOT_MODIFIED — no `.rs` source changed |
| Fresh isolated worktree (`npm ci`, no copied artifacts) | ALL PASS, matching the original worktree's numbers exactly |
| Remote CI (PR #56, head `bc7f704`) | ALL PASS — TypeScript and architecture checks, Windows native and Electron gate, fast, scan (×2), scan-pr/osv-scan, verify, scan-full (skipping, expected), CodeRabbit |

## Known gap — real-game proof (§24), honestly disclosed

Two ROADMAP-preferred titles are installed locally (Godlike Burger, DREDGE). Both fail to launch in this automated session — the process exits within seconds with no window, even after confirming Steam itself is running and genuinely logged in (`connection_log.txt` shows a real successful `RecvMsgClientLogOnResponse() : 'OK'`). This was tried via direct exe launch and via `steam://run/<appid>`, both failing the same way, consistent with an environment characteristic of this specific sandboxed session (likely missing whatever interactive desktop/session-0 state a Steam game launch needs) rather than a defect in the planner. Not retried indefinitely, per this mission's own "no retry-until-green" discipline once the same failure repeated identically. **Reported as NOT_COMPLETED, not silently skipped or fabricated.**

## Phase 2 requirement recount (§36)

Recomputed from the same 28-item methodology every prior stage has used. The only change from the P2-6-through-P2-9 baseline (14 COMPLETE / 3 PARTIAL / 11 ABSENT) is **Adaptive Scan Planner: ABSENT → PARTIAL** — not COMPLETE, because the real-game proof leg of its own verification requirement (ROADMAP's "Verification Requirements" line for this mandatory work item) was not completed this stage. Moving it to full COMPLETE without that evidence would repeat exactly the overclaim this repository's own prior missions have explicitly disciplined against (see the P2-6-through-P2-9 "NOT_COMPLETE" honest-correction precedent).

- **14 COMPLETE** (unchanged): pointer maps; pointer-chain visualization; pointer stability testing; module-relative addressing; restart stability validation; structure discovery; typed memory views; value/type inference; memory-region inspection; memory map; watchlists; hotkeys; freeze/write/revert; address validation.
- **3 PARTIAL** (unchanged): pointer scanning; multi-level pointer scanning; ReClass.NET adoption.
- **1 moved ABSENT → PARTIAL**: Adaptive Scan Planner — engine/orchestration/telemetry/UI/real-process/packaged proof all CERTIFIED; real-game proof open.
- **10 ABSENT** (was 11, minus Adaptive Scan Planner which moved to PARTIAL): AOB/signature engineering with resiliency; symbol/module awareness; instruction-aware analysis; resilient rediscovery; version-aware rediscovery; Zydis; Vectorscan; Ghidra; DynamoRIO; Dear ImGui.

**14 + 4 + 10 = 28.**

## Verdict

**P2-10: NOT_COMPLETE.** Every requirement this mission could independently verify is genuinely, non-fabricated CERTIFIED (planner model, runtime inputs, initial/follow-up adaptation, structured reasons, reference mode, result/coverage equality, cancellation, resource limits, Advanced Scan UI integration, fixture 10/10, certification 3/3, packaged 3/3, focused/live-memory/root/typecheck/build/package all PASS, fresh worktree PASS, remote CI PASS). The one item genuinely not completed — real-game proof — is disclosed honestly rather than faked or silently dropped, consistent with every prior stage's own established standard in this repository. **P2-D stays IN_PROGRESS. Do not mark P2-11/P2-12 complete. Do not start P2-11 or Phase 3.**
