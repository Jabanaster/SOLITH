//! Stage 2 integration tests — real spawned-process fixtures (mission §18),
//! not `FakeMemoryDriver`-style mocks. Each test spawns
//! `solith-scanner-fixture` (src/bin/fixture.rs), attaches to it as a real
//! Windows process via `solith_scanner_core`, and exercises region
//! enumeration / chunked reading against real, known memory contents.
//!
//! Windows-only; these tests are skipped (via `#[cfg(windows)]` on the
//! whole file) on any other target, matching this crate's Windows-only
//! scope.

#![cfg(windows)]

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use solith_scanner_core::cancellation::CancellationToken;
use solith_scanner_core::completeness::ScanMetrics;
use solith_scanner_core::reader::read_region_chunked;
use solith_scanner_core::region::{enumerate_regions, Region};
use solith_scanner_core::{
    completeness::{ScanCompleteness, SkipReason},
    read_regions_chunked,
    reader::ReadBudget,
    target::{ProcessHandle, TargetArchitecture},
    ChunkPlanConfig, CommitState, RegionKind, RegionSelectionPolicy,
};

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
            .expect("failed to spawn solith-scanner-fixture");

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

        // Detach the reader from `child` by leaking the remaining stdout
        // handle inside the closure's scope — we only needed it to observe
        // READY; the fixture writes nothing further to stdout.
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

    fn dec(&self, key: &str) -> u64 {
        self.fields
            .get(key)
            .unwrap_or_else(|| panic!("missing fixture field {key}"))
            .parse()
            .unwrap_or_else(|_| panic!("bad decimal field {key}"))
    }

    fn send(&mut self, command: &str) {
        if let Some(stdin) = self.child.stdin.as_mut() {
            let _ = writeln!(stdin, "{command}");
            let _ = stdin.flush();
        }
    }

    fn kill_abrupt(&mut self) {
        self.send("die");
        // Give the OS a moment to tear the process down so a subsequent
        // liveness check reliably observes STILL_ACTIVE == false rather than
        // racing the exit.
        std::thread::sleep(Duration::from_millis(200));
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.send("exit");
        let _ = self.child.wait();
    }
}

fn region_containing(regions: &[Region], address: u64) -> Region {
    regions
        .iter()
        .find(|r| address >= r.base_address && address < r.base_address + r.size)
        .unwrap_or_else(|| panic!("no enumerated region contains 0x{address:x}"))
        .clone()
}

