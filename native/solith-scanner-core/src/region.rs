//! Windows memory-region enumeration.
//!
//! This module owns *enumeration only* — it reports what regions exist and
//! their raw/normalized classification. It does not decide which regions a
//! scan should read; that is `policy.rs`'s job (Stage 1 doc 06 §2.1's
//! enumeration/selection separation, made structural here rather than
//! advisory).

use crate::error::{ErrorKind, ScannerResult};
use crate::target::ProcessHandle;

#[cfg(not(windows))]
use crate::error::ScannerError;

#[cfg(windows)]
use windows_sys::Win32::Foundation::GetLastError;
#[cfg(windows)]
use windows_sys::Win32::System::Memory::{
    VirtualQueryEx, MEMORY_BASIC_INFORMATION, MEM_COMMIT, MEM_FREE, MEM_IMAGE, MEM_MAPPED,
    MEM_PRIVATE, MEM_RESERVE, PAGE_EXECUTE_READ, PAGE_EXECUTE_READWRITE, PAGE_EXECUTE_WRITECOPY,
    PAGE_GUARD, PAGE_NOACCESS, PAGE_READONLY, PAGE_READWRITE, PAGE_WRITECOPY,
};

/// Normalized region backing-type classification. `MEMORY_BASIC_INFORMATION`
/// carries this in its `Type` field, which no current TypeScript
/// implementation reads at all (Stage 1 doc 01 §4/doc 06 §2.1's identified
/// gap) — every writable-committed region is scanned identically regardless
/// of whether it is heap, mapped file, or the executable's own image.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RegionKind {
    /// Backed by an executable/DLL image (`MEM_IMAGE`).
    Image,
    /// Backed by a memory-mapped file (`MEM_MAPPED`).
    Mapped,
    /// Private, non-shared memory — the common case for heap/stack (`MEM_PRIVATE`).
    Private,
    /// State/Type combination not one of the three above (should not occur
    /// for a `MEM_COMMIT` region in practice, but represented explicitly
    /// rather than defaulted, per the "never silently discard region
    /// metadata" requirement).
    Unknown,
}

impl RegionKind {
    fn from_raw_type(raw_type: u32) -> RegionKind {
        match raw_type {
            t if t == MEM_IMAGE => RegionKind::Image,
            t if t == MEM_MAPPED => RegionKind::Mapped,
            t if t == MEM_PRIVATE => RegionKind::Private,
            _ => RegionKind::Unknown,
        }
    }
}

/// Coarse commit state — `MEM_COMMIT`/`MEM_RESERVE`/`MEM_FREE` are
/// preserved distinctly rather than collapsed into a boolean, since a
/// reserved-but-uncommitted region is a materially different thing from a
/// free one for future policy decisions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommitState {
    Committed,
    Reserved,
    Free,
    Unknown,
}

impl CommitState {
    fn from_raw_state(raw_state: u32) -> CommitState {
        match raw_state {
            s if s == MEM_COMMIT => CommitState::Committed,
            s if s == MEM_RESERVE => CommitState::Reserved,
            s if s == MEM_FREE => CommitState::Free,
            _ => CommitState::Unknown,
        }
    }
}

/// One enumerated memory region, with both normalized classification and
/// the raw Win32 flags preserved for diagnostics (per the mission's
/// explicit "do not silently discard region metadata" instruction).
#[derive(Debug, Clone)]
pub struct Region {
    pub base_address: u64,
    pub size: u64,
    pub allocation_base: u64,
    pub commit_state: CommitState,
    pub kind: RegionKind,
    pub is_readable: bool,
    pub is_writable: bool,
    pub is_executable: bool,
    pub is_guard: bool,
    pub is_noaccess: bool,
    /// Raw `Protect` value from `MEMORY_BASIC_INFORMATION`, preserved
    /// verbatim for diagnostics even though `is_readable`/`is_writable`/etc.
    /// already normalize the bits a caller usually needs.
    pub raw_protect: u32,
    /// Raw `Type` value, same rationale as `raw_protect`.
    pub raw_type: u32,
}

