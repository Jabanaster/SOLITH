//! Stage 6 §6.16/§6.17 integration tests — real region mutation (protection
//! change, decommit, recommit, full free/"disappear") against a real
//! spawned process, both before a scan and mid-scan (synchronized
//! deterministically via the progress callback, the same technique
//! `pattern_scan_integration.rs`'s cancellation-during-scan tests already
//! use — no wall-clock sleep, no flaky timing).

#![cfg(windows)]

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};

use solith_scanner_core::cancellation::CancellationToken;
use solith_scanner_core::completeness::ScanCompleteness;
use solith_scanner_core::pattern::pattern_from_raw_bytes;
use solith_scanner_core::pattern_scan::{scan_pattern, PatternScanOptions};
use solith_scanner_core::policy::RegionSelectionPolicy;
use solith_scanner_core::region::{enumerate_regions, CommitState, Region, RegionKind};
use solith_scanner_core::target::ProcessHandle;
use solith_scanner_core::PatternKind;

struct Fixture {
    child: Child,
    fields: HashMap<String, String>,
    reader: BufReader<std::process::ChildStdout>,
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
        Self {
            child,
            fields,
            reader,
        }
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

    /// Sends `cmd` and blocks until a line starting with `expected_prefix`
    /// comes back, panicking on any `*_ERROR` line — so a caller never
    /// races the mutation against a subsequent scan.
    fn send_and_confirm(&mut self, cmd: &str, expected_prefix: &str) {
        let stdin = self.child.stdin.as_mut().expect("fixture stdin not piped");
        writeln!(stdin, "{cmd}").expect("failed to send command");
        loop {
            let mut line = String::new();
            let n = self
                .reader
                .read_line(&mut line)
                .expect("failed reading fixture stdout");
            assert!(n > 0, "fixture exited before confirming {cmd}");
            let line = line.trim().to_string();
            if line.starts_with(expected_prefix) {
                return;
            }
            assert!(
                !line.ends_with("_ERROR") && !line.contains("_ERROR "),
                "fixture rejected {cmd}: {line}"
            );
        }
    }

    fn protect_mutation(&mut self, flag: &str) {
        self.send_and_confirm(&format!("protect_mutation {flag}"), "PROTECTED");
    }

    fn decommit_mutation(&mut self) {
        self.send_and_confirm("decommit_mutation", "DECOMMITTED");
    }

    fn recommit_mutation(&mut self) {
        self.send_and_confirm("recommit_mutation", "RECOMMITTED");
    }

    fn free_mutation(&mut self) {
        self.send_and_confirm("free_mutation", "FREED");
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = self.child.stdin.as_mut().map(|s| writeln!(s, "exit"));
        let _ = self.child.wait();
    }
}

