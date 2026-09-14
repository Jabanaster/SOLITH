# Phase 1 / Stage 1 — Current Performance Baseline

## Method

Two complementary evidence sources, per the mission's method list:

1. **Deterministic synthetic fixtures** (method 1) — a temporary harness (`tmp-phase1-scanner-bench.mts`, written to repo root, run via `npx tsx`, then deleted; never committed) called the real, unmodified, exported `scanFirst`/`scanFirstRange`/`scanFirstUnknown`/`scanAobInProcess`/`scanForPointerPath` against synthetic in-memory `MemoryDriver` fixtures. This isolates **pure JS-side scanning algorithm throughput** from OS/memoryjs read latency (no real process attach was involved — the fixture's `readBuffer` slices an in-process `Buffer`).
2. **Existing real-machine evidence already embedded in production source** (method 3) — `memory-scanner.ts:12-16`'s own comment records a real attach to Stardew Valley.exe: committed writable footprint ≈957 MiB, a scan of close to 1 GiB took **≈2.2s** on that occasion. This is the only currently-available real-game timing data point; it predates this Stage 1 pass and was not re-run here (Stage 1 is read-only on production source; re-attaching live to a real game to reproduce this number is deferred to Stage 2/real-game validation per the mission's own test-architecture section, 1.13E).

No hyperfine, no existing benchmark suite, and no CI-wired performance test exist for the scanner (confirmed in doc 01/08) — this baseline is new infrastructure, exactly as the mission anticipated ("We need this baseline later to prove improvement").

## Machine

- CPU: AMD Ryzen 7 9850X3D, 8 cores / 16 logical processors
- RAM: 31.1 GiB
- OS: Windows 11 Home 10.0.26200, x64
- Node: v22.23.2, run via `tsx` (unbundled TS-to-JS-on-the-fly dev execution, **not** a production `build:electron` release binary — real packaged-app numbers will differ, likely favorably, since the shipped bundle is pre-transpiled)
- Build mode: dev/tsx, single-threaded (no worker pool; matches current production architecture, which has none)

## Results — IN-MEMORY MICROBENCHMARK (synthetic fixtures; median of 5–7 runs; min/max recorded for spread)

**Wording correction (Stage 2 normalization):** every number in this section is an **in-memory microbenchmark** — pure V8/Node JS execution against a synthetic in-process `Buffer`, with zero real Windows process-memory I/O involved. These numbers are explicitly **not**: Windows process-memory throughput, real-game scanner throughput, syscall throughput, or end-to-end native scanner performance. Real syscall-inclusive throughput was first measured in Stage 2 (`Docs/phase1/16-stage2-performance-results.md`, against a real spawned process's real memory) and is 3–4 orders of magnitude lower than the numbers below at comparable region sizes — that gap is expected and is itself evidence for where the real bottleneck lives (see that document's interpretation section).

| Scan | Region shape | Median | Min | Max | Throughput |
|---|---|---|---|---|---|
| `scanFirst` int32 exact | 1×1 MiB | 0.04 ms | 0.03 ms | 0.20 ms | 27,624 MiB/s |
| `scanFirst` int32 exact | 1×8 MiB | 0.40 ms | 0.38 ms | 0.45 ms | 20,040 MiB/s |
| `scanFirst` int32 exact | 1×32 MiB | 1.56 ms | 1.54 ms | 1.73 ms | 20,550 MiB/s |
| `scanFirst` int32 exact | 1×63 MiB (just under the 64 MiB region filter) | 3.05 ms | 3.02 ms | 3.36 ms | 20,674 MiB/s |
| `scanFirst` int32 exact | 200×256 KiB (50 MiB total, all cap-compliant) | 1.39 ms | 1.33 ms | 1.96 ms | 36,057 MiB/s |
| `scanFirstRange` int32 `[0,100]` | 1×1 MiB | 2.09 ms | 1.50 ms | 3.57 ms | 479 MiB/s |
| `scanFirstRange` int32 `[0,100]` | 1×8 MiB | 12.06 ms | 11.95 ms | 12.10 ms | 663 MiB/s |
| `scanFirstRange` int32 `[0,100]` | 1×32 MiB | 48.48 ms | 47.64 ms | 49.08 ms | 660 MiB/s |
| `scanFirstUnknown` (baseline capture) | 1×32 MiB | 2.73 ms | 2.67 ms | 3.15 ms | 11,707 MiB/s |
| `scanAobInProcess` 14-byte pattern (absent — worst-case full scan) | 1×1 MiB | 1.57 ms | 1.57 ms | 2.90 ms | 635 MiB/s |
| `scanAobInProcess` 14-byte pattern (absent) | 1×8 MiB | 12.95 ms | 12.76 ms | 13.06 ms | 618 MiB/s |
| `scanAobInProcess` 14-byte pattern (absent) | 1×32 MiB | 52.20 ms | 52.04 ms | 52.70 ms | 613 MiB/s |
| `scanForPointerPath` (`maxDepth:1`, no module hits — worst case) | 1×8 MiB | 59.02 ms | 58.68 ms | 60.92 ms | 135.5 MiB/s |

