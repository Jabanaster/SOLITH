//! `solith-scanner-napi` — thin napi-rs adapter exposing
//! `solith-scanner-core`'s scanner mechanics to Electron/Node for SOLITH
//! Phase 1 (Stage 2: native scanner foundation).
//!
//! Responsibilities, per the Stage 2 architectural boundary: JS/TS type
//! conversion, BigInt conversion, async task scheduling, cancellation and
//! progress plumbing, and mapping `ScannerResult`/`ScanCompleteness` into
//! JS-friendly shapes. No scanner algorithm lives in this crate — every
//! function here is a thin wrapper delegating to `solith_scanner_core`.
//!
//! Error contract: a thrown JS error's `message` is always formatted as
//! `"<stable_error_kind>: <human-readable detail>"`, where
//! `<stable_error_kind>` is one of `solith_scanner_core::ErrorKind`'s
//! `Display` strings (e.g. `target_exited`, `access_failure`). TypeScript
//! callers should parse the substring before the first `": "` as the
//! stable, machine-readable code — never pattern-match on the human-readable
//! detail, which may change wording between versions.

#![deny(clippy::all)]

use std::sync::{Arc, Mutex};

use napi::bindgen_prelude::*;
use napi_derive::napi;

use solith_scanner_core::cancellation::CancellationToken;
use solith_scanner_core::completeness::{ScanCompleteness, ScanMetrics, SkipReason, SkippedRange};
use solith_scanner_core::error::ScannerError;
use solith_scanner_core::exact_scan::{
    scan_exact, AlignmentMode, ScanMatch as CoreScanMatch, ScanOptions,
};
use solith_scanner_core::pattern::{
    parse_aob, pattern_from_raw_bytes, pattern_from_utf16le_str, pattern_from_utf8_str,
    NullTerminatorMode, Pattern, PatternKind, PatternParseError,
};
use solith_scanner_core::pattern_scan::{
    scan_pattern, PatternMatch as CorePatternMatch, PatternScanOptions,
};
use solith_scanner_core::policy::RegionSelectionPolicy;
use solith_scanner_core::reader::{
    read_region_chunked_with_progress, ChunkReadResult, ChunkReadStatus, ReadBudget,
};
use solith_scanner_core::region::{enumerate_regions, CommitState, Region, RegionKind};
use solith_scanner_core::session::{
    GenerationRecord, RefineMode, ScanSession as CoreScanSession, SessionResourceLimits,
};
use solith_scanner_core::target::{ProcessHandle, TargetArchitecture};
use solith_scanner_core::types::{PrimitiveType, PrimitiveValue};
use solith_scanner_core::ChunkPlanConfig;

fn to_napi_err(e: ScannerError) -> Error {
    Error::new(Status::GenericFailure, format!("{e}"))
}

fn detached_err() -> Error {
    Error::new(
        Status::GenericFailure,
        "target_unavailable: target handle already detached",
    )
}

// ---------------------------------------------------------------------------
// Pure BigInt round-trip contract check (Stage 2 mission §13/§18-F).
// ---------------------------------------------------------------------------

/// Echoes a `BigInt` argument back unchanged, as a `u64`, proving the napi
/// boundary carries 64-bit values end to end without ever routing through a
/// lossy JS `Number` — this is the property Stage 1's D06 (int64 precision
/// loss) needs the *value* half of, generalizing the pattern the
/// TypeScript scanner today only applies to addresses (`readPointer`).
/// Exposed as a standalone diagnostic function (not tied to a real scan)
/// because no real Windows user-mode address exceeds
/// `Number.MAX_SAFE_INTEGER` in practice (the 48-bit address space ceiling
/// is well under 2^53) — the property this proves is about API discipline,
/// not about a magnitude no real attach would ever produce.
#[napi]
pub fn debug_echo_u64(value: BigInt) -> Result<BigInt> {
    let (signed, words, _lossless) = value.get_u64();
    if signed {
        return Err(Error::new(
            Status::InvalidArg,
            "invalid_configuration: expected an unsigned BigInt",
        ));
    }
    Ok(BigInt::from(words))
}

// ---------------------------------------------------------------------------
// Cancellation (mission §15).
// ---------------------------------------------------------------------------

#[napi]
pub struct ScanCancellationHandle {
    inner: CancellationToken,
}

#[napi]
impl ScanCancellationHandle {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            inner: CancellationToken::new(),
        }
    }

    #[napi]
    pub fn cancel(&self) {
        self.inner.cancel();
    }

    #[napi(getter)]
    pub fn is_cancelled(&self) -> bool {
        self.inner.is_cancelled()
    }
}

impl Default for ScanCancellationHandle {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Progress (mission §16). Pull/poll-based rather than push-based: the
// background read task updates a shared, mutex-guarded ScanMetrics
// snapshot after every chunk; the JS caller polls `.snapshot()` at
// whatever cadence it chooses (e.g. a UI-driven timer). This sidesteps
// ThreadsafeFunction callback-flooding entirely by construction — the
// renderer controls its own poll rate rather than receiving an event per
// chunk, which is the safer default for a chunk size small enough to
// produce thousands of chunks per second. A push-based ThreadsafeFunction
// alternative remains available for a later stage if evidence shows
// polling latency is unacceptable for some UI (see Stage 2 evidence doc 14
// for the full rationale).
// ---------------------------------------------------------------------------

#[napi(object)]
pub struct JsProgress {
    pub regions_total: u32,
    pub regions_considered: u32,
    pub regions_read: u32,
    pub regions_skipped: u32,
    pub chunks_requested: u32,
    pub chunks_read: u32,
    pub chunks_partial: u32,
    pub chunks_failed: u32,
    pub bytes_requested: BigInt,
    pub bytes_read: BigInt,
    pub syscall_count: BigInt,
    pub elapsed_millis: BigInt,
}

fn metrics_to_js(m: &ScanMetrics) -> JsProgress {
    JsProgress {
        regions_total: m.regions_total as u32,
        regions_considered: m.regions_considered as u32,
        regions_read: m.regions_read as u32,
        regions_skipped: m.regions_skipped as u32,
        chunks_requested: m.chunks_requested as u32,
        chunks_read: m.chunks_read as u32,
        chunks_partial: m.chunks_partial as u32,
        chunks_failed: m.chunks_failed as u32,
        bytes_requested: BigInt::from(m.bytes_requested),
        bytes_read: BigInt::from(m.bytes_read),
        syscall_count: BigInt::from(m.syscall_count),
        elapsed_millis: BigInt::from(m.elapsed.as_millis() as u64),
    }
}

#[napi]
pub struct ScanProgressHandle {
    inner: Arc<Mutex<ScanMetrics>>,
}

#[napi]
impl ScanProgressHandle {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(ScanMetrics::default())),
        }
    }

    /// Current snapshot of the in-flight (or completed) operation's
    /// metrics. Safe to call at any time, including before the operation
    /// starts (returns all-zero metrics) and after it finishes (returns the
    /// final metrics, unchanged thereafter).
    #[napi]
    pub fn snapshot(&self) -> JsProgress {
        let guard = self.inner.lock().expect("progress mutex poisoned");
        metrics_to_js(&guard)
    }
}

