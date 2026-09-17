//! Stage 6 §6.22/§6.23 integration tests — real-process long-run stress
//! (repeated exact/AOB scans, repeated session cycles) and concurrent
//! session safety (same-process interleaved, and genuinely simultaneous
//! multi-threaded), each with a bounded-growth native handle check
//! (`GetProcessHandleCount`), the same technique
//! `session_integration.rs`'s Stage 4 leak check already established.

#![cfg(windows)]

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};

use solith_scanner_core::cancellation::CancellationToken;
use solith_scanner_core::completeness::ScanCompleteness;
use solith_scanner_core::exact_scan::{scan_exact, AlignmentMode, ScanOptions};
use solith_scanner_core::pattern::pattern_from_raw_bytes;
use solith_scanner_core::pattern_scan::{scan_pattern, PatternScanOptions};
use solith_scanner_core::policy::RegionSelectionPolicy;
use solith_scanner_core::region::{CommitState, Region, RegionKind};
use solith_scanner_core::session::{RefineMode, SessionResourceLimits};
use solith_scanner_core::target::ProcessHandle;
use solith_scanner_core::types::{PrimitiveType, PrimitiveValue};
use solith_scanner_core::{ChunkPlanConfig, PatternKind, ScanSession};

#[cfg(windows)]
use windows_sys::Win32::System::Threading::GetProcessHandleCount;

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

fn own_process_handle_count() -> u32 {
    let mut count: u32 = 0;
    let ok = unsafe {
        GetProcessHandleCount(
            windows_sys::Win32::System::Threading::GetCurrentProcess(),
            &mut count,
        )
    };
    assert_ne!(ok, 0, "GetProcessHandleCount failed");
    count
}

#[test]
fn one_hundred_repeated_exact_scans_do_not_leak_handles() {
    let fixture = Fixture::spawn();
    let region = types_region(&fixture);
    let policy = RegionSelectionPolicy {
        max_region_bytes: None,
        ..RegionSelectionPolicy::default_writable_value_scan()
    };
    let target = PrimitiveValue::I32(-2_000_000_000);
    let options = ScanOptions::default_for(PrimitiveType::I32, 1024 * 1024);

    // Warm up (first-call allocator/cache effects) before the baseline.
    for _ in 0..5 {
        let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
        let cancellation = CancellationToken::new();
        scan_exact(
            &handle,
            std::slice::from_ref(&region),
            &policy,
            PrimitiveType::I32,
            target,
            &options,
            &cancellation,
            None,
        )
        .expect("scan failed");
    }

    let baseline = own_process_handle_count();
    for i in 0..100 {
        let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
        let cancellation = CancellationToken::new();
        let result = scan_exact(
            &handle,
            std::slice::from_ref(&region),
            &policy,
            PrimitiveType::I32,
            target,
            &options,
            &cancellation,
            None,
        )
        .expect("scan failed");
        assert_eq!(
            result.completeness,
            ScanCompleteness::Complete,
            "iteration {i}"
        );
    }
    let after = own_process_handle_count();
    assert!(
        after <= baseline + 50,
        "handle count grew from {baseline} to {after} across 100 exact scans"
    );
}

