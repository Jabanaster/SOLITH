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
//!   before triggering a re-read/refine. The hex-decode buffer is scrubbed
//!   before it drops, so a planted pattern exists exactly once in this
//!   process and an AOB scan's first match is genuinely the planted one.
//! - `writefar <decimal_offset> <hex_le_bytes>` -> identical, but targets
//!   `PATTERN_REGION` (8 MiB) instead of `REFINE_REGION` (64 KiB), so a test
//!   can plant a signature beyond the legacy 1 MiB read ceiling.
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
    VirtualAlloc, VirtualFree, VirtualProtect, MEM_COMMIT, MEM_DECOMMIT, MEM_RELEASE, MEM_RESERVE,
    PAGE_NOACCESS, PAGE_READWRITE,
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

// ── Stage 6 (mission §6.16/§6.17): a dedicated region the parent test
// process can mutate at the OS level — change protection, decommit,
// recommit, or fully free (make it "disappear") — while a real scan is
// in-flight, proving truthful completeness/no-crash behavior under real
// region mutation rather than a synthetic/mocked region-state change.
// Starts fully committed, readable/writable, with a known marker planted.
const MUTATION_REGION_SIZE: usize = 3 * 4096; // 3 pages, matching GUARD_REGION's shape
const MUTATION_MARKER_OFFSET: usize = 4096; // middle page, mirroring GUARD's layout
const MUTATION_MARKER_PATTERN: [u8; 4] = [0xAA, 0xBB, 0xCC, 0xDD];

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

// ── Stage 5 (mission §5.13): string/byte/AOB test content. 8 MiB so four
// chunk-boundary offsets (at the 1×/3×/5×/7× 1 MiB marks, matching
// ChunkPlanConfig::default_for_testing()'s 1 MiB chunk size) each have
// comfortable room on both sides, and a "beyond old 1 MiB cap" marker can
// sit safely mid-region.
const PATTERN_REGION_SIZE: usize = 8 * 1024 * 1024;

const UTF8_ASCII_OFFSET: usize = 64;
const UTF8_ASCII_TEXT: &str = "PlayerHealth100";
const UTF8_MULTIBYTE_OFFSET: usize = 256;
// Real multibyte UTF-8: Latin-1-supplement accents, a Cyrillic word, and a
// CJK word — exercises 2-byte, (Cyrillic, 2-byte) and 3-byte UTF-8 sequences
// in one fixture string (mission §5.2's "multibyte UTF-8" requirement).
const UTF8_MULTIBYTE_TEXT: &str =
    "café \u{041F}\u{0440}\u{0438}\u{0432}\u{0435}\u{0442} \u{65E5}\u{672C}\u{8A9E}";
const UTF16LE_OFFSET: usize = 512;
const UTF16LE_TEXT: &str = "ScoreValue";
const UTF16LE_NONBMP_OFFSET: usize = 768;
// Contains a real non-BMP character (U+1F600 GRINNING FACE), requiring a
// genuine UTF-16 surrogate pair — mission §5.2's "surrogate pairs / non-BMP
// characters" requirement.
const UTF16LE_NONBMP_TEXT: &str = "Win\u{1F600}!";

const RAW_BYTES_OFFSET: usize = 1024;
const RAW_BYTES_PATTERN: [u8; 6] = [0x13, 0x37, 0xC0, 0xDE, 0x99, 0x88];
const RAW_BYTES_DUPLICATE_OFFSET: usize = 200_000; // far from the first occurrence

const AOB_EXACT_OFFSET: usize = 2048;
const AOB_EXACT_PATTERN: [u8; 8] = [0x48, 0x8B, 0x05, 0x11, 0x22, 0x33, 0x44, 0x89];
const AOB_WILDCARD_OFFSET: usize = 2112;
// Same structural bytes as AOB_EXACT_PATTERN but with a DIFFERENT marker
// byte at the position the test's query pattern wildcards out — proves the
// wildcard genuinely ignores content rather than coincidentally matching an
// identical value.
const AOB_WILDCARD_PATTERN: [u8; 8] = [0x48, 0x8B, 0x05, 0xFF, 0x22, 0x33, 0x44, 0x89];
const AOB_NIBBLE_OFFSET: usize = 2176;
// Plant A7/00/B3 so a nibble-wildcard query "A? 00 ?3" matches (high
// nibble A / low nibble 3 fixed) while an exact "A7 00 B3" query also still
// matches — proves the nibble mask ignores exactly the wildcarded nibble.
const AOB_NIBBLE_PATTERN: [u8; 3] = [0xA7, 0x00, 0xB3];