impl Default for ScanProgressHandle {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Region model (mission §6/§7).
// ---------------------------------------------------------------------------

#[napi(object)]
pub struct JsRegion {
    pub base_address: BigInt,
    pub size: BigInt,
    pub allocation_base: BigInt,
    pub commit_state: String,
    pub kind: String,
    pub is_readable: bool,
    pub is_writable: bool,
    pub is_executable: bool,
    pub is_guard: bool,
    pub is_noaccess: bool,
    pub raw_protect: u32,
    pub raw_type: u32,
}

fn commit_state_str(s: CommitState) -> &'static str {
    match s {
        CommitState::Committed => "committed",
        CommitState::Reserved => "reserved",
        CommitState::Free => "free",
        CommitState::Unknown => "unknown",
    }
}

fn region_kind_str(k: RegionKind) -> &'static str {
    match k {
        RegionKind::Image => "image",
        RegionKind::Mapped => "mapped",
        RegionKind::Private => "private",
        RegionKind::Unknown => "unknown",
    }
}

fn region_to_js(r: &Region) -> JsRegion {
    JsRegion {
        base_address: BigInt::from(r.base_address),
        size: BigInt::from(r.size),
        allocation_base: BigInt::from(r.allocation_base),
        commit_state: commit_state_str(r.commit_state).to_string(),
        kind: region_kind_str(r.kind).to_string(),
        is_readable: r.is_readable,
        is_writable: r.is_writable,
        is_executable: r.is_executable,
        is_guard: r.is_guard,
        is_noaccess: r.is_noaccess,
        raw_protect: r.raw_protect,
        raw_type: r.raw_type,
    }
}

fn js_to_region(r: &JsRegion) -> Result<Region> {
    let (_, base_words, _) = r.base_address.get_u64();
    let (_, size_words, _) = r.size.get_u64();
    let (_, alloc_words, _) = r.allocation_base.get_u64();
    let commit_state = match r.commit_state.as_str() {
        "committed" => CommitState::Committed,
        "reserved" => CommitState::Reserved,
        "free" => CommitState::Free,
        _ => CommitState::Unknown,
    };
    let kind = match r.kind.as_str() {
        "image" => RegionKind::Image,
        "mapped" => RegionKind::Mapped,
        "private" => RegionKind::Private,
        _ => RegionKind::Unknown,
    };
    Ok(Region {
        base_address: base_words,
        size: size_words,
        allocation_base: alloc_words,
        commit_state,
        kind,
        is_readable: r.is_readable,
        is_writable: r.is_writable,
        is_executable: r.is_executable,
        is_guard: r.is_guard,
        is_noaccess: r.is_noaccess,
        raw_protect: r.raw_protect,
        raw_type: r.raw_type,
    })
}

// ---------------------------------------------------------------------------
// Completeness (mission §11) and chunk read results (mission §9/§10).
// ---------------------------------------------------------------------------

#[napi(object)]
pub struct JsSkippedRange {
    pub base_address: BigInt,
    pub size: BigInt,
    pub reason: String,
}

fn skip_reason_str(r: &SkipReason) -> &'static str {
    match r {
        SkipReason::PolicyExcluded => "policy_excluded",
        SkipReason::Unreadable => "unreadable",
        SkipReason::AccessDenied => "access_denied",
        SkipReason::PartialRead => "partial_read",
        SkipReason::ProcessExited => "process_exited",
        SkipReason::ResourceLimit => "resource_limit",
        SkipReason::Cancelled => "cancelled",
        SkipReason::OsError => "os_error",
    }
}

fn skipped_to_js(s: &SkippedRange) -> JsSkippedRange {
    JsSkippedRange {
        base_address: BigInt::from(s.base_address),
        size: BigInt::from(s.size),
        reason: skip_reason_str(&s.reason).to_string(),
    }
}

#[napi(object)]
pub struct JsCompleteness {
    /// One of: "complete", "complete_with_skipped_regions", "cancelled",
    /// "process_exited", "read_error_limit", "resource_limit", "failed".
    pub state: String,
    pub at_byte: Option<BigInt>,
    pub skipped: Option<Vec<JsSkippedRange>>,
    pub failed_reason: Option<String>,
}

fn completeness_to_js(c: ScanCompleteness) -> JsCompleteness {
    match c {
        ScanCompleteness::Complete => JsCompleteness {
            state: "complete".into(),
            at_byte: None,
            skipped: None,
            failed_reason: None,
        },
        ScanCompleteness::CompleteWithSkippedRegions { skipped } => JsCompleteness {
            state: "complete_with_skipped_regions".into(),
            at_byte: None,
            skipped: Some(skipped.iter().map(skipped_to_js).collect()),
            failed_reason: None,
        },
        ScanCompleteness::Cancelled { at_byte } => JsCompleteness {
            state: "cancelled".into(),
            at_byte: Some(BigInt::from(at_byte)),
            skipped: None,
            failed_reason: None,
        },
        ScanCompleteness::ProcessExited { at_byte } => JsCompleteness {
            state: "process_exited".into(),
            at_byte: Some(BigInt::from(at_byte)),
            skipped: None,
            failed_reason: None,
        },
        ScanCompleteness::ReadErrorLimit { skipped } => JsCompleteness {
            state: "read_error_limit".into(),
            at_byte: None,
            skipped: Some(skipped.iter().map(skipped_to_js).collect()),
            failed_reason: None,
        },
        ScanCompleteness::ResourceLimit { at_byte } => JsCompleteness {
            state: "resource_limit".into(),
            at_byte: Some(BigInt::from(at_byte)),
            skipped: None,
            failed_reason: None,
        },
        ScanCompleteness::Failed { reason } => JsCompleteness {
            state: "failed".into(),
            at_byte: None,
            skipped: None,
            failed_reason: Some(reason),
        },
    }
}

#[napi(object)]
pub struct JsChunkReadResult {
    pub chunk_base: BigInt,
    pub requested_size: BigInt,
    /// One of: "success", "partial_read", "access_denied", "target_exited",
    /// "invalid_address", "os_error", "resource_limit", "cancelled".
    pub status: String,
    pub bytes_read_if_partial: Option<BigInt>,
    pub data: Buffer,
}

fn chunk_status_str(s: &ChunkReadStatus) -> &'static str {
    match s {
        ChunkReadStatus::Success => "success",
        ChunkReadStatus::PartialRead { .. } => "partial_read",
        ChunkReadStatus::AccessDenied => "access_denied",
        ChunkReadStatus::TargetExited => "target_exited",
        ChunkReadStatus::InvalidAddress => "invalid_address",
        ChunkReadStatus::OsError { .. } => "os_error",
        ChunkReadStatus::ResourceLimit => "resource_limit",
        ChunkReadStatus::Cancelled => "cancelled",
    }
}

fn chunk_result_to_js(r: ChunkReadResult) -> JsChunkReadResult {
    let bytes_read_if_partial = match &r.status {
        ChunkReadStatus::PartialRead { bytes_read } => Some(BigInt::from(*bytes_read)),
        _ => None,
    };
    JsChunkReadResult {
        chunk_base: BigInt::from(r.spec.chunk_base),
        requested_size: BigInt::from(r.spec.requested_size),
        status: chunk_status_str(&r.status).to_string(),
        bytes_read_if_partial,
        data: r.data.into(),
    }
}

#[napi(object)]
pub struct JsReadRegionOutcome {
    pub chunks: Vec<JsChunkReadResult>,
    pub metrics: JsProgress,
    pub completeness: JsCompleteness,
}