#[test]
fn one_hundred_repeated_aob_scans_do_not_leak_handles() {
    let fixture = Fixture::spawn();
    let region = pattern_region(&fixture);
    let pattern =
        pattern_from_raw_bytes(&[0x48, 0x8B, 0x05, 0x11, 0x22, 0x33, 0x44, 0x89]).unwrap();
    let policy = RegionSelectionPolicy {
        max_region_bytes: None,
        ..RegionSelectionPolicy::readable_any()
    };
    let options = PatternScanOptions::default_for(&pattern, 1024 * 1024);

    for _ in 0..5 {
        let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
        let cancellation = CancellationToken::new();
        scan_pattern(
            &handle,
            std::slice::from_ref(&region),
            &policy,
            &pattern,
            PatternKind::Aob,
            &options,
            &cancellation,
            None,
        )
        .expect("scan failed");
    }

    let baseline = own_process_handle_count();
    for i in 0..100 {
        let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
        let cancellation = CancellationToken::new();
        let result = scan_pattern(
            &handle,
            std::slice::from_ref(&region),
            &policy,
            &pattern,
            PatternKind::Aob,
            &options,
            &cancellation,
            None,
        )
        .expect("scan failed");
        assert_eq!(
            result.completeness,
            ScanCompleteness::Complete,
            "iteration {i}"
        );
        assert!(!result.matches.is_empty(), "iteration {i}");
    }
    let after = own_process_handle_count();
    assert!(
        after <= baseline + 50,
        "handle count grew from {baseline} to {after} across 100 AOB scans"
    );
}

#[test]
fn fifty_repeated_session_create_refine_close_cycles_do_not_leak_handles() {
    let fixture = Fixture::spawn();
    let region = refine_region(&fixture);

    for _ in 0..5 {
        let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
        let cancellation = CancellationToken::new();
        let (session, _) = ScanSession::create_unknown_initial(
            handle,
            std::slice::from_ref(&region),
            &RegionSelectionPolicy::default_writable_value_scan(),
            PrimitiveType::U32,
            AlignmentMode::AlignedToType,
            ChunkPlanConfig::default_for_testing(),
            SessionResourceLimits::default_safe(),
            &cancellation,
            None,
        )
        .expect("create_unknown_initial failed");
        session.close();
    }

    let baseline = own_process_handle_count();
    for i in 0..50 {
        let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
        let cancellation = CancellationToken::new();
        let (mut session, _) = ScanSession::create_unknown_initial(
            handle,
            std::slice::from_ref(&region),
            &RegionSelectionPolicy::default_writable_value_scan(),
            PrimitiveType::U32,
            AlignmentMode::AlignedToType,
            ChunkPlanConfig::default_for_testing(),
            SessionResourceLimits::default_safe(),
            &cancellation,
            None,
        )
        .expect("create_unknown_initial failed");
        let outcome = session
            .refine(RefineMode::Unchanged, &cancellation, None)
            .expect("refine failed");
        assert_eq!(
            outcome.completeness,
            ScanCompleteness::Complete,
            "iteration {i}"
        );
        session.close();
    }
    let after = own_process_handle_count();
    assert!(
        after <= baseline + 50,
        "handle count grew from {baseline} to {after} across 50 session cycles"
    );
}

#[test]
fn two_sessions_against_the_same_process_interleaved_stay_fully_isolated() {
    // Stage 6 §6.23: no global mutable scan state. Two independent sessions
    // against the SAME real process, refined in an interleaved (A, B, A, B)
    // order, must never see each other's generation counters or results.
    let fixture = Fixture::spawn();
    let region = refine_region(&fixture);
    let policy = RegionSelectionPolicy::default_writable_value_scan();

    let make_session = || {
        let handle = ProcessHandle::open_read_only(fixture.pid()).expect("attach failed");
        let cancellation = CancellationToken::new();
        let (session, _) = ScanSession::create_unknown_initial(
            handle,
            std::slice::from_ref(&region),
            &policy,
            PrimitiveType::U32,
            AlignmentMode::AlignedToType,
            ChunkPlanConfig::default_for_testing(),
            SessionResourceLimits::default_safe(),
            &cancellation,
            None,
        )
        .expect("create_unknown_initial failed");
        (session, cancellation)
    };

    let (mut session_a, cancel_a) = make_session();
    let (mut session_b, cancel_b) = make_session();
    assert_eq!(session_a.generation(), 0);
    assert_eq!(session_b.generation(), 0);

    session_a
        .refine(RefineMode::Unchanged, &cancel_a, None)
        .expect("A refine 1 failed");
    assert_eq!(session_a.generation(), 1);
    assert_eq!(
        session_b.generation(),
        0,
        "B must be unaffected by A's refine"
    );

    session_b
        .refine(RefineMode::Unchanged, &cancel_b, None)
        .expect("B refine 1 failed");
    assert_eq!(session_b.generation(), 1);

    session_a
        .refine(RefineMode::Unchanged, &cancel_a, None)
        .expect("A refine 2 failed");
    assert_eq!(session_a.generation(), 2);
    assert_eq!(session_b.generation(), 1, "B must still be unaffected");

    // Cancelling B's token must never affect A's independent operations.
    cancel_b.cancel();
    let a_outcome = session_a
        .refine(RefineMode::Unchanged, &cancel_a, None)
        .expect("A refine 3 must succeed even though B's token is cancelled");
    assert_eq!(a_outcome.completeness, ScanCompleteness::Complete);

    session_a.close();
    session_b.close();
}

