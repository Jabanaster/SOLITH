//! Stage 2 native-reader benchmark (mission §25).
//!
//! Spawns `solith-scanner-fixture <size_mib>` (a real OS process, real
//! `VirtualAlloc`'d memory — not an in-process synthetic buffer, unlike
//! Stage 1's JS microbenchmark in doc 04, which this supersedes for the
//! native reader specifically) and measures `read_region_chunked` against
//! it at several region sizes and chunk-size configurations. Results are
//! informational — Stage 2 does not claim a performance guarantee from a
//! single development machine's numbers; see
//! Docs/phase1/16-stage2-performance-results.md for the captured run and
//! its explicit caveats.
//!
//! Run: `cargo run --release --bin bench_reader`

#[cfg(windows)]
mod imp {
    use std::io::{BufRead, BufReader, Write};
    use std::process::{Child, Command, Stdio};
    use std::time::Instant;

    use solith_scanner_core::cancellation::CancellationToken;
    use solith_scanner_core::completeness::ScanMetrics;
    use solith_scanner_core::reader::{read_region_chunked, ReadBudget};
    use solith_scanner_core::region::{CommitState, Region, RegionKind};
    use solith_scanner_core::target::ProcessHandle;
    use solith_scanner_core::ChunkPlanConfig;

    fn fixture_exe_path() -> std::path::PathBuf {
        // [[bin]] targets (unlike integration tests) don't get a
        // CARGO_BIN_EXE_* env var — locate the sibling binary relative to
        // this one's own path instead (both land in the same target
        // profile directory).
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
            .expect("failed to spawn fixture");
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

    pub fn main() {
        println!("Stage 2 native-reader benchmark — real spawned process, real VirtualAlloc memory, real ReadProcessMemory calls.");
        println!(
            "{:>8} {:>14} {:>10} {:>10} {:>10} {:>14} {:>12}",
            "size", "chunk_size", "chunks", "syscalls", "elapsed_ms", "bytes_read", "MiB/s"
        );

        for size_mib in [1u64, 16, 64, 256] {
            let (child, base, size) = spawn_fixture(size_mib);
            if size == 0 {
                eprintln!(
                    "skipping {size_mib} MiB: fixture failed to allocate (insufficient memory?)"
                );
                kill(child);
                continue;
            }
            let handle = ProcessHandle::open_read_only(child.id()).expect("attach failed");
            let region = Region {
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
            };

            for chunk_size_bytes in [64 * 1024u64, 256 * 1024, 1024 * 1024, 4 * 1024 * 1024] {
                if chunk_size_bytes > size {
                    continue;
                }
                let chunk_config = ChunkPlanConfig {
                    chunk_size_bytes,
                    overlap_bytes: 7,
                };
                let cancellation = CancellationToken::new();
                let mut metrics = ScanMetrics::default();

                let start = Instant::now();
                let (_, completeness) = read_region_chunked(
                    &handle,
                    &region,
                    chunk_config,
                    &cancellation,
                    ReadBudget::default(),
                    &mut metrics,
                )
                .expect("read failed");
                let elapsed = start.elapsed();

                assert!(matches!(
                    completeness,
                    solith_scanner_core::completeness::ScanCompleteness::Complete
                ));

                let mib_per_sec =
                    (metrics.bytes_read as f64 / 1024.0 / 1024.0) / elapsed.as_secs_f64();
                println!(
                    "{:>6}MiB {:>12}B {:>10} {:>10} {:>10.2} {:>14} {:>12.1}",
                    size_mib,
                    chunk_size_bytes,
                    metrics.chunks_read,
                    metrics.syscall_count,
                    elapsed.as_secs_f64() * 1000.0,
                    metrics.bytes_read,
                    mib_per_sec
                );
            }

            drop(handle);
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
    eprintln!("bench_reader is Windows-only");
    std::process::exit(1);
}
