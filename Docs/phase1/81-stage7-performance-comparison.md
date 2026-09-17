# Phase 1 / Stage 7 — Performance Comparison

## §7.20 — not performed as a structured comparison this stage

No dedicated wall-clock/throughput/memory benchmark comparing legacy vs. native through the production-layer `ScannerBackendRouter` was built this stage (mission §7.20 asks for exact u32, exact u64, unknown-initial, AOB, and UTF-8 comparisons, normalized by actual bytes examined).

The only timing data available is incidental, from `tests/live-memory/scanner-backend-real-process.test.ts`'s real-process test durations: the 1 MiB-defect test (legacy scan of ~44 candidate regions plus a full native region-by-region exact scan of the same process) completed in ~200 ms; the alignment/int64 test in ~165 ms; the AOB test in ~178 ms. These are not controlled benchmarks (no warmup, no repetition, includes process spawn overhead in the surrounding `withFixture` harness, not isolated to just the scan call), and are not represented as satisfying §7.20 — they are reported only because they exist, per this stage's own honesty standard, not because they are adequate evidence of relative performance.

Stage 2/4's own native-core benchmarks (`native/solith-scanner-core/src/bin/bench_*.rs`) already measure the native path's raw throughput in isolation and remain valid, unaffected by this stage's changes (no hot-path native code was modified). No equivalent legacy-side benchmark exists to compare against, and none was added this stage.
