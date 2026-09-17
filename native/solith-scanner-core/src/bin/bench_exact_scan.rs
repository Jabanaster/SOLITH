//! Stage 3 exact-scan performance benchmark (mission §3.15).
//!
//! Spawns `solith-scanner-fixture <size_mib>` (real OS process, real
//! `VirtualAlloc`'d memory filled by the fixture's own deterministic
//! pseudo-random formula) and measures `scan_exact` — the real, unmodified
//! exported function — for representative types (u8, u32, u64, f32, f64)
//! at region sizes up to 256 MiB and chunk sizes informed by Stage 2's
//! evidence (doc 16: larger chunks materially reduce syscall-count
//! overhead). Also measures the "result-density effect" mission §3.15
//! explicitly asks for: a common byte value (thousands of matches) vs. a
//! value chosen to be genuinely absent (zero matches), at the same region
//! size/chunk size, to isolate match-processing cost from read cost.
//!
//! Run: `cargo run --release --bin bench_exact_scan`

#[cfg(windows)]
mod imp {
    use std::io::{BufRead, BufReader, Write};
    use std::process::{Child, Command, Stdio};
    use std::time::Instant;

    use solith_scanner_core::cancellation::CancellationToken;
    use solith_scanner_core::completeness::ScanCompleteness;
    use solith_scanner_core::exact_scan::{scan_exact, ScanOptions};
    use solith_scanner_core::policy::RegionSelectionPolicy;
    use solith_scanner_core::region::{CommitState, Region, RegionKind};
    use solith_scanner_core::target::ProcessHandle;
    use solith_scanner_core::types::{PrimitiveType, PrimitiveValue};
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

    pub fn main() {
        println!("Stage 3 exact-scan benchmark — real spawned process, real memory, real scan_exact() calls.");
        println!(
            "{:>8} {:>6} {:>12} {:>10} {:>10} {:>10} {:>14} {:>10} {:>12}",
            "size",
            "type",
            "chunk_size",
            "matches",
            "chunks",
            "syscalls",
            "elapsed_ms",
            "density",
            "MiB/s"
        );

        let policy = RegionSelectionPolicy {
            max_region_bytes: None,
            ..RegionSelectionPolicy::default_writable_value_scan()
        };

        for size_mib in [1u64, 16, 64, 256] {
            let (child, base, size) = spawn_fixture(size_mib);
            if size == 0 {
                eprintln!("skipping {size_mib} MiB: fixture failed to allocate");
                kill(child);
                continue;
            }
            let handle = ProcessHandle::open_read_only(child.id()).expect("attach failed");
            let region = region_of(base, size);

            // The fixture fills the region via: byte[i] = ((i as u32).wrapping_mul(0x9E3779B1) >> 20) as u8.
            // Byte value 0 occurs roughly 1-in-256 positions (high density);
            // a full 8-byte pattern that can never occur from this per-byte
            // formula (0xFFFFFFFFFFFFFFFF, since no single byte in the fill
            // ever reaches certain high values in a way that lines up 8 in a
            // row) gives a genuinely-absent (zero-density) comparison point.
            struct Case {
                label: &'static str,
                pt: PrimitiveType,
                target: PrimitiveValue,
                density: &'static str,
            }
            let cases = [
                Case {
                    label: "u8",
                    pt: PrimitiveType::U8,
                    target: PrimitiveValue::U8(0),
                    density: "high",
                },
                Case {
                    label: "u8",
                    pt: PrimitiveType::U8,
                    target: PrimitiveValue::U8(0xFF),
                    density: "absent",
                },
                Case {
                    label: "u32",
                    pt: PrimitiveType::U32,
                    target: PrimitiveValue::U32(0x1234_5678),
                    density: "sparse",
                },
                Case {
                    label: "u64",
                    pt: PrimitiveType::U64,
                    target: PrimitiveValue::U64(0xFFFF_FFFF_FFFF_FFFF),
                    density: "absent",
                },
                Case {
                    label: "f32",
                    pt: PrimitiveType::F32,
                    target: PrimitiveValue::F32(f32::from_bits(0x1234_5678)),
                    density: "sparse",
                },
                Case {
                    label: "f64",
                    pt: PrimitiveType::F64,
                    target: PrimitiveValue::F64(f64::from_bits(0x1122_3344_5566_7788)),
                    density: "sparse",
                },
            ];

            for chunk_size_bytes in [256 * 1024u64, 1024 * 1024, 4 * 1024 * 1024] {
                if chunk_size_bytes > size {
                    continue;
                }
                for case in &cases {
                    let overlap = case.pt.byte_width() as u64 - 1;
                    let options = ScanOptions {
                        alignment: Default::default(),
                        chunk_config: ChunkPlanConfig {
                            chunk_size_bytes,
                            overlap_bytes: overlap,
                        },
                        max_results: None,
                    };
                    let cancellation = CancellationToken::new();

                    let start = Instant::now();
                    let result = scan_exact(
                        &handle,
                        std::slice::from_ref(&region),
                        &policy,
                        case.pt,
                        case.target,
                        &options,
                        &cancellation,
                        None,
                    )
                    .expect("scan failed");
                    let elapsed = start.elapsed();

                    assert!(matches!(result.completeness, ScanCompleteness::Complete));
                    let mib_per_sec = (result.metrics.bytes_read as f64 / 1024.0 / 1024.0)
                        / elapsed.as_secs_f64();
                    println!(
                        "{:>6}MiB {:>6} {:>10}B {:>10} {:>10} {:>10} {:>10.2} {:>10} {:>12.1}",
                        size_mib,
                        case.label,
                        chunk_size_bytes,
                        result.matches.len(),
                        result.metrics.chunks_read,
                        result.metrics.syscall_count,
                        elapsed.as_secs_f64() * 1000.0,
                        case.density,
                        mib_per_sec
                    );
                }
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
    eprintln!("bench_exact_scan is Windows-only");
    std::process::exit(1);
}
