# Phase 1 / Stage 3 — Exact-Scan Performance

## Method

`native/solith-scanner-core/src/bin/bench_exact_scan.rs` (`cargo run --release --bin bench_exact_scan`) — real spawned process, real `VirtualAlloc`'d memory (via the fixture's `<size_mib>` CLI argument), real `scan_exact()` calls (the actual, unmodified, exported production function). Measures 5 representative types (u8, u32, u64, f32, f64 — a deliberate subset of the 10, per the mission's "at least" wording) at region sizes {1, 16, 64, 256} MiB and chunk sizes {256 KiB, 1 MiB, 4 MiB}, plus a high-density-vs-absent comparison for `u8` to isolate match-processing cost from read cost.

## Machine

Same as Stage 1/Stage 2: AMD Ryzen 7 9850X3D (16 logical CPUs), 31.1 GiB RAM, Windows 11, x64. Release build (`cargo run --release`).

## Results (representative excerpt — full run in the commit history / reproducible via the binary)

```
    size   type   chunk_size    matches     chunks   syscalls     elapsed_ms    density        MiB/s
     1MiB     u8     262144B       4096          4          4       1.57       high        638.9
     1MiB     u8     262144B       4096          4          4       1.46     absent        682.7
    16MiB     u8     262144B      65535         64         64      24.59       high        650.7
    16MiB     u8    4194304B      65535          4          4      25.72       high        622.1
    64MiB     u8     262144B     262142        256        256      97.54       high        656.1
    64MiB     u8    4194304B     262142         16         16     104.08       high        614.9
   256MiB     u8     262144B    1048575       1024       1024     409.89       high        624.6
   256MiB     u8    4194304B    1048575         64         64     434.46       high        589.2
   256MiB    u32    4194304B          0         65         65     390.20     sparse        656.1
   256MiB    u64    4194304B          0         65         65     345.45     absent        741.1
   256MiB    f32    4194304B          0         65         65     376.61     sparse        679.8
   256MiB    f64    4194304B          0         65         65     347.38     sparse        736.9
```

## Interpretation

- **Throughput sits at roughly 500–800 MiB/s across every type, region size, chunk size, and match density tested** — a genuinely different performance profile from Stage 2's raw-read benchmark (doc 16), which scaled from ~1.4 GiB/s at 64 KiB chunks to ~6.1 GiB/s at 4 MiB chunks. **Exact-scan throughput does not meaningfully improve with larger chunk sizes** the way raw reads did (compare the 262144B-chunk and 4194304B-chunk rows for the same size/type above — they differ by single-digit percent, not multiples).
- **Why**: Stage 2's raw reader does one `memcpy`-class operation per chunk — cost is dominated by the fixed per-syscall overhead, so fewer/larger chunks win decisively. `scan_exact`'s bytewise mode instead does a decode-and-compare operation at *every single byte offset* in every chunk — an O(n) CPU-bound cost that scales with total bytes scanned regardless of how those bytes were divided into chunks. Once the per-byte CPU cost dominates, the per-chunk syscall-count savings that mattered so much in doc 16 become a rounding error by comparison. **This is a real, measured structural finding, not a restatement of doc 16's**: the two benchmarks together show that chunk-size tuning is a first-order lever for raw reads and a near-irrelevant one for bytewise exact scanning — a concrete, evidence-based input for Stage 4+'s own chunk-size decisions (a refinement/comparative scan, re-reading only already-narrowed candidate addresses, is closer to Stage 2's raw-read profile than to this stage's full-sweep profile, and should be tuned accordingly).
- **Result density has a small, not dominant, effect**: `u8` searching for a value present ~1-in-256 times ("high" density, up to ~1.05M matches at 256 MiB) runs within a few percent of the same search for a value absent entirely ("absent," 0 matches) at the same region/chunk size. Match *processing* (push to a `Vec`, later dedup/sort) is cheap relative to the per-byte decode/compare cost that dominates regardless of whether a given byte turns out to be a match.
- **No Cheat Engine comparison is made.** This is a **pre-refinement-stage baseline** for the *current* Rust bytewise engine only — a legitimate future optimization (e.g. a SIMD-accelerated exact-match fast path, analogous to how `Buffer.indexOf` made Stage 1's `scanFirst` JS microbenchmark fast) is explicitly out of Stage 3's scope and not attempted here, per the mission's "do not optimize solely for one type... do not claim Cheat Engine superiority" instructions. This number exists so a future optimization pass has a real "before" to measure against.
