//! Stage 2 deterministic test fixture — a real, spawned target process with
//! controlled memory layout, used by `tests/*.rs` integration tests instead
//! of relying solely on `FakeMemoryDriver`-style mocks (mission §18: "Do
//! NOT rely solely on FakeMemoryDriver. Build real deterministic Windows
//! scanner fixtures.").
//!
//! Behavior: allocates known memory layouts, prints their addresses to
//! stdout as `KEY=VALUE` lines terminated by a `READY` line, then blocks
//! reading a command from stdin:
//!
//! - `exit` -> clean, orderly exit (Process-exit test E's "graceful" leg)
//! - `die` -> immediate `std::process::exit`, no cleanup (Process-exit
//!   test E's "abrupt exit" leg)
//! - anything else / EOF / no input within the timeout -> exits after a
//!   bounded wait, so a test that forgets to signal it can never hang CI
//!   forever.
//!
//! Not production code — this binary is never packaged with the app; it
//! exists solely under `cargo test`.

use std::io::{BufRead, Write};
use std::time::Duration;

#[cfg(windows)]
use windows_sys::Win32::System::Memory::{
    VirtualAlloc, VirtualProtect, MEM_COMMIT, MEM_RESERVE, PAGE_NOACCESS, PAGE_READWRITE,
};

const BIG_REGION_SIZE: usize = 4 * 1024 * 1024; // 4 MiB — well above the old 1 MiB cap
const SENTINEL_OFFSET: usize = 1_500_000; // > 1 MiB, inside BIG_REGION_SIZE
const SENTINEL_VALUE: u32 = 0xCAFEBABE;
const UNALIGNED_OFFSET: usize = 4_097; // not a multiple of 2/4/8
const UNALIGNED_BYTE: u8 = 0x5A;
// Matches ChunkPlanConfig::default_for_testing() (chunk_size=1 MiB, overlap=7):
// placed so the naive "one chunk per 1 MiB, no overlap" boundary at
// offset 1_048_576 falls in the middle of this 8-byte pattern.
const BOUNDARY_OFFSET: usize = 1_048_572;
const BOUNDARY_PATTERN: [u8; 8] = [0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88];

const GUARD_REGION_SIZE: usize = 3 * 4096; // 3 pages
const GUARD_NOACCESS_PAGE_OFFSET: usize = 4096; // the middle page becomes PAGE_NOACCESS

#[cfg(windows)]
fn main() {
    let pid = std::process::id();

    // Optional first CLI arg: allocate an additional region of this many
    // MiB, for Stage 2's native-reader benchmarks (src/bin/bench_reader.rs,
    // mission §25) — separate from the fixed-size correctness fixtures
    // below, since benchmark region sizes need to vary (1/16/64/256 MiB)
    // while the correctness sentinels stay fixed and small.
    let bench_region_mib: Option<usize> = std::env::args().nth(1).and_then(|s| s.parse().ok());
    if let Some(mib) = bench_region_mib {
        let size = mib * 1024 * 1024;
        let region = unsafe {
            VirtualAlloc(
                std::ptr::null(),
                size,
                MEM_COMMIT | MEM_RESERVE,
                PAGE_READWRITE,
            )
        };
        assert!(!region.is_null(), "VirtualAlloc(bench_region) failed");
        unsafe {
            let slice = std::slice::from_raw_parts_mut(region as *mut u8, size);
            for (i, b) in slice.iter_mut().enumerate() {
                *b = ((i as u32).wrapping_mul(2654435761) >> 24) as u8;
            }
        }
        println!("BENCH_REGION_BASE=0x{:x}", region as usize);
        println!("BENCH_REGION_SIZE={size}");
    }

    let big_region = unsafe {
        VirtualAlloc(
            std::ptr::null(),
            BIG_REGION_SIZE,
            MEM_COMMIT | MEM_RESERVE,
            PAGE_READWRITE,
        )
    };
    assert!(!big_region.is_null(), "VirtualAlloc(big_region) failed");
    let big_base = big_region as usize;

    unsafe {
        let slice = std::slice::from_raw_parts_mut(big_region as *mut u8, BIG_REGION_SIZE);
        slice[SENTINEL_OFFSET..SENTINEL_OFFSET + 4].copy_from_slice(&SENTINEL_VALUE.to_le_bytes());
        slice[UNALIGNED_OFFSET] = UNALIGNED_BYTE;
        slice[BOUNDARY_OFFSET..BOUNDARY_OFFSET + 8].copy_from_slice(&BOUNDARY_PATTERN);
    }

    let guard_region = unsafe {
        VirtualAlloc(
            std::ptr::null(),
            GUARD_REGION_SIZE,
            MEM_COMMIT | MEM_RESERVE,
            PAGE_READWRITE,
        )
    };
    assert!(!guard_region.is_null(), "VirtualAlloc(guard_region) failed");
    let guard_base = guard_region as usize;

    let mut old_protect: u32 = 0;
    let middle_page_ptr = unsafe { guard_region.add(GUARD_NOACCESS_PAGE_OFFSET) };
    let protect_ok = unsafe {
        VirtualProtect(
            middle_page_ptr,
            4096,
            PAGE_NOACCESS,
            &mut old_protect as *mut u32,
        )
    };
    assert_ne!(protect_ok, 0, "VirtualProtect(guard middle page) failed");

    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    writeln!(out, "PID={pid}").unwrap();
    writeln!(out, "BIG_REGION_BASE=0x{big_base:x}").unwrap();
    writeln!(out, "BIG_REGION_SIZE={BIG_REGION_SIZE}").unwrap();
    writeln!(out, "SENTINEL_OFFSET={SENTINEL_OFFSET}").unwrap();
    writeln!(out, "SENTINEL_VALUE=0x{SENTINEL_VALUE:x}").unwrap();
    writeln!(out, "UNALIGNED_OFFSET={UNALIGNED_OFFSET}").unwrap();
    writeln!(out, "UNALIGNED_BYTE=0x{UNALIGNED_BYTE:x}").unwrap();
    writeln!(out, "BOUNDARY_OFFSET={BOUNDARY_OFFSET}").unwrap();
    writeln!(out, "BOUNDARY_PATTERN=1122334455667788").unwrap();
    writeln!(out, "GUARD_REGION_BASE=0x{guard_base:x}").unwrap();
    writeln!(out, "GUARD_REGION_SIZE={GUARD_REGION_SIZE}").unwrap();
    writeln!(out, "GUARD_NOACCESS_OFFSET={GUARD_NOACCESS_PAGE_OFFSET}").unwrap();
    writeln!(out, "READY").unwrap();
    out.flush().unwrap();
    drop(out);

    // Bounded wait for a command, so an interrupted/forgotten test can never
    // hang the fixture (and therefore CI) forever.
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let stdin = std::io::stdin();
        let mut line = String::new();
        if stdin.lock().read_line(&mut line).is_ok() {
            let _ = tx.send(line.trim().to_string());
        }
    });

    match rx.recv_timeout(Duration::from_secs(30)) {
        Ok(cmd) if cmd == "die" => {
            // Abrupt, no-cleanup exit — simulates a real crash/kill for the
            // process-exit-during-scan test.
            std::process::exit(0xDEAD);
        }
        _ => {
            // "exit", timeout, or EOF: fall through to an orderly return,
            // which drops the VirtualAlloc'd regions with the process and
            // exits 0.
        }
    }
}

#[cfg(not(windows))]
fn main() {
    eprintln!("solith-scanner-fixture is Windows-only");
    std::process::exit(1);
}
