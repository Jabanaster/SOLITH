//! Process handle lifecycle and target architecture detection.
//!
//! Per the Stage 2 architectural boundary: this module owns only the
//! *mechanics* of holding a process handle and determining its pointer
//! width/WOW64 state. Process identity (executable path, start time,
//! PID-reuse rejection) remains a TypeScript responsibility
//! (`windows-process-identity.ts`, unchanged) — this crate accepts identity
//! hints as opaque, caller-supplied strings purely for diagnostic
//! correlation, and never derives or verifies them itself.

use crate::error::{ErrorKind, ScannerError, ScannerResult};

#[cfg(windows)]
use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, FILETIME, HANDLE, STILL_ACTIVE};
#[cfg(windows)]
use windows_sys::Win32::System::Threading::{
    GetExitCodeProcess, GetProcessTimes, IsWow64Process, OpenProcess,
    PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_VM_OPERATION, PROCESS_VM_READ, PROCESS_VM_WRITE,
};

/// Pointer width of the target process, independent of the host OS's own
/// bitness. A 64-bit Windows host can run 32-bit (WOW64) target processes,
/// whose pointers are 4 bytes at 4-byte-aligned slots — a fact the current
/// TypeScript pointer scanner ignores entirely (Phase 1 Stage 1, P1-SCAN-001).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TargetArchitecture {
    /// Native 64-bit target process (8-byte pointers).
    X64,
    /// 32-bit target process running under WOW64 on a 64-bit host (4-byte
    /// pointers). This is the case P1-SCAN-001 exists to close.
    X86OnWow64,
    /// Architecture could not be determined (e.g. `IsWow64Process` itself
    /// failed). Callers must treat this as "unsupported," never default to
    /// either pointer width silently.
    Unknown,
}

impl TargetArchitecture {
    /// Pointer width in bytes for this architecture, or `None` for `Unknown`
    /// — deliberately not a default, so a caller cannot accidentally assume
    /// 8 bytes for an architecture that was never actually confirmed.
    pub fn pointer_width_bytes(self) -> Option<u8> {
        match self {
            TargetArchitecture::X64 => Some(8),
            TargetArchitecture::X86OnWow64 => Some(4),
            TargetArchitecture::Unknown => None,
        }
    }

    pub fn is_wow64(self) -> bool {
        matches!(self, TargetArchitecture::X86OnWow64)
    }
}

/// Handle/access status of a target — surfaced explicitly rather than
/// folded into a boolean, so a caller can distinguish "never attached,"
/// "attached and alive," and "attached but the process has since exited"
/// without re-deriving it from error strings.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HandleStatus {
    Open,
    Exited,
}

/// A minimal, scan-mechanics-only descriptor for an attached target.
/// `executable_identity_hint`/`process_start_identity_hint` are opaque
/// strings supplied by the TypeScript identity layer (never computed here)
/// purely so diagnostics/logs on the Rust side can be correlated back to a
/// specific attach session without this crate re-implementing identity
/// verification.
#[derive(Debug, Clone)]
pub struct TargetDescriptor {
    pub pid: u32,
    pub architecture: TargetArchitecture,
    pub executable_identity_hint: Option<String>,
    pub process_start_identity_hint: Option<String>,
}

/// RAII wrapper around a Win32 process `HANDLE`. `Drop` always calls
/// `CloseHandle`, so a panic or early `?`-return can never leak a handle —
/// the same discipline already proven in this repo by
/// `native/solith-readonly-scanner/src/main.rs`'s `ProcessHandle`.
#[cfg(windows)]
pub struct ProcessHandle {
    raw: HANDLE,
    pid: u32,
}

#[cfg(windows)]
impl ProcessHandle {
    /// Opens a handle sufficient for read-only scanning mechanics
    /// (`PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ`). Write
    /// access, if ever needed by a future stage, must be requested by a
    /// distinct, explicit constructor — this crate's Stage 2 scope is
    /// read-only region enumeration and chunked reading.
    pub fn open_read_only(pid: u32) -> ScannerResult<Self> {
        let desired_access = PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ;
        let handle = unsafe { OpenProcess(desired_access, 0, pid) };
        if handle.is_null() {
            let code = unsafe { GetLastError() };
            return Err(ScannerError::with_os_code(
                ErrorKind::TargetUnavailable,
                format!("OpenProcess({pid}) failed"),
                code,
            ));
        }
        Ok(Self { raw: handle, pid })
    }

    /// Opens a handle that additionally permits writes
    /// (`PROCESS_VM_WRITE | PROCESS_VM_OPERATION`), for future stages that
    /// need it. Not used by Stage 2's read-only foundation; included now so
    /// the handle-acquisition surface does not need a breaking change later.
    #[allow(dead_code)]
    pub fn open_read_write(pid: u32) -> ScannerResult<Self> {
        let desired_access = PROCESS_QUERY_LIMITED_INFORMATION
            | PROCESS_VM_READ
            | PROCESS_VM_WRITE
            | PROCESS_VM_OPERATION;
        let handle = unsafe { OpenProcess(desired_access, 0, pid) };
        if handle.is_null() {
            let code = unsafe { GetLastError() };
            return Err(ScannerError::with_os_code(
                ErrorKind::TargetUnavailable,
                format!("OpenProcess({pid}, read-write) failed"),
                code,
            ));
        }
        Ok(Self { raw: handle, pid })
    }

