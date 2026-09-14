# Phase 1 / Stage 2 — Native Reader Performance Results

## Method

`native/solith-scanner-core/src/bin/bench_reader.rs` (`cargo run --release --bin bench_reader`) spawns `solith-scanner-fixture <size_mib>` — a **real OS process** that `VirtualAlloc`s a real region of the requested size and fills it with deterministic pseudo-random bytes — attaches to it via the real `ProcessHandle`, and measures `read_region_chunked` (the real, unmodified, exported function; no test double, no in-process buffer) at region sizes {1, 16, 64, 256} MiB × chunk sizes {64 KiB, 256 KiB, 1 MiB, 4 MiB} (skipping any chunk size larger than the region itself). This directly measures real `ReadProcessMemory` syscall cost against real committed memory, superseding Stage 1 doc 04's in-process JS microbenchmark for the native reader specifically — per the mission's explicit wording-correction instruction, Stage 1's `20–36 GiB/s`-class numbers are **in-memory microbenchmark** results only (pure `Buffer.indexOf`/decode-loop cost against a synthetic buffer with no real syscall involved) and must not be conflated with real Windows process-memory throughput, real-game scanner throughput, or end-to-end native scanner performance. The numbers below are the first real-syscall data point for this project's scanner-reconstruction effort.

## Machine

Same as Stage 1 doc 04: AMD Ryzen 7 9850X3D (16 logical CPUs), 31.1 GiB RAM, Windows 11 10.0.26200, x64. Build: `cargo run --release` (optimized), not a packaged Electron binary.

## Results

```
    size     chunk_size     chunks   syscalls elapsed_ms     bytes_read        MiB/s
     1MiB        65536B         17         17       0.68        1048688       1474.9
     1MiB       262144B          5          5       0.28        1048604       3561.3
     1MiB      1048576B          1          1       0.20        1048576       5065.9
    16MiB        65536B        257        257      11.46       16779008       1396.0
    16MiB       262144B         65         65       5.64       16777664       2834.9
    16MiB      1048576B         17         17       3.53       16777328       4530.2
    16MiB      4194304B          5          5       2.64       16777244       6059.5
    64MiB        65536B       1025       1025      40.12       67116032       1595.5
    64MiB       262144B        257        257      21.36       67110656       2995.7
    64MiB      1048576B         65         65      13.69       67109312       4676.2
    64MiB      4194304B         17         17      11.20       67108976       5711.9
   256MiB        65536B       4097       4097     172.06      268464128       1488.1
   256MiB       262144B       1025       1025      89.70      268442624       2854.1
   256MiB      1048576B        257        257      66.40      268437248       3855.5
   256MiB      4194304B         65         65      52.66      268435904       4861.2
```

(`bytes_read` exceeds the nominal region size by the expected overlap-double-count amount — see doc 13 — and `syscalls` equals `chunks` exactly, confirming the reader issues exactly one `ReadProcessMemory` call per planned chunk, no retries, no redundant calls.)

## Interpretation

- **Throughput scales strongly with chunk size, at every region size tested**: roughly 1.4–1.6 GiB/s at 64 KiB chunks, climbing to 4.9–6.1 GiB/s at 4 MiB chunks — a **~3.4–4.1× improvement** purely from issuing fewer, larger `ReadProcessMemory` calls, with the *same total bytes* transferred. This is a real-syscall confirmation of Stage 1 doc 04's structural hypothesis ("reducing region-read *count* is likely to matter more than reducing the per-byte scan algorithm's cost"), not merely a repetition of it.
- **The relationship is consistent, not a fluke of one region size**: the same ~3.4–4× ratio between the smallest and largest chunk size tested holds at 1 MiB, 16 MiB, 64 MiB, and 256 MiB regions alike — evidence this is a per-call fixed-overhead effect (syscall/context-switch cost), not a cache-size or region-size-specific artifact.
- **This directly informs Stage 3's chunk-size default.** `ChunkPlanConfig::default_for_testing()`'s 1 MiB chunk size (chosen in Stage 2 as a reasonable starting point, matching the historical 1 MiB cap's own scale) sits roughly in the middle of the measured range (4,530–5,066 MiB/s) — closer to the fast end than the slow end, but doc 16's data suggests a 4 MiB (or larger, untested here) default could meaningfully outperform it further. Stage 3, which will need to balance larger chunks against per-chunk-overlap-copy memory cost and cross-boundary value/pattern correctness at whatever chunk size it settles on, should treat these numbers — not the 1 MiB default — as the evidence base for that decision.
- **No superiority claim is made here.** These numbers describe *this reader, on this machine, against a real but simple flat allocation* — not a comparison against Cheat Engine, not a comparison against a real game process's actual memory layout (fragmented, many small regions, mixed protections), and not a claim that Stage 3's eventual real scan modes will hit these exact throughputs (value decoding/comparison work happens on top of the raw read). Per the mission's explicit instruction: "Do not optimize prematurely... Do not turn one machine's result into a product guarantee."
- **Cross-reference to Stage 1's numbers**: Stage 1 doc 04's `scanFirst`-equivalent JS-only throughput (20–36 GiB/s) is 4–7× *higher* than this stage's real-syscall numbers even at the fastest (4 MiB-chunk) configuration — exactly as expected, since Stage 1's number excluded all OS/syscall cost by construction. The gap between the two numbers is itself the evidence for why chunking/syscall-count matters more than per-byte JS/Rust decode speed for real-world scanner throughput, which is the core architectural bet Stage 2's chunked-reader design is built on.