// ---------------------------------------------------------------------------
// The async read task (mission §14) — CPU/syscall-bound work executed on
// napi's libuv worker-thread pool via the `Task` trait, deliberately not
// requiring a tokio runtime (this operation is not I/O-async in the
// tokio sense; it is a bounded, cancellable, blocking-per-syscall loop that
// simply must not run on the JS main thread).
// ---------------------------------------------------------------------------

pub struct ReadRegionTask {
    handle: Arc<Mutex<Option<ProcessHandle>>>,
    region: Region,
    chunk_config: ChunkPlanConfig,
    cancellation: CancellationToken,
    progress: Arc<Mutex<ScanMetrics>>,
}

impl Task for ReadRegionTask {
    type Output = (Vec<ChunkReadResult>, ScanMetrics, ScanCompleteness);
    type JsValue = JsReadRegionOutcome;

    fn compute(&mut self) -> Result<Self::Output> {
        let guard = self.handle.lock().map_err(|_| {
            Error::new(
                Status::GenericFailure,
                "internal_invariant_violation: target mutex poisoned",
            )
        })?;
        let handle_ref = guard.as_ref().ok_or_else(detached_err)?;

        let mut metrics = ScanMetrics::default();
        let progress = self.progress.clone();
        let mut on_progress = move |m: &ScanMetrics| {
            if let Ok(mut slot) = progress.lock() {
                *slot = *m;
            }
        };

        let (results, completeness) = read_region_chunked_with_progress(
            handle_ref,
            &self.region,
            self.chunk_config,
            &self.cancellation,
            ReadBudget::default(),
            &mut metrics,
            Some(&mut on_progress),
        )
        .map_err(to_napi_err)?;

        Ok((results, metrics, completeness))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        let (results, metrics, completeness) = output;
        Ok(JsReadRegionOutcome {
            chunks: results.into_iter().map(chunk_result_to_js).collect(),
            metrics: metrics_to_js(&metrics),
            completeness: completeness_to_js(completeness),
        })
    }
}

// ---------------------------------------------------------------------------
// The attached-target handle (mission §6/§17/§23).
// ---------------------------------------------------------------------------

/// A live attach to a target process, scan-mechanics only (no policy — see
/// module doc). Wraps the handle in `Arc<Mutex<Option<...>>>` so it can be
/// shared with a background `Task` while still allowing an explicit
/// `detach()` from JS that releases the handle immediately (RAII `Drop`
/// still guarantees `CloseHandle` even if `detach()` is never called).
///
/// Security note (mission §23): this class is exported for use by trusted
/// Electron main-process code only — it is Stage 2 foundation plumbing, not
/// a renderer-facing API. The existing game-scoped authority boundary
/// (attach authorization, protected-target blocklist, online-guard) remains
/// entirely in TypeScript and must gate every real call site that
/// constructs a `NativeScanTarget`; this class itself performs no such
/// policy check, by design (mechanics vs. policy separation).
#[napi]
pub struct NativeScanTarget {
    handle: Arc<Mutex<Option<ProcessHandle>>>,
    pid: u32,
}

#[napi]
impl NativeScanTarget {
    /// Attaches to `pid` with a read-only handle
    /// (`PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ`).
    #[napi(factory)]
    pub fn attach(pid: u32) -> Result<Self> {
        let handle = ProcessHandle::open_read_only(pid).map_err(to_napi_err)?;
        Ok(Self {
            handle: Arc::new(Mutex::new(Some(handle))),
            pid,
        })
    }

    #[napi(getter)]
    pub fn pid(&self) -> u32 {
        self.pid
    }

    /// Releases the underlying handle immediately rather than waiting for
    /// this object to be garbage-collected. Safe to call more than once.
    #[napi]
    pub fn detach(&self) {
        if let Ok(mut guard) = self.handle.lock() {
            *guard = None;
        }
    }

    #[napi]
    pub fn is_attached(&self) -> bool {
        self.handle.lock().map(|g| g.is_some()).unwrap_or(false)
    }

    /// `"open"` if the process is still running, `"exited"` if it has
    /// terminated, per a fresh `GetExitCodeProcess` check (not cached).
    #[napi]
    pub fn status(&self) -> Result<String> {
        let guard = self.handle.lock().map_err(|_| {
            Error::new(
                Status::GenericFailure,
                "internal_invariant_violation: target mutex poisoned",
            )
        })?;
        let h = guard.as_ref().ok_or_else(detached_err)?;
        let status = h.status().map_err(to_napi_err)?;
        Ok(match status {
            solith_scanner_core::target::HandleStatus::Open => "open",
            solith_scanner_core::target::HandleStatus::Exited => "exited",
        }
        .to_string())
    }

    /// `"x64"` | `"x86_on_wow64"` | `"unknown"` — see
    /// `solith_scanner_core::target::TargetArchitecture`. Real positive
    /// (`x86_on_wow64`) validation against an actual 32-bit target process
    /// is a documented, not-yet-executed Stage 2 gap (no i686 Rust target is
    /// installed in this environment) — see Stage 2 evidence doc 17.
    #[napi]
    pub fn architecture(&self) -> Result<String> {
        let guard = self.handle.lock().map_err(|_| {
            Error::new(
                Status::GenericFailure,
                "internal_invariant_violation: target mutex poisoned",
            )
        })?;
        let h = guard.as_ref().ok_or_else(detached_err)?;
        let arch = h.detect_architecture().map_err(to_napi_err)?;
        Ok(match arch {
            TargetArchitecture::X64 => "x64",
            TargetArchitecture::X86OnWow64 => "x86_on_wow64",
            TargetArchitecture::Unknown => "unknown",
        }
        .to_string())
    }

    #[napi]
    pub fn pointer_width_bytes(&self) -> Result<Option<u32>> {
        let guard = self.handle.lock().map_err(|_| {
            Error::new(
                Status::GenericFailure,
                "internal_invariant_violation: target mutex poisoned",
            )
        })?;
        let h = guard.as_ref().ok_or_else(detached_err)?;
        let arch = h.detect_architecture().map_err(to_napi_err)?;
        Ok(arch.pointer_width_bytes().map(|w| w as u32))
    }

    /// Enumerates every committed/reserved region in the target's address
    /// space. Synchronous (region enumeration across the full user-mode
    /// address space is bounded and fast in practice — see Stage 2
    /// evidence doc 16 for measured timing); the read operation, which can
    /// be arbitrarily large, is the one made async (see
    /// `read_region_chunked`).
    #[napi]
    pub fn enumerate_regions(&self) -> Result<Vec<JsRegion>> {
        let guard = self.handle.lock().map_err(|_| {
            Error::new(
                Status::GenericFailure,
                "internal_invariant_violation: target mutex poisoned",
            )
        })?;
        let h = guard.as_ref().ok_or_else(detached_err)?;
        let result = enumerate_regions(h, 0).map_err(to_napi_err)?;
        if !result.is_complete {
            return Err(Error::new(
                Status::GenericFailure,
                format!(
                    "region_enumeration_failure: enumeration stopped early at 0x{:x} ({:?})",
                    result.stopped_at.unwrap_or(0),
                    result.stop_reason
                ),
            ));
        }
        Ok(result.regions.iter().map(region_to_js).collect())
    }

