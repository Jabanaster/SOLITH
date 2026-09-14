//! Stage 4 scan-session performance benchmark (mission §4.18).
//!
//! Spawns `solith-scanner-fixture <size_mib>` (real OS process, real
//! `VirtualAlloc`'d memory) and measures the real, unmodified exported
//! `ScanSession::create_unknown_initial`/`refine` functions at representative
//! candidate densities: a dense capture (u8, bytewise — one candidate per
//! byte) and two sparser captures (u32/u64, aligned-to-type — one candidate
//! per 4/8 bytes). For each, measures `UNKNOWN_INITIAL` initialization, then
//! CHANGED/UNCHANGED/INCREASED/DECREASED refinement against the
//! now-established candidate set.
//!
//! Refinement here re-reads the *same, unmutated* bench region rather than a
//! genuinely mutated one — `BENCH_REGION` (unlike `REFINE_REGION`) has no
//! stdin mutation command wired to it, and real mutation-vs-refinement
//! *correctness* is already what `tests/session_integration.rs` proves
//! against `REFINE_REGION`'s real writes. What this benchmark measures is
//! refinement's actual cost driver regardless of outcome: the real
//! `ReadProcessMemory` re-read-and-compare loop over every candidate address
//! (mission §4.18's "refinement throughput" figure) — CHANGED/INCREASED/
//! DECREASED will report 0 survivors and UNCHANGED will report all of them
//! against unmutated memory, which is expected and does not affect the
//! timing being measured.
//!
//! Cancellation latency is measured separately: cancel a `refine` call after
//! observing a fixed number of completed read-spans via the progress
//! callback, and report the wall-clock delay between that decision and the
//! call actually returning.
//!
//! CPU utilization is not measured (no portable, dependency-free way to
//! sample it from this benchmark binary) — wall-clock elapsed time is
//! reported instead, consistent with every earlier stage's benchmarks
//! (Stage 2 doc 16, Stage 3 doc 24).
//!
//! Run: `cargo run --release --bin bench_session`

#[cfg(windows)]
mod imp {
    use std::io::{BufRead, BufReader, Write};
    use std::process::{Child, Command, Stdio};
    use std::time::Instant;

    use solith_scanner_core::cancellation::CancellationToken;
    use solith_scanner_core::exact_scan::AlignmentMode;
    use solith_scanner_core::policy::RegionSelectionPolicy;
    use solith_scanner_core::region::{CommitState, Region, RegionKind};
    use solith_scanner_core::session::{RefineMode, SessionResourceLimits};
    use solith_scanner_core::target::ProcessHandle;
    use solith_scanner_core::types::PrimitiveType;
    use solith_scanner_core::{ChunkPlanConfig, ScanSession};

    fn fixture_exe_path() -> std::path::PathBuf {
        let mut path = std::env::current_exe().expect("current_exe failed");
        path.pop();
        path.push("solith-scanner-fixture.exe");
        path
    }

    fn spawn_fixture(size_mib: u64) -> (Child, u64, u64) {
        let exe = fixture_exe_path();
        let mut child = Command::new(exe)
            .arg(size_mib.to_string())
            .stdout(Stdio::piped())
            .stdin(Stdio::piped())
            .spawn()
            .expect("spawn failed");
        let stdout = child.stdout.take().unwrap();
        let mut reader = BufReader::new(stdout);
        let mut base = 0u64;
        let mut size = 0u64;
        loop {
            let mut line = String::new();
            let n = reader.read_line(&mut line).unwrap();
            if n == 0 {
                panic!("fixture exited before READY");
            }
            let line = line.trim();
            if line == "READY" {
                break;
            }
            if let Some(v) = line.strip_prefix("BENCH_REGION_BASE=0x") {
                base = u64::from_str_radix(v, 16).unwrap();
            } else if let Some(v) = line.strip_prefix("BENCH_REGION_SIZE=") {
                size = v.parse().unwrap();
            }
        }
        (child, base, size)
    }

    fn kill(mut child: Child) {
        let _ = child.stdin.take().map(|mut s| writeln!(s, "exit"));
        let _ = child.wait();
    }

