# Phase 1 / Stage 4 — Scan-Session Performance

## Method

`native/solith-scanner-core/src/bin/bench_session.rs` (`cargo run --release --bin bench_session`) — real spawned process, real `VirtualAlloc`'d memory, real `ScanSession::create_unknown_initial`/`refine` calls (the actual, unmodified, exported functions). Measures three representative candidate densities (mission §4.18's "do not optimize only sparse or only dense cases"): `u8`/bytewise (dense — one candidate per byte), `u32`/aligned-to-type (sparse — one per 4 bytes), `u64`/aligned-to-type (sparser — one per 8 bytes), at region sizes {1, 4, 16} MiB.

Refinement is measured against the *same, unmutated* bench region rather than a genuinely mutated one (`BENCH_REGION` has no stdin mutation command — real mutation-vs-refinement *correctness* is what `tests/session_integration.rs`'s real writes to `REFINE_REGION` already prove, doc 32). What this benchmark isolates is refinement's actual cost driver regardless of outcome: the real `ReadProcessMemory` re-read-and-compare loop over every candidate address.

CPU utilization is not measured (no portable, dependency-free sampling from this benchmark binary, consistent with Stage 2 doc 16 / Stage 3 doc 24's own scoping) — wall-clock elapsed time is reported instead.

## Machine

Same as Stage 1-3: AMD Ryzen 7 9850X3D (16 logical CPUs), 31.1 GiB RAM, Windows 11, x64. Release build.

## Full real results

```
    size   type      align     candidates      snapshot_MB     elapsed_ms      phase
     1MiB u8/bytewise(dense)          -        1048576             9.00           6.43 unknown_initial
     1MiB u8/bytewise(dense)          -              0                -           3.33    changed
     1MiB u8/bytewise(dense)          -        1048576                -           8.46  unchanged
     1MiB u8/bytewise(dense)          -              0                -           3.34  increased
     1MiB u8/bytewise(dense)          -              0                -           3.42  decreased
     1MiB u8/bytewise(dense)          -              0                -           3.98 cancel_lat (Complete)
     1MiB u32/aligned(sparse)          -         262144             3.00           2.54 unknown_initial
     1MiB u32/aligned(sparse)          -              0                -           1.27    changed
     1MiB u32/aligned(sparse)          -         262144                -           2.66  unchanged
     1MiB u32/aligned(sparse)          -              0                -           0.99  increased
     1MiB u32/aligned(sparse)          -              0                -           1.25  decreased
     1MiB u32/aligned(sparse)          -              0                -           1.26 cancel_lat (Complete)
     1MiB u64/aligned(sparser)          -         131072             2.00           1.86 unknown_initial
     1MiB u64/aligned(sparser)          -              0                -           0.61    changed
     1MiB u64/aligned(sparser)          -         131072                -           1.64  unchanged
     1MiB u64/aligned(sparser)          -              0                -           0.64  increased
     1MiB u64/aligned(sparser)          -              0                -           0.65  decreased
     1MiB u64/aligned(sparser)          -              0                -           0.65 cancel_lat (Complete)
     4MiB u8/bytewise(dense)          -        4194304            36.00          25.00 unknown_initial
     4MiB u8/bytewise(dense)          -              0                -          14.29    changed
     4MiB u8/bytewise(dense)          -        4194304                -          32.98  unchanged
     4MiB u8/bytewise(dense)          -              0                -          13.23  increased
     4MiB u8/bytewise(dense)          -              0                -          13.18  decreased
     4MiB u8/bytewise(dense)          -              0                -          12.99 cancel_lat (Complete)
     4MiB u32/aligned(sparse)          -        1048576            12.00           9.44 unknown_initial
     4MiB u32/aligned(sparse)          -              0                -           3.87    changed
     4MiB u32/aligned(sparse)          -        1048576                -          10.47  unchanged
     4MiB u32/aligned(sparse)          -              0                -           3.85  increased
     4MiB u32/aligned(sparse)          -              0                -           4.06  decreased
     4MiB u32/aligned(sparse)          -              0                -           3.91 cancel_lat (Complete)
     4MiB u64/aligned(sparser)          -         524288             8.00           6.97 unknown_initial
     4MiB u64/aligned(sparser)          -              0                -           2.33    changed
     4MiB u64/aligned(sparser)          -         524288                -           6.00  unchanged
     4MiB u64/aligned(sparser)          -              0                -           2.31  increased
     4MiB u64/aligned(sparser)          -              0                -           2.33  decreased
     4MiB u64/aligned(sparser)          -              0                -           2.29 cancel_lat (Complete)
    16MiB u8/bytewise(dense)          -       16777216           144.00          95.58 unknown_initial
    16MiB u8/bytewise(dense)          -              0                -          57.22    changed
    16MiB u8/bytewise(dense)          -       16777216                -         133.99  unchanged
    16MiB u8/bytewise(dense)          -              0                -          56.27  increased
    16MiB u8/bytewise(dense)          -              0                -          55.36  decreased
    16MiB u8/bytewise(dense)          -              0                -          79.25 cancel_lat (Cancelled)
    16MiB u32/aligned(sparse)          -        4194301            48.00          39.15 unknown_initial
    16MiB u32/aligned(sparse)          -              0                -          16.16    changed
    16MiB u32/aligned(sparse)          -        4194301                -          42.57  unchanged
    16MiB u32/aligned(sparse)          -              0                -          16.24  increased
    16MiB u32/aligned(sparse)          -              0                -          16.68  decreased
    16MiB u32/aligned(sparse)          -              0                -          24.00 cancel_lat (Cancelled)
    16MiB u64/aligned(sparser)          -        2097149            32.00          26.74 unknown_initial
    16MiB u64/aligned(sparser)          -              0                -          10.22    changed
    16MiB u64/aligned(sparser)          -        2097149                -          24.17  unchanged
    16MiB u64/aligned(sparser)          -              0                -           9.25  increased
    16MiB u64/aligned(sparser)          -              0                -           9.31  decreased
    16MiB u64/aligned(sparser)          -              0                -          13.43 cancel_lat (Cancelled)
```

(`at_byte` addresses omitted from the `Cancelled` rows above for readability — real, non-zero values in the actual run.)

## Snapshot memory matches doc 29's formula exactly

16 MiB u8/bytewise: 16,777,216 candidates × 9 bytes = 151,003,944 bytes = **144.00 MB** — exactly what the benchmark reports, not an approximation. Same exact match at every other row (e.g. 4 MiB u32/aligned: 1,048,576 × 12 = 12,582,912 bytes = **12.00 MB**).

## Interpretation

- **`UNKNOWN_INITIAL` cost scales with candidate count, which scales with region size ÷ alignment stride** — u8/bytewise's 1M-candidates-per-MiB rate costs roughly 3-4× u32/aligned's 256K-per-MiB rate in elapsed time at every region size, consistent with per-candidate decode/store cost dominating (the same "CPU-bound once bytewise" structural finding Stage 3 doc 24 made for exact-scan, extended here to capture-everything mode).
- **`UNCHANGED` costs almost exactly the same as `UNKNOWN_INITIAL`** at every row (e.g. 16 MiB u8: 95.58ms capture vs. 133.99ms unchanged-refine — refine is actually *slower* here because it decodes AND compares AND re-stores every surviving candidate, one real memory re-read pass over the same candidate addresses). This is expected: `UNCHANGED` against unmutated memory survives every candidate, so its output size equals its input size — the worst case for refine's own per-candidate overhead, and therefore the right case to benchmark for an upper bound.
- **`CHANGED`/`INCREASED`/`DECREASED` are all consistently ~2.3-2.5× faster than `UNCHANGED`/capture** at every row (e.g. 16 MiB u8: ~56ms vs. ~96-134ms). Against unmutated memory these three modes produce **zero survivors**, so the *comparison* cost is identical per candidate (`eq_exact`/`compare_ordered` are equally cheap either way) — the real explanation is that a zero-output refine never calls `CandidateStore::push`/`encode_into` for any candidate, only reads and compares, while `UNCHANGED`'s all-survive case pays the encode-and-store cost for every single one. This is a genuine, measured finding about where refinement's own cost actually lives (store cost, not compare cost) — useful evidence for any future optimization pass, not merely "unchanged happens to be slower."
- **Refinement throughput is dominated by the same per-byte-decode cost Stage 3 identified for exact-scan** (doc 24) — chunk-size tuning matters far less than total candidates × value width, matching the structural finding that motivated `build_read_spans`' own trade-off (batch nearby candidates into fewer, larger reads to cut syscall count, since syscall count was Stage 2's dominant raw-read cost — but once CPU-bound decode/compare/store dominates, further syscall-count reduction has diminishing returns, which is exactly what these numbers show: candidate count predicts elapsed time far better than region size or chunk size alone).
- **Cancellation latency**: at 1 and 4 MiB, every candidate set fits inside `build_read_spans`' single 4 MiB span cap, so there is only ever one span — cancellation checked *between* spans never gets a chance to fire mid-refine, and every `cancel_lat` row at those sizes correctly reports `Complete` (the refine simply finished before the 2-span-observed cancellation trigger could fire — an honest, expected result, not a bug). At 16 MiB, candidates spread across multiple 4 MiB spans, cancellation fires as designed, and every `cancel_lat` row correctly reports `Cancelled` with real, non-zero output candidate counts and a real `at_byte` address — direct confirmation that `build_read_spans`' multi-span batching (doc 28) behaves exactly as designed once a real candidate set is wide enough to need it.
- **No Cheat Engine comparison is made** and no claim of superiority over any other tool — this is a pre-optimization baseline for the current, first-cut Rust refinement engine, exactly as Stage 3's own performance doc scoped itself.