    /// Reads `region` (as returned by `enumerate_regions`, or a
    /// caller-constructed synthetic region for testing) in full, chunk by
    /// chunk, honestly reporting completeness. Runs on napi's worker-thread
    /// pool — does not block the JS event loop for the read's duration
    /// (mission §14). `cancellation.cancel()` may be called from JS at any
    /// time while the returned Promise is pending; `progress.snapshot()`
    /// may be polled at any time for a live view of work completed so far.
    #[napi(ts_return_type = "Promise<JsReadRegionOutcome>")]
    #[allow(clippy::too_many_arguments)]
    pub fn read_region_chunked(
        &self,
        region: JsRegion,
        chunk_size_bytes: BigInt,
        overlap_bytes: BigInt,
        cancellation: &ScanCancellationHandle,
        progress: &ScanProgressHandle,
    ) -> Result<AsyncTask<ReadRegionTask>> {
        let region = js_to_region(&region)?;
        let (_, chunk_size, _) = chunk_size_bytes.get_u64();
        let (_, overlap, _) = overlap_bytes.get_u64();
        let chunk_config = ChunkPlanConfig {
            chunk_size_bytes: chunk_size,
            overlap_bytes: overlap,
        };

        Ok(AsyncTask::new(ReadRegionTask {
            handle: self.handle.clone(),
            region,
            chunk_config,
            cancellation: cancellation.inner.clone(),
            progress: progress.inner.clone(),
        }))
    }

    /// Convenience wrapper: enumerates regions, applies the default
    /// writable-value-scan policy (mission §8's separation preserved —
    /// this is one named policy, not baked into enumeration), and reads
    /// every selected region. Exists so Stage 2's own tests/benchmarks
    /// don't need to hand-roll policy application from JS; a future scan
    /// mode is expected to call `enumerate_regions()` +
    /// `read_region_chunked()` per-region directly with its own policy.
    #[napi]
    pub fn default_region_policy_summary(&self) -> Result<Vec<JsRegion>> {
        let guard = self.handle.lock().map_err(|_| {
            Error::new(
                Status::GenericFailure,
                "internal_invariant_violation: target mutex poisoned",
            )
        })?;
        let h = guard.as_ref().ok_or_else(detached_err)?;
        let result = enumerate_regions(h, 0).map_err(to_napi_err)?;
        let policy = RegionSelectionPolicy::default_writable_value_scan();
        let (selected, _excluded) = policy.partition(&result.regions);
        Ok(selected.into_iter().map(region_to_js).collect())
    }
}

// ---------------------------------------------------------------------------
// Stage 3 — exact primitive-value scanning (mission §3.13).
//
// Value contract: a value crosses the boundary as EITHER a plain JS
// `number` (i8/u8/i16/u16/i32/u32/f32/f64 — all exactly representable) OR a
// `BigInt` (i64/u64 only), never both, and never coerced from one to the
// other. Callers pass `valueNumber` for the former group and `valueBigint`
// for the latter, matching `primitiveType`; passing the wrong one for a
// given type is a thrown `invalid_configuration` error, not a silent
// truncation. `PrimitiveType::requires_bigint_for_js()` is the single
// source of truth this crate and any caller should consult for which slot
// to use.
// ---------------------------------------------------------------------------

fn primitive_type_from_str(s: &str) -> Result<PrimitiveType> {
    Ok(match s {
        "i8" => PrimitiveType::I8,
        "u8" => PrimitiveType::U8,
        "i16" => PrimitiveType::I16,
        "u16" => PrimitiveType::U16,
        "i32" => PrimitiveType::I32,
        "u32" => PrimitiveType::U32,
        "i64" => PrimitiveType::I64,
        "u64" => PrimitiveType::U64,
        "f32" => PrimitiveType::F32,
        "f64" => PrimitiveType::F64,
        other => {
            return Err(Error::new(
                Status::InvalidArg,
                format!("invalid_configuration: unknown primitive type \"{other}\""),
            ))
        }
    })
}

fn primitive_value_from_js(
    pt: PrimitiveType,
    value_number: Option<f64>,
    value_bigint: Option<BigInt>,
) -> Result<PrimitiveValue> {
    if pt.requires_bigint_for_js() {
        let big = value_bigint.ok_or_else(|| {
            Error::new(
                Status::InvalidArg,
                format!("invalid_configuration: {pt} requires valueBigint, not valueNumber"),
            )
        })?;
        return Ok(match pt {
            PrimitiveType::I64 => {
                let (v, lossless) = big.get_i64();
                if !lossless {
                    return Err(Error::new(
                        Status::InvalidArg,
                        "invalid_configuration: valueBigint does not fit in i64 exactly",
                    ));
                }
                PrimitiveValue::I64(v)
            }
            PrimitiveType::U64 => {
                let (sign, v, lossless) = big.get_u64();
                if sign || !lossless {
                    return Err(Error::new(
                        Status::InvalidArg,
                        "invalid_configuration: valueBigint does not fit in u64 exactly",
                    ));
                }
                PrimitiveValue::U64(v)
            }
            _ => unreachable!("requires_bigint_for_js() only true for I64/U64"),
        });
    }

    let num = value_number.ok_or_else(|| {
        Error::new(
            Status::InvalidArg,
            format!("invalid_configuration: {pt} requires valueNumber, not valueBigint"),
        )
    })?;
    Ok(match pt {
        PrimitiveType::I8 => PrimitiveValue::I8(num as i8),
        PrimitiveType::U8 => PrimitiveValue::U8(num as u8),
        PrimitiveType::I16 => PrimitiveValue::I16(num as i16),
        PrimitiveType::U16 => PrimitiveValue::U16(num as u16),
        PrimitiveType::I32 => PrimitiveValue::I32(num as i32),
        PrimitiveType::U32 => PrimitiveValue::U32(num as u32),
        PrimitiveType::F32 => PrimitiveValue::F32(num as f32),
        PrimitiveType::F64 => PrimitiveValue::F64(num),
        PrimitiveType::I64 | PrimitiveType::U64 => {
            unreachable!("handled in the bigint branch above")
        }
    })
}

fn alignment_from_str(s: &str) -> Result<AlignmentMode> {
    match s {
        "bytewise" => Ok(AlignmentMode::Bytewise),
        "aligned_to_type" => Ok(AlignmentMode::AlignedToType),
        other => Err(Error::new(
            Status::InvalidArg,
            format!("invalid_configuration: unknown alignment mode \"{other}\""),
        )),
    }
}

#[napi(object)]
pub struct JsScanMatch {
    pub address: BigInt,
    /// One of the 10 canonical type strings ("i8".."f64").
    pub primitive_type: String,
    /// Populated for every type except i64/u64.
    pub value_number: Option<f64>,
    /// Populated only for i64/u64 — exact, never routed through `f64`.
    pub value_bigint: Option<BigInt>,
}

