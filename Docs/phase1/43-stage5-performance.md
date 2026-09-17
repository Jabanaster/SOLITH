# Phase 1 / Stage 5 — Pattern-Scan Performance

## Method

`native/solith-scanner-core/src/bin/bench_pattern.rs` (`cargo run --release --bin bench_pattern`) — real spawned process, real `VirtualAlloc`'d memory filled with pseudo-random decoy bytes (no planted match anywhere), real `scan_pattern` calls (the actual, unmodified, exported function). Every measurement below is therefore a genuine full-region worst case: with zero real hits, the matcher must actually examine candidate positions across the entire region rather than terminating early on a lucky match — the correct case to benchmark for a throughput ceiling (same rationale Stage 3 doc 24 and Stage 4 doc 33 used for their own zero/low-survivor benchmark rows).

Region sizes 16/64/256 MiB (mission §5.17's explicit minimum set). Pattern-length matrix: short (4B raw bytes), medium (16B raw bytes / 16B wildcard AOB / 17-character UTF-8 / 17-character UTF-16LE), long (64B raw bytes) — mission's "short/medium/long" + "wildcard impact" dimensions. Chunk-size effect isolated separately at 64 MiB using the 16-byte exact pattern across 256 KiB/1 MiB/4 MiB chunks.

CPU utilization is not measured (no portable, dependency-free sampling from this benchmark binary, consistent with every earlier stage's own scoping) — wall-clock elapsed time and derived MB/s throughput are reported instead.

## Machine

Same as Stage 1-4: AMD Ryzen 7 9850X3D (16 logical CPUs), 31.1 GiB RAM, Windows 11, x64. Release build.

## Full real results

```
    size       kind    matches         elapsed_ms         MB/s       case
    16MiB  raw_bytes          0              12.31      1299.88 raw_bytes_short_4B
    16MiB  raw_bytes          0               4.89      3268.84 raw_bytes_medium_16B
    16MiB  raw_bytes          0               3.18      5038.89 raw_bytes_long_64B
    16MiB        aob          0               4.72      3387.82 aob_wildcard_medium_16B
    16MiB       utf8          0               4.63      3457.29 utf8_medium_17ch
    16MiB    utf16le          0               3.59      4454.84 utf16le_medium_17ch
    64MiB  raw_bytes          0              48.61      1316.66 raw_bytes_short_4B
    64MiB  raw_bytes          0              20.09      3186.24 raw_bytes_medium_16B
    64MiB  raw_bytes          0              13.36      4789.70 raw_bytes_long_64B
    64MiB        aob          0              19.32      3312.53 aob_wildcard_medium_16B
    64MiB       utf8          0              18.92      3382.15 utf8_medium_17ch
    64MiB    utf16le          0              14.71      4350.07 utf16le_medium_17ch
    64MiB  raw_bytes          0              16.98      3768.50 chunk_size_effect (chunk=256KiB)
    64MiB  raw_bytes          0              21.09      3035.33 chunk_size_effect (chunk=1024KiB)
    64MiB  raw_bytes          0              19.02      3365.50 chunk_size_effect (chunk=4096KiB)
   256MiB  raw_bytes          0             191.90      1334.02 raw_bytes_short_4B
   256MiB  raw_bytes          0              79.88      3205.00 raw_bytes_medium_16B
   256MiB  raw_bytes          0              53.07      4823.79 raw_bytes_long_64B
   256MiB        aob          0              82.56      3100.80 aob_wildcard_medium_16B
   256MiB       utf8          0              78.49      3261.48 utf8_medium_17ch
   256MiB    utf16le          0              61.74      4146.28 utf16le_medium_17ch
```

## Interpretation

- **Pattern-length impact is the dominant, consistent effect, and it runs the opposite direction from a naive "more bytes = slower" intuition**: at every region size, the 4-byte pattern is the *slowest* (~1.3 GB/s) and the 64-byte pattern is the *fastest* (~4.8-5.0 GB/s) — roughly 3.7× apart, holding almost exactly across 16/64/256 MiB. This is the expected, textbook Horspool signature: a longer pattern gives the bad-character skip table a larger maximum jump distance (up to the full pattern length) per mismatch, so the scan advances through decoy memory faster the longer the pattern is — real, measured confirmation that `build_horspool_skip_table` (doc 40) is genuinely accelerating the scan, not merely present.
- **Wildcard impact is small when the anchoring last byte stays exact**: the 16-byte wildcard AOB case (3,313-3,388 MB/s across sizes) tracks within ~4% of the equal-length fully-exact 16-byte raw-byte case (3,186-3,269 MB/s) — actually slightly *faster* in this run, well within measurement noise, confirming doc 40's claim that a wildcard costs little as long as the pattern's last byte remains exact and the skip table stays active.
- **UTF-16LE outperforms UTF-8 for the same source text** (4,146-4,455 MB/s vs. 3,261-3,457 MB/s for the same 17-character string): UTF-16LE encodes to double the byte length (34 vs. 17 bytes), and per the length-impact finding above, a longer pattern skips further per mismatch — the encoding choice does not change the underlying throughput mechanism, only the effective pattern length does.
- **Chunk-size effect (at 64 MiB, 16-byte exact pattern) shows no strong monotonic trend**: 256 KiB (3,769 MB/s) slightly beats both 1 MiB (3,035 MB/s) and 4 MiB (3,366 MB/s) in this run. Unlike Stage 2's raw chunked-read benchmark (where syscall count dominated), once Horspool's per-byte skip logic is the dominant cost driver, chunk-size variation within this range mostly trades a small syscall-count difference against a small per-call buffer-processing overhead difference — neither consistently wins, an honest "no strong effect in this range" finding rather than a forced narrative.
- **Zero matches everywhere is expected and correct** — the bench region has no planted content; this row set measures pure worst-case scan cost, not match-density-dependent behavior (match-count correctness is separately, exhaustively proven by the real fixture-based tests in doc 42/`pattern_scan_integration.rs`/`pattern.test.js`).
- **No Cheat Engine comparison is made** and no claim of superiority over any other tool — this is a pre-optimization baseline for the current, first-cut Rust pattern engine, exactly as every earlier stage's performance doc scoped itself.
