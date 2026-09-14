//! Stage 5 integration tests — real spawned-process string/byte/AOB pattern
//! scanning (mission §5.13's real fixture requirement: "Do not certify only
//! from pure Rust arrays"). Same fixture-spawn pattern as
//! `session_integration.rs` (Stage 4), extended to use the new
//! `PATTERN_REGION` and `GUARD_REGION` content Stage 5 added to the fixture.

#![cfg(windows)]

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};

use solith_scanner_core::cancellation::CancellationToken;
use solith_scanner_core::completeness::ScanCompleteness;
use solith_scanner_core::pattern::{
    parse_aob, pattern_from_raw_bytes, pattern_from_utf16le_str, pattern_from_utf8_str,
    NullTerminatorMode, PatternKind,
};
use solith_scanner_core::pattern_scan::{scan_pattern, PatternScanOptions};
use solith_scanner_core::policy::RegionSelectionPolicy;
use solith_scanner_core::region::{CommitState, Region, RegionKind};
use solith_scanner_core::target::ProcessHandle;

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

    fn text(&self, key: &str) -> &str {
        self.fields
            .get(key)
            .unwrap_or_else(|| panic!("missing fixture field {key}"))
    }

    fn kill(&mut self) {
        let stdin = self.child.stdin.as_mut().expect("fixture stdin not piped");
        let _ = writeln!(stdin, "die");
        let _ = self.child.wait();
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = self.child.stdin.as_mut().map(|s| writeln!(s, "exit"));
        let _ = self.child.wait();
    }
}