fn scan_match_to_js(m: CoreScanMatch) -> JsScanMatch {
    let pt = m.value.primitive_type();
    let (value_number, value_bigint) = if pt.requires_bigint_for_js() {
        let big = match m.value {
            PrimitiveValue::I64(v) => BigInt::from(v),
            PrimitiveValue::U64(v) => BigInt::from(v),
            _ => unreachable!(),
        };
        (None, Some(big))
    } else {
        let num = match m.value {
            PrimitiveValue::I8(v) => v as f64,
            PrimitiveValue::U8(v) => v as f64,
            PrimitiveValue::I16(v) => v as f64,
            PrimitiveValue::U16(v) => v as f64,
            PrimitiveValue::I32(v) => v as f64,
            PrimitiveValue::U32(v) => v as f64,
            PrimitiveValue::F32(v) => v as f64,
            PrimitiveValue::F64(v) => v,
            PrimitiveValue::I64(_) | PrimitiveValue::U64(_) => unreachable!(),
        };
        (Some(num), None)
    };
    JsScanMatch {
        address: BigInt::from(m.address),
        primitive_type: pt.to_string(),
        value_number,
        value_bigint,
    }
}

#[napi(object)]
pub struct JsExactScanOutcome {
    pub matches: Vec<JsScanMatch>,
    pub metrics: JsProgress,
    pub completeness: JsCompleteness,
}

pub struct ExactScanTask {
    handle: Arc<Mutex<Option<ProcessHandle>>>,
    region: Region,
    policy: RegionSelectionPolicy,
    primitive_type: PrimitiveType,
    target: PrimitiveValue,
    options: ScanOptions,
    cancellation: CancellationToken,
    progress: Arc<Mutex<ScanMetrics>>,
}

impl Task for ExactScanTask {
    type Output = solith_scanner_core::exact_scan::ExactScanResult;
    type JsValue = JsExactScanOutcome;

    fn compute(&mut self) -> Result<Self::Output> {
        let guard = self.handle.lock().map_err(|_| {
            Error::new(
                Status::GenericFailure,
                "internal_invariant_violation: target mutex poisoned",
            )
        })?;
        let handle_ref = guard.as_ref().ok_or_else(detached_err)?;

        let progress = self.progress.clone();
        let mut on_progress = move |m: &ScanMetrics| {
            if let Ok(mut slot) = progress.lock() {
                *slot = *m;
            }
        };

        scan_exact(
            handle_ref,
            std::slice::from_ref(&self.region),
            &self.policy,
            self.primitive_type,
            self.target,
            &self.options,
            &self.cancellation,
            Some(&mut on_progress),
        )
        .map_err(to_napi_err)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(JsExactScanOutcome {
            matches: output.matches.into_iter().map(scan_match_to_js).collect(),
            metrics: metrics_to_js(&output.metrics),
            completeness: completeness_to_js(output.completeness),
        })
    }
}

#[napi]
impl NativeScanTarget {
    /// Scans `region` for an exact match of the given primitive value.
    /// Runs on napi's worker-thread pool (mission §3.13's async
    /// requirement) — see `read_region_chunked` above for the same
    /// cancellation/progress contract, which this reuses unchanged.
    ///
    /// `primitiveType`: one of "i8","u8","i16","u16","i32","u32","i64",
    /// "u64","f32","f64". `alignment`: "bytewise" (default/recommended) or
    /// "aligned_to_type". `valueNumber`/`valueBigint`: exactly one must be
    /// supplied, per `primitiveType` (see module doc's value contract).
    #[napi(ts_return_type = "Promise<JsExactScanOutcome>")]
    #[allow(clippy::too_many_arguments)]
    pub fn scan_exact(
        &self,
        region: JsRegion,
        primitive_type: String,
        value_number: Option<f64>,
        value_bigint: Option<BigInt>,
        alignment: String,
        chunk_size_bytes: BigInt,
        overlap_bytes: BigInt,
        max_results: Option<BigInt>,
        cancellation: &ScanCancellationHandle,
        progress: &ScanProgressHandle,
    ) -> Result<AsyncTask<ExactScanTask>> {
        let pt = primitive_type_from_str(&primitive_type)?;
        let target = primitive_value_from_js(pt, value_number, value_bigint)?;
        let alignment_mode = alignment_from_str(&alignment)?;
        let region = js_to_region(&region)?;
        let (_, chunk_size, _) = chunk_size_bytes.get_u64();
        let (_, overlap, _) = overlap_bytes.get_u64();
        let max_results_u64 = match max_results {
            Some(b) => {
                let (_, v, _) = b.get_u64();
                Some(v)
            }
            None => None,
        };

        let options = ScanOptions {
            alignment: alignment_mode,
            chunk_config: ChunkPlanConfig {
                chunk_size_bytes: chunk_size,
                overlap_bytes: overlap,
            },
            max_results: max_results_u64,
        };

        Ok(AsyncTask::new(ExactScanTask {
            handle: self.handle.clone(),
            region,
            policy: RegionSelectionPolicy::default_writable_value_scan(),
            primitive_type: pt,
            target,
            options,
            cancellation: cancellation.inner.clone(),
            progress: progress.inner.clone(),
        }))
    }
}

// ---------------------------------------------------------------------------
// Stage 5 — string/byte/AOB pattern scanning (mission §5.15). Reuses every
// Stage 2/3 primitive unchanged (`JsRegion`, cancellation/progress handles,
// `JsCompleteness`/`JsProgress`) — only the pattern itself and its match
// shape are new. Unlike `scanExact`'s writable-value-scan default, pattern
// scans default to `RegionSelectionPolicy::readable_any()`: an AOB
// signature or a UI string commonly lives in read-only or executable image
// regions, not just writable heap/stack, so restricting to writable-only
// would silently miss the exact regions this feature exists to search.
// ---------------------------------------------------------------------------

fn null_terminator_from_str(s: &str) -> Result<NullTerminatorMode> {
    match s {
        "none" => Ok(NullTerminatorMode::None),
        "required" => Ok(NullTerminatorMode::Required),
        other => Err(Error::new(
            Status::InvalidArg,
            format!("invalid_configuration: unknown null terminator mode \"{other}\""),
        )),
    }
}

fn pattern_parse_err(e: PatternParseError) -> Error {
    Error::new(Status::InvalidArg, e.to_string())
}

fn build_pattern_options(
    pattern: &Pattern,
    chunk_size_bytes: BigInt,
    max_results: Option<BigInt>,
    first_match_only: Option<bool>,
) -> PatternScanOptions {
    let (_, chunk_size, _) = chunk_size_bytes.get_u64();
    let max_results_u64 = max_results.map(|b| {
        let (_, v, _) = b.get_u64();
        v
    });
    let mut options = PatternScanOptions::default_for(pattern, chunk_size);
    options.max_results = max_results_u64;
    options.first_match_only = first_match_only.unwrap_or(false);
    options
}

#[napi(object)]
pub struct JsPatternMatch {
    pub address: BigInt,
    pub length: u32,
}

fn pattern_match_to_js(m: CorePatternMatch) -> JsPatternMatch {
    JsPatternMatch {
        address: BigInt::from(m.address),
        length: m.length,
    }
}

#[napi(object)]
pub struct JsPatternScanOutcome {
    /// One of "raw_bytes", "utf8", "utf16le", "aob" — echoes which Stage 5
    /// surface produced this result (mission §5.10's "pattern/string type"
    /// result field).
    pub kind: String,
    pub matches: Vec<JsPatternMatch>,
    pub metrics: JsProgress,
    pub completeness: JsCompleteness,
}