## Interpretation

- **`scanFirst` (indexOf-based exact match) is fast** — 20–36 GiB/s, dominated by V8's native `Buffer.indexOf`. Region fragmentation (200 small regions vs. 1 big one) did not hurt and in fact scored higher here (measurement noise at this scale, not a real fragmentation cost) — the current single-region-per-`readBuffer` design is not the bottleneck for the value scanner in pure algorithmic terms.
- **`scanFirstRange` (decode-every-offset) is ~30–40× slower than `scanFirst`** (479–663 MiB/s vs. 20,000+ MiB/s) because it cannot use `indexOf` — it must `decodeValue()` at every 4-byte-aligned offset and compare. This is the realistic per-byte cost model the Rust core's chunked reader/comparator needs to beat, not `scanFirst`'s number.
- **`scanAobInProcess`'s naive O(n·m) byte-compare search runs at ~613–635 MiB/s**, close to `scanFirstRange`'s decode-loop cost — consistent with it being a hand-rolled nested loop with no SIMD/vectorization. This is the number a native (Rust, or Vectorscan-backed for compatible batches) AOB engine needs to substantially beat; a 10×+ improvement is a reasonable, evidence-grounded target for Stage 2/Phase 1 design (not a superiority claim yet — to be measured, not assumed).
- **`scanForPointerPath` is by far the slowest primitive tested** (135.5 MiB/s, worst-case/no-hits) — expected, since `findPointersNear` reads every 8-byte-aligned slot and does a subtraction+range check per slot, with no early exit. A real pointer scan's total wall-clock cost is dominated by how many regions/bytes are swept per level × how many levels are walked, which the current `MAX_TOTAL_SCANS=25`/`MAX_RESULTS=20` caps bound — but as doc 02 (D05) shows, that bounding is not honestly reported to the caller today.
- All of the above are **pure in-process JS costs only** — they exclude the real cost of a `ReadProcessMemory`/memoryjs `readBuffer` syscall per region, and exclude Windows' own `VirtualQueryEx` region-enumeration cost. The existing real-machine data point (Stardew Valley, ~957 MiB committed, ~2.2s for a `scanFirst`-class exact scan) is almost certainly dominated by IPC/syscall overhead across many small regions, not by the JS-side `indexOf` cost measured above (957 MiB at 20 GiB/s JS-only would be ~48ms — the other ~2.15s is Windows/memoryjs syscall + region-enumeration overhead, and/or the region-count multiplying a fixed per-call overhead). **This split — algorithmic cost vs. per-syscall overhead — is exactly the number Stage 2's Rust core and its chunked reader need to measure and reduce separately**, and is the most important structural finding of this baseline pass: reducing region-read *count* (fewer, larger, safely-chunked reads) is likely to matter more than reducing the per-byte scan algorithm's cost.
- **Cancellation latency**: not measurable. `memory-scanner.ts`, `pointer-scanner.ts`, and `aob-resolver.ts` have no `AbortSignal` or cancellation parameter anywhere (confirmed by source read across all three files) — there is no cancellation code path to time. This is itself carried into doc 09/10 as mandatory new capability, not an existing number to beat.

## What this baseline is for

This is a **pre-redesign reference point**, not a claim of adequacy or inadequacy on its own. Its purpose (per the mission) is so that Stage 2+'s Rust-core implementation can be measured against a concrete, reproducible "before" — both the JS-algorithm numbers above and the region-count/syscall-overhead structural finding. Any later "SOLITH scanner is faster/more complete than before" claim must cite this document's numbers directly, with the same methodology (synthetic fixture + region shape), never an isolated anecdote.
