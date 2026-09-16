# Phase 2 P2-1 — Pointer Map Data Model

**Status: IMPLEMENTED, FOCUSED_TESTED, NOT_YET_PHASE_CERTIFIED.** This document records what P2-1 actually is — a data-model increment inside a larger stage — not a Phase 2 certification. Phase 2 as a whole remains open; see doc 005 for the current Phase 2 status.

## What ROADMAP requires

ROADMAP's Phase 2 Mandatory Work names "pointer maps" as one bullet among many (line 300: "Pointer scanning, multi-level pointer scanning, pointer maps, pointer-chain visualization, pointer stability testing."). Phase 1 had already built truth-reporting reverse pointer scanning (`scanForPointerPath`, D05) and single-path resolution (`resolvePointerPath`), but a discovery only ever lived as a transient candidate list for one target address. There was no way to name, keep, and re-resolve several pointer chains together — the prerequisite a visualization stage (P2-3) needs to render anything.

## What P2-1 built

[`src/core/live-memory/pointer-map.ts`](../../src/core/live-memory/pointer-map.ts):

- `PointerMap` / `PointerMapNode` — an immutable, named collection of pointer chains. Every mutation (`addPointerMapNode`, `removePointerMapNode`, `renamePointerMap`) returns a new value rather than mutating in place, matching this codebase's existing convention (see `watch-list-bookmarks.ts` for the same shape at smaller scale).
- `PointerMapNodeStatus` — `unresolved | resolved | module_missing | read_failed | process_exited`. `process_exited` is distinct from `read_failed` on purpose: Phase 1's D-series pointer work established that a dead-but-open process handle fails module enumeration (`getModules` throws) rather than silently returning nothing, so a caller can and must tell "this chain doesn't resolve" apart from "the process is gone" (`isProcessGoneError`, shared with `memory-scanner.ts`).
- `resolvePointerMap` — re-resolves every node against a live `MemoryDriver`/`LiveProcessHandle` in one pass, from real reads, not fabricated state.
- `pointerMapNodeChainSteps` — flattens a node's path into ordered steps a visualization stage can render without re-deriving module/offset formatting.

## Test evidence

[`tests/live-memory/pointer-map.test.ts`](../../tests/live-memory/pointer-map.test.ts) — 10/10 pass: node creation from a scan candidate, immutability of every mutator, real resolution through `FakeMemoryDriver` (resolved / module_missing / read_failed / process_exited, the last via the same driver-method-monkeypatch technique `pointer-scanner-depth-truth.test.ts` uses for the equivalent D05 case), independent multi-node resolution in one map, chain-step flattening including a zero-offset direct pointer, and map rename/id stability.

## What P2-1 explicitly did not close

- No live orchestration (multi-target scanning into a map) — that is P2-2, doc 002.
- No persistence — P2-2.
- No IPC/production wiring — P2-2.
- No visualization UI — P2-3, deliberately deferred (mission §17).
- No real-process proof at the P2-1 stage itself — real-process proof for the pointer-map feature as a whole is covered in P2-2 (doc 003), once orchestration exists to exercise.

## Commit

`e5b48fa` on `feature/solith-phase2-pointer-engineering`, branched off the certified Phase 1 HEAD (`455f9cd`) rather than PR #31's branch, so PR #31 stays pinned at its certified SHA.