pub struct PatternScanTask {
    handle: Arc<Mutex<Option<ProcessHandle>>>,
    region: Region,
    pattern: Pattern,
    kind: PatternKind,
    options: PatternScanOptions,
    cancellation: CancellationToken,
    progress: Arc<Mutex<ScanMetrics>>,
}

impl Task for PatternScanTask {
    type Output = solith_scanner_core::pattern_scan::PatternScanResult;
    type JsValue = JsPatternScanOutcome;

    fn compute(&mut self) -> Result<Self::Output> {
        let guard = self.handle.lock().map_err(|_| {
            Error::new(
                Status::GenericFailure,
                "internal_invariant_violation: target mutex poisoned",
            )
        })?;
        let handle_ref = guard.as_ref().ok_or_else(detached_err)?;

        let progress = self.progress.clone();
        let mut on_progress = move |m: &ScanMetrics| {
            if let Ok(mut slot) = progress.lock() {
                *slot = *m;
            }
        };

        scan_pattern(
            handle_ref,
            std::slice::from_ref(&self.region),
            &RegionSelectionPolicy::readable_any(),
            &self.pattern,
            self.kind,
            &self.options,
            &self.cancellation,
            Some(&mut on_progress),
        )
        .map_err(to_napi_err)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(JsPatternScanOutcome {
            kind: output.kind.to_string(),
            matches: output
                .matches
                .into_iter()
                .map(pattern_match_to_js)
                .collect(),
            metrics: metrics_to_js(&output.metrics),
            completeness: completeness_to_js(output.completeness),
        })
    }
}

#[napi]
impl NativeScanTarget {
    /// Scans `region` for every occurrence of an exact raw byte sequence
    /// (mission §5.3). `bytes` must not be empty.
    #[napi(ts_return_type = "Promise<JsPatternScanOutcome>")]
    #[allow(clippy::too_many_arguments)]
    pub fn scan_bytes(
        &self,
        region: JsRegion,
        bytes: Buffer,
        chunk_size_bytes: BigInt,
        max_results: Option<BigInt>,
        first_match_only: Option<bool>,
        cancellation: &ScanCancellationHandle,
        progress: &ScanProgressHandle,
    ) -> Result<AsyncTask<PatternScanTask>> {
        let region = js_to_region(&region)?;
        let pattern = pattern_from_raw_bytes(&bytes).map_err(to_napi_err)?;
        let options =
            build_pattern_options(&pattern, chunk_size_bytes, max_results, first_match_only);
        Ok(AsyncTask::new(PatternScanTask {
            handle: self.handle.clone(),
            region,
            pattern,
            kind: PatternKind::RawBytes,
            options,
            cancellation: cancellation.inner.clone(),
            progress: progress.inner.clone(),
        }))
    }

    /// Scans `region` for `text`, encoded per `encoding` ("utf8" or
    /// "utf16le") — mission §5.2. `caseSensitive` (default-recommended:
    /// true) controls ASCII-only case folding (module doc for the
    /// justification); `nullTerminator` is "none" (match the content
    /// anywhere) or "required" (match only when immediately followed by a
    /// real encoding-native null terminator).
    #[napi(ts_return_type = "Promise<JsPatternScanOutcome>")]
    #[allow(clippy::too_many_arguments)]
    pub fn scan_string(
        &self,
        region: JsRegion,
        text: String,
        encoding: String,
        case_sensitive: bool,
        null_terminator: String,
        chunk_size_bytes: BigInt,
        max_results: Option<BigInt>,
        first_match_only: Option<bool>,
        cancellation: &ScanCancellationHandle,
        progress: &ScanProgressHandle,
    ) -> Result<AsyncTask<PatternScanTask>> {
        let region = js_to_region(&region)?;
        let nt = null_terminator_from_str(&null_terminator)?;
        let (pattern, kind) = match encoding.as_str() {
            "utf8" => (
                pattern_from_utf8_str(&text, case_sensitive, nt).map_err(to_napi_err)?,
                PatternKind::Utf8,
            ),
            "utf16le" => (
                pattern_from_utf16le_str(&text, case_sensitive, nt).map_err(to_napi_err)?,
                PatternKind::Utf16Le,
            ),
            other => {
                return Err(Error::new(
                    Status::InvalidArg,
                    format!("invalid_configuration: unknown string encoding \"{other}\""),
                ))
            }
        };
        let options =
            build_pattern_options(&pattern, chunk_size_bytes, max_results, first_match_only);
        Ok(AsyncTask::new(PatternScanTask {
            handle: self.handle.clone(),
            region,
            pattern,
            kind,
            options,
            cancellation: cancellation.inner.clone(),
            progress: progress.inner.clone(),
        }))
    }

    /// Scans `region` for the AOB pattern `pattern` (mission §5.4's
    /// grammar: whitespace-separated exact-byte/`??`/`?`/`*`/nibble-wildcard
    /// tokens — see `solith_scanner_core::pattern::parse_aob`'s doc). A
    /// malformed pattern is rejected with a stable
    /// `invalid_hex_token:`/`malformed_wildcard:`/`empty_pattern:`/
    /// `unsupported_token:`/`invalid_separator:`-prefixed error, synchronously,
    /// before any async work begins.
    #[napi(ts_return_type = "Promise<JsPatternScanOutcome>")]
    #[allow(clippy::too_many_arguments)]
    pub fn scan_aob(
        &self,
        region: JsRegion,
        pattern: String,
        chunk_size_bytes: BigInt,
        max_results: Option<BigInt>,
        first_match_only: Option<bool>,
        cancellation: &ScanCancellationHandle,
        progress: &ScanProgressHandle,
    ) -> Result<AsyncTask<PatternScanTask>> {
        let region = js_to_region(&region)?;
        let compiled = parse_aob(&pattern).map_err(pattern_parse_err)?;
        let options =
            build_pattern_options(&compiled, chunk_size_bytes, max_results, first_match_only);
        Ok(AsyncTask::new(PatternScanTask {
            handle: self.handle.clone(),
            region,
            pattern: compiled,
            kind: PatternKind::Aob,
            options,
            cancellation: cancellation.inner.clone(),
            progress: progress.inner.clone(),
        }))
    }
}

// ---------------------------------------------------------------------------
// Stage 4 — scan-session / refinement engine (mission §4.14's napi session
// API). A `NativeScanSession` starts empty (`inner: None`); the first call
// must be `createUnknownInitial`, which opens its own `ProcessHandle` (this
// session's for its entire lifetime — mission §4.1's "process handle
// ownership" bullet) and performs the real baseline capture. Every
// subsequent `refine` call re-reads only the current candidate set. Neither
// method leaks the underlying Rust `ScanSession`/`ProcessHandle` to JS
// (mission §4.14's explicit "do not leak Rust/internal handles" rule) — JS
// only ever sees this opaque class plus the plain-data result/status shapes
// below.
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
fn refine_mode_from_js(
    session_pt: PrimitiveType,
    mode: &str,
    value_number: Option<f64>,
    value_bigint: Option<BigInt>,
    min_number: Option<f64>,
    min_bigint: Option<BigInt>,
    max_number: Option<f64>,
    max_bigint: Option<BigInt>,
) -> Result<RefineMode> {
    Ok(match mode {
        "changed" => RefineMode::Changed,
        "unchanged" => RefineMode::Unchanged,
        "increased" => RefineMode::Increased,
        "decreased" => RefineMode::Decreased,
        "increased_by" => {
            let delta = primitive_value_from_js(session_pt, value_number, value_bigint)?;
            RefineMode::IncreasedBy(delta)
        }
        "decreased_by" => {
            let delta = primitive_value_from_js(session_pt, value_number, value_bigint)?;
            RefineMode::DecreasedBy(delta)
        }
        "between" => {
            let min = primitive_value_from_js(session_pt, min_number, min_bigint)?;
            let max = primitive_value_from_js(session_pt, max_number, max_bigint)?;
            RefineMode::Between(min, max)
        }
        other => {
            return Err(Error::new(
                Status::InvalidArg,
                format!("invalid_configuration: unknown refine mode \"{other}\""),
            ))
        }
    })
}

