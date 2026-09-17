# Phase 1 / Stage 1 — Test Architecture

Full verification plan for the Phase 1 scanner reconstruction, per the mission's six required layers (A–F). Written against the current test baseline (doc 01 §_test/benchmark infrastructure_: default `npm test` runs 100% against `FakeMemoryDriver`/`BufferMemoryReader` in-process mocks, zero real memoryjs, zero real OS process; 17 files under `tests/live-memory/*.test.ts`; no scanner-specific benchmark harness exists) and the new architecture in doc 06/07.

## A. Pure algorithm tests

Target: `native/solith-scanner-core`'s Rust unit tests (`cargo test`), covering logic with no OS/process dependency at all:

- Byte scanning: exact-match search correctness across buffer sizes, boundary offsets (first byte, last valid byte, one-past-end rejection).
- Type decoding: every `ScanType` variant (i8–u64, f32/f64, UTF-8/UTF-16, bytes) round-trips encode→decode correctly; explicit tests for each type's overflow/underflow boundary (e.g. `i8::MIN`/`MAX`, `u64::MAX`).
- Alignment: default unaligned-safe scanning finds a value at every byte offset (not just type-width multiples) in a synthetic buffer; the opt-in aligned-fast-path finds values only at aligned offsets, and this restriction is asserted, not assumed.
- Comparisons: every mode from doc 07 (exact/changed/unchanged/increased/decreased/increasedBy/decreasedBy/between) against hand-picked value pairs including the specific edge cases doc 07 identifies as gaps today (NaN inputs, magnitude-extreme deltas for increasedBy/decreasedBy, `min > max` rejection).
- AOB wildcard semantics: exact bytes, full wildcards (`?`), and (if adopted per doc 06 §5) nibble wildcards; pattern-at-buffer-start, pattern-at-buffer-end, pattern-longer-than-buffer (must not panic/OOB).
- Chunk overlap: a value/pattern planted exactly at a chunk boundary (offset = chunk_size − k for the value's width) must be found; a synthetic test asserts the overlap window's exact byte count matches doc 06 §2.2's `max_value_width - 1` / `pattern_length - 1` formula.

## B. Synthetic memory fixtures

Target: real spawned child processes with deterministic, known memory layouts — replacing/extending the existing pattern already established by `tests/fixtures/gate2-2-memory-fixture` (a real, compiled, spawned .NET fixture pinning one known-address `int32`, already proven in this codebase's Gate-2 e2e suite). Required fixture memory layouts, each a new named scenario built on the same pattern:

- A region **>1 MiB** (closes the D02/P1-SCAN-004 test-blindness identified in doc 03/10 — today's `FakeMemoryDriver` cannot represent this at all).
- Unaligned values (planted at deliberately non-type-width-multiple offsets).
- Values/patterns planted at a **region boundary** (straddling two separately-allocated, separately-`VirtualQuery`-enumerated regions) — directly targets P1-SCAN-004.
- An unreadable region (e.g., `VirtualFree`d after enumeration but before read, or `VirtualProtect`ed to `PAGE_NOACCESS` mid-test) — targets the completeness-contract's `CompleteWithSkippedRegions` state.
- A guard page (`PAGE_GUARD`) region, confirmed excluded from scan candidates.
- A partial-read scenario (region freed mid-multi-chunk-read, if feasible to construct deterministically on Windows — otherwise documented as infeasible-to-fixture and covered instead by a targeted unit test that mocks the OS call boundary).
- A dynamically-changing value (fixture process mutates a known address on a signal/file-trigger, matching the existing `Gate2_2Fixture.cs` mutate-file channel) — for CHANGED/INCREASED/DECREASED mode verification against a *real* process, not just `FakeMemoryDriver`.
- Genuine 64-bit values, including values `> Number.MAX_SAFE_INTEGER` (directly targets D06 — this is the fixture class today's suite entirely lacks, since no real-int64 test exists anywhere per doc 02's finding).
- Floats/doubles, including deliberately-planted NaN/Infinity bit patterns (targets P1-SCAN-002's asymmetric NaN-guard gap).
- AOB patterns, including one spanning a chunk/region boundary.
- **A 32-bit (WOW64) target process fixture**, if practically constructible (a 32-bit-compiled version of the existing C# fixture pattern, or a minimal C 32-bit executable) — directly targets P1-SCAN-001; if genuinely infeasible within Stage 2's timeline, this must be explicitly flagged as a documented gap in the exit-gate review (doc 10), not silently dropped.

## C. Property/fuzz testing

Target: `cargo test` with `proptest` or `quickcheck` (new Rust dev-dependency, evaluated during Stage 2), covering:

- Arbitrary chunk boundaries: random buffer sizes and chunk sizes, asserting every planted value is found regardless of where it falls relative to chunk edges.
- Arbitrary pattern lengths: random AOB pattern lengths (including pathological cases: 1-byte pattern, pattern longer than any single chunk) against random buffers.
- Malformed patterns: invalid hex tokens, empty patterns, patterns exceeding a sane maximum length — asserting a clean, typed error, never a panic.
- Address arithmetic: random base addresses + region sizes near `u64::MAX`, asserting no silent wraparound (mirrors the "integer/address overflow" category doc 03 found NOT FOUND in current code — a regression guard, not a currently-known gap).
- Random candidate layouts for the pointer-scanner BFS: random module placements and pointer-slot values, asserting `levelsSearched`/`truncated`/candidate-count invariants hold (e.g. `truncated == false` implies every valid candidate within the configured depth/result bounds was actually returned — a property-based regression test for exactly the class of bug in D05).

## D. Integration tests

Target: `tests/live-memory/*.test.ts` (Node's existing `node:test` runner, kept), extended to exercise the real napi-rs boundary:

- napi-rs ↔ Electron/Node: the addon loads correctly under the packaged Electron ABI (extends the existing `electron-boundary-static.test.ts` pattern, which already asserts `memoryjs` stays confined to the main-process bundle — add an equivalent assertion for the new native module).
- napi-rs ↔ scanner API: every `LiveMemorySession` method that today calls into `memory-scanner.ts`/`pointer-scanner.ts`/`aob-resolver.ts` directly instead calls into the new native core via a thin TypeScript adapter; integration tests assert the adapter's TypeScript-facing contract (types, error shapes, completeness values) matches doc 06/07 exactly.
- **`FakeMemoryDriver` itself must be upgraded to enforce the real driver's constraints** (P1-SCAN-010's fix): add the missing 1 MiB cap, address-range validation, finite-value-on-write validation, and PID upper-bound check to the fake, so the existing 17-file unit-test suite gains real signal for these cases instead of silently passing through them. This is a **test-fixture change, not a production-source change**, and must ship alongside (not after) the native core, per the mission's coverage-must-not-weaken principle.
- IPC contract tests: extend `electron/ipc-validation.ts`'s existing coverage to the new `live-memory-scan-cancel` and `live-memory-scan-progress` channels (doc 06 §1.5/§1.6), and to the new `completeness` field on every scan-result payload shape.

## E. Real-game validation (required before Phase 1 closes, per the mission)

- Re-attach to **Stardew Valley** (already part of the certified evidence trail — ROADMAP.md's Phase-0 certification cites a real live attach to PID 28336; Audit 2's ~957 MiB committed-footprint measurement is the specific target this phase must demonstrably beat) and confirm: full committed-memory coverage (no silent 1 MiB-cap-style gaps), a real AOB signature from the 120,245-signature CT corpus resolves against live memory, and a real pointer chain resolves and survives a game restart.
- A second title for cross-validation — **Palworld** is the natural second candidate (ROADMAP.md's Phase 4 exit gate already names both Stardew Valley and Palworld as the two-title bind requirement, and `scripts/explore-palworld-*.mts` shows prior manual exploration already happened against it) — confirming the redesign generalizes beyond one engine/runtime (Stardew is MonoGame/.NET; Palworld is UE5/native), which matters directly for P1-SCAN-001 (32-bit/pointer-width assumptions) and general region-layout diversity.
- Both runs must produce a doc-04-style before/after comparison (region coverage %, scan duration, defect-closure confirmation for D01–D06/P1-SCAN-001–010 where applicable to real memory) — not an anecdotal "it worked" statement.

## F. Performance regression tests

- Evidence thresholds/ranges, never brittle exact-timing assertions (per the mission's explicit instruction) — e.g. "a 32 MiB `scanFirst`-equivalent completes in under Xms on CI hardware, where X is set from doc 04's baseline with a documented safety margin (e.g. 3× the measured median, to absorb CI-runner variance)," not "completes in exactly 1.56ms."
- One regression test per doc 04 benchmark row, re-run in CI on every PR touching the native scanner core, comparing against the stored doc-04 baseline (or a re-captured baseline if the underlying hardware profile changes — CI hardware differs from this Stage 1 pass's dev machine, so the *first* Stage 2 CI run of this suite should capture its own baseline numbers rather than reusing doc 04's literal thresholds verbatim).
- A dedicated region-count-vs-syscall-overhead test (doc 04's key structural finding: real-machine timing is dominated by read-call count, not JS decode cost) — measure wall-clock scaling as a function of region *count* at fixed total bytes, to catch a regression that increases the number of native calls per scan even if per-call JS logic doesn't slow down.

## Coverage-preservation discipline (binding on Stage 2+ implementation)

Per the mission's Phase-0/Step-0.14.1 precedent (already certified in this repo): new tests must be **strictly stronger or equivalent** in coverage to what they replace, never a smoke-test weakening, never a silently-reduced test count, no skip/xfail used to "pass" a known-incomplete feature. Every one of the 16 Phase-1 defect IDs (D01–D06, P1-SCAN-001–010) must have at least one test in layer A, B, or D that fails against the pre-fix behavior and passes against the fixed behavior — i.e. every defect in doc 02/03 gets a regression test, not just a design mention.
