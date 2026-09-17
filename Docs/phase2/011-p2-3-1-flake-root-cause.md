# Phase 2 P2-3.1 — Real Depth-3 Discovery Flake: Root Cause and Fix

Doc 008 (P2-3) recorded the flake honestly rather than hiding it: a representative 5-run sample of the real two-target/depth-3 e2e flow showed 3 pass / 2 fail, and a later 5-run sample under the UI's actual default scan bounds showed the same class of failure. This document is the deliberate, evidence-first root-cause investigation and fix mission P2-3.1 required, superseding doc 008's "not yet a clean 3/3" as the final word on this specific defect.

## Reproduction — not skipped, not chased with blind retries

The bounds `tests/live-memory/pointer-map-real-process.test.ts` uses (`maxOffsetPerLevel: 64`, `maxRegionBytes: 1 MiB`, `maxTotalScans: 500`) were already known-reliable — 10/10 clean before this stage's work even started. Those are **not** the bounds the UI actually sends. `PointerMapPanel`'s scan form defaults to `maxOffsetPerLevel: 2048` (the scanner's own `DEFAULT_MAX_OFFSET_PER_LEVEL`) with `maxRegionBytes`/`maxBytesPerScan`/`maxTotalScans` left at their production defaults (64 MiB / 128 MiB / 25).

A harness (`repro-ui-bounds.mjs`, scratchpad) drove `scanForPointerPath` directly against the real fixture at these exact UI-default bounds, 15 consecutive runs. Result: **15/15 hit `resource_limit` (termination: `scan_budget_exhausted`) with zero candidates** — not intermittent at all, a deterministic 100% failure at these bounds prior to the fix. A second, fuller diagnostic run captured the raw scan diagnostics per attempt: every run performed exactly `scansPerformed: 25` (the `maxTotalScans` cap), `candidatesDropped: 26–32`, `skippedRegions: 175`.

## Mechanism

`scanForPointerPath`'s BFS accepted heap candidates into the next frontier level in **raw memory-scan discovery order** (ascending region base address), applying the `maxCandidatesPerLevel` cap as it went:

```ts
if (nextFrontier.length >= maxCandidatesPerLevel) {
  candidatesDropped += 1;
  continue;
}
nextFrontier.push({ address: hit.address, offsetsSoFar: pathOffsets });
```

A real process's heap allocator metadata, thread stacks, and other incidental structures routinely contain 8-byte values that coincidentally land within `maxOffsetPerLevel` bytes of a frontier address — genuine noise, not a defect in the target process. At `maxOffsetPerLevel: 2048` this noise population is large enough that, combined with `maxCandidatesPerLevel: 32`, the real chain link can be pushed out of the kept set before it is ever found — and separately, `maxTotalScans: 25` is a **global** budget across the whole BFS, so if `maxCandidatesPerLevel` noise siblings get scanned ahead of the real link at the next level, the budget exhausts before the real link is ever reached.

This is root-cause class **G (candidate ordering instability)** compounded by **H (maxCandidatesPerLevel/scan-budget values insufficient relative to real noise population)** — not a timing race (class N), not resource contention (class O), and not a fixture defect. The dependency on ASLR/heap-layout, which varies per real-process launch, is exactly what made it present as "flaky" rather than a clean deterministic failure at the 5-run sample size doc 008 used.

## Fix

`src/core/live-memory/pointer-scanner.ts`: heap hits for an entire BFS level are now collected first, then **ranked by ascending diff** (`item.address - hit.pointerValue`) before the `maxCandidatesPerLevel` cap is applied, instead of accepting them in scan-discovery order.

A genuine pointer link's diff is deterministic for a given binary (0 or an exact small offset in this fixture's synthetic chain) and is with near-certainty the global minimum among coincidental noise diffs, which are effectively uniform across `[0, maxOffsetPerLevel]`. Ranking by diff means:

1. The real link almost always survives the cap, regardless of how much noise exists.
2. The real link is now **first** in the next level's frontier (since it is scanned in array order), so it is scanned before the global `maxTotalScans` budget can be exhausted by noise siblings — resilient even at the tight default budget.

The BFS itself was refactored into a synchronous generator (`pointerScanGenerator`) yielding once per frontier item, so the same fix could be exercised identically by both the existing synchronous `scanForPointerPath` (unchanged behavior — see "no regression" below) and the new cancellable async path P2-3.1 also required (doc 012).

## No regression

- 85/85 pre-existing `pointer-scanner*`/`pointer-scanner-depth-truth`/`memory-scanner-truth-matrix` tests pass unchanged — the synchronous entry point drains the identical generator to completion with no behavior change.
- 160/160 full P2-3-focused suite (model, orchestration, store, session, UI logic) passes.

## Verification after the fix

- 15/15 direct production-entry-point runs (`session.pointerMapScanTargets`, both real targets, UI-default bounds) found the depth-3 candidate every time.
- 10/10 real-process/real-UI critical-flow stress proof (`tests/pointer-map-ui-real-process.e2e.test.ts`), run as a dedicated stress block.
- 3/3 separate certification run of the same flow.
- 14/15 consecutive passes across two informal stress batches run immediately before the dedicated 10-run block (the one failure was an Attach-step cold-start issue on the very first run after a fresh rebuild — see "A separate, unrelated finding" below — not a discovery failure).

Total across this stage: **30/30 depth-3 discoveries succeeded** at UI-default bounds after the fix, versus a previously deterministic 0/15 (and a documented ~40% failure rate in the earlier, looser 5-run samples) before it.

## A separate, unrelated finding: cold-start Attach flake

The very first real-process e2e run immediately after a fresh `build:electron` rebuild failed at the Attach step (5/5 retry attempts exhausted), not at pointer discovery. It did not recur across the 29 subsequent runs in this stage, including runs immediately following other rebuilds. This is recorded honestly as a real, observed, non-reproducing anomaly — most likely OS-level cold-start cost (antivirus scan of a freshly-written executable, cold file-system cache) — rather than assumed away or silently omitted. It is a different failure mode than the depth-3 discovery defect this document fixes, and did not block reaching a clean 10/10 stress + 3/3 certification result.
