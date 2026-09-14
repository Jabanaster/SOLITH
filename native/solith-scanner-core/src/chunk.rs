//! Chunk planning — pure, OS-independent logic that decides how a region is
//! split into bounded, overlapping read windows. Kept fully testable
//! without Windows/a real process (see `tests/chunk_planning.rs`), per the
//! mission's chunk test matrix (§19).
//!
//! This directly retires the current TypeScript scanner's "one region, one
//! `readBuffer` call, hard boundary" design (Stage 1 doc 01 §5/doc 02 D02),
//! which is what makes the 1 MiB cap a silent data-loss boundary today
//! rather than an internal tuning knob.

use crate::error::{ErrorKind, ScannerError, ScannerResult};

/// Configuration for chunk planning. `overlap_bytes` must satisfy
/// `overlap_bytes < chunk_size_bytes` — the mission's required relationship
/// is `overlap >= max_candidate_width - 1` for fixed-width scans, which is a
/// *caller* obligation (the planner enforces the upper structural bound,
/// not the semantic minimum, since the planner has no notion of "candidate
/// width" — that belongs to the scan mode, a later stage's concern).
#[derive(Debug, Clone, Copy)]
pub struct ChunkPlanConfig {
    pub chunk_size_bytes: u64,
    pub overlap_bytes: u64,
}

impl ChunkPlanConfig {
    /// A conservative default for early testing/benchmarking (doc 06 §2.2
    /// suggested 1 MiB as the tuning-knob starting point, matching the real
    /// per-`ReadProcessMemory`-call cost/reliability sweet spot already
    /// implicit in today's cap). Exposed as a named default, not hardcoded
    /// into the planner itself, so Stage 2's own benchmarks (doc 16) can
    /// evidence-check whether it should change before Stage 3 commits to it
    /// for real scan modes.
    pub fn default_for_testing() -> Self {
        ChunkPlanConfig {
            chunk_size_bytes: 1024 * 1024,
            overlap_bytes: 7,
        }
    }

    fn validate(&self) -> ScannerResult<()> {
        if self.chunk_size_bytes == 0 {
            return Err(ScannerError::new(
                ErrorKind::InvalidConfiguration,
                "chunk_size_bytes must be > 0",
            ));
        }
        if self.overlap_bytes >= self.chunk_size_bytes {
            return Err(ScannerError::new(
                ErrorKind::InvalidConfiguration,
                format!(
                    "overlap_bytes ({}) must be strictly less than chunk_size_bytes ({})",
                    self.overlap_bytes, self.chunk_size_bytes
                ),
            ));
        }
        Ok(())
    }
}

/// One planned read window. `logical_region_base`/`logical_region_size`
/// identify which enumerated region this chunk belongs to (a region may
/// produce many chunks); `chunk_base`/`requested_size` are the actual
/// window to read; `overlap_before`/`overlap_after` record how many bytes
/// of this window duplicate the previous/next chunk, so a caller doing
/// value/pattern matching across chunk boundaries knows exactly which bytes
/// to de-duplicate rather than guessing from `chunk_size`/`overlap` alone
/// (important once the final chunk is shorter than a full chunk).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChunkSpec {
    pub logical_region_base: u64,
    pub logical_region_size: u64,
    pub chunk_base: u64,
    pub requested_size: u64,
    pub overlap_before: u64,
    pub overlap_after: u64,
}