const NEAR_MISS_OFFSET: usize = 2240;
// Differs from RAW_BYTES_PATTERN by exactly the last byte — proves no
// false positive from almost-matching noise.
const NEAR_MISS_PATTERN: [u8; 6] = [0x13, 0x37, 0xC0, 0xDE, 0x99, 0x77];

// Chunk-boundary-straddling patterns (mission §5.7): each offset is chosen
// so the pattern of that exact length straddles a 1 MiB chunk boundary
// under the default 1 MiB/7-byte-overlap test config — analogous to
// TYPES_REGION's BOUNDARY_U16/U32/U64 offsets above, extended to Stage 5's
// variable-length patterns (2/8/16-as-string/32-as-wildcard-capable bytes).
const PATTERN_BOUNDARY_2_OFFSET: usize = 1_048_576 - 1;
const PATTERN_BOUNDARY_2: [u8; 2] = [0xAB, 0xCD];
const PATTERN_BOUNDARY_8_OFFSET: usize = 3 * 1_048_576 - 4;
const PATTERN_BOUNDARY_8: [u8; 8] = [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08];
const PATTERN_BOUNDARY_STRING_OFFSET: usize = 5 * 1_048_576 - 8;
const PATTERN_BOUNDARY_STRING_TEXT: &str = "STRADDLE16CHARS!"; // exactly 16 bytes
const PATTERN_BOUNDARY_32_OFFSET: usize = 7 * 1_048_576 - 16;
const PATTERN_BOUNDARY_32: [u8; 32] = [
    0xF0, 0xF1, 0xF2, 0xF3, 0xF4, 0xF5, 0xF6, 0xF7, 0xF8, 0xF9, 0xFA, 0xFB, 0xFC, 0xFD, 0xFE, 0xFF,
    0xE0, 0xE1, 0xE2, 0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA, 0xEB, 0xEC, 0xED, 0xEE, 0xEF,
];

// Well beyond the old 1 MiB cap and beyond every chunk-boundary offset
// above — proves the native path finds a signature no matter how deep into
// a large region it sits (mission §5.14).
const FAR_MARKER_OFFSET: usize = 6_291_456; // 6 MiB
const FAR_MARKER_PATTERN: [u8; 5] = [0xDE, 0xAD, 0xC0, 0xDE, 0x42];

// Planted *inside* GUARD_REGION_SIZE's PAGE_NOACCESS middle page (written
// before VirtualProtect is applied): real bytes exist there, but they
// become unreadable once protected — proving "zero matches + incomplete
// coverage != authoritative not found" (mission §5.11/§5.14) against a real
// OS-level unreadable page, not a simulated one.
const GUARD_HIDDEN_PATTERN_OFFSET: usize = GUARD_NOACCESS_PAGE_OFFSET + 100;
const GUARD_HIDDEN_PATTERN: [u8; 4] = [0x5E, 0xC4, 0x37, 0x21];

// -- Phase 1 final closure (D05, mission §13): a real module-rooted pointer
// chain in a real process.
//
//   POINTER_ROOT (this binary's own .data, i.e. inside the module range)
//     -> NODE1 -> NODE2 -> NODE3 -> the target value
//
// Each node lives in its own VirtualAlloc'd region so the reverse traversal
// has to cross three genuine region boundaries rather than walking within one
// buffer. The value sits at POINTER_TARGET_OFFSET inside NODE3, so a correct
// depth-3 path is `[0, 0, POINTER_TARGET_OFFSET]`.
//
// `POINTER_ROOT` must live in the image, not in a VirtualAlloc region: the
// scanner only calls a hit a stable path root when the address holding the
// pointer falls inside a loaded module, which is the entire point of the
// "module + offset chain" output. An atomic is used rather than `static mut`
// so writing it needs no `unsafe` and no pointer-to-static lint exception.
const POINTER_NODE_SIZE: usize = 4096;
const POINTER_TARGET_OFFSET: usize = 16;
const POINTER_TARGET_VALUE: u32 = 0x5A5A_1234;
// A second slot in NODE1 pointing at NODE2, and a slot in NODE2 pointing back
// at NODE1, so the live process really does contain a pointer cycle for the
// traversal to survive (mission §11) rather than a synthetic one.
//
// The cycle is deliberately placed BETWEEN adjacent links rather than across
// them: an earlier revision put it on NODE1 -> NODE3, which created a genuine
// two-edge shortcut from the module root to the target and made the chain's
// nominal depth-3 path no longer the shortest one.
const POINTER_CYCLE_OFFSET: usize = 32;
static POINTER_ROOT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