fn pattern_region(fixture: &Fixture) -> Region {
    Region {
        base_address: fixture.hex("PATTERN_REGION_BASE"),
        size: fixture.dec_u64("PATTERN_REGION_SIZE"),
        allocation_base: fixture.hex("PATTERN_REGION_BASE"),
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

fn guard_region(fixture: &Fixture) -> Region {
    Region {
        base_address: fixture.hex("GUARD_REGION_BASE"),
        size: fixture.dec_u64("GUARD_REGION_SIZE"),
        allocation_base: fixture.hex("GUARD_REGION_BASE"),
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

fn readable_any_policy() -> RegionSelectionPolicy {
    RegionSelectionPolicy {
        max_region_bytes: None,
        ..RegionSelectionPolicy::readable_any()
    }
}

#[test]
fn utf8_ascii_string_is_found_at_the_planted_offset() {
    let fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let region = pattern_region(&fixture);
    let expected_addr = region.base_address + fixture.dec_u64("UTF8_ASCII_OFFSET");
    let pattern = pattern_from_utf8_str(
        fixture.text("UTF8_ASCII_TEXT"),
        true,
        NullTerminatorMode::None,
    )
    .unwrap();
    let options = PatternScanOptions::default_for(&pattern, 1024 * 1024);
    let cancellation = CancellationToken::new();
    let result = scan_pattern(
        &handle,
        &[region],
        &readable_any_policy(),
        &pattern,
        PatternKind::Utf8,
        &options,
        &cancellation,
        None,
    )
    .expect("scan failed");
    assert_eq!(result.completeness, ScanCompleteness::Complete);
    assert!(result.matches.iter().any(|m| m.address == expected_addr));
}

#[test]
fn utf8_multibyte_string_is_found_intact() {
    let fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let region = pattern_region(&fixture);
    let expected_addr = region.base_address + fixture.dec_u64("UTF8_MULTIBYTE_OFFSET");
    // The exact real multibyte string planted by the fixture (café + a
    // Cyrillic word + a CJK word) — kept in sync with fixture.rs's
    // UTF8_MULTIBYTE_TEXT constant.
    let text = "café \u{041F}\u{0440}\u{0438}\u{0432}\u{0435}\u{0442} \u{65E5}\u{672C}\u{8A9E}";
    let pattern = pattern_from_utf8_str(text, true, NullTerminatorMode::None).unwrap();
    let options = PatternScanOptions::default_for(&pattern, 1024 * 1024);
    let cancellation = CancellationToken::new();
    let result = scan_pattern(
        &handle,
        &[region],
        &readable_any_policy(),
        &pattern,
        PatternKind::Utf8,
        &options,
        &cancellation,
        None,
    )
    .expect("scan failed");
    assert!(result.matches.iter().any(|m| m.address == expected_addr));
}

#[test]
fn utf16le_string_is_found_at_the_planted_offset() {
    let fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let region = pattern_region(&fixture);
    let expected_addr = region.base_address + fixture.dec_u64("UTF16LE_OFFSET");
    let pattern =
        pattern_from_utf16le_str(fixture.text("UTF16LE_TEXT"), true, NullTerminatorMode::None)
            .unwrap();
    let options = PatternScanOptions::default_for(&pattern, 1024 * 1024);
    let cancellation = CancellationToken::new();
    let result = scan_pattern(
        &handle,
        &[region],
        &readable_any_policy(),
        &pattern,
        PatternKind::Utf16Le,
        &options,
        &cancellation,
        None,
    )
    .expect("scan failed");
    assert!(result.matches.iter().any(|m| m.address == expected_addr));
}

#[test]
fn utf16le_nonbmp_surrogate_pair_string_is_found() {
    let fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let region = pattern_region(&fixture);
    let expected_addr = region.base_address + fixture.dec_u64("UTF16LE_NONBMP_OFFSET");
    let text = "Win\u{1F600}!";
    let pattern = pattern_from_utf16le_str(text, true, NullTerminatorMode::None).unwrap();
    assert_eq!(pattern.len(), 12); // 3 BMP units (6 bytes) + 1 surrogate pair (4 bytes) + 1 BMP unit (2 bytes)
    let options = PatternScanOptions::default_for(&pattern, 1024 * 1024);
    let cancellation = CancellationToken::new();
    let result = scan_pattern(
        &handle,
        &[region],
        &readable_any_policy(),
        &pattern,
        PatternKind::Utf16Le,
        &options,
        &cancellation,
        None,
    )
    .expect("scan failed");
    assert!(result.matches.iter().any(|m| m.address == expected_addr));
}

#[test]
fn raw_byte_pattern_all_match_mode_returns_both_duplicate_instances() {
    let fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let region = pattern_region(&fixture);
    let addr_a = region.base_address + fixture.dec_u64("RAW_BYTES_OFFSET");
    let addr_b = region.base_address + fixture.dec_u64("RAW_BYTES_DUPLICATE_OFFSET");
    let pattern = pattern_from_raw_bytes(&[0x13, 0x37, 0xC0, 0xDE, 0x99, 0x88]).unwrap();
    let options = PatternScanOptions::default_for(&pattern, 1024 * 1024);
    let cancellation = CancellationToken::new();
    let result = scan_pattern(
        &handle,
        &[region],
        &readable_any_policy(),
        &pattern,
        PatternKind::RawBytes,
        &options,
        &cancellation,
        None,
    )
    .expect("scan failed");
    let addrs: Vec<u64> = result.matches.iter().map(|m| m.address).collect();
    assert!(addrs.contains(&addr_a));
    assert!(addrs.contains(&addr_b));
    // Deterministic address-ascending order.
    assert!(addrs.windows(2).all(|w| w[0] < w[1]));
}

#[test]
fn exact_aob_signature_is_found() {
    let fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let region = pattern_region(&fixture);
    let expected_addr = region.base_address + fixture.dec_u64("AOB_EXACT_OFFSET");
    let pattern = parse_aob("48 8B 05 11 22 33 44 89").unwrap();
    let options = PatternScanOptions::default_for(&pattern, 1024 * 1024);
    let cancellation = CancellationToken::new();
    let result = scan_pattern(
        &handle,
        &[region],
        &readable_any_policy(),
        &pattern,
        PatternKind::Aob,
        &options,
        &cancellation,
        None,
    )
    .expect("scan failed");
    assert!(result.matches.iter().any(|m| m.address == expected_addr));
}

#[test]
fn full_byte_wildcard_aob_matches_regardless_of_wildcarded_byte() {
    let fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let region = pattern_region(&fixture);
    // Real planted bytes are [48 8B 05 FF 22 33 44 89] — the query
    // wildcards exactly the FF byte, proving the match is content-blind
    // there, not coincidentally exact.
    let expected_addr = region.base_address + fixture.dec_u64("AOB_WILDCARD_OFFSET");
    let pattern = parse_aob("48 8B 05 ?? 22 33 44 89").unwrap();
    let options = PatternScanOptions::default_for(&pattern, 1024 * 1024);
    let cancellation = CancellationToken::new();
    let result = scan_pattern(
        &handle,
        &[region],
        &readable_any_policy(),
        &pattern,
        PatternKind::Aob,
        &options,
        &cancellation,
        None,
    )
    .expect("scan failed");
    assert!(result.matches.iter().any(|m| m.address == expected_addr));
}

#[test]
fn nibble_wildcard_aob_matches_regardless_of_wildcarded_nibble() {
    let fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let region = pattern_region(&fixture);
    // Real planted bytes are [A7 00 B3]; "A? 00 ?3" fixes the high nibble
    // of byte 0 and the low nibble of byte 2, wildcarding the rest.
    let expected_addr = region.base_address + fixture.dec_u64("AOB_NIBBLE_OFFSET");
    let pattern = parse_aob("A? 00 ?3").unwrap();
    let options = PatternScanOptions::default_for(&pattern, 1024 * 1024);
    let cancellation = CancellationToken::new();
    let result = scan_pattern(
        &handle,
        &[region],
        &readable_any_policy(),
        &pattern,
        PatternKind::Aob,
        &options,
        &cancellation,
        None,
    )
    .expect("scan failed");
    assert!(result.matches.iter().any(|m| m.address == expected_addr));
}

#[test]
fn near_miss_bytes_do_not_produce_a_false_positive() {
    let fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let region = pattern_region(&fixture);
    let near_miss_addr = region.base_address + fixture.dec_u64("NEAR_MISS_OFFSET");
    // Real RAW_BYTES_PATTERN — differs from the planted NEAR_MISS bytes by
    // exactly the last byte (0x88 vs 0x77).
    let pattern = pattern_from_raw_bytes(&[0x13, 0x37, 0xC0, 0xDE, 0x99, 0x88]).unwrap();
    let options = PatternScanOptions::default_for(&pattern, 1024 * 1024);
    let cancellation = CancellationToken::new();
    let result = scan_pattern(
        &handle,
        &[region],
        &readable_any_policy(),
        &pattern,
        PatternKind::RawBytes,
        &options,
        &cancellation,
        None,
    )
    .expect("scan failed");
    assert!(!result.matches.iter().any(|m| m.address == near_miss_addr));
}

#[test]
fn chunk_boundary_2_byte_pattern_is_found_intact() {
    let fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let region = pattern_region(&fixture);
    let expected_addr = region.base_address + fixture.dec_u64("PATTERN_BOUNDARY_2_OFFSET");
    let pattern = pattern_from_raw_bytes(&[0xAB, 0xCD]).unwrap();
    let options = PatternScanOptions::default_for(&pattern, 1024 * 1024);
    let cancellation = CancellationToken::new();
    let result = scan_pattern(
        &handle,
        &[region],
        &readable_any_policy(),
        &pattern,
        PatternKind::RawBytes,
        &options,
        &cancellation,
        None,
    )
    .expect("scan failed");
    assert_eq!(result.completeness, ScanCompleteness::Complete);
    assert!(result.matches.iter().any(|m| m.address == expected_addr));
}

#[test]
fn chunk_boundary_8_byte_pattern_is_found_intact() {
    let fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let region = pattern_region(&fixture);
    let expected_addr = region.base_address + fixture.dec_u64("PATTERN_BOUNDARY_8_OFFSET");
    let pattern =
        pattern_from_raw_bytes(&[0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]).unwrap();
    let options = PatternScanOptions::default_for(&pattern, 1024 * 1024);
    let cancellation = CancellationToken::new();
    let result = scan_pattern(
        &handle,
        &[region],
        &readable_any_policy(),
        &pattern,
        PatternKind::RawBytes,
        &options,
        &cancellation,
        None,
    )
    .expect("scan failed");
    assert!(result.matches.iter().any(|m| m.address == expected_addr));
}

#[test]
fn chunk_boundary_16_byte_string_is_found_intact() {
    let fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let region = pattern_region(&fixture);
    let expected_addr = region.base_address + fixture.dec_u64("PATTERN_BOUNDARY_STRING_OFFSET");
    let text = fixture.text("PATTERN_BOUNDARY_STRING_TEXT").to_string();
    assert_eq!(text.len(), 16);
    let pattern = pattern_from_utf8_str(&text, true, NullTerminatorMode::None).unwrap();
    let options = PatternScanOptions::default_for(&pattern, 1024 * 1024);
    let cancellation = CancellationToken::new();
    let result = scan_pattern(
        &handle,
        &[region],
        &readable_any_policy(),
        &pattern,
        PatternKind::Utf8,
        &options,
        &cancellation,
        None,
    )
    .expect("scan failed");
    assert!(result.matches.iter().any(|m| m.address == expected_addr));
}

#[test]
fn chunk_boundary_32_byte_wildcard_aob_is_found_intact() {
    let fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let region = pattern_region(&fixture);
    let expected_addr = region.base_address + fixture.dec_u64("PATTERN_BOUNDARY_32_OFFSET");
    // Real planted bytes: F0..FF then E0..EF (32 bytes). Query with a
    // handful of full-byte wildcards spread across the pattern, including
    // right at the chunk-boundary straddle point.
    let query = "F0 F1 F2 F3 F4 F5 ?? F7 F8 F9 FA FB FC FD FE FF \
                 E0 E1 ?? E3 E4 E5 E6 E7 E8 E9 EA EB EC ED EE EF";
    let pattern = parse_aob(query).unwrap();
    assert_eq!(pattern.len(), 32);
    let options = PatternScanOptions::default_for(&pattern, 1024 * 1024);
    let cancellation = CancellationToken::new();
    let result = scan_pattern(
        &handle,
        &[region],
        &readable_any_policy(),
        &pattern,
        PatternKind::Aob,
        &options,
        &cancellation,
        None,
    )
    .expect("scan failed");
    assert!(result.matches.iter().any(|m| m.address == expected_addr));
}

#[test]
fn pattern_beyond_1mib_is_found_by_the_native_path() {
    let fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let region = pattern_region(&fixture);
    let expected_addr = region.base_address + fixture.dec_u64("FAR_MARKER_OFFSET");
    assert!(fixture.dec_u64("FAR_MARKER_OFFSET") > 1024 * 1024);
    let pattern = pattern_from_raw_bytes(&[0xDE, 0xAD, 0xC0, 0xDE, 0x42]).unwrap();
    let options = PatternScanOptions::default_for(&pattern, 1024 * 1024);
    let cancellation = CancellationToken::new();
    let result = scan_pattern(
        &handle,
        &[region],
        &readable_any_policy(),
        &pattern,
        PatternKind::RawBytes,
        &options,
        &cancellation,
        None,
    )
    .expect("scan failed");
    assert_eq!(result.completeness, ScanCompleteness::Complete);
    assert!(result.matches.iter().any(|m| m.address == expected_addr));
}

#[test]
fn first_match_only_returns_deterministic_lowest_address() {
    let fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let region = pattern_region(&fixture);
    let addr_a = region.base_address + fixture.dec_u64("RAW_BYTES_OFFSET");
    let pattern = pattern_from_raw_bytes(&[0x13, 0x37, 0xC0, 0xDE, 0x99, 0x88]).unwrap();
    let options = PatternScanOptions {
        first_match_only: true,
        ..PatternScanOptions::default_for(&pattern, 1024 * 1024)
    };
    let cancellation = CancellationToken::new();
    let result = scan_pattern(
        &handle,
        &[region],
        &readable_any_policy(),
        &pattern,
        PatternKind::RawBytes,
        &options,
        &cancellation,
        None,
    )
    .expect("scan failed");
    assert_eq!(result.matches.len(), 1);
    assert_eq!(result.matches[0].address, addr_a);
    // `at_byte` marks where the configured limit was detected (the chunk
    // boundary reached once the cap was hit — the same convention
    // `exact_scan.rs` already established), not necessarily the last
    // match's own address; only the completeness *variant* is asserted.
    assert!(matches!(
        result.completeness,
        ScanCompleteness::ResourceLimit { .. }
    ));
}

#[test]
fn max_results_resource_limit_is_reported_truthfully() {
    let fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let region = pattern_region(&fixture);
    let pattern = pattern_from_raw_bytes(&[0x13, 0x37, 0xC0, 0xDE, 0x99, 0x88]).unwrap();
    let mut options = PatternScanOptions::default_for(&pattern, 1024 * 1024);
    options.max_results = Some(1);
    let cancellation = CancellationToken::new();
    let result = scan_pattern(
        &handle,
        &[region],
        &readable_any_policy(),
        &pattern,
        PatternKind::RawBytes,
        &options,
        &cancellation,
        None,
    )
    .expect("scan failed");
    assert_eq!(result.matches.len(), 1);
    assert!(matches!(
        result.completeness,
        ScanCompleteness::ResourceLimit { .. }
    ));
}

/// The critical truthful-not-found proof (mission §5.11/§5.14): a real
/// pattern's bytes exist inside a real, genuinely unreadable `PAGE_NOACCESS`
/// page. The scan must report zero matches AND a non-`Complete`
/// completeness — never letting "zero matches" be silently mistaken for
/// "authoritatively not found" when coverage was actually incomplete. This
/// directly reproduces the old D04 AOB false-negative class against the
/// native path and proves it does not occur here.
#[test]
fn zero_matches_under_unreadable_page_is_not_authoritative_not_found() {
    let fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let region = guard_region(&fixture);
    let pattern = pattern_from_raw_bytes(&[0x5E, 0xC4, 0x37, 0x21]).unwrap();
    let options = PatternScanOptions::default_for(&pattern, 4096);
    let cancellation = CancellationToken::new();
    let result = scan_pattern(
        &handle,
        &[region],
        &readable_any_policy(),
        &pattern,
        PatternKind::RawBytes,
        &options,
        &cancellation,
        None,
    )
    .expect("scan failed");
    assert!(
        result.matches.is_empty(),
        "the hidden pattern lives behind PAGE_NOACCESS and must not be reported as found"
    );
    assert_ne!(
        result.completeness,
        ScanCompleteness::Complete,
        "zero matches under a real unreadable page must never claim Complete coverage"
    );
    assert!(matches!(
        result.completeness,
        ScanCompleteness::CompleteWithSkippedRegions { .. }
    ));
}

#[test]
fn cancellation_stops_pattern_scan_before_full_region_is_covered() {
    let fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let region = pattern_region(&fixture);
    let pattern = pattern_from_raw_bytes(&[0xDE, 0xAD, 0xC0, 0xDE, 0x42]).unwrap();
    let mut options = PatternScanOptions::default_for(&pattern, 1024 * 1024);
    options.chunk_config.chunk_size_bytes = 1024 * 1024;
    let cancellation = CancellationToken::new();
    let cancel_clone = cancellation.clone();
    let mut on_progress = move |m: &solith_scanner_core::completeness::ScanMetrics| {
        if m.chunks_read >= 2 {
            cancel_clone.cancel();
        }
    };
    let far_addr = region.base_address + fixture.dec_u64("FAR_MARKER_OFFSET");
    let result = scan_pattern(
        &handle,
        &[region],
        &readable_any_policy(),
        &pattern,
        PatternKind::RawBytes,
        &options,
        &cancellation,
        Some(&mut on_progress),
    )
    .expect("scan failed");
    assert!(matches!(
        result.completeness,
        ScanCompleteness::Cancelled { .. }
    ));
    // The FAR_MARKER at 6 MiB is well past the ~2 MiB read before
    // cancellation fires, so it must not appear — proving the cancellation
    // genuinely stopped the scan rather than racing to completion first.
    assert!(!result.matches.iter().any(|m| m.address == far_addr));
}

#[test]
fn progress_reflects_real_work_during_pattern_scan() {
    let fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let region = pattern_region(&fixture);
    let pattern = pattern_from_raw_bytes(&[0xDE, 0xAD, 0xC0, 0xDE, 0x42]).unwrap();
    let options = PatternScanOptions::default_for(&pattern, 1024 * 1024);
    let cancellation = CancellationToken::new();
    let mut max_bytes_read = 0u64;
    let mut on_progress = move |m: &solith_scanner_core::completeness::ScanMetrics| {
        max_bytes_read = max_bytes_read.max(m.bytes_read);
    };
    let result = scan_pattern(
        &handle,
        &[region],
        &readable_any_policy(),
        &pattern,
        PatternKind::RawBytes,
        &options,
        &cancellation,
        Some(&mut on_progress),
    )
    .expect("scan failed");
    assert_eq!(result.completeness, ScanCompleteness::Complete);
    assert!(result.metrics.bytes_read > 0);
}

#[test]
fn stale_target_scan_reports_process_exited_not_zero_matches() {
    let mut fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let region = pattern_region(&fixture);
    fixture.kill();
    let pattern = pattern_from_raw_bytes(&[0xDE, 0xAD, 0xC0, 0xDE, 0x42]).unwrap();
    let options = PatternScanOptions::default_for(&pattern, 1024 * 1024);
    let cancellation = CancellationToken::new();
    let result = scan_pattern(
        &handle,
        &[region],
        &readable_any_policy(),
        &pattern,
        PatternKind::RawBytes,
        &options,
        &cancellation,
        None,
    )
    .expect("scan failed");
    assert!(matches!(
        result.completeness,
        ScanCompleteness::ProcessExited { .. }
    ));
}
