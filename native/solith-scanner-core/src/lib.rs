//! `solith-scanner-core` — pure Windows process-memory scanner mechanics
//! for SOLITH Phase 1 (Stage 2: native scanner foundation).
//!
//! This crate must not depend on Electron or Node. All JS/TS-facing
//! concerns (bigint conversion, async task scheduling, IPC) live in the
//! sibling `solith-scanner-napi` adapter crate. This crate owns only:
//! process-handle lifecycle internal to a scan operation, memory-region
//! enumeration, native memory reads, chunk construction/overlap,
//! read-result classification, low-level metrics, and typed native errors
//! — per the Phase 1 Stage 2 architectural boundary.

pub mod cancellation;
pub mod chunk;
pub mod completeness;
pub mod error;
pub mod exact_scan;
pub mod pattern;
pub mod pattern_scan;
pub mod policy;
pub mod reader;
pub mod region;
pub mod session;
pub mod session_snapshot;
pub mod target;
pub mod types;

pub use cancellation::CancellationToken;
pub use chunk::{plan_chunks, ChunkPlanConfig, ChunkSpec};
pub use completeness::{
    is_authoritative_absence, ScanCompleteness, ScanMetrics, SkipReason, SkippedRange,
};
pub use error::{ErrorKind, ScannerError, ScannerResult};
pub use exact_scan::{scan_exact, AlignmentMode, ExactScanResult, ScanMatch, ScanOptions};
pub use pattern::{
    parse_aob, pattern_from_raw_bytes, pattern_from_utf16le_str, pattern_from_utf8_bytes,
    pattern_from_utf8_str, NullTerminatorMode, Pattern, PatternByte, PatternKind,
    PatternParseError, PatternParseErrorKind,
};
pub use pattern_scan::{scan_pattern, PatternMatch, PatternScanOptions, PatternScanResult};
pub use policy::RegionSelectionPolicy;
pub use reader::{
    read_region_chunked, read_region_chunked_with_progress, read_regions_chunked,
    read_regions_chunked_with_progress, ChunkReadResult, ChunkReadStatus, ReadBudget,
};
pub use region::{
    enumerate_regions, enumerate_regions_with_cancellation, CommitState, Region,
    RegionEnumerationResult, RegionKind,
};
pub use session::{
    CandidateStore, GenerationRecord, ProcessIdentity, RefineMode, RefineOutcome, ScanSession,
    SessionResourceLimits,
};
pub use session_snapshot::{SessionRecoveryStatus, SessionSnapshot, SNAPSHOT_SCHEMA_VERSION};
pub use target::{HandleStatus, ProcessHandle, TargetArchitecture, TargetDescriptor};
pub use types::{PrimitiveType, PrimitiveValue};