// -- Phase 2 P2-2 (mission §15): a second, wholly independent module-rooted
// pointer chain in the same real process, so a real multi-target
// scanTargetsIntoMap([A, B]) run has two genuine, unrelated targets to
// resolve rather than two views of the same one. Deliberately depth-1
// (POINTER_ROOT_B -> NODE_B1 -> value) rather than mirroring Target A's
// depth-3/cycle shape — the point of Target B is independence, not
// duplicating coverage §11/§13 already have.
const POINTER_B_TARGET_VALUE: u32 = 0xB0B0_5678;
static POINTER_ROOT_B: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

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

    // Optional second CLI arg (P2-3.1 §8 real-process cancellation proof):
    // plant this many small, separately-VirtualAlloc'd "noise" regions. A
    // single findPointersNear() call scans every committed region in the
    // process once per BFS frontier item; a real large game process has
    // thousands of small individual heap allocations (allocator arenas,
    // per-object headers, etc.), and the resulting many-small-regions shape
    // adds real, non-simulated wall-clock latency dominated by per-region
    // native round-trip overhead rather than raw memory bandwidth. This lets
    // a real-process E2E test observe (and genuinely interrupt) an in-flight
    // scan without any timing hack in the product code being tested.
    let noise_region_count: Option<usize> = std::env::args().nth(2).and_then(|s| s.parse().ok());
    if let Some(count) = noise_region_count {
        const NOISE_REGION_SIZE: usize = 64 * 1024;
        for i in 0..count {
            let region = unsafe {
                VirtualAlloc(
                    std::ptr::null(),
                    NOISE_REGION_SIZE,
                    MEM_COMMIT | MEM_RESERVE,
                    PAGE_READWRITE,
                )
            };
            assert!(!region.is_null(), "VirtualAlloc(noise_region) failed");
            unsafe {
                let slice = std::slice::from_raw_parts_mut(region as *mut u8, NOISE_REGION_SIZE);
                for (j, b) in slice.iter_mut().enumerate() {
                    *b = ((i as u32).wrapping_mul(2246822519).wrapping_add(j as u32) >> 16) as u8;
                }
            }
        }
        println!("NOISE_REGION_COUNT={count}");
        println!("NOISE_REGION_SIZE={NOISE_REGION_SIZE}");
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

    unsafe {
        let slice = std::slice::from_raw_parts_mut(guard_region as *mut u8, GUARD_REGION_SIZE);
        slice[GUARD_HIDDEN_PATTERN_OFFSET..GUARD_HIDDEN_PATTERN_OFFSET + 4]
            .copy_from_slice(&GUARD_HIDDEN_PATTERN);
    }

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

    let mutation_region = unsafe {
        VirtualAlloc(
            std::ptr::null(),
            MUTATION_REGION_SIZE,
            MEM_COMMIT | MEM_RESERVE,
            PAGE_READWRITE,
        )
    };
    assert!(
        !mutation_region.is_null(),
        "VirtualAlloc(mutation_region) failed"
    );
    let mutation_base = mutation_region as usize;

    // -- D05 pointer chain: three separately-allocated nodes, rooted in .data.
    let mut pointer_nodes: [usize; 3] = [0; 3];
    for node in pointer_nodes.iter_mut() {
        let region = unsafe {
            VirtualAlloc(
                std::ptr::null(),
                POINTER_NODE_SIZE,
                MEM_COMMIT | MEM_RESERVE,
                PAGE_READWRITE,
            )
        };
        assert!(!region.is_null(), "VirtualAlloc(pointer_node) failed");
        unsafe {
            std::ptr::write_bytes(region as *mut u8, 0, POINTER_NODE_SIZE);
        }
        *node = region as usize;
    }
    unsafe {
        // NODE1[0] -> NODE2, NODE2[0] -> NODE3, NODE3[+16] = the value.
        std::ptr::write_unaligned(pointer_nodes[0] as *mut u64, pointer_nodes[1] as u64);
        std::ptr::write_unaligned(pointer_nodes[1] as *mut u64, pointer_nodes[2] as u64);
        std::ptr::write_unaligned(
            (pointer_nodes[2] + POINTER_TARGET_OFFSET) as *mut u32,
            POINTER_TARGET_VALUE,
        );
        // The cycle: NODE1 -> NODE2 and NODE2 -> NODE1.
        std::ptr::write_unaligned(
            (pointer_nodes[0] + POINTER_CYCLE_OFFSET) as *mut u64,
            pointer_nodes[1] as u64,
        );
        std::ptr::write_unaligned(
            (pointer_nodes[1] + POINTER_CYCLE_OFFSET) as *mut u64,
            pointer_nodes[0] as u64,
        );
    }
    POINTER_ROOT.store(pointer_nodes[0] as u64, std::sync::atomic::Ordering::SeqCst);

    // -- P2-2 Target B: independent single-node chain.
    let pointer_node_b = unsafe {
        VirtualAlloc(
            std::ptr::null(),
            POINTER_NODE_SIZE,
            MEM_COMMIT | MEM_RESERVE,
            PAGE_READWRITE,
        )
    };
    assert!(!pointer_node_b.is_null(), "VirtualAlloc(pointer_node_b) failed");
    unsafe {
        std::ptr::write_bytes(pointer_node_b as *mut u8, 0, POINTER_NODE_SIZE);
        std::ptr::write_unaligned(
            (pointer_node_b as usize + POINTER_TARGET_OFFSET) as *mut u32,
            POINTER_B_TARGET_VALUE,
        );
    }
    POINTER_ROOT_B.store(pointer_node_b as u64, std::sync::atomic::Ordering::SeqCst);
    let pointer_root_b_addr = &POINTER_ROOT_B as *const _ as usize;
    let pointer_root_addr = &POINTER_ROOT as *const _ as usize;
    unsafe {
        let slice =
            std::slice::from_raw_parts_mut(mutation_region as *mut u8, MUTATION_REGION_SIZE);
        slice[MUTATION_MARKER_OFFSET..MUTATION_MARKER_OFFSET + MUTATION_MARKER_PATTERN.len()]
            .copy_from_slice(&MUTATION_MARKER_PATTERN);
    }

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

    let pattern_region = unsafe {
        VirtualAlloc(
            std::ptr::null(),
            PATTERN_REGION_SIZE,
            MEM_COMMIT | MEM_RESERVE,
            PAGE_READWRITE,
        )
    };
    assert!(
        !pattern_region.is_null(),
        "VirtualAlloc(pattern_region) failed"
    );
    let pattern_base = pattern_region as usize;

    unsafe {
        let slice = std::slice::from_raw_parts_mut(pattern_region as *mut u8, PATTERN_REGION_SIZE);
        for (i, b) in slice.iter_mut().enumerate() {
            *b = ((i as u32).wrapping_mul(0x85EBCA6B) >> 22) as u8;
        }

        let utf8_ascii = UTF8_ASCII_TEXT.as_bytes();
        slice[UTF8_ASCII_OFFSET..UTF8_ASCII_OFFSET + utf8_ascii.len()].copy_from_slice(utf8_ascii);
        let utf8_multibyte = UTF8_MULTIBYTE_TEXT.as_bytes();
        slice[UTF8_MULTIBYTE_OFFSET..UTF8_MULTIBYTE_OFFSET + utf8_multibyte.len()]
            .copy_from_slice(utf8_multibyte);
        let mut utf16le: Vec<u8> = Vec::new();
        for unit in UTF16LE_TEXT.encode_utf16() {
            utf16le.extend_from_slice(&unit.to_le_bytes());
        }
        slice[UTF16LE_OFFSET..UTF16LE_OFFSET + utf16le.len()].copy_from_slice(&utf16le);
        let mut utf16le_nonbmp: Vec<u8> = Vec::new();
        for unit in UTF16LE_NONBMP_TEXT.encode_utf16() {
            utf16le_nonbmp.extend_from_slice(&unit.to_le_bytes());
        }
        slice[UTF16LE_NONBMP_OFFSET..UTF16LE_NONBMP_OFFSET + utf16le_nonbmp.len()]
            .copy_from_slice(&utf16le_nonbmp);

        slice[RAW_BYTES_OFFSET..RAW_BYTES_OFFSET + RAW_BYTES_PATTERN.len()]
            .copy_from_slice(&RAW_BYTES_PATTERN);
        slice[RAW_BYTES_DUPLICATE_OFFSET..RAW_BYTES_DUPLICATE_OFFSET + RAW_BYTES_PATTERN.len()]
            .copy_from_slice(&RAW_BYTES_PATTERN);

        slice[AOB_EXACT_OFFSET..AOB_EXACT_OFFSET + AOB_EXACT_PATTERN.len()]
            .copy_from_slice(&AOB_EXACT_PATTERN);
        slice[AOB_WILDCARD_OFFSET..AOB_WILDCARD_OFFSET + AOB_WILDCARD_PATTERN.len()]
            .copy_from_slice(&AOB_WILDCARD_PATTERN);
        slice[AOB_NIBBLE_OFFSET..AOB_NIBBLE_OFFSET + AOB_NIBBLE_PATTERN.len()]
            .copy_from_slice(&AOB_NIBBLE_PATTERN);
        slice[NEAR_MISS_OFFSET..NEAR_MISS_OFFSET + NEAR_MISS_PATTERN.len()]
            .copy_from_slice(&NEAR_MISS_PATTERN);

        slice[PATTERN_BOUNDARY_2_OFFSET..PATTERN_BOUNDARY_2_OFFSET + PATTERN_BOUNDARY_2.len()]
            .copy_from_slice(&PATTERN_BOUNDARY_2);
        slice[PATTERN_BOUNDARY_8_OFFSET..PATTERN_BOUNDARY_8_OFFSET + PATTERN_BOUNDARY_8.len()]
            .copy_from_slice(&PATTERN_BOUNDARY_8);
        let boundary_string = PATTERN_BOUNDARY_STRING_TEXT.as_bytes();
        slice[PATTERN_BOUNDARY_STRING_OFFSET
            ..PATTERN_BOUNDARY_STRING_OFFSET + boundary_string.len()]
            .copy_from_slice(boundary_string);
        slice[PATTERN_BOUNDARY_32_OFFSET..PATTERN_BOUNDARY_32_OFFSET + PATTERN_BOUNDARY_32.len()]
            .copy_from_slice(&PATTERN_BOUNDARY_32);

        slice[FAR_MARKER_OFFSET..FAR_MARKER_OFFSET + FAR_MARKER_PATTERN.len()]
            .copy_from_slice(&FAR_MARKER_PATTERN);
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
    writeln!(out, "PATTERN_REGION_BASE=0x{pattern_base:x}").unwrap();
    writeln!(out, "PATTERN_REGION_SIZE={PATTERN_REGION_SIZE}").unwrap();
    writeln!(out, "UTF8_ASCII_OFFSET={UTF8_ASCII_OFFSET}").unwrap();
    writeln!(out, "UTF8_ASCII_TEXT={UTF8_ASCII_TEXT}").unwrap();
    writeln!(out, "UTF8_MULTIBYTE_OFFSET={UTF8_MULTIBYTE_OFFSET}").unwrap();
    writeln!(out, "UTF16LE_OFFSET={UTF16LE_OFFSET}").unwrap();
    writeln!(out, "UTF16LE_TEXT={UTF16LE_TEXT}").unwrap();
    writeln!(out, "UTF16LE_NONBMP_OFFSET={UTF16LE_NONBMP_OFFSET}").unwrap();
    writeln!(out, "RAW_BYTES_OFFSET={RAW_BYTES_OFFSET}").unwrap();
    writeln!(
        out,
        "RAW_BYTES_DUPLICATE_OFFSET={RAW_BYTES_DUPLICATE_OFFSET}"
    )
    .unwrap();
    writeln!(out, "AOB_EXACT_OFFSET={AOB_EXACT_OFFSET}").unwrap();
    writeln!(out, "AOB_WILDCARD_OFFSET={AOB_WILDCARD_OFFSET}").unwrap();
    writeln!(out, "AOB_NIBBLE_OFFSET={AOB_NIBBLE_OFFSET}").unwrap();
    writeln!(out, "NEAR_MISS_OFFSET={NEAR_MISS_OFFSET}").unwrap();
    writeln!(out, "PATTERN_BOUNDARY_2_OFFSET={PATTERN_BOUNDARY_2_OFFSET}").unwrap();
    writeln!(out, "PATTERN_BOUNDARY_8_OFFSET={PATTERN_BOUNDARY_8_OFFSET}").unwrap();
    writeln!(
        out,
        "PATTERN_BOUNDARY_STRING_OFFSET={PATTERN_BOUNDARY_STRING_OFFSET}"
    )
    .unwrap();
    writeln!(
        out,
        "PATTERN_BOUNDARY_STRING_TEXT={PATTERN_BOUNDARY_STRING_TEXT}"
    )
    .unwrap();
    writeln!(
        out,
        "PATTERN_BOUNDARY_32_OFFSET={PATTERN_BOUNDARY_32_OFFSET}"
    )
    .unwrap();
    writeln!(out, "FAR_MARKER_OFFSET={FAR_MARKER_OFFSET}").unwrap();
    writeln!(
        out,
        "GUARD_HIDDEN_PATTERN_OFFSET={GUARD_HIDDEN_PATTERN_OFFSET}"
    )
    .unwrap();
    writeln!(out, "POINTER_ROOT_ADDRESS=0x{pointer_root_addr:x}").unwrap();
    writeln!(out, "POINTER_NODE1_BASE=0x{:x}", pointer_nodes[0]).unwrap();
    writeln!(out, "POINTER_NODE2_BASE=0x{:x}", pointer_nodes[1]).unwrap();
    writeln!(out, "POINTER_NODE3_BASE=0x{:x}", pointer_nodes[2]).unwrap();
    writeln!(out, "POINTER_NODE_SIZE={POINTER_NODE_SIZE}").unwrap();
    writeln!(out, "POINTER_TARGET_OFFSET={POINTER_TARGET_OFFSET}").unwrap();
    writeln!(out, "POINTER_TARGET_VALUE=0x{POINTER_TARGET_VALUE:x}").unwrap();
    writeln!(out, "POINTER_CYCLE_OFFSET={POINTER_CYCLE_OFFSET}").unwrap();
    writeln!(out, "POINTER_ROOT_B_ADDRESS=0x{pointer_root_b_addr:x}").unwrap();
    writeln!(out, "POINTER_NODE_B1_BASE=0x{:x}", pointer_node_b as usize).unwrap();
    writeln!(out, "POINTER_B_TARGET_VALUE=0x{POINTER_B_TARGET_VALUE:x}").unwrap();
    writeln!(out, "MUTATION_REGION_BASE=0x{mutation_base:x}").unwrap();
    writeln!(out, "MUTATION_REGION_SIZE={MUTATION_REGION_SIZE}").unwrap();
    writeln!(out, "MUTATION_MARKER_OFFSET={MUTATION_MARKER_OFFSET}").unwrap();
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
    // Stage 7.5 - the same mutable view over PATTERN_REGION, so a test can
    // plant a long, genuinely distinctive signature *past* the legacy 1 MiB
    // readBuffer ceiling. REFINE_REGION is only 64 KiB, which is entirely
    // legacy-reachable and therefore cannot demonstrate the cap at all; the
    // fixture's own pre-planted FAR_MARKER_PATTERN is only 5 bytes, which is
    // too short to be unique under drift tolerance (a 5-byte pattern with a
    // one-substitution budget matches coincidentally in a real process).
    let pattern_slice =
        unsafe { std::slice::from_raw_parts_mut(pattern_region as *mut u8, PATTERN_REGION_SIZE) };

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
                } else if let Some(rest) = cmd.strip_prefix("writefar ") {
                    apply_write_command(pattern_slice, rest, &mut out);
                } else if let Some(rest) = cmd.strip_prefix("protect_mutation ") {
                    apply_protect_mutation_command(mutation_region, rest, &mut out);
                } else if cmd == "decommit_mutation" {
                    apply_decommit_mutation_command(mutation_region, &mut out);
                } else if cmd == "recommit_mutation" {
                    apply_recommit_mutation_command(mutation_region, &mut out);
                } else if cmd == "free_mutation" {
                    apply_free_mutation_command(mutation_region, &mut out);
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

    // Stage 7.5 - scrub the decode buffer before it drops.
    //
    // This `bytes` Vec is a second, heap-resident copy of exactly the byte
    // sequence the caller just planted, and it sits at a LOWER address than
    // the VirtualAlloc'd regions above. Any AOB scan over this process uses
    // first-match-in-ascending-address-order semantics, so without this scrub
    // a scanner legitimately returns the heap copy rather than the planted
    // one - and a test asserting "the planted address" fails through no fault
    // of the scanner. Leaving the bytes behind after the Vec drops is just as
    // bad: freed heap memory is still committed, still readable, and still
    // matches. Zero it while it is still owned, and keep the write from being
    // optimized away.
    bytes.fill(0);
    std::hint::black_box(&bytes);

    writeln!(out, "WROTE {offset}").unwrap();
    out.flush().unwrap();
}

/// Stage 6 §6.16/§6.17 region-mutation commands. Each acts on the whole
/// `MUTATION_REGION_SIZE`-byte allocation starting at `region`, at the real
/// OS level (`VirtualProtect`/`VirtualFree`), so a concurrently-running real
/// scan observes a genuine, real protection/commit-state change — not a
/// simulated one.
#[cfg(windows)]
fn apply_protect_mutation_command(
    region: *mut core::ffi::c_void,
    rest: &str,
    out: &mut impl Write,
) {
    let flag = match rest.trim() {
        "readwrite" => PAGE_READWRITE,
        "noaccess" => PAGE_NOACCESS,
        other => {
            writeln!(out, "PROTECT_ERROR unknown_flag_{other}").unwrap();
            out.flush().unwrap();
            return;
        }
    };
    let mut old_protect: u32 = 0;
    let ok = unsafe {
        VirtualProtect(
            region,
            MUTATION_REGION_SIZE,
            flag,
            &mut old_protect as *mut u32,
        )
    };
    if ok == 0 {
        writeln!(out, "PROTECT_ERROR virtual_protect_failed").unwrap();
    } else {
        writeln!(out, "PROTECTED {}", rest.trim()).unwrap();
    }
    out.flush().unwrap();
}

#[cfg(windows)]
fn apply_decommit_mutation_command(region: *mut core::ffi::c_void, out: &mut impl Write) {
    let ok = unsafe { VirtualFree(region, MUTATION_REGION_SIZE, MEM_DECOMMIT) };
    if ok == 0 {
        writeln!(out, "DECOMMIT_ERROR virtual_free_failed").unwrap();
    } else {
        writeln!(out, "DECOMMITTED").unwrap();
    }
    out.flush().unwrap();
}

#[cfg(windows)]
fn apply_recommit_mutation_command(region: *mut core::ffi::c_void, out: &mut impl Write) {
    // Re-commit at the SAME address (the reservation from the original
    // VirtualAlloc(MEM_RESERVE) survives a MEM_DECOMMIT, only MEM_RELEASE
    // would give the address back to the OS) and replant the known marker
    // so a test can prove recommit genuinely restores a writable, readable
    // page, not just that the call returned success.
    let recommitted =
        unsafe { VirtualAlloc(region, MUTATION_REGION_SIZE, MEM_COMMIT, PAGE_READWRITE) };
    if recommitted.is_null() {
        writeln!(out, "RECOMMIT_ERROR virtual_alloc_failed").unwrap();
        out.flush().unwrap();
        return;
    }
    unsafe {
        let slice = std::slice::from_raw_parts_mut(region as *mut u8, MUTATION_REGION_SIZE);
        slice[MUTATION_MARKER_OFFSET..MUTATION_MARKER_OFFSET + MUTATION_MARKER_PATTERN.len()]
            .copy_from_slice(&MUTATION_MARKER_PATTERN);
    }
    writeln!(out, "RECOMMITTED").unwrap();
    out.flush().unwrap();
}

#[cfg(windows)]
fn apply_free_mutation_command(region: *mut core::ffi::c_void, out: &mut impl Write) {
    // MEM_RELEASE requires size 0 and frees the entire reservation — the
    // region genuinely disappears from the address space from this point
    // on (a subsequent VirtualQueryEx sees MEM_FREE, not merely decommitted).
    let ok = unsafe { VirtualFree(region, 0, MEM_RELEASE) };
    if ok == 0 {
        writeln!(out, "FREE_ERROR virtual_free_failed").unwrap();
    } else {
        writeln!(out, "FREED").unwrap();
    }
    out.flush().unwrap();
}

#[cfg(not(windows))]
fn main() {
    eprintln!("solith-scanner-fixture is Windows-only");
    std::process::exit(1);
}