#[test]
fn concurrent_scans_on_two_real_threads_against_two_real_processes_are_isolated() {
    // Genuine simultaneous execution (not just interleaved), proving there
    // is no shared global mutable scan state a data race could corrupt.
    let fixture_a = Fixture::spawn();
    let fixture_b = Fixture::spawn();
    let region_a = types_region(&fixture_a);
    let region_b = types_region(&fixture_b);
    let region_a_base = region_a.base_address;
    let region_b_base = region_b.base_address;
    let pid_a = fixture_a.pid();
    let pid_b = fixture_b.pid();

    let thread_a = std::thread::spawn(move || {
        let handle = ProcessHandle::open_read_only(pid_a).expect("attach A failed");
        let policy = RegionSelectionPolicy {
            max_region_bytes: None,
            ..RegionSelectionPolicy::default_writable_value_scan()
        };
        let cancellation = CancellationToken::new();
        let mut results = Vec::new();
        for _ in 0..20 {
            let result = scan_exact(
                &handle,
                std::slice::from_ref(&region_a),
                &policy,
                PrimitiveType::I32,
                PrimitiveValue::I32(-2_000_000_000),
                &ScanOptions::default_for(PrimitiveType::I32, 1024 * 1024),
                &cancellation,
                None,
            )
            .expect("thread A scan failed");
            results.push(result);
        }
        results
    });

    let thread_b = std::thread::spawn(move || {
        let handle = ProcessHandle::open_read_only(pid_b).expect("attach B failed");
        let policy = RegionSelectionPolicy {
            max_region_bytes: None,
            ..RegionSelectionPolicy::default_writable_value_scan()
        };
        let cancellation = CancellationToken::new();
        let mut results = Vec::new();
        for _ in 0..20 {
            let result = scan_exact(
                &handle,
                std::slice::from_ref(&region_b),
                &policy,
                PrimitiveType::U32,
                PrimitiveValue::U32(3_000_000_000),
                &ScanOptions::default_for(PrimitiveType::U32, 1024 * 1024),
                &cancellation,
                None,
            )
            .expect("thread B scan failed");
            results.push(result);
        }
        results
    });

    let results_a = thread_a.join().expect("thread A panicked");
    let results_b = thread_b.join().expect("thread B panicked");

    for r in &results_a {
        assert_eq!(r.completeness, ScanCompleteness::Complete);
        assert!(
            !r.matches.is_empty(),
            "thread A must find its own I32 target"
        );
    }
    for r in &results_b {
        assert_eq!(r.completeness, ScanCompleteness::Complete);
        assert!(
            !r.matches.is_empty(),
            "thread B must find its own U32 target"
        );
    }
    // Cross-check: A's matches are I32 offsets from fixture A's own address
    // space, B's from fixture B's — real, different processes, never mixed.
    let addr_a = results_a[0].matches[0].address;
    let addr_b = results_b[0].matches[0].address;
    assert_eq!(addr_a, region_a_base + fixture_a.dec_u64("I32_OFFSET"));
    assert_eq!(addr_b, region_b_base + fixture_b.dec_u64("U32_OFFSET"));
}
