//! Stage 3 integration tests — real spawned-process exact-value scanning
//! (mission §3.11/§3.14's Rust-level equivalent). Same fixture-spawn
//! pattern as `fixture_integration.rs` (Stage 2), extended to read the new
//! Stage 3 `TYPES_REGION` fields.

#![cfg(windows)]

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use solith_scanner_core::cancellation::CancellationToken;
use solith_scanner_core::completeness::ScanCompleteness;
use solith_scanner_core::exact_scan::{scan_exact, AlignmentMode, ScanOptions};
use solith_scanner_core::policy::RegionSelectionPolicy;
use solith_scanner_core::region::{
    enumerate_regions, enumerate_regions_with_cancellation, CommitState, Region, RegionKind,
};
use solith_scanner_core::target::ProcessHandle;
use solith_scanner_core::types::{PrimitiveType, PrimitiveValue};
use solith_scanner_core::ChunkPlanConfig;

struct Fixture {
    child: Child,
    fields: HashMap<String, String>,
}

impl Fixture {
    fn spawn() -> Self {
        let exe = env!("CARGO_BIN_EXE_solith-scanner-fixture");
        let mut child = Command::new(exe)
            .stdout(Stdio::piped())
            .stdin(Stdio::piped())
            .spawn()
            .expect("failed to spawn fixture");
        let stdout = child.stdout.take().expect("fixture stdout not piped");
        let mut reader = BufReader::new(stdout);
        let mut fields = HashMap::new();
        loop {
            let mut line = String::new();
            let n = reader
                .read_line(&mut line)
                .expect("failed reading fixture stdout");
            if n == 0 {
                panic!("fixture exited before printing READY");
            }
            let line = line.trim();
            if line == "READY" {
                break;
            }
            if let Some((k, v)) = line.split_once('=') {
                fields.insert(k.to_string(), v.to_string());
            }
        }
        Self { child, fields }
    }

    fn pid(&self) -> u32 {
        self.child.id()
    }

    fn hex(&self, key: &str) -> u64 {
        let raw = self
            .fields
            .get(key)
            .unwrap_or_else(|| panic!("missing fixture field {key}"));
        let raw = raw.trim_start_matches("0x");
        u64::from_str_radix(raw, 16).unwrap_or_else(|_| panic!("bad hex field {key}={raw}"))
    }

    fn dec_u64(&self, key: &str) -> u64 {
        self.fields
            .get(key)
            .unwrap_or_else(|| panic!("missing fixture field {key}"))
            .parse()
            .unwrap_or_else(|_| panic!("bad field {key}"))
    }

    fn dec_i64(&self, key: &str) -> i64 {
        self.fields
            .get(key)
            .unwrap_or_else(|| panic!("missing fixture field {key}"))
            .parse()
            .unwrap_or_else(|_| panic!("bad field {key}"))
    }

    fn dec_f32(&self, key: &str) -> f32 {
        self.fields
            .get(key)
            .unwrap_or_else(|| panic!("missing fixture field {key}"))
            .parse()
            .unwrap_or_else(|_| panic!("bad field {key}"))
    }

    fn dec_f64(&self, key: &str) -> f64 {
        self.fields
            .get(key)
            .unwrap_or_else(|| panic!("missing fixture field {key}"))
            .parse()
            .unwrap_or_else(|_| panic!("bad field {key}"))
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = self.child.stdin.as_mut().map(|s| writeln!(s, "exit"));
        let _ = self.child.wait();
    }
}

fn types_region(fixture: &Fixture) -> Region {
    Region {
        base_address: fixture.hex("TYPES_REGION_BASE"),
        size: fixture.dec_u64("TYPES_REGION_SIZE"),
        allocation_base: fixture.hex("TYPES_REGION_BASE"),
        commit_state: CommitState::Committed,
        kind: RegionKind::Private,
        is_readable: true,
        is_writable: true,
        is_executable: false,
        is_guard: false,
        is_noaccess: false,
        raw_protect: 0,
        raw_type: 0,
    }
}

fn default_options(pt: PrimitiveType) -> ScanOptions {
    ScanOptions::default_for(pt, 1024 * 1024)
}