#[napi(object)]
pub struct JsRefineOutcome {
    pub generation: u32,
    pub input_candidate_count: BigInt,
    pub output_candidate_count: BigInt,
    pub bytes_reread: BigInt,
    pub skipped_reads: BigInt,
    pub completeness: JsCompleteness,
    pub duration_millis: BigInt,
}

#[napi(object)]
pub struct JsGenerationRecord {
    pub generation: u32,
    pub mode_label: String,
    pub input_candidate_count: BigInt,
    pub output_candidate_count: BigInt,
    pub bytes_reread: BigInt,
    pub skipped_reads: BigInt,
    pub completeness: JsCompleteness,
    pub duration_millis: BigInt,
}

fn generation_record_to_js(r: GenerationRecord) -> JsGenerationRecord {
    JsGenerationRecord {
        generation: r.generation as u32,
        mode_label: r.mode_label.to_string(),
        input_candidate_count: BigInt::from(r.input_candidate_count),
        output_candidate_count: BigInt::from(r.output_candidate_count),
        bytes_reread: BigInt::from(r.bytes_reread),
        skipped_reads: BigInt::from(r.skipped_reads),
        completeness: completeness_to_js(r.completeness),
        duration_millis: BigInt::from(r.duration.as_millis() as u64),
    }
}

#[napi(object)]
pub struct JsSessionStatus {
    pub pid: u32,
    pub primitive_type: String,
    pub alignment: String,
    pub generation: u32,
    pub candidate_count: BigInt,
    pub candidate_memory_bytes: BigInt,
    pub last_completeness: JsCompleteness,
    /// `false` once the session's target process has exited — checked live
    /// via `GetExitCodeProcess` on every call, never cached (mission §4.2).
    pub is_stale: bool,
}

fn session_not_initialized_err() -> Error {
    Error::new(
        Status::GenericFailure,
        "invalid_configuration: session not yet initialized — call createUnknownInitial first",
    )
}

fn session_already_initialized_err() -> Error {
    Error::new(
        Status::GenericFailure,
        "invalid_configuration: session already initialized — createUnknownInitial may only be called once per session",
    )
}

fn alignment_str(a: AlignmentMode) -> &'static str {
    match a {
        AlignmentMode::Bytewise => "bytewise",
        AlignmentMode::AlignedToType => "aligned_to_type",
    }
}

pub struct CreateUnknownInitialTask {
    inner: Arc<Mutex<Option<CoreScanSession>>>,
    pid: u32,
    regions: Vec<Region>,
    policy: RegionSelectionPolicy,
    primitive_type: PrimitiveType,
    alignment: AlignmentMode,
    chunk_config: ChunkPlanConfig,
    resource_limits: SessionResourceLimits,
    cancellation: CancellationToken,
    progress: Arc<Mutex<ScanMetrics>>,
}

impl Task for CreateUnknownInitialTask {
    type Output = JsRefineOutcome;
    type JsValue = JsRefineOutcome;