fn classify_protection(protect: u32) -> (bool, bool, bool, bool, bool) {
    let is_guard = (protect & PAGE_GUARD) != 0;
    let is_noaccess = (protect & PAGE_NOACCESS) != 0;
    // PAGE_GUARD and PAGE_NOACCESS both mean "not currently readable,"
    // regardless of the base protection bits also present — an allow-list
    // read/write/execute classification below, per Stage 1 doc 06 §2.1's
    // decision to prefer an allow-list (fails safe on an unrecognized
    // future flag combination) over the deny-list style
    // `native-memory-driver.ts` uses today.
    let base = protect & 0xFF; // strip PAGE_GUARD/PAGE_NOCACHE/PAGE_WRITECOMBINE modifier bits
    let is_readable = !is_guard
        && !is_noaccess
        && matches!(
            base,
            PAGE_READONLY
                | PAGE_READWRITE
                | PAGE_WRITECOPY
                | PAGE_EXECUTE_READ
                | PAGE_EXECUTE_READWRITE
                | PAGE_EXECUTE_WRITECOPY
        );
    let is_writable = !is_guard
        && !is_noaccess
        && matches!(
            base,
            PAGE_READWRITE | PAGE_WRITECOPY | PAGE_EXECUTE_READWRITE | PAGE_EXECUTE_WRITECOPY
        );
    let is_executable = !is_guard
        && !is_noaccess
        && matches!(
            base,
            PAGE_EXECUTE_READ | PAGE_EXECUTE_READWRITE | PAGE_EXECUTE_WRITECOPY
        );
    (
        is_readable,
        is_writable,
        is_executable,
        is_guard,
        is_noaccess,
    )
}

/// Result of one enumeration pass: the regions found, plus whether the pass
/// covered the full requested address range. Per the mission's explicit
/// instruction, this must never claim `is_complete: true` when the sweep
/// was cut short for any reason.
#[derive(Debug, Clone)]
pub struct RegionEnumerationResult {
    pub regions: Vec<Region>,
    pub is_complete: bool,
    /// Set when `is_complete` is false — the address at which enumeration
    /// stopped, and why.
    pub stopped_at: Option<u64>,
    pub stop_reason: Option<ErrorKind>,
    /// True iff the stop was due to caller-requested cancellation (Stage 6
    /// §6.5) rather than a genuine enumeration failure — kept as its own
    /// field rather than folded into `stop_reason: Option<ErrorKind>`
    /// because cancellation is not an error, matching how
    /// `ScanCompleteness::Cancelled` is kept distinct from `Failed`.
    pub cancelled: bool,
}

const USER_MODE_ADDRESS_CEILING: u64 = 0x0000_7FFF_FFFF_0000;

/// Enumerates every region in `[start, USER_MODE_ADDRESS_CEILING)` via
/// repeated `VirtualQueryEx` calls, advancing strictly past each returned
/// region so a zero-size or non-advancing result can never spin the loop
/// forever (the mission's explicit "avoid infinite loops" requirement).
#[cfg(windows)]
pub fn enumerate_regions(
    handle: &ProcessHandle,
    start: u64,
) -> ScannerResult<RegionEnumerationResult> {
    enumerate_regions_with_cancellation(handle, start, None)
}