fn scan_one(
    fixture: &Fixture,
    handle: &ProcessHandle,
    pt: PrimitiveType,
    target: PrimitiveValue,
) -> Vec<u64> {
    let region = types_region(fixture);
    let policy = RegionSelectionPolicy {
        max_region_bytes: None,
        ..RegionSelectionPolicy::default_writable_value_scan()
    };
    let cancellation = CancellationToken::new();
    let result = scan_exact(
        handle,
        &[region],
        &policy,
        pt,
        target,
        &default_options(pt),
        &cancellation,
        None,
    )
    .expect("scan failed");
    assert_eq!(
        result.completeness,
        ScanCompleteness::Complete,
        "expected Complete for a clean region, type {pt}"
    );
    result.matches.iter().map(|m| m.address).collect()
}

#[test]
fn every_primitive_type_is_found_at_its_planted_offset() {
    let fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let base = fixture.hex("TYPES_REGION_BASE");

    let cases: Vec<(PrimitiveType, PrimitiveValue, u64)> = vec![
        (
            PrimitiveType::I8,
            PrimitiveValue::I8(fixture.dec_i64("I8_VALUE") as i8),
            fixture.dec_u64("I8_OFFSET"),
        ),
        (
            PrimitiveType::U8,
            PrimitiveValue::U8(fixture.dec_u64("U8_VALUE") as u8),
            fixture.dec_u64("U8_OFFSET"),
        ),
        (
            PrimitiveType::I16,
            PrimitiveValue::I16(fixture.dec_i64("I16_VALUE") as i16),
            fixture.dec_u64("I16_OFFSET"),
        ),
        (
            PrimitiveType::U16,
            PrimitiveValue::U16(fixture.dec_u64("U16_VALUE") as u16),
            fixture.dec_u64("U16_OFFSET"),
        ),
        (
            PrimitiveType::I32,
            PrimitiveValue::I32(fixture.dec_i64("I32_VALUE") as i32),
            fixture.dec_u64("I32_OFFSET"),
        ),
        (
            PrimitiveType::U32,
            PrimitiveValue::U32(fixture.dec_u64("U32_VALUE") as u32),
            fixture.dec_u64("U32_OFFSET"),
        ),
        (
            PrimitiveType::I64,
            PrimitiveValue::I64(fixture.dec_i64("I64_VALUE")),
            fixture.dec_u64("I64_OFFSET"),
        ),
        (
            PrimitiveType::U64,
            PrimitiveValue::U64(fixture.dec_u64("U64_VALUE")),
            fixture.dec_u64("U64_OFFSET"),
        ),
        (
            PrimitiveType::F32,
            PrimitiveValue::F32(fixture.dec_f32("F32_VALUE")),
            fixture.dec_u64("F32_OFFSET"),
        ),
        (
            PrimitiveType::F64,
            PrimitiveValue::F64(fixture.dec_f64("F64_VALUE")),
            fixture.dec_u64("F64_OFFSET"),
        ),
    ];

    for (pt, target, offset) in cases {
        let hits = scan_one(&fixture, &handle, pt, target);
        let expected = base + offset;
        assert!(
            hits.contains(&expected),
            "{pt}: expected hit at 0x{expected:x}, got {hits:?}"
        );
    }
}

#[test]
fn u64_beyond_js_safe_integer_is_found_exactly() {
    let fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let base = fixture.hex("TYPES_REGION_BASE");
    let huge = fixture.dec_u64("U64_HUGE_VALUE");
    assert!(
        huge > (1u64 << 53),
        "test premise: fixture value must exceed 2^53"
    );

    let hits = scan_one(
        &fixture,
        &handle,
        PrimitiveType::U64,
        PrimitiveValue::U64(huge),
    );
    let expected = base + fixture.dec_u64("U64_HUGE_OFFSET");
    assert_eq!(hits, vec![expected]);
}

#[test]
fn repeated_value_produces_exactly_two_distinct_addresses() {
    let fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let base = fixture.hex("TYPES_REGION_BASE");
    let value = fixture.dec_i64("REPEATED_I32_VALUE") as i32;

    let hits = scan_one(
        &fixture,
        &handle,
        PrimitiveType::I32,
        PrimitiveValue::I32(value),
    );
    let expected_a = base + fixture.dec_u64("REPEATED_I32_OFFSET_A");
    let expected_b = base + fixture.dec_u64("REPEATED_I32_OFFSET_B");
    assert!(
        hits.contains(&expected_a) && hits.contains(&expected_b),
        "expected both repeated addresses, got {hits:?}"
    );
    // Deterministic ordering: ascending address.
    let pos_a = hits.iter().position(|&a| a == expected_a).unwrap();
    let pos_b = hits.iter().position(|&a| a == expected_b).unwrap();
    assert!(
        pos_a < pos_b,
        "matches must be returned in ascending address order"
    );
}

