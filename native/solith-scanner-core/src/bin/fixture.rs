//! Stage 2 deterministic test fixture — a real, spawned target process with
//! controlled memory layout, used by `tests/*.rs` integration tests instead
//! of relying solely on `FakeMemoryDriver`-style mocks (mission §18: "Do
//! NOT rely solely on FakeMemoryDriver. Build real deterministic Windows
//! scanner fixtures.").
//!
//! Behavior: allocates known memory layouts, prints their addresses to
//! stdout as `KEY=VALUE` lines terminated by a `READY` line, then loops
//! reading commands from stdin (mission §4.13: "the parent/test can command
//! value mutations"):
//!
//! - `exit` -> clean, orderly exit (Process-exit test E's "graceful" leg)
//! - `die` -> immediate `std::process::exit`, no cleanup (Process-exit
//!   test E's "abrupt exit" leg)
//! - `write <decimal_offset> <hex_le_bytes>` -> overwrites that many bytes
//!   at that offset within `REFINE_REGION` (Stage 4's dedicated mutable
//!   region, kept separate from Stage 3's `TYPES_REGION` so refinement
//!   tests can freely mutate without disturbing Stage 3's fixed sentinels),
//!   then prints `WROTE <decimal_offset>` so the caller can synchronize
//!   before triggering a re-read/refine.
//! - anything else -> `UNKNOWN_CMD` is printed and the loop continues.
//! - EOF, or no input for 30s -> exits after a bounded wait, so a test that
//!   forgets to signal it can never hang CI forever. The 30s bound resets on
//!   every successfully received line, so a long but active mutation
//!   sequence is never artificially cut short.
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

// ── Stage 3 (mission §3.11): all 10 primitive types, aligned/unaligned,
// repeated, boundary-straddling, extreme 64-bit values, float specials,
// and decoy noise everywhere else. Sized to exceed one default (1 MiB)
// chunk so boundary-straddling offsets are meaningful.
const TYPES_REGION_SIZE: usize = 4 * 1024 * 1024;

const I8_OFFSET: usize = 64;
const I8_VALUE: i8 = -100;
const U8_OFFSET: usize = 128;
const U8_VALUE: u8 = 250;
const I16_OFFSET: usize = 193; // unaligned
const I16_VALUE: i16 = -12345;
const U16_OFFSET: usize = 256;
const U16_VALUE: u16 = 54321;
const I32_OFFSET: usize = 321; // unaligned
const I32_VALUE: i32 = -2_000_000_000;
const U32_OFFSET: usize = 384;
const U32_VALUE: u32 = 3_000_000_000;
const I64_OFFSET: usize = 449; // unaligned
const I64_VALUE: i64 = -9_000_000_000_000_000_000;
const U64_OFFSET: usize = 512;
const U64_VALUE: u64 = 18_000_000_000_000_000_000;
const U64_HUGE_OFFSET: usize = 576; // u64::MAX — beyond any f64-representable-exactly range
const U64_HUGE_VALUE: u64 = u64::MAX;
const F32_OFFSET: usize = 640;
// Deliberately pi/e-like test values (real, plausible non-integer game
// stats), not a typo'd math constant.
#[allow(clippy::approx_constant)]
const F32_VALUE: f32 = 3.14159;
const F64_OFFSET: usize = 704;
#[allow(clippy::approx_constant)]
const F64_VALUE: f64 = 2.718281828459045;
const F32_POS_INF_OFFSET: usize = 768;
const F32_NEG_INF_OFFSET: usize = 772;
const F64_NAN_OFFSET: usize = 776;
const REPEATED_I32_OFFSET_A: usize = 800;
const REPEATED_I32_OFFSET_B: usize = 900;
const REPEATED_I32_VALUE: i32 = 777_777;

// Matches the 1 MiB chunk size Stage 3's tests/benchmarks use — each width
// straddles a DIFFERENT multiple of 1,048,576 so their byte spans never
// overlap each other (an earlier version of this fixture placed all three
// within a few bytes of the SAME boundary, which made the u64 plant
// silently clobber the u16/u32 plants — Stage 3 evidence doc 25 records
// this as a caught-and-fixed authoring bug, not a scanner defect).
const BOUNDARY_U16_OFFSET: usize = 1_048_575; // straddles the 1×1MiB boundary
const BOUNDARY_U16_VALUE: u16 = 0xBEEF;
const BOUNDARY_U32_OFFSET: usize = 2 * 1_048_576 - 2; // straddles the 2×1MiB boundary
const BOUNDARY_U32_VALUE: u32 = 0xCAFEF00D;
const BOUNDARY_U64_OFFSET: usize = 3 * 1_048_576 - 4; // straddles the 3×1MiB boundary
const BOUNDARY_U64_VALUE: u64 = 0x0123_4567_89AB_CDEF;