    fn region_of(base: u64, size: u64) -> Region {
        Region {
            base_address: base,
            size,
            allocation_base: base,
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

    fn capture(
        pid: u32,
        region: &Region,
        pt: PrimitiveType,
        alignment: AlignmentMode,
    ) -> (ScanSession, std::time::Duration) {
        let handle = ProcessHandle::open_read_only(pid).expect("attach failed");
        let policy = RegionSelectionPolicy {
            max_region_bytes: None,
            ..RegionSelectionPolicy::default_writable_value_scan()
        };
        let cancellation = CancellationToken::new();
        let start = Instant::now();
        let (session, _metrics) = ScanSession::create_unknown_initial(
            handle,
            std::slice::from_ref(region),
            &policy,
            pt,
            alignment,
            ChunkPlanConfig {
                chunk_size_bytes: 4 * 1024 * 1024,
                overlap_bytes: (pt.byte_width() as u64).saturating_sub(1),
            },
            SessionResourceLimits {
                max_candidates: Some(20_000_000),
                ..SessionResourceLimits::default()
            },
            &cancellation,
            None,
        )
        .expect("create_unknown_initial failed");
        (session, start.elapsed())
    }

    pub fn main() {
        println!("Stage 4 scan-session benchmark — real spawned process, real memory, real create_unknown_initial()/refine() calls.");
        println!(
            "{:>8} {:>6} {:>10} {:>14} {:>16} {:>14} {:>10}",
            "size", "type", "align", "candidates", "snapshot_MB", "elapsed_ms", "phase"
        );

        struct DensityCase {
            pt: PrimitiveType,
            alignment: AlignmentMode,
            label: &'static str,
        }
        let density_cases = [
            DensityCase {
                pt: PrimitiveType::U8,
                alignment: AlignmentMode::Bytewise,
                label: "u8/bytewise(dense)",
            },
            DensityCase {
                pt: PrimitiveType::U32,
                alignment: AlignmentMode::AlignedToType,
                label: "u32/aligned(sparse)",
            },
            DensityCase {
                pt: PrimitiveType::U64,
                alignment: AlignmentMode::AlignedToType,
                label: "u64/aligned(sparser)",
            },
        ];

        for size_mib in [1u64, 4, 16] {
            let (child, base, size) = spawn_fixture(size_mib);
            if size == 0 {
                eprintln!("skipping {size_mib} MiB: fixture failed to allocate");
                kill(child);
                continue;
            }
            let region = region_of(base, size);

            for case in &density_cases {
                let (mut session, capture_elapsed) =
                    capture(child.id(), &region, case.pt, case.alignment);
                let candidate_count = session.candidate_count();
                let snapshot_mb = session.candidate_memory_bytes() as f64 / 1024.0 / 1024.0;
                println!(
                    "{:>6}MiB {:>6} {:>10} {:>14} {:>16.2} {:>14.2} {:>10}",
                    size_mib,
                    case.label,
                    "-",
                    candidate_count,
                    snapshot_mb,
                    capture_elapsed.as_secs_f64() * 1000.0,
                    "unknown_initial"
                );

                for (mode, mode_label) in [
                    (RefineMode::Changed, "changed"),
                    (RefineMode::Unchanged, "unchanged"),
                    (RefineMode::Increased, "increased"),
                    (RefineMode::Decreased, "decreased"),
                ] {
                    let cancellation = CancellationToken::new();
                    let start = Instant::now();
                    let outcome = session
                        .refine(mode, &cancellation, None)
                        .expect("refine failed");
                    let elapsed = start.elapsed();
                    println!(
                        "{:>6}MiB {:>6} {:>10} {:>14} {:>16} {:>14.2} {:>10}",
                        size_mib,
                        case.label,
                        "-",
                        outcome.output_candidate_count,
                        "-",
                        elapsed.as_secs_f64() * 1000.0,
                        mode_label
                    );
                    // Refine mutates `session.candidates` in place; recapture
                    // a fresh baseline before the next mode so every mode is
                    // benchmarked against the same starting candidate count
                    // rather than whatever the previous mode left behind.
                    let (fresh, _) = capture(child.id(), &region, case.pt, case.alignment);
                    session = fresh;
                }

                // Cancellation latency: cancel after 2 completed read-spans,
                // measure wall-clock time until refine() actually returns.
                let cancel_token = CancellationToken::new();
                let cancel_token_for_cb = cancel_token.clone();
                let mut on_progress = move |m: &solith_scanner_core::ScanMetrics| {
                    if m.chunks_read >= 2 {
                        cancel_token_for_cb.cancel();
                    }
                };
                let start = Instant::now();
                let outcome = session
                    .refine(RefineMode::Changed, &cancel_token, Some(&mut on_progress))
                    .expect("refine failed");
                let elapsed = start.elapsed();
                println!(
                    "{:>6}MiB {:>6} {:>10} {:>14} {:>16} {:>14.2} {:>10} ({:?})",
                    size_mib,
                    case.label,
                    "-",
                    outcome.output_candidate_count,
                    "-",
                    elapsed.as_secs_f64() * 1000.0,
                    "cancel_lat",
                    outcome.completeness
                );
            }

            kill(child);
        }
    }
}

#[cfg(windows)]
fn main() {
    imp::main();
}

#[cfg(not(windows))]
fn main() {
    eprintln!("bench_session is Windows-only");
    std::process::exit(1);
}