fn mutation_region(fixture: &Fixture) -> Region {
    Region {
        base_address: fixture.hex("MUTATION_REGION_BASE"),
        size: fixture.dec_u64("MUTATION_REGION_SIZE"),
        allocation_base: fixture.hex("MUTATION_REGION_BASE"),
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

fn marker_pattern() -> solith_scanner_core::Pattern {
    pattern_from_raw_bytes(&[0xAA, 0xBB, 0xCC, 0xDD]).unwrap()
}

#[test]
fn marker_is_found_before_any_mutation() {
    // Baseline: proves the fixture/region/marker setup itself is correct,
    // so the negative results in the tests below are trusted as real
    // mutation effects, not an always-absent marker.
    let fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let region = mutation_region(&fixture);
    let expected_addr = region.base_address + fixture.dec_u64("MUTATION_MARKER_OFFSET");
    let pattern = marker_pattern();
    let options = PatternScanOptions::default_for(&pattern, 4096);
    let cancellation = CancellationToken::new();
    let result = scan_pattern(
        &handle,
        std::slice::from_ref(&region),
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
fn protection_change_to_noaccess_between_scans_is_reported_truthfully_not_as_a_crash() {
    let mut fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let region = mutation_region(&fixture);
    let pattern = marker_pattern();
    let options = PatternScanOptions::default_for(&pattern, 4096);

    fixture.protect_mutation("noaccess");

    let cancellation = CancellationToken::new();
    let result = scan_pattern(
        &handle,
        std::slice::from_ref(&region),
        &readable_any_policy(),
        &pattern,
        PatternKind::RawBytes,
        &options,
        &cancellation,
        None,
    )
    .expect("scan must not error/crash even though the region is now unreadable");
    assert!(result.matches.is_empty());
    assert!(
        !result.completeness.is_complete(),
        "an unreadable region must never be reported as Complete"
    );
    assert!(matches!(
        result.completeness,
        ScanCompleteness::CompleteWithSkippedRegions { .. }
    ));

    // Restore so Drop's "exit" cleanup and any later assertions don't
    // depend on an unreadable page.
    fixture.protect_mutation("readwrite");
}

#[test]
fn decommitted_region_is_skipped_not_crashed_and_recommit_restores_it() {
    let mut fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let region = mutation_region(&fixture);
    let pattern = marker_pattern();
    let options = PatternScanOptions::default_for(&pattern, 4096);

    fixture.decommit_mutation();

    let cancellation = CancellationToken::new();
    let result = scan_pattern(
        &handle,
        std::slice::from_ref(&region),
        &readable_any_policy(),
        &pattern,
        PatternKind::RawBytes,
        &options,
        &cancellation,
        None,
    )
    .expect("scan must not error/crash against a decommitted region");
    assert!(result.matches.is_empty());
    assert!(!result.completeness.is_complete());

    // Recommit restores real, readable, writable memory with the marker
    // replanted — proving "disappear then come back" round-trips cleanly,
    // not just that decommit alone doesn't crash.
    fixture.recommit_mutation();
    let expected_addr = region.base_address + fixture.dec_u64("MUTATION_MARKER_OFFSET");
    let result2 = scan_pattern(
        &handle,
        std::slice::from_ref(&region),
        &readable_any_policy(),
        &pattern,
        PatternKind::RawBytes,
        &options,
        &cancellation,
        None,
    )
    .expect("scan failed after recommit");
    assert_eq!(result2.completeness, ScanCompleteness::Complete);
    assert!(result2.matches.iter().any(|m| m.address == expected_addr));
}

#[test]
fn freed_region_is_no_longer_enumerated_and_a_stale_reference_is_skipped_not_crashed() {
    let mut fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let region = mutation_region(&fixture);
    let base = region.base_address;

    // Sanity: freshly enumerated regions include this one before freeing.
    let before = enumerate_regions(&handle, 0).expect("enumeration failed");
    assert!(before
        .regions
        .iter()
        .any(|r| r.base_address <= base && base < r.base_address + r.size));

    fixture.free_mutation();

    let after = enumerate_regions(&handle, 0).expect("enumeration failed");
    assert!(
        !after
            .regions
            .iter()
            .any(|r| r.base_address <= base && base < r.base_address + r.size),
        "a freed region must disappear from real enumeration, not linger as a phantom entry"
    );

    // A caller still holding the old (now-stale) Region descriptor must get
    // a truthful skip, never a crash, if it tries to read/scan it anyway.
    let pattern = marker_pattern();
    let options = PatternScanOptions::default_for(&pattern, 4096);
    let cancellation = CancellationToken::new();
    let result = scan_pattern(
        &handle,
        std::slice::from_ref(&region),
        &readable_any_policy(),
        &pattern,
        PatternKind::RawBytes,
        &options,
        &cancellation,
        None,
    )
    .expect("scan against a stale/freed region descriptor must not error/crash");
    assert!(result.matches.is_empty());
    assert!(!result.completeness.is_complete());
}

#[test]
fn region_is_decommitted_mid_scan_via_deterministic_progress_callback_sync() {
    // Real "mutation DURING an in-flight scan," synchronized deterministically
    // (no sleep/wall-clock race): a filler region large enough to need
    // several chunks is scanned with a tiny chunk size; once the first
    // chunk has been read, the progress callback (running synchronously on
    // this same thread, mid-scan-loop) sends the real decommit command to
    // the fixture before the scan reaches the mutation region's own chunk.
    let mut fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let mutation_addr = mutation_region(&fixture).base_address;
    let filler_region = Region {
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
    };
    let region = mutation_region(&fixture);
    let pattern = marker_pattern();
    let mut options = PatternScanOptions::default_for(&pattern, 4096);
    options.chunk_config.chunk_size_bytes = 4096;
    let cancellation = CancellationToken::new();

    let mut mutated = false;
    let mut on_progress = |m: &solith_scanner_core::completeness::ScanMetrics| {
        if !mutated && m.chunks_read >= 1 {
            mutated = true;
            fixture.decommit_mutation();
        }
    };

    let result = scan_pattern(
        &handle,
        &[filler_region, region],
        &readable_any_policy(),
        &pattern,
        PatternKind::RawBytes,
        &options,
        &cancellation,
        Some(&mut on_progress),
    )
    .expect("scan must survive a real region being decommitted mid-scan");
    assert!(
        mutated,
        "the progress callback must have fired at least once to trigger the mutation"
    );
    assert!(result.matches.is_empty());
    assert!(
        !result.completeness.is_complete(),
        "a region decommitted mid-scan must not be reported as fully covered"
    );
    let _ = mutation_addr;
}