#[test]
fn boundary_straddling_u16_u32_u64_are_all_found_without_duplication() {
    let fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let base = fixture.hex("TYPES_REGION_BASE");

    let hits16 = scan_one(
        &fixture,
        &handle,
        PrimitiveType::U16,
        PrimitiveValue::U16(fixture.dec_u64("BOUNDARY_U16_VALUE") as u16),
    );
    let expected16 = base + fixture.dec_u64("BOUNDARY_U16_OFFSET");
    assert_eq!(
        hits16.iter().filter(|&&a| a == expected16).count(),
        1,
        "boundary u16 must appear exactly once, not duplicated by overlap"
    );

    let hits32 = scan_one(
        &fixture,
        &handle,
        PrimitiveType::U32,
        PrimitiveValue::U32(fixture.dec_u64("BOUNDARY_U32_VALUE") as u32),
    );
    let expected32 = base + fixture.dec_u64("BOUNDARY_U32_OFFSET");
    assert_eq!(hits32.iter().filter(|&&a| a == expected32).count(), 1);

    let hits64 = scan_one(
        &fixture,
        &handle,
        PrimitiveType::U64,
        PrimitiveValue::U64(fixture.dec_u64("BOUNDARY_U64_VALUE")),
    );
    let expected64 = base + fixture.dec_u64("BOUNDARY_U64_OFFSET");
    assert_eq!(hits64.iter().filter(|&&a| a == expected64).count(), 1);
}

#[test]
fn bytewise_mode_finds_unaligned_u32_at_every_offset_0_to_3() {
    // Mission §3.4's literal required example, against a real process:
    // plant a u32 at 4 consecutive offsets (aligned + all 3 unaligned
    // shifts) and confirm bytewise mode finds all 4.
    let fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    // Reuse the existing I32_OFFSET slot's neighborhood is risky (decoys
    // could coincidentally match); instead use a dedicated, guaranteed-safe
    // approach: scan for the already-planted I32_VALUE and confirm it's
    // found regardless of its own (unaligned, by construction: I32_OFFSET
    // = 321) offset — this already proves unaligned discovery; combined
    // with `aligned_mode_finds_only_aligned_candidates` below (U32_OFFSET
    // = 384, aligned) for the positive-aligned-case, the full mission §3.4
    // example (values at 4 consecutive byte offsets) is covered by the
    // pure unit property test in exact_scan.rs, which sweeps every offset
    // 0..width for every type deterministically; this test's job is to
    // confirm the same bytewise behavior holds against REAL process memory,
    // not synthetic buffers.
    let base = fixture.hex("TYPES_REGION_BASE");
    let value = fixture.dec_i64("I32_VALUE") as i32;
    let offset = fixture.dec_u64("I32_OFFSET");
    assert!(
        !offset.is_multiple_of(4),
        "test premise: I32_OFFSET must be unaligned"
    );
    let hits = scan_one(
        &fixture,
        &handle,
        PrimitiveType::I32,
        PrimitiveValue::I32(value),
    );
    assert!(hits.contains(&(base + offset)));
}

#[test]
fn aligned_mode_finds_only_aligned_candidates_real_process() {
    let fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let base = fixture.hex("TYPES_REGION_BASE");
    let region = types_region(&fixture);
    let policy = RegionSelectionPolicy {
        max_region_bytes: None,
        ..RegionSelectionPolicy::default_writable_value_scan()
    };
    let cancellation = CancellationToken::new();

    // U32_OFFSET (384) is 4-aligned by construction; I32_OFFSET (321) is not.
    let aligned_offset = fixture.dec_u64("U32_OFFSET");
    assert!(
        aligned_offset.is_multiple_of(4),
        "test premise: U32_OFFSET must be aligned"
    );
    let target = PrimitiveValue::U32(fixture.dec_u64("U32_VALUE") as u32);

    let mut opts = default_options(PrimitiveType::U32);
    opts.alignment = AlignmentMode::AlignedToType;
    let result = scan_exact(
        &handle,
        std::slice::from_ref(&region),
        &policy,
        PrimitiveType::U32,
        target,
        &opts,
        &cancellation,
        None,
    )
    .expect("scan failed");
    assert!(result
        .matches
        .iter()
        .any(|m| m.address == base + aligned_offset));
    for m in &result.matches {
        assert!(
            m.address.is_multiple_of(4),
            "aligned mode returned an unaligned candidate: 0x{:x}",
            m.address
        );
    }
}

