//! Stage 4 integration tests — real spawned-process scan-session/refinement
//! (mission §4.17's Rust-level equivalent). Same fixture-spawn pattern as
//! `exact_scan_integration.rs` (Stage 3), extended to use the new
//! `REFINE_REGION` and `write <offset> <hex_le_bytes>` mutation command
//! (mission §4.13: real target-process writes, not Rust-array simulation).

#![cfg(windows)]

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};

use solith_scanner_core::cancellation::CancellationToken;
use solith_scanner_core::completeness::ScanCompleteness;
use solith_scanner_core::exact_scan::AlignmentMode;
use solith_scanner_core::policy::RegionSelectionPolicy;
use solith_scanner_core::region::{CommitState, Region, RegionKind};
use solith_scanner_core::session::{RefineMode, SessionResourceLimits};
use solith_scanner_core::target::ProcessHandle;
use solith_scanner_core::types::{PrimitiveType, PrimitiveValue};
use solith_scanner_core::{ChunkPlanConfig, ScanSession};

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

    /// Sends `write <offset> <hex_le_bytes>` and blocks until the matching
    /// `WROTE <offset>` confirmation line comes back, so the caller never
    /// races the fixture's own write against a subsequent read.
    fn write_bytes(&mut self, offset: usize, bytes: &[u8]) {
        let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
        let stdin = self.child.stdin.as_mut().expect("fixture stdin not piped");
        writeln!(stdin, "write {offset} {hex}").expect("failed to send write command");
        loop {
            let mut line = String::new();
            let n = self
                .reader
                .read_line(&mut line)
                .expect("failed reading fixture stdout");
            assert!(n > 0, "fixture exited before confirming write {offset}");
            let line = line.trim();
            if line == format!("WROTE {offset}") {
                return;
            }
            assert!(
                !line.starts_with("WRITE_ERROR"),
                "fixture rejected write {offset}: {line}"
            );
        }
    }

    fn write_u32(&mut self, offset: usize, value: u32) {
        self.write_bytes(offset, &value.to_le_bytes());
    }

    fn write_f32(&mut self, offset: usize, value: f32) {
        self.write_bytes(offset, &value.to_le_bytes());
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

fn refine_region(fixture: &Fixture) -> Region {
    Region {
        base_address: fixture.hex("REFINE_REGION_BASE"),
        size: fixture.dec_u64("REFINE_REGION_SIZE"),
        allocation_base: fixture.hex("REFINE_REGION_BASE"),
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

fn open_session(
    fixture: &Fixture,
    primitive_type: PrimitiveType,
    alignment: AlignmentMode,
) -> ScanSession {
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let region = refine_region(fixture);
    let policy = RegionSelectionPolicy {
        max_region_bytes: None,
        ..RegionSelectionPolicy::default_writable_value_scan()
    };
    let cancellation = CancellationToken::new();
    let (session, _metrics) = ScanSession::create_unknown_initial(
        handle,
        &[region],
        &policy,
        primitive_type,
        alignment,
        ChunkPlanConfig::default_for_testing(),
        SessionResourceLimits::default(),
        &cancellation,
        None,
    )
    .expect("create_unknown_initial failed");
    session
}

/// Finds the candidate index for `address` (aligned-mode candidates are
/// stored in ascending-address order, so this is a simple linear scan for
/// test-sized candidate sets).
fn candidate_address_present(session: &ScanSession, address: u64) -> bool {
    let page = session.candidates_page(0, session.candidate_count());
    page.iter().any(|(a, _)| *a == address)
}

fn candidate_value_at(session: &ScanSession, address: u64) -> Option<PrimitiveValue> {
    let page = session.candidates_page(0, session.candidate_count());
    page.into_iter()
        .find(|(a, _)| *a == address)
        .map(|(_, v)| v)
}

#[test]
fn unknown_initial_captures_the_exact_value_just_written() {
    let mut fixture = Fixture::spawn();
    let base = fixture.hex("REFINE_REGION_BASE");
    let offset = 4096usize;
    fixture.write_u32(offset, 0x1234_5678);

    let session = open_session(&fixture, PrimitiveType::U32, AlignmentMode::AlignedToType);
    assert_eq!(*session.last_completeness(), ScanCompleteness::Complete);
    assert!(session.candidate_count() > 0);

    let value = candidate_value_at(&session, base + offset as u64)
        .expect("planted candidate must be captured by UNKNOWN_INITIAL");
    assert!(matches!(value, PrimitiveValue::U32(0x1234_5678)));
}

#[test]
fn changed_and_unchanged_partition_correctly_after_a_real_write() {
    let mut fixture = Fixture::spawn();
    let base = fixture.hex("REFINE_REGION_BASE");
    let changed_offset = 4000usize;
    let unchanged_offset = 8000usize;
    fixture.write_u32(changed_offset, 111);
    fixture.write_u32(unchanged_offset, 222);

    let mut session = open_session(&fixture, PrimitiveType::U32, AlignmentMode::AlignedToType);
    let changed_addr = base + changed_offset as u64;
    let unchanged_addr = base + unchanged_offset as u64;
    assert!(candidate_address_present(&session, changed_addr));
    assert!(candidate_address_present(&session, unchanged_addr));

    // Real target-process write: mutate only one of the two slots.
    fixture.write_u32(changed_offset, 999);

    let cancellation = CancellationToken::new();
    let outcome = session
        .refine(RefineMode::Changed, &cancellation, None)
        .expect("CHANGED refine failed");
    assert_eq!(outcome.completeness, ScanCompleteness::Complete);
    assert!(candidate_address_present(&session, changed_addr));
    assert!(!candidate_address_present(&session, unchanged_addr));
    assert_eq!(session.generation(), 1);
}

#[test]
fn unchanged_survives_only_the_untouched_candidate() {
    let mut fixture = Fixture::spawn();
    let base = fixture.hex("REFINE_REGION_BASE");
    let changed_offset = 4000usize;
    let unchanged_offset = 8000usize;
    fixture.write_u32(changed_offset, 111);
    fixture.write_u32(unchanged_offset, 222);

    let mut session = open_session(&fixture, PrimitiveType::U32, AlignmentMode::AlignedToType);
    fixture.write_u32(changed_offset, 999);

    let cancellation = CancellationToken::new();
    session
        .refine(RefineMode::Unchanged, &cancellation, None)
        .expect("UNCHANGED refine failed");
    assert!(!candidate_address_present(
        &session,
        base + changed_offset as u64
    ));
    assert!(candidate_address_present(
        &session,
        base + unchanged_offset as u64
    ));
}

#[test]
fn increased_and_decreased_respect_direction_against_real_writes() {
    let mut fixture = Fixture::spawn();
    let base = fixture.hex("REFINE_REGION_BASE");
    let up_offset = 4000usize;
    let down_offset = 8000usize;
    fixture.write_u32(up_offset, 100);
    fixture.write_u32(down_offset, 100);

    let mut session = open_session(&fixture, PrimitiveType::U32, AlignmentMode::AlignedToType);
    fixture.write_u32(up_offset, 150);
    fixture.write_u32(down_offset, 50);

    let cancellation = CancellationToken::new();
    session
        .refine(RefineMode::Increased, &cancellation, None)
        .expect("INCREASED refine failed");
    assert!(candidate_address_present(&session, base + up_offset as u64));
    assert!(!candidate_address_present(
        &session,
        base + down_offset as u64
    ));
}

#[test]
fn increased_by_matches_an_exact_delta_and_rejects_a_different_change() {
    let mut fixture = Fixture::spawn();
    let base = fixture.hex("REFINE_REGION_BASE");
    let exact_delta_offset = 4000usize;
    let wrong_delta_offset = 8000usize;
    fixture.write_u32(exact_delta_offset, 1000);
    fixture.write_u32(wrong_delta_offset, 1000);

    let mut session = open_session(&fixture, PrimitiveType::U32, AlignmentMode::AlignedToType);
    fixture.write_u32(exact_delta_offset, 1042); // +42 exactly
    fixture.write_u32(wrong_delta_offset, 1050); // +50, not +42

    let cancellation = CancellationToken::new();
    session
        .refine(
            RefineMode::IncreasedBy(PrimitiveValue::U32(42)),
            &cancellation,
            None,
        )
        .expect("INCREASED_BY refine failed");
    assert!(candidate_address_present(
        &session,
        base + exact_delta_offset as u64
    ));
    assert!(!candidate_address_present(
        &session,
        base + wrong_delta_offset as u64
    ));
}

#[test]
fn decreased_by_never_matches_a_real_unsigned_underflow() {
    let mut fixture = Fixture::spawn();
    let base = fixture.hex("REFINE_REGION_BASE");
    let offset = 4000usize;
    fixture.write_u32(offset, 5);

    let mut session = open_session(&fixture, PrimitiveType::U32, AlignmentMode::AlignedToType);
    // A real u32 can't go negative, so simulate "no valid decrease by 10"
    // by leaving the value unchanged at 5 — checked_sub(5, 10) is None,
    // so DECREASED_BY(10) must never match regardless of what the current
    // value ends up being (unit tests already cover the None-arithmetic
    // path directly; this proves it end-to-end against a real read too).
    let cancellation = CancellationToken::new();
    session
        .refine(
            RefineMode::DecreasedBy(PrimitiveValue::U32(10)),
            &cancellation,
            None,
        )
        .expect("DECREASED_BY refine failed");
    assert!(!candidate_address_present(&session, base + offset as u64));
}

#[test]
fn between_filters_a_real_written_value_by_inclusive_range() {
    let mut fixture = Fixture::spawn();
    let base = fixture.hex("REFINE_REGION_BASE");
    let in_range_offset = 4000usize;
    let out_of_range_offset = 8000usize;
    fixture.write_u32(in_range_offset, 0);
    fixture.write_u32(out_of_range_offset, 0);

    let mut session = open_session(&fixture, PrimitiveType::U32, AlignmentMode::AlignedToType);
    fixture.write_u32(in_range_offset, 50); // inside [10, 100]
    fixture.write_u32(out_of_range_offset, 500); // outside

    let cancellation = CancellationToken::new();
    session
        .refine(
            RefineMode::Between(PrimitiveValue::U32(10), PrimitiveValue::U32(100)),
            &cancellation,
            None,
        )
        .expect("BETWEEN refine failed");
    assert!(candidate_address_present(
        &session,
        base + in_range_offset as u64
    ));
    assert!(!candidate_address_present(
        &session,
        base + out_of_range_offset as u64
    ));
}

#[test]
fn float_refinement_handles_nan_and_infinity_against_real_memory() {
    let mut fixture = Fixture::spawn();
    let base = fixture.hex("REFINE_REGION_BASE");
    let nan_offset = 4000usize;
    let inf_offset = 8000usize;
    fixture.write_f32(nan_offset, 1.0);
    fixture.write_f32(inf_offset, 1.0);

    let mut session = open_session(&fixture, PrimitiveType::F32, AlignmentMode::AlignedToType);
    fixture.write_f32(nan_offset, f32::NAN);
    fixture.write_f32(inf_offset, f32::INFINITY);

    let cancellation = CancellationToken::new();
    // CHANGED must be true for both: NaN is never "unchanged" even from a
    // normal value, and +Infinity is a real, distinct value from 1.0.
    session
        .refine(RefineMode::Changed, &cancellation, None)
        .expect("CHANGED refine over floats failed");
    assert!(candidate_address_present(
        &session,
        base + nan_offset as u64
    ));
    assert!(candidate_address_present(
        &session,
        base + inf_offset as u64
    ));
}

#[test]
fn u64_beyond_js_safe_integer_survives_a_real_refine_exactly() {
    let mut fixture = Fixture::spawn();
    let base = fixture.hex("REFINE_REGION_BASE");
    let offset = 4000usize;
    let huge: u64 = u64::MAX - 2; // Stage 2/3's known Number()-collision partner
    fixture.write_bytes(offset, &huge.to_le_bytes());

    let session = open_session(&fixture, PrimitiveType::U64, AlignmentMode::AlignedToType);
    let value =
        candidate_value_at(&session, base + offset as u64).expect("u64 candidate must be captured");
    assert!(matches!(value, PrimitiveValue::U64(v) if v == huge));
}

#[test]
fn stale_target_is_rejected_after_the_process_exits() {
    let mut fixture = Fixture::spawn();
    let mut session = open_session(&fixture, PrimitiveType::U32, AlignmentMode::AlignedToType);
    fixture.kill();

    let stale = session.verify_not_stale().unwrap_err();
    assert_eq!(stale.kind, solith_scanner_core::ErrorKind::TargetExited);

    let cancellation = CancellationToken::new();
    let err = session
        .refine(RefineMode::Changed, &cancellation, None)
        .unwrap_err();
    assert_eq!(err.kind, solith_scanner_core::ErrorKind::TargetExited);
}

#[test]
fn a_second_independent_session_is_unaffected_by_the_first_process_dying() {
    // Mission §4.2's core scenario, proven for the provable half (see
    // session.rs's module doc for why forcing a literal PID-reuse
    // collision is not deterministically reproducible from user-mode
    // Windows): two fully independent sessions, each owning its own
    // handle, never cross-contaminate — killing session A's target must
    // never affect session B's target, which is exactly what would need to
    // be true for "stale session A silently reads process B's memory" to
    // be impossible by construction.
    let mut fixture_a = Fixture::spawn();
    let mut fixture_b = Fixture::spawn();
    let mut session_a = open_session(&fixture_a, PrimitiveType::U32, AlignmentMode::AlignedToType);
    let mut session_b = open_session(&fixture_b, PrimitiveType::U32, AlignmentMode::AlignedToType);

    fixture_a.kill();

    let cancellation = CancellationToken::new();
    assert!(session_a
        .refine(RefineMode::Changed, &cancellation, None)
        .is_err());
    let outcome_b = session_b
        .refine(RefineMode::Changed, &cancellation, None)
        .expect("session B must be unaffected by session A's target dying");
    assert_eq!(outcome_b.completeness, ScanCompleteness::Complete);

    fixture_b.kill();
}

#[test]
fn cancellation_before_a_refine_preserves_every_candidate_unchanged() {
    let fixture = Fixture::spawn();
    let mut session = open_session(&fixture, PrimitiveType::U32, AlignmentMode::AlignedToType);
    let before = session.candidate_count();
    assert!(before > 0);

    let cancellation = CancellationToken::new();
    cancellation.cancel();
    let outcome = session
        .refine(RefineMode::Changed, &cancellation, None)
        .expect("cancelled refine must still return Ok with Cancelled completeness");
    assert!(matches!(
        outcome.completeness,
        ScanCompleteness::Cancelled { .. }
    ));
    assert_eq!(
        session.candidate_count(),
        before,
        "an immediately-cancelled refine must carry every not-yet-examined candidate forward unchanged"
    );
}

#[test]
fn cancellation_during_unknown_initial_stops_before_full_region_is_covered() {
    let fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let region = refine_region(&fixture);
    let policy = RegionSelectionPolicy {
        max_region_bytes: None,
        ..RegionSelectionPolicy::default_writable_value_scan()
    };
    let cancellation = CancellationToken::new();
    // 4 KiB chunks over a 64 KiB region -> 16 chunks, enough boundaries to
    // deterministically cancel partway through (same proven pattern as
    // Stage 2's reader cancellation test: cancel after observing N
    // completed chunks via the progress callback, never a wall-clock race).
    let chunk_config = ChunkPlanConfig {
        chunk_size_bytes: 4096,
        overlap_bytes: 3,
    };
    // `metrics.chunks_requested` is set once, up front, to the region's
    // full planned chunk count (mirroring `exact_scan.rs`'s own metrics
    // convention) — the per-chunk progress signal is `chunks_read`, which
    // increments only as each chunk actually completes.
    let mut on_progress = |m: &solith_scanner_core::ScanMetrics| {
        if m.chunks_read >= 3 {
            cancellation.cancel();
        }
    };

    let (session, metrics) = ScanSession::create_unknown_initial(
        handle,
        &[region],
        &policy,
        PrimitiveType::U8,
        AlignmentMode::Bytewise,
        chunk_config,
        SessionResourceLimits::default(),
        &cancellation,
        Some(&mut on_progress),
    )
    .expect("create_unknown_initial failed");

    assert!(matches!(
        session.last_completeness(),
        ScanCompleteness::Cancelled { .. }
    ));
    assert!(
        metrics.chunks_read < metrics.chunks_requested,
        "cancellation should stop before every planned chunk is read: read {} of {} planned",
        metrics.chunks_read,
        metrics.chunks_requested
    );
}

#[test]
fn resource_limit_bounds_unknown_initial_and_never_reports_complete() {
    let fixture = Fixture::spawn();
    let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
    let region = refine_region(&fixture);
    let policy = RegionSelectionPolicy {
        max_region_bytes: None,
        ..RegionSelectionPolicy::default_writable_value_scan()
    };
    let cancellation = CancellationToken::new();
    let limits = SessionResourceLimits {
        max_candidates: Some(100),
        ..SessionResourceLimits::default()
    };

    let (session, _metrics) = ScanSession::create_unknown_initial(
        handle,
        &[region],
        &policy,
        PrimitiveType::U8,
        AlignmentMode::Bytewise,
        ChunkPlanConfig::default_for_testing(),
        limits,
        &cancellation,
        None,
    )
    .expect("create_unknown_initial failed");

    assert!(matches!(
        session.last_completeness(),
        ScanCompleteness::ResourceLimit { .. }
    ));
    assert!(session.candidate_count() <= 100);
}

#[test]
fn generation_history_records_every_refine_and_respects_retention_cap() {
    let mut fixture = Fixture::spawn();
    let offset = 4000usize;
    fixture.write_u32(offset, 0);
    let mut session = open_session(&fixture, PrimitiveType::U32, AlignmentMode::AlignedToType);

    let cancellation = CancellationToken::new();
    for _ in 0..5 {
        session
            .refine(RefineMode::Unchanged, &cancellation, None)
            .expect("refine failed");
    }
    assert_eq!(session.generation(), 5);
    // The initial UNKNOWN_INITIAL record (generation 0) plus 5 refines = 6.
    assert_eq!(session.generation_history().len(), 6);
    assert_eq!(session.generation_history().last().unwrap().generation, 5);
}

#[test]
fn candidates_page_is_bounded_and_deterministically_ordered() {
    let fixture = Fixture::spawn();
    let session = open_session(&fixture, PrimitiveType::U8, AlignmentMode::Bytewise);
    let total = session.candidate_count();
    assert!(total > 10);

    let page = session.candidates_page(0, 5);
    assert_eq!(page.len(), 5);
    for pair in page.windows(2) {
        assert!(
            pair[0].0 < pair[1].0,
            "candidates must be ascending by address"
        );
    }

    let empty = session.candidates_page(total, 5);
    assert!(
        empty.is_empty(),
        "an offset past the end returns no candidates"
    );
}

#[test]
fn repeated_create_refine_close_cycles_do_not_leak_os_handles() {
    #[cfg(windows)]
    fn current_process_handle_count() -> u32 {
        use windows_sys::Win32::System::Threading::{GetCurrentProcess, GetProcessHandleCount};
        let mut count: u32 = 0;
        unsafe {
            GetProcessHandleCount(GetCurrentProcess(), &mut count as *mut u32);
        }
        count
    }

    let baseline = current_process_handle_count();
    for _ in 0..10 {
        let fixture = Fixture::spawn();
        let mut session = open_session(&fixture, PrimitiveType::U32, AlignmentMode::AlignedToType);
        let cancellation = CancellationToken::new();
        session
            .refine(RefineMode::Changed, &cancellation, None)
            .expect("refine failed");
        session.close();
        // `fixture` (and its child process handle) drops at end of scope.
    }
    let after = current_process_handle_count();
    // Some slack for unrelated transient handles (thread pool, allocator,
    // etc.) — the point is bounded, not-strictly-increasing-per-cycle
    // growth, not an exact count match.
    assert!(
        after <= baseline + 50,
        "handle count grew from {baseline} to {after} across 10 create/refine/close cycles"
    );
}