    pub fn pid(&self) -> u32 {
        self.pid
    }

    pub fn raw(&self) -> HANDLE {
        self.raw
    }

    /// Re-validates that the process is still running, via
    /// `GetExitCodeProcess`/`STILL_ACTIVE` — the pre-scan liveness check
    /// mandated by Stage 1's design (doc 06 §1.11): a scan must not start
    /// against a handle whose process has already exited.
    pub fn status(&self) -> ScannerResult<HandleStatus> {
        let mut exit_code: u32 = 0;
        let ok = unsafe { GetExitCodeProcess(self.raw, &mut exit_code as *mut u32) };
        if ok == 0 {
            let code = unsafe { GetLastError() };
            return Err(ScannerError::with_os_code(
                ErrorKind::AccessFailure,
                "GetExitCodeProcess failed",
                code,
            ));
        }
        if exit_code == STILL_ACTIVE as u32 {
            Ok(HandleStatus::Open)
        } else {
            Ok(HandleStatus::Exited)
        }
    }

    /// Detects the target's pointer width / WOW64 state via
    /// `IsWow64Process`. `IsWow64Process2` (which also reports the *host*
    /// architecture, useful on ARM64 Windows) is a reasonable future
    /// upgrade; `IsWow64Process` alone is sufficient to answer "is this
    /// target 32-bit on a 64-bit host," which is the concrete question
    /// P1-SCAN-001 needs answered, and it is supported back to Windows XP
    /// SP2 with no additional feature-detection complexity.
    pub fn detect_architecture(&self) -> ScannerResult<TargetArchitecture> {
        let mut is_wow64: i32 = 0;
        let ok = unsafe { IsWow64Process(self.raw, &mut is_wow64 as *mut i32) };
        if ok == 0 {
            let code = unsafe { GetLastError() };
            return Err(ScannerError::with_os_code(
                ErrorKind::UnsupportedArchitecture,
                "IsWow64Process failed",
                code,
            ));
        }
        if is_wow64 != 0 {
            Ok(TargetArchitecture::X86OnWow64)
        } else {
            // On a 64-bit host, IsWow64Process returning FALSE means the
            // target is itself 64-bit. (This crate is built only for
            // x86_64-pc-windows-msvc per doc 06 §1.12 — a 32-bit *host*
            // running a 32-bit target, where both sides report non-WOW64,
            // is out of scope, matching the project's Windows x64-only
            // packaging target.)
            Ok(TargetArchitecture::X64)
        }
    }

    /// Captures the target's process creation time as a raw 64-bit
    /// `FILETIME` value via `GetProcessTimes` — the strongest reliable
    /// per-process identity value this crate can obtain (Stage 4 mission
    /// §4.2), used alongside the PID to build a `ProcessIdentity` at scan
    /// session creation. `GetProcessTimes` is queried on this handle's own
    /// held `HANDLE`, which Windows keeps bound to the exact kernel process
    /// object it was opened against for the handle's entire lifetime — a
    /// PID being reused by an unrelated process the instant the original
    /// exits can never cause this same handle to silently start reading the
    /// new process's memory (see `session.rs`'s module doc for the full
    /// stale-target argument this fact underpins).
    pub fn process_creation_time_filetime(&self) -> ScannerResult<u64> {
        let mut creation: FILETIME = unsafe { std::mem::zeroed() };
        let mut exit: FILETIME = unsafe { std::mem::zeroed() };
        let mut kernel: FILETIME = unsafe { std::mem::zeroed() };
        let mut user: FILETIME = unsafe { std::mem::zeroed() };
        let ok = unsafe {
            GetProcessTimes(
                self.raw,
                &mut creation as *mut FILETIME,
                &mut exit as *mut FILETIME,
                &mut kernel as *mut FILETIME,
                &mut user as *mut FILETIME,
            )
        };
        if ok == 0 {
            let code = unsafe { GetLastError() };
            return Err(ScannerError::with_os_code(
                ErrorKind::AccessFailure,
                "GetProcessTimes failed",
                code,
            ));
        }
        Ok(((creation.dwHighDateTime as u64) << 32) | creation.dwLowDateTime as u64)
    }

    pub fn describe(
        &self,
        executable_identity_hint: Option<String>,
        process_start_identity_hint: Option<String>,
    ) -> ScannerResult<TargetDescriptor> {
        let architecture = self.detect_architecture()?;
        Ok(TargetDescriptor {
            pid: self.pid,
            architecture,
            executable_identity_hint,
            process_start_identity_hint,
        })
    }
}

#[cfg(windows)]
impl Drop for ProcessHandle {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.raw);
        }
    }
}

// ProcessHandle deliberately does not implement Clone/Copy: exactly one
// owner must be responsible for CloseHandle. A caller needing to share
// access across the napi async-task boundary wraps it in an Arc/Mutex at
// that layer, not by duplicating the raw HANDLE here.
#[cfg(windows)]
unsafe impl Send for ProcessHandle {}