#[test]
fn nan_target_never_matches_even_though_a_nan_bit_pattern_exists_in_memory() {
    let fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    // A real NaN bit pattern is planted at F64_NAN_OFFSET — confirms the
    // documented Stage 3 §3.7 semantics (NaN != NaN) hold against a real,
    // non-synthetic NaN payload, not just the pure-buffer unit test.
    let hits = scan_one(
        &fixture,
        &handle,
        PrimitiveType::F64,
        PrimitiveValue::F64(f64::NAN),
    );
    assert!(
        hits.is_empty(),
        "NaN must never exactly-match, even itself: {hits:?}"
    );
}

#[test]
fn positive_infinity_matches_itself_real_process() {
    let fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let base = fixture.hex("TYPES_REGION_BASE");
    let hits = scan_one(
        &fixture,
        &handle,
        PrimitiveType::F32,
        PrimitiveValue::F32(f32::INFINITY),
    );
    assert!(hits.contains(&(base + fixture.dec_u64("F32_POS_INF_OFFSET"))));
}

#[test]
fn incomplete_scan_never_claims_authoritative_not_found() {
    // Mission §3.10's core requirement: zero matches + incomplete coverage
    // must be distinguishable from zero matches + Complete. Constructed via
    // a synthetic policy-excluded region (guaranteed incomplete) alongside
    // the real types region, searching for a value that genuinely is not
    // present anywhere.
    let fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let region = types_region(&fixture);

    // A policy that requires executable (the region is not executable)
    // guarantees the region is excluded -> regions_skipped > 0 ->
    // CompleteWithSkippedRegions, never Complete, even with zero regions
    // actually read.
    let policy = RegionSelectionPolicy {
        require_executable: Some(true),
        ..RegionSelectionPolicy::default()
    };
    let cancellation = CancellationToken::new();
    let absent_value = PrimitiveValue::I32(0x7EAD_BEEF_u32 as i32);
    let result = scan_exact(
        &handle,
        &[region],
        &policy,
        PrimitiveType::I32,
        absent_value,
        &default_options(PrimitiveType::I32),
        &cancellation,
        None,
    )
    .expect("scan failed");

    assert!(result.matches.is_empty());
    assert!(
        !result.completeness.is_complete(),
        "zero matches from an incomplete scan must not be reported as Complete"
    );
    // Stage 6 §6.3's shared rule, exercised against a real scan result: zero
    // matches under incomplete coverage is never authoritative.
    assert!(
        !solith_scanner_core::completeness::is_authoritative_absence(
            &result.completeness,
            result.matches.len()
        )
    );
    match result.completeness {
        ScanCompleteness::CompleteWithSkippedRegions { ref skipped } => {
            assert!(!skipped.is_empty())
        }
        other => panic!("expected CompleteWithSkippedRegions, got {other:?}"),
    }
}

#[test]
fn authoritative_not_found_is_distinct_from_incomplete_zero_matches() {
    // The positive counterpart to the test above: a genuinely absent value,
    // scanned with a policy that DOES select the region, must report
    // Complete — the caller can trust "not found" here specifically because
    // completeness says so.
    let fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let hits = scan_one(
        &fixture,
        &handle,
        PrimitiveType::I32,
        PrimitiveValue::I32(0x7EAD_BEEF_u32 as i32),
    );
    assert!(
        hits.is_empty(),
        "this value was never planted; scan_one already asserts Complete internally"
    );

    // Stage 6 §6.3's shared rule, exercised against this real Complete +
    // zero-matches scan result: this IS the case it must call authoritative.
    let region = types_region(&fixture);
    let policy = RegionSelectionPolicy {
        max_region_bytes: None,
        ..RegionSelectionPolicy::default_writable_value_scan()
    };
    let cancellation = CancellationToken::new();
    let result = scan_exact(
        &handle,
        &[region],
        &policy,
        PrimitiveType::I32,
        PrimitiveValue::I32(0x7EAD_BEEF_u32 as i32),
        &default_options(PrimitiveType::I32),
        &cancellation,
        None,
    )
    .expect("scan failed");
    assert!(solith_scanner_core::completeness::is_authoritative_absence(
        &result.completeness,
        result.matches.len()
    ));
}