#[test]
fn region_over_1mib_is_fully_covered_and_sentinel_value_readable() {
    let fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");

    let enum_result = enumerate_regions(&handle, 0).expect("enumeration failed");
    assert!(
        enum_result.is_complete,
        "enumeration did not cover the full address range: {:?}",
        enum_result.stop_reason
    );

    let big_base = fixture.hex("BIG_REGION_BASE");
    let big_size = fixture.dec("BIG_REGION_SIZE");
    assert!(
        big_size > 1024 * 1024,
        "fixture region must exceed the old 1 MiB cap"
    );

    let region = region_containing(&enum_result.regions, big_base);
    assert!(
        region.size >= big_size,
        "enumerated region ({}) smaller than the fixture's allocation ({})",
        region.size,
        big_size
    );
    assert_eq!(region.commit_state, CommitState::Committed);
    assert!(region.is_readable);
    assert!(region.is_writable);

    let policy = RegionSelectionPolicy {
        max_region_bytes: None,
        ..RegionSelectionPolicy::default_writable_value_scan()
    };
    let cancellation = CancellationToken::new();
    let (results, metrics, completeness) = read_regions_chunked(
        &handle,
        std::slice::from_ref(&region),
        &policy,
        ChunkPlanConfig::default_for_testing(),
        &cancellation,
        ReadBudget::default(),
    )
    .expect("chunked read failed");

    assert_eq!(
        completeness,
        ScanCompleteness::Complete,
        "expected full coverage of a clean >1MiB region"
    );
    // bytes_read counts every chunk's own requested_size, including the
    // deliberately-overlapping bytes shared between adjacent chunks (each
    // overlap byte is genuinely read twice, by two separate
    // ReadProcessMemory calls) — so it is expected to exceed region.size by
    // exactly (number of internal chunk boundaries) * overlap_bytes, never
    // less than region.size (that would mean a gap).
    assert!(
        metrics.bytes_read >= region.size,
        "bytes_read must cover at least the full region"
    );
    let overlap_inflation = metrics.bytes_read - region.size;
    let expected_boundaries = metrics.chunks_read + metrics.chunks_partial - 1; // number of internal boundaries
    assert_eq!(
        overlap_inflation,
        expected_boundaries * ChunkPlanConfig::default_for_testing().overlap_bytes,
        "unexpected overlap accounting"
    );
    assert!(
        metrics.chunks_read > 1,
        "a region this large must produce more than one chunk"
    );

    // Reconstruct the sentinel u32 at SENTINEL_OFFSET from whichever
    // chunk(s) cover it.
    let sentinel_offset = fixture.dec("SENTINEL_OFFSET");
    let sentinel_value_expected = fixture.hex("SENTINEL_VALUE") as u32;
    let sentinel_absolute = big_base + sentinel_offset;

    let mut found_bytes: Option<[u8; 4]> = None;
    for r in &results {
        let chunk_start = r.spec.chunk_base;
        let chunk_end = chunk_start + r.spec.requested_size;
        if sentinel_absolute >= chunk_start && sentinel_absolute + 4 <= chunk_end {
            let local_offset = (sentinel_absolute - chunk_start) as usize;
            let mut bytes = [0u8; 4];
            bytes.copy_from_slice(&r.data[local_offset..local_offset + 4]);
            found_bytes = Some(bytes);
            break;
        }
    }
    let bytes = found_bytes.expect("sentinel offset not fully contained in any returned chunk");
    let actual = u32::from_le_bytes(bytes);
    assert_eq!(
        actual, sentinel_value_expected,
        "sentinel value beyond the 1 MiB boundary was not read correctly"
    );
}

#[test]
fn unaligned_sentinel_byte_is_read_intact() {
    let fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let enum_result = enumerate_regions(&handle, 0).expect("enumeration failed");

    let big_base = fixture.hex("BIG_REGION_BASE");
    let region = region_containing(&enum_result.regions, big_base);

    let cancellation = CancellationToken::new();
    let mut metrics = ScanMetrics::default();
    let (results, completeness) = read_region_chunked(
        &handle,
        &region,
        ChunkPlanConfig::default_for_testing(),
        &cancellation,
        ReadBudget::default(),
        &mut metrics,
    )
    .expect("chunked read failed");
    assert_eq!(completeness, ScanCompleteness::Complete);

    let unaligned_offset = fixture.dec("UNALIGNED_OFFSET");
    let expected_byte = fixture.hex("UNALIGNED_BYTE") as u8;
    let absolute = big_base + unaligned_offset;

    let byte = results
        .iter()
        .find_map(|r| {
            let start = r.spec.chunk_base;
            let end = start + r.spec.requested_size;
            if absolute >= start && absolute < end {
                Some(r.data[(absolute - start) as usize])
            } else {
                None
            }
        })
        .expect("unaligned offset not covered by any chunk");
    assert_eq!(
        byte, expected_byte,
        "byte at a non-type-width-aligned offset was not read correctly"
    );
}