/// Plans the chunk sequence for one region. Returns `Ok(vec![])` for a
/// zero-size region (a valid, non-error edge case — there is simply nothing
/// to read), and `Err(InvalidConfiguration)` for a nonsensical config
/// (`overlap >= chunk_size`, `chunk_size == 0`), and `Err(AddressOverflow)`
/// if `region_base + region_size` (or any intermediate chunk address) would
/// wrap past `u64::MAX` — the mission's explicit "no unchecked address
/// arithmetic" requirement.
pub fn plan_chunks(
    region_base: u64,
    region_size: u64,
    config: ChunkPlanConfig,
) -> ScannerResult<Vec<ChunkSpec>> {
    config.validate()?;

    if region_size == 0 {
        return Ok(Vec::new());
    }

    // Fail closed on a region descriptor whose own bounds already overflow,
    // rather than discovering it mid-loop.
    region_base.checked_add(region_size).ok_or_else(|| {
        ScannerError::new(
            ErrorKind::AddressOverflow,
            "region_base + region_size overflows u64",
        )
    })?;

    let stride = config.chunk_size_bytes - config.overlap_bytes; // > 0, guaranteed by validate()

    let mut chunks = Vec::new();
    let mut offset: u64 = 0;

    loop {
        let remaining = region_size - offset;
        let requested_size = remaining.min(config.chunk_size_bytes);

        let chunk_base = region_base.checked_add(offset).ok_or_else(|| {
            ScannerError::new(ErrorKind::AddressOverflow, "chunk_base overflows u64")
        })?;

        let overlap_before = if offset == 0 {
            0
        } else {
            config.overlap_bytes.min(offset)
        };
        let is_last = offset + requested_size >= region_size;
        let overlap_after = if is_last { 0 } else { config.overlap_bytes };

        chunks.push(ChunkSpec {
            logical_region_base: region_base,
            logical_region_size: region_size,
            chunk_base,
            requested_size,
            overlap_before,
            overlap_after,
        });

        if is_last {
            break;
        }

        offset = offset.checked_add(stride).ok_or_else(|| {
            ScannerError::new(ErrorKind::AddressOverflow, "chunk offset overflows u64")
        })?;
    }

    Ok(chunks)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(chunk_size: u64, overlap: u64) -> ChunkPlanConfig {
        ChunkPlanConfig {
            chunk_size_bytes: chunk_size,
            overlap_bytes: overlap,
        }
    }

    fn assert_full_coverage(base: u64, size: u64, chunks: &[ChunkSpec]) {
        // Every byte offset in [0, size) must fall inside at least one
        // chunk's [chunk_base, chunk_base + requested_size) window,
        // relative to `base` — the fundamental correctness property this
        // planner exists to guarantee (mission §9/§19).
        for offset in 0..size {
            let absolute = base + offset;
            let covered = chunks
                .iter()
                .any(|c| absolute >= c.chunk_base && absolute < c.chunk_base + c.requested_size);
            assert!(
                covered,
                "offset {offset} (absolute 0x{absolute:x}) not covered by any chunk"
            );
        }
    }

    #[test]
    fn region_size_zero_produces_no_chunks() {
        let chunks = plan_chunks(0x1000, 0, config(4096, 7)).unwrap();
        assert!(chunks.is_empty());
    }

    #[test]
    fn region_smaller_than_chunk_produces_one_partial_chunk() {
        let chunks = plan_chunks(0x1000, 100, config(4096, 7)).unwrap();
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].requested_size, 100);
        assert_eq!(chunks[0].overlap_before, 0);
        assert_eq!(chunks[0].overlap_after, 0);
        assert_full_coverage(0x1000, 100, &chunks);
    }

    #[test]
    fn region_exactly_chunk_size_produces_one_full_chunk() {
        let chunks = plan_chunks(0x1000, 4096, config(4096, 7)).unwrap();
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].requested_size, 4096);
        assert_full_coverage(0x1000, 4096, &chunks);
    }

    #[test]
    fn region_chunk_plus_one_produces_two_overlapping_chunks() {
        let chunks = plan_chunks(0x1000, 4097, config(4096, 7)).unwrap();
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].requested_size, 4096);
        assert_eq!(chunks[0].overlap_after, 7);
        assert_eq!(chunks[1].overlap_before, 7);
        assert_eq!(chunks[1].requested_size, 4097 - (4096 - 7));
        assert_full_coverage(0x1000, 4097, &chunks);
    }

    #[test]
    fn multiple_chunks_cover_a_large_region_with_no_gaps() {
        let region_size = 10 * 1024 * 1024 + 12345;
        let chunks = plan_chunks(0x1_0000_0000, region_size, config(1024 * 1024, 7)).unwrap();
        assert!(chunks.len() > 1);
        assert_full_coverage(0x1_0000_0000, region_size, &chunks);
        // Every non-final chunk must be exactly the requested chunk size.
        for c in &chunks[..chunks.len() - 1] {
            assert_eq!(c.requested_size, 1024 * 1024);
        }
    }

    #[test]
    fn overlap_zero_is_valid_and_produces_contiguous_chunks() {
        let chunks = plan_chunks(0, 4096 * 3, config(4096, 0)).unwrap();
        assert_eq!(chunks.len(), 3);
        for c in &chunks {
            assert_eq!(c.overlap_before.max(c.overlap_after), 0);
        }
        assert_full_coverage(0, 4096 * 3, &chunks);
    }

    #[test]
    fn overlap_equal_to_width_minus_one_is_valid() {
        // An 8-byte-wide candidate needs overlap >= 7 (mission's required
        // relationship: overlap >= max_candidate_width - 1).
        let chunks = plan_chunks(0, 4096 * 3, config(4096, 7)).unwrap();
        assert!(!chunks.is_empty());
        assert_full_coverage(0, 4096 * 3, &chunks);
    }

    #[test]
    fn overlap_greater_or_equal_to_chunk_size_is_rejected() {
        let err = plan_chunks(0, 4096, config(4096, 4096)).unwrap_err();
        assert_eq!(err.kind, ErrorKind::InvalidConfiguration);

        let err2 = plan_chunks(0, 4096, config(4096, 5000)).unwrap_err();
        assert_eq!(err2.kind, ErrorKind::InvalidConfiguration);
    }

    #[test]
    fn zero_chunk_size_is_rejected() {
        let err = plan_chunks(0, 4096, config(0, 0)).unwrap_err();
        assert_eq!(err.kind, ErrorKind::InvalidConfiguration);
    }

    #[test]
    fn address_near_u64_max_that_fits_is_planned_correctly() {
        let base = u64::MAX - 4096;
        let chunks = plan_chunks(base, 4096, config(4096, 7)).unwrap();
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].chunk_base, base);
        assert_eq!(chunks[0].requested_size, 4096);
    }

    #[test]
    fn address_arithmetic_overflow_is_refused_not_wrapped() {
        // region_base + region_size itself overflows u64::MAX.
        let err = plan_chunks(u64::MAX - 10, 4096, config(4096, 7)).unwrap_err();
        assert_eq!(err.kind, ErrorKind::AddressOverflow);
    }

    #[test]
    fn chunk_offset_overflow_mid_plan_is_refused_not_wrapped() {
        // A region whose base+size fits in u64 but whose chunk stride
        // stepping would need to exceed it is impossible by construction
        // once the up-front region_base+region_size check passes (the loop
        // never advances `offset` past `region_size`), but this test
        // documents that invariant explicitly: the final chunk always
        // terminates the loop via `is_last`, never via an offset overflow,
        // when the region's own bounds are valid.
        let base = u64::MAX - (4096 * 3);
        let chunks = plan_chunks(base, 4096 * 3, config(4096, 7)).unwrap();
        assert_full_coverage(base, 4096 * 3, &chunks);
    }

    #[test]
    fn partial_final_chunk_is_shorter_than_chunk_size() {
        let region_size = 1024 * 1024 + 500;
        let chunks = plan_chunks(0, region_size, config(1024 * 1024, 7)).unwrap();
        let last = chunks.last().unwrap();
        assert!(last.requested_size < 1024 * 1024);
        assert_full_coverage(0, region_size, &chunks);
    }

    #[test]
    fn boundary_straddling_value_is_fully_contained_in_at_least_one_chunk() {
        // Mirrors the fixture's BOUNDARY_OFFSET sentinel: an 8-byte value
        // placed at chunk_size - 4 straddles the naive non-overlapping
        // boundary at chunk_size, but must be fully contained in one chunk
        // once overlap >= 7 is applied.
        let chunk_size = 1024 * 1024u64;
        let chunks = plan_chunks(0, chunk_size * 2, config(chunk_size, 7)).unwrap();
        let value_start = chunk_size - 4;
        let value_end = value_start + 8;
        let fully_contained = chunks
            .iter()
            .any(|c| value_start >= c.chunk_base && value_end <= c.chunk_base + c.requested_size);
        assert!(
            fully_contained,
            "8-byte boundary-straddling value must be fully contained in one chunk"
        );
    }

    /// Minimal deterministic xorshift64 PRNG — used instead of pulling in a
    /// `proptest`/`quickcheck` dev-dependency for Stage 2's property-test
    /// layer, so the chunk-planning fuzz coverage required by mission §19
    /// ("arbitrary chunk boundaries," "arbitrary pattern lengths"-adjacent
    /// randomized sizing) does not depend on an additional pinned crate
    /// before Stage 2's own dependency footprint has been evidence-reviewed.
    /// Fixed seed: failures are reproducible without recording a seed value.
    struct Xorshift64(u64);
    impl Xorshift64 {
        fn next(&mut self) -> u64 {
            let mut x = self.0;
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            self.0 = x;
            x
        }
        fn range(&mut self, lo: u64, hi_inclusive: u64) -> u64 {
            lo + (self.next() % (hi_inclusive - lo + 1))
        }
    }

    #[test]
    fn arbitrary_chunk_boundaries_never_lose_coverage_or_panic() {
        let mut rng = Xorshift64(0x9E3779B97F4A7C15);
        for _ in 0..2000 {
            let chunk_size = rng.range(1, 8192);
            let overlap = rng.range(0, chunk_size - 1);
            let region_size = rng.range(0, 32 * 1024);
            let base = rng.range(0, 1_000_000_000);

            let result = plan_chunks(base, region_size, config(chunk_size, overlap));
            let chunks = result.unwrap_or_else(|e| {
                panic!("unexpected error for chunk_size={chunk_size} overlap={overlap} region_size={region_size} base={base}: {e:?}")
            });

            if region_size == 0 {
                assert!(chunks.is_empty());
                continue;
            }
            assert_full_coverage(base, region_size, &chunks);

            // No chunk ever requests more than chunk_size bytes, and only
            // the last chunk may be shorter.
            for (i, c) in chunks.iter().enumerate() {
                assert!(c.requested_size <= chunk_size);
                if i + 1 < chunks.len() {
                    assert_eq!(
                        c.requested_size, chunk_size,
                        "only the final chunk may be short"
                    );
                }
            }
        }
    }

    #[test]
    fn arbitrary_pattern_widths_get_full_coverage_with_matching_overlap() {
        // Sweeps candidate widths 1..=32 (covers every scalar type Stage 3+
        // will support, i8..=u64 and beyond) with overlap = width - 1,
        // asserting a value of that exact width placed at every possible
        // straddle offset near a chunk boundary is always fully contained.
        let chunk_size = 4096u64;
        for width in 1..=32u64 {
            let overlap = width.saturating_sub(1);
            let chunks = plan_chunks(0, chunk_size * 3, config(chunk_size, overlap)).unwrap();
            for straddle in 0..width {
                let value_start = chunk_size - straddle;
                let value_end = value_start + width;
                let fully_contained = chunks.iter().any(|c| {
                    value_start >= c.chunk_base && value_end <= c.chunk_base + c.requested_size
                });
                assert!(
                    fully_contained,
                    "width={width} straddle={straddle} value [{value_start},{value_end}) not fully contained in any chunk"
                );
            }
        }
    }
}
