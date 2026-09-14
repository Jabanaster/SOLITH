//! Typed error hierarchy for the native scanner core.
//!
//! Every fallible operation in this crate returns `Result<T, ScannerError>`
//! rather than a formatted string, so a consumer (the napi adapter, or a
//! Rust test) can branch on a stable, exhaustive `ErrorKind` instead of
//! parsing message text. This is what makes the Phase 1 completeness
//! contract enforceable in Rust's type system rather than a convention a
//! `catch { continue; }` can silently violate (see doc 02's D01/D05 findings
//! in the TypeScript scanner this crate replaces).

use std::fmt;

/// Stable, machine-readable error category. Adding a new call site must map
/// into one of these; it must never introduce a bespoke string-only error.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorKind {
    /// The target process could not be opened, or a handle to it is no
    /// longer valid (distinct from `TargetExited`: this covers "never
    /// available" as well as "handle invalidated for another reason").
    TargetUnavailable,
    /// The target process has exited (confirmed via `GetExitCodeProcess`).
    TargetExited,
    /// The OS denied access to a handle/region/read that would otherwise be
    /// valid (e.g. `PAGE_NOACCESS`, `PAGE_GUARD`, or `ERROR_ACCESS_DENIED`).
    AccessFailure,
    /// Region enumeration (`VirtualQueryEx`) itself failed or returned data
    /// that could not be trusted (e.g. a zero-size region that would loop
    /// forever if advanced upon naively).
    RegionEnumerationFailure,
    /// A read (`ReadProcessMemory`) failed for a reason other than the
    /// specific `AccessFailure`/`TargetExited` cases above.
    ReadFailure,
    /// A caller-supplied configuration value is invalid (e.g. overlap ≥
    /// chunk size, zero chunk size, `min > max`-style misuse).
    InvalidConfiguration,
    /// Address or size arithmetic would overflow `u64`/`usize` if performed;
    /// the operation was refused rather than silently wrapping.
    AddressOverflow,
    /// The target process's architecture (pointer width / WOW64 state)
    /// could not be determined, or is not one this crate supports.
    UnsupportedArchitecture,
    /// An internal invariant was violated (a bug in this crate, not a
    /// runtime/environment condition) — surfaced distinctly so it is never
    /// silently treated as a routine, expected failure.
    InternalInvariantViolation,
    /// A configured resource bound (byte budget, region count, etc.) was
    /// reached. Not itself a failure of the underlying OS operation.
    ResourceExhaustion,
}

impl fmt::Display for ErrorKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            ErrorKind::TargetUnavailable => "target_unavailable",
            ErrorKind::TargetExited => "target_exited",
            ErrorKind::AccessFailure => "access_failure",
            ErrorKind::RegionEnumerationFailure => "region_enumeration_failure",
            ErrorKind::ReadFailure => "read_failure",
            ErrorKind::InvalidConfiguration => "invalid_configuration",
            ErrorKind::AddressOverflow => "address_overflow",
            ErrorKind::UnsupportedArchitecture => "unsupported_architecture",
            ErrorKind::InternalInvariantViolation => "internal_invariant_violation",
            ErrorKind::ResourceExhaustion => "resource_exhaustion",
        };
        f.write_str(s)
    }
}

/// A scanner-core error: a stable `kind` plus a human-readable `message` for
/// logs/diagnostics. `kind` is the contract; `message` is not meant to be
/// parsed by callers.
#[derive(Debug, Clone)]
pub struct ScannerError {
    pub kind: ErrorKind,
    pub message: String,
    /// The OS error code (`GetLastError()`), when the failure originated
    /// from a Win32 call — preserved for diagnostics, never required for
    /// correct behavior (a caller must be able to act on `kind` alone).
    pub os_error_code: Option<u32>,
}

impl ScannerError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            os_error_code: None,
        }
    }

    pub fn with_os_code(kind: ErrorKind, message: impl Into<String>, os_error_code: u32) -> Self {
        Self {
            kind,
            message: message.into(),
            os_error_code: Some(os_error_code),
        }
    }
}

impl fmt::Display for ScannerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.os_error_code {
            Some(code) => write!(f, "{}: {} (os_error={})", self.kind, self.message, code),
            None => write!(f, "{}: {}", self.kind, self.message),
        }
    }
}

impl std::error::Error for ScannerError {}

pub type ScannerResult<T> = Result<T, ScannerError>;