#[test]
fn chunk_boundary_straddling_pattern_is_read_intact_via_overlap() {
    let fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let enum_result = enumerate_regions(&handle, 0).expect("enumeration failed");

    let big_base = fixture.hex("BIG_REGION_BASE");
    let region = region_containing(&enum_result.regions, big_base);

    let cancellation = CancellationToken::new();
    let mut metrics = ScanMetrics::default();
    let (results, completeness) = read_region_chunked(
        &handle,
        &region,
        ChunkPlanConfig::default_for_testing(),
        &cancellation,
        ReadBudget::default(),
        &mut metrics,
    )
    .expect("chunked read failed");
    assert_eq!(completeness, ScanCompleteness::Complete);

    let boundary_offset = fixture.dec("BOUNDARY_OFFSET");
    let absolute = big_base + boundary_offset;
    let expected: [u8; 8] = [0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88];

    let found = results.iter().find_map(|r| {
        let start = r.spec.chunk_base;
        let end = start + r.spec.requested_size;
        if absolute >= start && absolute + 8 <= end {
            let local = (absolute - start) as usize;
            Some(r.data[local..local + 8].to_vec())
        } else {
            None
        }
    });
    let bytes = found.expect(
        "boundary-straddling pattern was not fully contained in any single chunk — overlap failed",
    );
    assert_eq!(
        bytes, expected,
        "boundary-straddling pattern bytes corrupted"
    );
}