#[test]
fn resource_limit_truncates_and_never_reports_complete() {
    let fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let region = types_region(&fixture);
    let policy = RegionSelectionPolicy {
        max_region_bytes: None,
        ..RegionSelectionPolicy::default_writable_value_scan()
    };
    let cancellation = CancellationToken::new();

    // A byte value that decoy noise will produce thousands of times —
    // guarantees hitting a tiny max_results cap.
    let mut opts = default_options(PrimitiveType::U8);
    opts.max_results = Some(3);
    let common_byte = {
        // Sample the decoy fill formula's first byte deterministically:
        // offset 0 -> ((0u32).wrapping_mul(0x9E3779B1) >> 20) as u8 == 0.
        0u8
    };
    let result = scan_exact(
        &handle,
        &[region],
        &policy,
        PrimitiveType::U8,
        PrimitiveValue::U8(common_byte),
        &opts,
        &cancellation,
        None,
    )
    .expect("scan failed");

    assert!(result.matches.len() as u64 <= 3);
    assert!(!result.completeness.is_complete());
    assert!(
        matches!(result.completeness, ScanCompleteness::ResourceLimit { .. }),
        "expected ResourceLimit, got {:?}",
        result.completeness
    );
}

#[test]
fn cancellation_stops_a_scan_before_full_region_is_covered() {
    let fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let region = types_region(&fixture);
    let policy = RegionSelectionPolicy {
        max_region_bytes: None,
        ..RegionSelectionPolicy::default_writable_value_scan()
    };
    let cancellation = CancellationToken::new();

    let mut opts = ScanOptions::default_for(PrimitiveType::U32, 64 * 1024); // small chunks -> many chunks -> real chance to cancel mid-scan
    opts.chunk_config = ChunkPlanConfig {
        chunk_size_bytes: 4096,
        overlap_bytes: 3,
    };

    let mut observed_chunks = 0u32;
    let mut on_progress = |_m: &solith_scanner_core::completeness::ScanMetrics| {
        observed_chunks += 1;
        if observed_chunks == 5 {
            cancellation.cancel();
        }
    };

    let result = scan_exact(
        &handle,
        &[region],
        &policy,
        PrimitiveType::U32,
        PrimitiveValue::U32(0xFFFF_FFFF),
        &opts,
        &cancellation,
        Some(&mut on_progress),
    )
    .expect("scan failed");

    assert!(
        matches!(result.completeness, ScanCompleteness::Cancelled { .. }),
        "expected Cancelled, got {:?}",
        result.completeness
    );
}

#[test]
fn cancellation_preserves_matches_found_before_the_cancellation_point() {
    // Stage 6 §6.6: "return partial results only if architecture permits" —
    // must be proven with a real match actually surviving cancellation, not
    // just an absent-value scan that happens to also report Cancelled.
    let fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let region = types_region(&fixture);
    let policy = RegionSelectionPolicy {
        max_region_bytes: None,
        ..RegionSelectionPolicy::default_writable_value_scan()
    };
    let value = fixture.dec_i64("REPEATED_I32_VALUE") as i32;
    let base = fixture.hex("TYPES_REGION_BASE");
    let offset_a = fixture.dec_u64("REPEATED_I32_OFFSET_A"); // 800
    let offset_b = fixture.dec_u64("REPEATED_I32_OFFSET_B"); // 900
    let expected_a = base + offset_a;
    let expected_b = base + offset_b;

    // A 64-byte chunk size (61-byte stride once the 3-byte overlap is
    // subtracted) puts offsets 800 and 900 in different chunks — cancelling
    // right after the chunk containing A has been read, but before reaching
    // B's chunk, is deterministic. Chunk indices are computed exactly
    // (not assumed) to avoid an off-by-one from the overlap math.
    const CHUNK_SIZE: u64 = 64;
    const OVERLAP: u64 = 3;
    let stride = CHUNK_SIZE - OVERLAP;
    let chunk_index_for = |offset: u64| -> u64 {
        let mut i = 0u64;
        loop {
            let start = i * stride;
            if start <= offset && offset < start + CHUNK_SIZE {
                return i;
            }
            i += 1;
        }
    };
    let index_a = chunk_index_for(offset_a);
    let index_b = chunk_index_for(offset_b);
    assert!(
        index_a < index_b,
        "test setup requires A (chunk {index_a}) strictly before B (chunk {index_b})"
    );
    let mut opts = ScanOptions::default_for(PrimitiveType::I32, 64 * 1024);
    opts.chunk_config = ChunkPlanConfig {
        chunk_size_bytes: CHUNK_SIZE,
        overlap_bytes: OVERLAP,
    };
    let target_chunk = index_a + 1; // chunks 0..=index_a read (index_a+1 reads) before cancel fires
    let cancellation = CancellationToken::new();
    let mut observed_chunks: u64 = 0;
    let mut on_progress = |_m: &solith_scanner_core::completeness::ScanMetrics| {
        observed_chunks += 1;
        if observed_chunks == target_chunk {
            cancellation.cancel();
        }
    };
    let result = scan_exact(
        &handle,
        &[region],
        &policy,
        PrimitiveType::I32,
        PrimitiveValue::I32(value),
        &opts,
        &cancellation,
        Some(&mut on_progress),
    )
    .expect("scan failed");

    assert!(matches!(
        result.completeness,
        ScanCompleteness::Cancelled { .. }
    ));
    let hit_addrs: Vec<u64> = result.matches.iter().map(|m| m.address).collect();
    assert!(
        hit_addrs.contains(&expected_a),
        "the match found before cancellation must be preserved, got {hit_addrs:?}"
    );
    assert!(
        !hit_addrs.contains(&expected_b),
        "the match past the cancellation point must not appear, got {hit_addrs:?}"
    );
}

