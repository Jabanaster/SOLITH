//! Stage 5 pattern-scan performance benchmark (mission §5.17).
//!
//! Spawns `solith-scanner-fixture <size_mib>` (real OS process, real
//! `VirtualAlloc`'d memory filled with pseudo-random decoy bytes — no
//! planted match, so every measurement here is a genuine full-region worst
//! case: the matcher must examine every candidate offset because none of
//! them terminate early on a real hit) and measures the real, unmodified
//! exported `scan_pattern` function across pattern kinds/lengths (mission's
//! "short/medium/long" + "wildcard impact" + "chunk size effect"
//! requirements), and separately across region sizes 16/64/256 MiB.
//!
//! CPU utilization is not measured, consistent with every earlier stage's
//! benchmark (Stage 2 doc 16, Stage 3 doc 24, Stage 4 doc 33) — wall-clock
//! elapsed time and derived MB/s throughput are reported instead.
//!
//! Run: `cargo run --release --bin bench_pattern`

#[cfg(windows)]
mod imp {
    use std::io::{BufRead, BufReader, Write};
    use std::process::{Child, Command, Stdio};
    use std::time::Instant;

    use solith_scanner_core::cancellation::CancellationToken;
    use solith_scanner_core::pattern::{
        pattern_from_raw_bytes, pattern_from_utf16le_str, pattern_from_utf8_str, Pattern,
        PatternByte, PatternKind,
    };
    use solith_scanner_core::pattern_scan::{scan_pattern, PatternScanOptions};
    use solith_scanner_core::policy::RegionSelectionPolicy;
    use solith_scanner_core::region::{CommitState, Region, RegionKind};
    use solith_scanner_core::target::ProcessHandle;
    use solith_scanner_core::ChunkPlanConfig;

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

    fn run_case(
        pid: u32,
        region: &Region,
        pattern: &Pattern,
        kind: PatternKind,
        chunk_size_bytes: u64,
    ) -> (usize, std::time::Duration, f64) {
        let handle = ProcessHandle::open_read_only(pid).expect("attach failed");
        let policy = RegionSelectionPolicy {
            max_region_bytes: None,
            ..RegionSelectionPolicy::readable_any()
        };
        let cancellation = CancellationToken::new();
        let options = PatternScanOptions {
            chunk_config: ChunkPlanConfig {
                chunk_size_bytes,
                overlap_bytes: (pattern.len() as u64).saturating_sub(1),
            },
            max_results: None,
            first_match_only: false,
        };
        let start = Instant::now();
        let result = scan_pattern(
            &handle,
            std::slice::from_ref(region),
            &policy,
            pattern,
            kind,
            &options,
            &cancellation,
            None,
        )
        .expect("scan_pattern failed");
        let elapsed = start.elapsed();
        let mb = region.size as f64 / 1024.0 / 1024.0;
        let throughput = mb / elapsed.as_secs_f64();
        (result.matches.len(), elapsed, throughput)
    }

    fn wildcard16() -> Pattern {
        let mut bytes = vec![
            PatternByte::exact(0x10),
            PatternByte::exact(0x11),
            PatternByte::wildcard(),
            PatternByte::exact(0x13),
            PatternByte::exact(0x14),
            PatternByte::wildcard(),
            PatternByte::exact(0x16),
            PatternByte::exact(0x17),
            PatternByte::wildcard(),
            PatternByte::exact(0x19),
            PatternByte::exact(0x1A),
            PatternByte::wildcard(),
            PatternByte::exact(0x1C),
            PatternByte::exact(0x1D),
            PatternByte::exact(0x1E),
            PatternByte::exact(0x1F),
        ];
        // Ensure Horspool's anchor byte (the last byte) is exact so this
        // case exercises the accelerated path, same as the plain-exact
        // 16-byte case — isolating "wildcard impact" from "lost the skip
        // table entirely" as two independently measurable effects.
        bytes[15] = PatternByte::exact(0x1F);
        Pattern::new(bytes).unwrap()
    }

    pub fn main() {
        println!("Stage 5 pattern-scan benchmark — real spawned process, real memory, real scan_pattern() calls.");
        println!(
            "{:>8} {:>10} {:>10} {:>18} {:>12} {:>10}",
            "size", "kind", "matches", "elapsed_ms", "MB/s", "case"
        );

        for size_mib in [16u64, 64, 256] {
            let (child, base, size) = spawn_fixture(size_mib);
            if size == 0 {
                eprintln!("skipping {size_mib} MiB: fixture failed to allocate");
                kill(child);
                continue;
            }
            let region = region_of(base, size);
            let pid = child.id();

            let cases: Vec<(Pattern, PatternKind, &'static str)> = vec![
                (
                    pattern_from_raw_bytes(&[0xAA, 0xBB, 0xCC, 0xDD]).unwrap(),
                    PatternKind::RawBytes,
                    "raw_bytes_short_4B",
                ),
                (
                    pattern_from_raw_bytes(&[
                        0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B,
                        0x0C, 0x0D, 0x0E, 0x0F,
                    ])
                    .unwrap(),
                    PatternKind::RawBytes,
                    "raw_bytes_medium_16B",
                ),
                (
                    pattern_from_raw_bytes(&[0x5Au8; 64]).unwrap(),
                    PatternKind::RawBytes,
                    "raw_bytes_long_64B",
                ),
                (wildcard16(), PatternKind::Aob, "aob_wildcard_medium_16B"),
                (
                    pattern_from_utf8_str(
                        "PlayerHealthValue",
                        true,
                        solith_scanner_core::pattern::NullTerminatorMode::None,
                    )
                    .unwrap(),
                    PatternKind::Utf8,
                    "utf8_medium_17ch",
                ),
                (
                    pattern_from_utf16le_str(
                        "PlayerHealthValue",
                        true,
                        solith_scanner_core::pattern::NullTerminatorMode::None,
                    )
                    .unwrap(),
                    PatternKind::Utf16Le,
                    "utf16le_medium_17ch",
                ),
            ];

            for (pattern, kind, label) in &cases {
                let (matches, elapsed, throughput) =
                    run_case(pid, &region, pattern, *kind, 4 * 1024 * 1024);
                println!(
                    "{:>6}MiB {:>10} {:>10} {:>18.2} {:>12.2} {:>10}",
                    size_mib,
                    kind.to_string(),
                    matches,
                    elapsed.as_secs_f64() * 1000.0,
                    throughput,
                    label
                );
            }

            // Chunk-size effect, isolated at 64 MiB using the medium
            // exact-byte pattern only, per mission §5.17's own dimension.
            if size_mib == 64 {
                let pattern = pattern_from_raw_bytes(&[
                    0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0x0C,
                    0x0D, 0x0E, 0x0F,
                ])
                .unwrap();
                for chunk_size in [256 * 1024u64, 1024 * 1024, 4 * 1024 * 1024] {
                    let (matches, elapsed, throughput) =
                        run_case(pid, &region, &pattern, PatternKind::RawBytes, chunk_size);
                    println!(
                        "{:>6}MiB {:>10} {:>10} {:>18.2} {:>12.2} {:>10} (chunk={}KiB)",
                        size_mib,
                        "raw_bytes",
                        matches,
                        elapsed.as_secs_f64() * 1000.0,
                        throughput,
                        "chunk_size_effect",
                        chunk_size / 1024
                    );
                }
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
    eprintln!("bench_pattern is Windows-only");
    std::process::exit(1);
}