#[test]
fn inaccessible_page_yields_completewithskippedregions_not_complete() {
    let fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");

    let guard_base = fixture.hex("GUARD_REGION_BASE");
    let guard_size = fixture.dec("GUARD_REGION_SIZE");

    // Deliberately NOT using enumerate_regions here: the PAGE_NOACCESS
    // middle page causes VirtualQueryEx to report 3 separate regions, and
    // this test wants to prove the *reader's* per-chunk failure
    // classification, not the enumerator's region-splitting behavior
    // (which is exercised implicitly by every other test's use of
    // enumerate_regions). A synthetic Region spanning the whole 3-page
    // allocation, read with page-aligned chunks, isolates that.
    let synthetic_region = Region {
        base_address: guard_base,
        size: guard_size,
        allocation_base: guard_base,
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

    let cancellation = CancellationToken::new();
    let mut metrics = ScanMetrics::default();
    let chunk_config = ChunkPlanConfig {
        chunk_size_bytes: 4096,
        overlap_bytes: 0,
    };
    let (results, completeness) = read_region_chunked(
        &handle,
        &synthetic_region,
        chunk_config,
        &cancellation,
        ReadBudget::default(),
        &mut metrics,
    )
    .expect("chunked read failed");

    assert_eq!(results.len(), 3, "expected exactly 3 page-sized chunks");
    match completeness {
        ScanCompleteness::CompleteWithSkippedRegions { skipped } => {
            assert_eq!(
                skipped.len(),
                1,
                "expected exactly one skipped (inaccessible) chunk"
            );
            assert!(matches!(
                skipped[0].reason,
                SkipReason::AccessDenied | SkipReason::Unreadable
            ));
        }
        other => panic!("expected CompleteWithSkippedRegions, got {other:?}"),
    }
    assert_eq!(
        metrics.chunks_read, 2,
        "the two accessible pages must still be read"
    );
    assert_eq!(
        metrics.chunks_failed, 1,
        "the inaccessible page must be counted as failed, not silently dropped"
    );
}

#[test]
fn process_exit_is_reported_truthfully_not_silently_ignored() {
    let mut fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let big_base = fixture.hex("BIG_REGION_BASE");
    let big_size = fixture.dec("BIG_REGION_SIZE");

    fixture.kill_abrupt();

    let region = Region {
        base_address: big_base,
        size: big_size,
        allocation_base: big_base,
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

    let cancellation = CancellationToken::new();
    let mut metrics = ScanMetrics::default();
    let (_results, completeness) = read_region_chunked(
        &handle,
        &region,
        ChunkPlanConfig::default_for_testing(),
        &cancellation,
        ReadBudget::default(),
        &mut metrics,
    )
    .expect("read call itself must not error — a dead target is a completeness state, not a Result::Err");

    assert!(
        matches!(completeness, ScanCompleteness::ProcessExited { .. }),
        "expected ProcessExited, got {completeness:?}"
    );
}

#[test]
fn cancellation_mid_operation_stops_before_full_region_is_read() {
    let fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let big_base = fixture.hex("BIG_REGION_BASE");
    let big_size = fixture.dec("BIG_REGION_SIZE");

    let region = Region {
        base_address: big_base,
        size: big_size,
        allocation_base: big_base,
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

    // A deliberately tiny chunk size (64 bytes across a multi-MiB region)
    // produces tens of thousands of chunks. Rather than racing a wall-clock
    // sleep against the reader (nondeterministic — a fast machine could
    // finish the whole region before the sleeping thread wakes), this uses
    // the progress callback (mission §16's foundation) to request
    // cancellation deterministically after observing a specific, known
    // number of completed chunks — a real, reproducible "cancel strictly
    // between the first and last chunk" proof.
    let tiny_chunk_config = ChunkPlanConfig {
        chunk_size_bytes: 64,
        overlap_bytes: 7,
    };
    let cancellation = CancellationToken::new();
    let cancel_after_chunks: u64 = 10;
    let mut observed_chunks: u64 = 0;
    let mut on_progress = |_metrics: &ScanMetrics| {
        observed_chunks += 1;
        if observed_chunks == cancel_after_chunks {
            cancellation.cancel();
        }
    };

    let mut metrics = ScanMetrics::default();
    let (results, completeness) = solith_scanner_core::reader::read_region_chunked_with_progress(
        &handle,
        &region,
        tiny_chunk_config,
        &cancellation,
        ReadBudget::default(),
        &mut metrics,
        Some(&mut on_progress),
    )
    .expect("chunked read failed");

    assert!(
        matches!(completeness, ScanCompleteness::Cancelled { .. }),
        "expected Cancelled, got {completeness:?}"
    );
    let total_possible_chunks = big_size.div_ceil(64 - 7);
    assert_eq!(
        results.len() as u64,
        cancel_after_chunks,
        "must stop at exactly the chunk that requested cancellation"
    );
    assert!(
        (results.len() as u64) < total_possible_chunks,
        "cancellation had no effect — every chunk was read anyway"
    );
    assert!(
        !results.is_empty(),
        "cancellation must not fire before the first chunk in this deterministic setup"
    );
}

#[test]
fn own_process_architecture_detects_as_x64_not_wow64() {
    // Real-process validation of the WOW64/pointer-width detection code
    // (P1-SCAN-001's foundation) against our own, genuinely 64-bit process —
    // this crate is built only for x86_64-pc-windows-msvc (doc 06 §1.12),
    // so a positive (is_wow64 == true) case cannot be produced without a
    // 32-bit target process, which this environment cannot build (no
    // i686-pc-windows-msvc Rust target installed). That leg is recorded as
    // a required, not-yet-executed later gate in Stage 2 evidence — this
    // test proves the negative case is at least correctly detected against
    // a real process, not fabricated.
    let pid = std::process::id();
    let handle =
        ProcessHandle::open_read_only(pid).expect("failed to open a handle to our own process");
    let architecture = handle
        .detect_architecture()
        .expect("architecture detection failed");
    assert_eq!(architecture, TargetArchitecture::X64);
    assert!(!architecture.is_wow64());
    assert_eq!(architecture.pointer_width_bytes(), Some(8));
}

#[test]
fn no_handle_leak_across_many_open_close_cycles() {
    // Indirect handle-leak check: opening and dropping a ProcessHandle many
    // times in a loop must not fail partway through (a real leak would
    // eventually exhaust the process handle table or, more realistically
    // for a test-sized loop count, would at least not regress). This is a
    // coarse but real, executable check rather than relying solely on code
    // review of the Drop impl.
    let fixture = Fixture::spawn();
    for _ in 0..500 {
        let handle =
            ProcessHandle::open_read_only(fixture.pid()).expect("open_read_only failed mid-loop");
        let _ = handle.status();
        drop(handle);
    }
}