/// Same as [`enumerate_regions`], but checked cooperatively against
/// `cancellation` once per `VirtualQueryEx` iteration (Stage 6 §6.5). The
/// plain `enumerate_regions` above is the unaffected, still-synchronous
/// default every existing caller keeps using; this variant exists for
/// callers (and tests) that want enumeration to stop early on request. See
/// doc 61 for why the current napi `enumerate_regions()` binding remains
/// synchronous and does not yet wire a live JS-facing cancel signal through
/// to this parameter.
#[cfg(windows)]
pub fn enumerate_regions_with_cancellation(
    handle: &ProcessHandle,
    start: u64,
    cancellation: Option<&crate::cancellation::CancellationToken>,
) -> ScannerResult<RegionEnumerationResult> {
    let mut regions = Vec::new();
    let mut address = start;

    loop {
        if let Some(token) = cancellation {
            if token.is_cancelled() {
                return Ok(RegionEnumerationResult {
                    regions,
                    is_complete: false,
                    stopped_at: Some(address),
                    stop_reason: None,
                    cancelled: true,
                });
            }
        }

        if address >= USER_MODE_ADDRESS_CEILING {
            return Ok(RegionEnumerationResult {
                regions,
                is_complete: true,
                stopped_at: None,
                stop_reason: None,
                cancelled: false,
            });
        }

        let mut info: MEMORY_BASIC_INFORMATION = unsafe { std::mem::zeroed() };
        let written = unsafe {
            VirtualQueryEx(
                handle.raw(),
                address as *const core::ffi::c_void,
                &mut info as *mut MEMORY_BASIC_INFORMATION,
                std::mem::size_of::<MEMORY_BASIC_INFORMATION>(),
            )
        };

        if written == 0 {
            // Ambiguous by design: could mean "process exited," "query
            // genuinely failed," or (per Win32 docs) "reached the end of
            // the address space early." Whichever it is, this enumeration
            // pass did NOT cover the full requested range — report that
            // honestly rather than silently treating it as "done." The raw
            // GetLastError() code is intentionally not threaded further
            // here (this path returns Ok with an explicit stop_reason, not
            // Err) — a future diagnostics upgrade can attach it to
            // RegionEnumerationResult if needed.
            let _ = unsafe { GetLastError() };
            let liveness = handle.status();
            let reason = match liveness {
                Ok(crate::target::HandleStatus::Exited) => ErrorKind::TargetExited,
                _ => ErrorKind::RegionEnumerationFailure,
            };
            return Ok(RegionEnumerationResult {
                regions,
                is_complete: false,
                stopped_at: Some(address),
                stop_reason: Some(reason),
                cancelled: false,
            });
        }

        let region_size = info.RegionSize as u64;
        let region_base = info.BaseAddress as u64;

        if region_size == 0 {
            // A zero-size result would not advance `address` and would spin
            // forever — this should not happen per Win32 semantics for a
            // successful VirtualQueryEx call, but is treated as an honest,
            // named stop condition rather than assumed impossible.
            return Ok(RegionEnumerationResult {
                regions,
                is_complete: false,
                stopped_at: Some(address),
                stop_reason: Some(ErrorKind::InternalInvariantViolation),
                cancelled: false,
            });
        }

        let (is_readable, is_writable, is_executable, is_guard, is_noaccess) =
            classify_protection(info.Protect);
        let commit_state = CommitState::from_raw_state(info.State);

        if commit_state != CommitState::Free {
            regions.push(Region {
                base_address: region_base,
                size: region_size,
                allocation_base: info.AllocationBase as u64,
                commit_state,
                kind: RegionKind::from_raw_type(info.Type),
                is_readable,
                is_writable,
                is_executable,
                is_guard,
                is_noaccess,
                raw_protect: info.Protect,
                raw_type: info.Type,
            });
        }

        // Advance strictly past this region. Checked arithmetic: a region
        // reported right at the top of the address space must not wrap
        // `address` back to zero and cause an infinite/duplicate loop.
        address = match region_base.checked_add(region_size) {
            Some(next) if next > region_base => next,
            _ => {
                return Ok(RegionEnumerationResult {
                    regions,
                    is_complete: false,
                    stopped_at: Some(region_base),
                    stop_reason: Some(ErrorKind::AddressOverflow),
                    cancelled: false,
                });
            }
        };
    }
}

#[cfg(not(windows))]
pub fn enumerate_regions(
    _handle: &ProcessHandle,
    _start: u64,
) -> ScannerResult<RegionEnumerationResult> {
    Err(ScannerError::new(
        ErrorKind::UnsupportedArchitecture,
        "region enumeration is Windows-only",
    ))
}
