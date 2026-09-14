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
pub mod policy;
pub mod reader;
pub mod region;
pub mod target;

pub use cancellation::CancellationToken;
pub use chunk::{plan_chunks, ChunkPlanConfig, ChunkSpec};
pub use completeness::{ScanCompleteness, ScanMetrics, SkipReason, SkippedRange};
pub use error::{ErrorKind, ScannerError, ScannerResult};
pub use policy::RegionSelectionPolicy;
pub use reader::{
    read_region_chunked, read_region_chunked_with_progress, read_regions_chunked,
    read_regions_chunked_with_progress, ChunkReadResult, ChunkReadStatus, ReadBudget,
};
pub use region::{enumerate_regions, CommitState, Region, RegionEnumerationResult, RegionKind};
pub use target::{HandleStatus, ProcessHandle, TargetArchitecture, TargetDescriptor};
