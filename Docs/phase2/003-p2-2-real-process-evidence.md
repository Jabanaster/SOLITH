# Phase 2 P2-2 — Real-Process Evidence

Mission §15: "P2-2 must not finish on FakeMemoryDriver only." This document is that proof.

## Fixture extension

[`native/solith-scanner-core/src/bin/fixture.rs`](../../native/solith-scanner-core/src/bin/fixture.rs) already planted one real module-rooted pointer chain for Phase 1's D05 closure (`POINTER_ROOT -> NODE1 -> NODE2 -> NODE3 -> target`, depth 3, with a genuine NODE1<->NODE2 cycle). For P2-2, a second, wholly independent chain was added: `POINTER_ROOT_B -> NODE_B1 -> target B`, depth 1, its own separate `VirtualAlloc` region, no relationship to Target A. The point of Target B is independence, not depth — Target A already covers depth/cycle behavior.

New fixture stdout fields: `POINTER_ROOT_B_ADDRESS`, `POINTER_NODE_B1_BASE`, `POINTER_B_TARGET_VALUE`.

Both `cargo build --bin solith-scanner-fixture` (debug) and `cargo build --release --bin solith-scanner-fixture` (the binary the real-process test suite actually spawns) compile clean.

## Real-process test suite

[`tests/live-memory/pointer-map-real-process.test.ts`](../../tests/live-memory/pointer-map-real-process.test.ts), 3 tests, all passing in isolation:

1. **`scanTargetsIntoMap populates both independent targets correctly`** — a real spawned fixture process, real attach, `session.pointerMapScanTargets(mapId, [targetA, targetB], bounds)` in one call. Asserts both targets produce at least one real candidate, a module-rooted candidate exists at the fixture's real depth for each (3 for A, 1 for B), and no node is misattributed to the wrong target.
2. **`resolve matches real ground-truth addresses for both targets`** — after scanning, `pointerMapResolve` must resolve both nodes back to the *exact* real addresses the fixture itself reported, not merely "some address."
3. **`save, kill, respawn, load, re-resolve proves restart stability through the real persistence path`** — generation-1 fixture: scan, resolve, save to the real SQLite-backed store. Kill it. Spawn generation-2 (a fresh process, different ASLR/allocator layout — ground-truth addresses provably differ from generation 1). Load the saved map into a **new** `LiveMemorySession` (simulating an app restart), confirm every node comes back `unresolved` (mission §8's "inactive until explicitly attached"), then re-resolve and confirm the module+offset chain finds generation 2's real, different addresses. This is the actual restart-stability proof mission §2/§14 asks for, exercised through the real save/load path rather than only in memory.

### A known flake, encountered and diagnosed rather than silently retried

The first attempt at test 1 in a cold run failed with `openProcess(...) failed: unable to find process` after ~69s — the existing 5-attempt/300ms-backoff attach retry (copied from `pointer-scanner-real-process.test.ts`) was exhausted before a real, valid PID could be attached to. Re-running the same file in isolation immediately after passed 3/3 in ~27s total. This matches this project's own documented history of intermittent Windows real-process attach flakiness (doc 129: "`PR Windows` was an intermittently-failing gate... four failures in six runs") — not a defect introduced by P2-2's own logic, since the attach path itself is unchanged Phase 1 code. Recorded here rather than hidden: this test class is not yet at Phase 1's "zero known flaky certification tests" bar, and closing that (if it recurs under full-suite load) is real remaining work, not assumed away.

## Separate real-process regression

`tests/live-memory/pointer-scanner-real-process.test.ts` (Phase 1's own D05 real-process suite, 8 tests) was re-run unmodified as part of the full `test:live-memory` pass (doc 004) to confirm P2-2's fixture changes (adding Target B) did not disturb Target A's existing depth-3/cycle behavior.