    fn compute(&mut self) -> Result<Self::Output> {
        {
            let guard = self.inner.lock().map_err(|_| {
                Error::new(
                    Status::GenericFailure,
                    "internal_invariant_violation: session mutex poisoned",
                )
            })?;
            if guard.is_some() {
                return Err(session_already_initialized_err());
            }
        }

        let handle = ProcessHandle::open_read_only(self.pid).map_err(to_napi_err)?;
        let progress = self.progress.clone();
        let mut on_progress = move |m: &ScanMetrics| {
            if let Ok(mut slot) = progress.lock() {
                *slot = *m;
            }
        };

        let (session, metrics) = CoreScanSession::create_unknown_initial(
            handle,
            &self.regions,
            &self.policy,
            self.primitive_type,
            self.alignment,
            self.chunk_config,
            self.resource_limits,
            &self.cancellation,
            Some(&mut on_progress),
        )
        .map_err(to_napi_err)?;

        let completeness = session.last_completeness().clone();
        let candidate_count = session.candidate_count();
        let mut guard = self.inner.lock().map_err(|_| {
            Error::new(
                Status::GenericFailure,
                "internal_invariant_violation: session mutex poisoned",
            )
        })?;
        *guard = Some(session);

        Ok(JsRefineOutcome {
            generation: 0,
            input_candidate_count: BigInt::from(0u64),
            output_candidate_count: BigInt::from(candidate_count),
            bytes_reread: BigInt::from(metrics.bytes_read),
            skipped_reads: BigInt::from(0u64),
            completeness: completeness_to_js(completeness),
            duration_millis: BigInt::from(metrics.elapsed.as_millis() as u64),
        })
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

pub struct RefineTask {
    inner: Arc<Mutex<Option<CoreScanSession>>>,
    mode: RefineMode,
    cancellation: CancellationToken,
    progress: Arc<Mutex<ScanMetrics>>,
}

impl Task for RefineTask {
    type Output = JsRefineOutcome;
    type JsValue = JsRefineOutcome;

    fn compute(&mut self) -> Result<Self::Output> {
        let mut guard = self.inner.lock().map_err(|_| {
            Error::new(
                Status::GenericFailure,
                "internal_invariant_violation: session mutex poisoned",
            )
        })?;
        let session = guard.as_mut().ok_or_else(session_not_initialized_err)?;

        let progress = self.progress.clone();
        let mut on_progress = move |m: &ScanMetrics| {
            if let Ok(mut slot) = progress.lock() {
                *slot = *m;
            }
        };

        let outcome = session
            .refine(self.mode, &self.cancellation, Some(&mut on_progress))
            .map_err(to_napi_err)?;

        Ok(JsRefineOutcome {
            generation: outcome.generation as u32,
            input_candidate_count: BigInt::from(outcome.input_candidate_count),
            output_candidate_count: BigInt::from(outcome.output_candidate_count),
            bytes_reread: BigInt::from(outcome.bytes_reread),
            skipped_reads: BigInt::from(outcome.skipped_reads),
            completeness: completeness_to_js(outcome.completeness),
            duration_millis: BigInt::from(outcome.duration.as_millis() as u64),
        })
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

/// A native scan-session (mission §4.1/§4.14). See the module-level comment
/// above for the create-once/refine-many lifecycle and the leak-nothing
/// boundary discipline this class follows.
#[napi]
pub struct NativeScanSession {
    inner: Arc<Mutex<Option<CoreScanSession>>>,
}

#[napi]
impl NativeScanSession {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(None)),
        }
    }

    /// Establishes the `UNKNOWN_INITIAL` baseline (mission §4.4): opens a
    /// fresh, session-owned handle to `pid` and captures every eligible
    /// candidate across `regions` (as returned by
    /// `NativeScanTarget.enumerateRegions()`, or a caller-constructed list)
    /// per `alignment`. May be called exactly once per session instance.
    #[napi(ts_return_type = "Promise<JsRefineOutcome>")]
    #[allow(clippy::too_many_arguments)]
    pub fn create_unknown_initial(
        &self,
        pid: u32,
        regions: Vec<JsRegion>,
        primitive_type: String,
        alignment: String,
        chunk_size_bytes: BigInt,
        overlap_bytes: BigInt,
        max_candidates: Option<BigInt>,
        max_snapshot_bytes: Option<BigInt>,
        max_session_bytes: Option<BigInt>,
        cancellation: &ScanCancellationHandle,
        progress: &ScanProgressHandle,
    ) -> Result<AsyncTask<CreateUnknownInitialTask>> {
        {
            let guard = self.inner.lock().map_err(|_| {
                Error::new(
                    Status::GenericFailure,
                    "internal_invariant_violation: session mutex poisoned",
                )
            })?;
            if guard.is_some() {
                return Err(session_already_initialized_err());
            }
        }

        let pt = primitive_type_from_str(&primitive_type)?;
        let alignment_mode = alignment_from_str(&alignment)?;
        let regions: Result<Vec<Region>> = regions.iter().map(js_to_region).collect();
        let regions = regions?;
        let (_, chunk_size, _) = chunk_size_bytes.get_u64();
        let (_, overlap, _) = overlap_bytes.get_u64();

        fn opt_u64(b: Option<BigInt>) -> Option<u64> {
            b.map(|v| v.get_u64().1)
        }

        let resource_limits = SessionResourceLimits {
            max_candidates: opt_u64(max_candidates),
            max_snapshot_bytes: opt_u64(max_snapshot_bytes),
            max_session_bytes: opt_u64(max_session_bytes),
            max_generations_retained: SessionResourceLimits::default_safe()
                .max_generations_retained,
        };

        Ok(AsyncTask::new(CreateUnknownInitialTask {
            inner: self.inner.clone(),
            pid,
            regions,
            policy: RegionSelectionPolicy::default_writable_value_scan(),
            primitive_type: pt,
            alignment: alignment_mode,
            chunk_config: ChunkPlanConfig {
                chunk_size_bytes: chunk_size,
                overlap_bytes: overlap,
            },
            resource_limits,
            cancellation: cancellation.inner.clone(),
            progress: progress.inner.clone(),
        }))
    }

    /// Re-reads the current candidate set and filters by `mode` (mission
    /// §4.5-§4.8): one of `"changed"`, `"unchanged"`, `"increased"`,
    /// `"decreased"`, `"increased_by"`, `"decreased_by"`, `"between"`.
    /// `valueNumber`/`valueBigint` supply the delta for
    /// `increased_by`/`decreased_by`; `minNumber`/`minBigint` and
    /// `maxNumber`/`maxBigint` supply the inclusive bounds for `between` —
    /// exactly one of the Number/BigInt pair per slot, per the session's own
    /// primitive type (same value-duality contract as `scanExact`).
    #[napi(ts_return_type = "Promise<JsRefineOutcome>")]
    #[allow(clippy::too_many_arguments)]
    pub fn refine(
        &self,
        mode: String,
        value_number: Option<f64>,
        value_bigint: Option<BigInt>,
        min_number: Option<f64>,
        min_bigint: Option<BigInt>,
        max_number: Option<f64>,
        max_bigint: Option<BigInt>,
        cancellation: &ScanCancellationHandle,
        progress: &ScanProgressHandle,
    ) -> Result<AsyncTask<RefineTask>> {
        let session_pt = {
            let guard = self.inner.lock().map_err(|_| {
                Error::new(
                    Status::GenericFailure,
                    "internal_invariant_violation: session mutex poisoned",
                )
            })?;
            let session = guard.as_ref().ok_or_else(session_not_initialized_err)?;
            session.primitive_type()
        };

        let refine_mode = refine_mode_from_js(
            session_pt,
            &mode,
            value_number,
            value_bigint,
            min_number,
            min_bigint,
            max_number,
            max_bigint,
        )?;

        Ok(AsyncTask::new(RefineTask {
            inner: self.inner.clone(),
            mode: refine_mode,
            cancellation: cancellation.inner.clone(),
            progress: progress.inner.clone(),
        }))
    }

    /// A bounded, deterministically-ordered page of the current candidate
    /// set (mission §4.3/§4.14's pagination requirement) — synchronous,
    /// since it is a plain in-memory slice, not a re-read of target memory.
    #[napi]
    pub fn get_results(&self, offset: BigInt, limit: u32) -> Result<Vec<JsScanMatch>> {
        let guard = self.inner.lock().map_err(|_| {
            Error::new(
                Status::GenericFailure,
                "internal_invariant_violation: session mutex poisoned",
            )
        })?;
        let session = guard.as_ref().ok_or_else(session_not_initialized_err)?;
        let (_, offset_u64, _) = offset.get_u64();
        let page = session.candidates_page(offset_u64, limit as u64);
        Ok(page
            .into_iter()
            .map(|(address, value)| scan_match_to_js(CoreScanMatch { address, value }))
            .collect())
    }

    /// Full generation history recorded so far (mission §4.9), oldest
    /// first, bounded by `maxGenerationsRetained`.
    #[napi]
    pub fn generation_history(&self) -> Result<Vec<JsGenerationRecord>> {
        let guard = self.inner.lock().map_err(|_| {
            Error::new(
                Status::GenericFailure,
                "internal_invariant_violation: session mutex poisoned",
            )
        })?;
        let session = guard.as_ref().ok_or_else(session_not_initialized_err)?;
        Ok(session
            .generation_history()
            .iter()
            .cloned()
            .map(generation_record_to_js)
            .collect())
    }

    /// Current status snapshot, including a live (never cached)
    /// stale-target check (mission §4.2).
    #[napi]
    pub fn status(&self) -> Result<JsSessionStatus> {
        let guard = self.inner.lock().map_err(|_| {
            Error::new(
                Status::GenericFailure,
                "internal_invariant_violation: session mutex poisoned",
            )
        })?;
        let session = guard.as_ref().ok_or_else(session_not_initialized_err)?;
        Ok(JsSessionStatus {
            pid: session.identity().pid,
            primitive_type: session.primitive_type().to_string(),
            alignment: alignment_str(session.alignment()).to_string(),
            generation: session.generation() as u32,
            candidate_count: BigInt::from(session.candidate_count()),
            candidate_memory_bytes: BigInt::from(session.candidate_memory_bytes()),
            last_completeness: completeness_to_js(session.last_completeness().clone()),
            is_stale: session.verify_not_stale().is_err(),
        })
    }

    /// Releases the session's handle and candidate storage immediately
    /// (mission §4.15) rather than waiting for garbage collection. Safe to
    /// call more than once, and safe to call before `createUnknownInitial`.
    #[napi]
    pub fn close(&self) {
        if let Ok(mut guard) = self.inner.lock() {
            *guard = None;
        }
    }

    #[napi]
    pub fn is_initialized(&self) -> bool {
        self.inner.lock().map(|g| g.is_some()).unwrap_or(false)
    }
}

impl Default for NativeScanSession {
    fn default() -> Self {
        Self::new()
    }
}