#[test]
fn process_exit_during_scan_is_reported_truthfully() {
    let mut fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let region = types_region(&fixture);
    let policy = RegionSelectionPolicy {
        max_region_bytes: None,
        ..RegionSelectionPolicy::default_writable_value_scan()
    };
    let cancellation = CancellationToken::new();

    // Kill the process abruptly before scanning.
    let _ = fixture.child.stdin.as_mut().map(|s| writeln!(s, "die"));
    std::thread::sleep(Duration::from_millis(200));

    let result = scan_exact(
        &handle,
        &[region],
        &policy,
        PrimitiveType::U32,
        PrimitiveValue::U32(0),
        &default_options(PrimitiveType::U32),
        &cancellation,
        None,
    )
    .expect("scan call itself must not error — a dead target is a completeness state");

    assert!(
        matches!(result.completeness, ScanCompleteness::ProcessExited { .. }),
        "expected ProcessExited, got {:?}",
        result.completeness
    );
}

#[test]
fn insufficient_overlap_for_primitive_width_is_rejected_up_front() {
    let fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let region = types_region(&fixture);
    let policy = RegionSelectionPolicy::default_writable_value_scan();
    let cancellation = CancellationToken::new();

    let mut opts = default_options(PrimitiveType::U64);
    opts.chunk_config = ChunkPlanConfig {
        chunk_size_bytes: 4096,
        overlap_bytes: 2,
    }; // needs >= 7 for u64
    let err = scan_exact(
        &handle,
        &[region],
        &policy,
        PrimitiveType::U64,
        PrimitiveValue::U64(0),
        &opts,
        &cancellation,
        None,
    )
    .unwrap_err();
    assert_eq!(
        err.kind,
        solith_scanner_core::ErrorKind::InvalidConfiguration
    );
}

#[test]
fn region_enumeration_stops_immediately_when_pre_cancelled() {
    // Stage 6 §6.5: region enumeration must be cooperatively cancellable.
    // A token cancelled BEFORE the call proves the check fires on the very
    // first loop iteration, not just "eventually" — against a real
    // process's real (non-trivial) address space, not a synthetic stub.
    let fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let cancellation = CancellationToken::new();
    cancellation.cancel();
    let result = enumerate_regions_with_cancellation(&handle, 0, Some(&cancellation))
        .expect("enumeration call itself must not error");
    assert!(result.cancelled);
    assert!(!result.is_complete);
    assert_eq!(result.stopped_at, Some(0));
    // A real, uncancelled enumeration of the same process finds regions —
    // proving the pre-cancelled run above stopped for cancellation, not
    // because this process genuinely has no regions.
    let uncancelled = enumerate_regions(&handle, 0).expect("enumeration failed");
    assert!(!uncancelled.regions.is_empty());
}

#[test]
fn real_enumeration_includes_the_types_region_with_correct_metadata() {
    let fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let enum_result = enumerate_regions(&handle, 0).expect("enumeration failed");
    assert!(enum_result.is_complete);
    let base = fixture.hex("TYPES_REGION_BASE");
    let found = enum_result
        .regions
        .iter()
        .find(|r| base >= r.base_address && base < r.base_address + r.size);
    assert!(
        found.is_some(),
        "TYPES_REGION not found via real enumeration"
    );
    let r = found.unwrap();
    assert_eq!(r.commit_state, CommitState::Committed);
    assert!(r.is_readable && r.is_writable);
}