// ── Stage 4 (mission §4.13): a dedicated mutable region, separate from
// TYPES_REGION above, that the parent test process can rewrite at runtime
// via the `write <offset> <hex_le_bytes>` stdin command. Real scan-session
// refinement tests plant an initial value, run UNKNOWN_INITIAL, issue a
// `write` command to mutate it, then re-scan — a real target-process write,
// not a Rust-array simulation (mission's explicit "do not certify only from
// pure Rust arrays" instruction).
const REFINE_REGION_SIZE: usize = 64 * 1024;

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

    let types_region = unsafe {
        VirtualAlloc(
            std::ptr::null(),
            TYPES_REGION_SIZE,
            MEM_COMMIT | MEM_RESERVE,
            PAGE_READWRITE,
        )
    };
    assert!(!types_region.is_null(), "VirtualAlloc(types_region) failed");
    let types_base = types_region as usize;

    unsafe {
        let slice = std::slice::from_raw_parts_mut(types_region as *mut u8, TYPES_REGION_SIZE);
        // Decoy noise everywhere first, so every planted value sits inside
        // realistic-looking surrounding bytes rather than a zeroed buffer.
        for (i, b) in slice.iter_mut().enumerate() {
            *b = ((i as u32).wrapping_mul(0x9E3779B1) >> 20) as u8;
        }

        slice[I8_OFFSET] = I8_VALUE as u8;
        slice[U8_OFFSET] = U8_VALUE;
        slice[I16_OFFSET..I16_OFFSET + 2].copy_from_slice(&I16_VALUE.to_le_bytes());
        slice[U16_OFFSET..U16_OFFSET + 2].copy_from_slice(&U16_VALUE.to_le_bytes());
        slice[I32_OFFSET..I32_OFFSET + 4].copy_from_slice(&I32_VALUE.to_le_bytes());
        slice[U32_OFFSET..U32_OFFSET + 4].copy_from_slice(&U32_VALUE.to_le_bytes());
        slice[I64_OFFSET..I64_OFFSET + 8].copy_from_slice(&I64_VALUE.to_le_bytes());
        slice[U64_OFFSET..U64_OFFSET + 8].copy_from_slice(&U64_VALUE.to_le_bytes());
        slice[U64_HUGE_OFFSET..U64_HUGE_OFFSET + 8].copy_from_slice(&U64_HUGE_VALUE.to_le_bytes());
        slice[F32_OFFSET..F32_OFFSET + 4].copy_from_slice(&F32_VALUE.to_le_bytes());
        slice[F64_OFFSET..F64_OFFSET + 8].copy_from_slice(&F64_VALUE.to_le_bytes());
        slice[F32_POS_INF_OFFSET..F32_POS_INF_OFFSET + 4]
            .copy_from_slice(&f32::INFINITY.to_le_bytes());
        slice[F32_NEG_INF_OFFSET..F32_NEG_INF_OFFSET + 4]
            .copy_from_slice(&f32::NEG_INFINITY.to_le_bytes());
        slice[F64_NAN_OFFSET..F64_NAN_OFFSET + 8].copy_from_slice(&f64::NAN.to_le_bytes());
        slice[REPEATED_I32_OFFSET_A..REPEATED_I32_OFFSET_A + 4]
            .copy_from_slice(&REPEATED_I32_VALUE.to_le_bytes());
        slice[REPEATED_I32_OFFSET_B..REPEATED_I32_OFFSET_B + 4]
            .copy_from_slice(&REPEATED_I32_VALUE.to_le_bytes());
        slice[BOUNDARY_U16_OFFSET..BOUNDARY_U16_OFFSET + 2]
            .copy_from_slice(&BOUNDARY_U16_VALUE.to_le_bytes());
        slice[BOUNDARY_U32_OFFSET..BOUNDARY_U32_OFFSET + 4]
            .copy_from_slice(&BOUNDARY_U32_VALUE.to_le_bytes());
        slice[BOUNDARY_U64_OFFSET..BOUNDARY_U64_OFFSET + 8]
            .copy_from_slice(&BOUNDARY_U64_VALUE.to_le_bytes());
    }

    let refine_region = unsafe {
        VirtualAlloc(
            std::ptr::null(),
            REFINE_REGION_SIZE,
            MEM_COMMIT | MEM_RESERVE,
            PAGE_READWRITE,
        )
    };
    assert!(
        !refine_region.is_null(),
        "VirtualAlloc(refine_region) failed"
    );
    let refine_base = refine_region as usize;
    unsafe {
        let slice = std::slice::from_raw_parts_mut(refine_region as *mut u8, REFINE_REGION_SIZE);
        for (i, b) in slice.iter_mut().enumerate() {
            *b = ((i as u32).wrapping_mul(0x2545F491) >> 16) as u8;
        }
    }

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
    writeln!(out, "TYPES_REGION_BASE=0x{types_base:x}").unwrap();
    writeln!(out, "TYPES_REGION_SIZE={TYPES_REGION_SIZE}").unwrap();
    writeln!(out, "I8_OFFSET={I8_OFFSET}").unwrap();
    writeln!(out, "I8_VALUE={I8_VALUE}").unwrap();
    writeln!(out, "U8_OFFSET={U8_OFFSET}").unwrap();
    writeln!(out, "U8_VALUE={U8_VALUE}").unwrap();
    writeln!(out, "I16_OFFSET={I16_OFFSET}").unwrap();
    writeln!(out, "I16_VALUE={I16_VALUE}").unwrap();
    writeln!(out, "U16_OFFSET={U16_OFFSET}").unwrap();
    writeln!(out, "U16_VALUE={U16_VALUE}").unwrap();
    writeln!(out, "I32_OFFSET={I32_OFFSET}").unwrap();
    writeln!(out, "I32_VALUE={I32_VALUE}").unwrap();
    writeln!(out, "U32_OFFSET={U32_OFFSET}").unwrap();
    writeln!(out, "U32_VALUE={U32_VALUE}").unwrap();
    writeln!(out, "I64_OFFSET={I64_OFFSET}").unwrap();
    writeln!(out, "I64_VALUE={I64_VALUE}").unwrap();
    writeln!(out, "U64_OFFSET={U64_OFFSET}").unwrap();
    writeln!(out, "U64_VALUE={U64_VALUE}").unwrap();
    writeln!(out, "U64_HUGE_OFFSET={U64_HUGE_OFFSET}").unwrap();
    writeln!(out, "U64_HUGE_VALUE={U64_HUGE_VALUE}").unwrap();
    writeln!(out, "F32_OFFSET={F32_OFFSET}").unwrap();
    writeln!(out, "F32_VALUE={F32_VALUE}").unwrap();
    writeln!(out, "F64_OFFSET={F64_OFFSET}").unwrap();
    writeln!(out, "F64_VALUE={F64_VALUE}").unwrap();
    writeln!(out, "F32_POS_INF_OFFSET={F32_POS_INF_OFFSET}").unwrap();
    writeln!(out, "F32_NEG_INF_OFFSET={F32_NEG_INF_OFFSET}").unwrap();
    writeln!(out, "F64_NAN_OFFSET={F64_NAN_OFFSET}").unwrap();
    writeln!(out, "REPEATED_I32_OFFSET_A={REPEATED_I32_OFFSET_A}").unwrap();
    writeln!(out, "REPEATED_I32_OFFSET_B={REPEATED_I32_OFFSET_B}").unwrap();
    writeln!(out, "REPEATED_I32_VALUE={REPEATED_I32_VALUE}").unwrap();
    writeln!(out, "BOUNDARY_U16_OFFSET={BOUNDARY_U16_OFFSET}").unwrap();
    writeln!(out, "BOUNDARY_U16_VALUE={BOUNDARY_U16_VALUE}").unwrap();
    writeln!(out, "BOUNDARY_U32_OFFSET={BOUNDARY_U32_OFFSET}").unwrap();
    writeln!(out, "BOUNDARY_U32_VALUE={BOUNDARY_U32_VALUE}").unwrap();
    writeln!(out, "BOUNDARY_U64_OFFSET={BOUNDARY_U64_OFFSET}").unwrap();
    writeln!(out, "BOUNDARY_U64_VALUE={BOUNDARY_U64_VALUE}").unwrap();
    writeln!(out, "REFINE_REGION_BASE=0x{refine_base:x}").unwrap();
    writeln!(out, "REFINE_REGION_SIZE={REFINE_REGION_SIZE}").unwrap();
    writeln!(out, "READY").unwrap();
    out.flush().unwrap();

    // A dedicated thread feeds every stdin line into a channel; the main
    // loop applies a bounded (30s, reset per line) wait on each `recv` so an
    // interrupted/forgotten test can never hang the fixture (and therefore
    // CI) forever, while still supporting an arbitrarily long sequence of
    // mutation commands from an active test.
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    std::thread::spawn(move || {
        let stdin = std::io::stdin();
        let mut line = String::new();
        loop {
            line.clear();
            match stdin.lock().read_line(&mut line) {
                Ok(0) => break, // EOF
                Ok(_) => {
                    if tx.send(line.trim().to_string()).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    let refine_slice =
        unsafe { std::slice::from_raw_parts_mut(refine_region as *mut u8, REFINE_REGION_SIZE) };

    loop {
        match rx.recv_timeout(Duration::from_secs(30)) {
            Ok(cmd) if cmd == "die" => {
                // Abrupt, no-cleanup exit — simulates a real crash/kill for
                // the process-exit-during-scan/refine test.
                std::process::exit(0xDEAD);
            }
            Ok(cmd) if cmd == "exit" => break,
            Ok(cmd) => {
                if let Some(rest) = cmd.strip_prefix("write ") {
                    apply_write_command(refine_slice, rest, &mut out);
                } else {
                    writeln!(out, "UNKNOWN_CMD {cmd}").unwrap();
                    out.flush().unwrap();
                }
            }
            Err(_) => break, // 30s of silence, or EOF: bounded-hang-safe exit.
        }
    }
    // Falling through drops the VirtualAlloc'd regions with the process and
    // exits 0 — the orderly path for both "exit" and the bounded timeout.
}

/// Parses `"<decimal_offset> <hex_le_bytes>"` and writes the decoded bytes
/// into `region` at that offset, bounds-checked. Prints `WROTE <offset>` on
/// success or `WRITE_ERROR <reason>` on any malformed input/out-of-bounds
/// request — never panics on attacker/typo-grade input, since a real test
/// harness bug here must be diagnosable, not a fixture crash indistinguishable
/// from a real target-process crash.
#[cfg(windows)]
fn apply_write_command(region: &mut [u8], rest: &str, out: &mut impl Write) {
    let mut parts = rest.trim().splitn(2, ' ');
    let offset_str = parts.next().unwrap_or("");
    let hex_str = parts.next().unwrap_or("");

    let offset: usize = match offset_str.parse() {
        Ok(v) => v,
        Err(_) => {
            writeln!(out, "WRITE_ERROR bad_offset").unwrap();
            out.flush().unwrap();
            return;
        }
    };

    if hex_str.is_empty() || !hex_str.len().is_multiple_of(2) {
        writeln!(out, "WRITE_ERROR bad_hex_length").unwrap();
        out.flush().unwrap();
        return;
    }

    let mut bytes = Vec::with_capacity(hex_str.len() / 2);
    let mut ok = true;
    for i in (0..hex_str.len()).step_by(2) {
        match u8::from_str_radix(&hex_str[i..i + 2], 16) {
            Ok(b) => bytes.push(b),
            Err(_) => {
                ok = false;
                break;
            }
        }
    }
    if !ok {
        writeln!(out, "WRITE_ERROR bad_hex_digit").unwrap();
        out.flush().unwrap();
        return;
    }

    if offset
        .checked_add(bytes.len())
        .is_none_or(|end| end > region.len())
    {
        writeln!(out, "WRITE_ERROR out_of_bounds").unwrap();
        out.flush().unwrap();
        return;
    }

    region[offset..offset + bytes.len()].copy_from_slice(&bytes);
    writeln!(out, "WROTE {offset}").unwrap();
    out.flush().unwrap();
}

#[cfg(not(windows))]
fn main() {
    eprintln!("solith-scanner-fixture is Windows-only");
    std::process::exit(1);
}
