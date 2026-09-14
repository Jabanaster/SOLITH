//! Safe session-persistence metadata boundary (Stage 6 §6.9-§6.12, §6.24).
//!
//! What this module deliberately does NOT do, per explicit mission scope:
//!
//! - It never persists a live OS handle (`ProcessHandle`) — a `SessionSnapshot`
//!   is a plain data snapshot, not a resumable live session.
//! - It never deserializes a snapshot into a live `ScanSession`. Loading a
//!   snapshot yields metadata and a [`SessionRecoveryStatus`] classification
//!   only; the caller must explicitly call `create_unknown_initial` against
//!   a freshly attached process to get a working session again (§6.12's "no
//!   implicit rebinding," matching `ScanSession`'s own handle-pinned
//!   stale-target design, see `session.rs`'s module doc).
//! - It never persists raw candidate addresses/values. Windows ASLR means a
//!   restarted or newly-attached process almost certainly has different
//!   base addresses than the process the snapshot was taken from, so a
//!   stored absolute address is not safely restorable without additional,
//!   not-yet-built module-relative-offset tracking (§6.10's "if not
//!   practical in Phase 1: persist metadata only, and document candidate
//!   persistence as deferred" escape hatch — exercised here deliberately,
//!   not by oversight). Only the candidate *count* is kept, for display.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::chunk::ChunkPlanConfig;
use crate::error::{ErrorKind, ScannerError, ScannerResult};
use crate::exact_scan::AlignmentMode;
use crate::session::{GenerationRecord, ProcessIdentity, ScanSession, SessionResourceLimits};
use crate::target::ProcessHandle;
use crate::types::PrimitiveType;

/// The schema version this build writes and the only version it accepts on
/// read (Stage 6 §6.11: "reject unsupported/newer/corrupt versions
/// cleanly" — this crate does not attempt cross-version migration today,
/// so "unsupported" and "newer" both simply mean "not exactly this").
pub const SNAPSHOT_SCHEMA_VERSION: u32 = 1;

/// A file this large or larger is refused before even attempting to parse
/// it — metadata-only snapshots (no raw candidate data) are always small;
/// anything near this size is either corrupt or not a snapshot at all.
pub const MAX_SNAPSHOT_FILE_BYTES: u64 = 1024 * 1024;

const SNAPSHOT_FILE_SUFFIX: &str = ".solith-session-snapshot.json";
const SNAPSHOT_FILE_TMP_SUFFIX: &str = ".solith-session-snapshot.json.tmp";

/// One persisted generation-history entry. Deliberately flat and
/// string/number-only (no nested `ScanCompleteness`, whose
/// `CompleteWithSkippedRegions`/`ReadErrorLimit` variants carry an
/// unbounded `Vec<SkippedRange>`) — a snapshot's size must stay small and
/// bounded regardless of how many regions a real scan skipped.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotGenerationRecord {
    pub generation: u64,
    pub mode_label: String,
    pub input_candidate_count: u64,
    pub output_candidate_count: u64,
    pub bytes_reread: u64,
    pub skipped_reads: u64,
    pub completeness_label: String,
    pub duration_millis: u64,
}

impl From<&GenerationRecord> for SnapshotGenerationRecord {
    fn from(g: &GenerationRecord) -> Self {
        SnapshotGenerationRecord {
            generation: g.generation,
            mode_label: g.mode_label.to_string(),
            input_candidate_count: g.input_candidate_count,
            output_candidate_count: g.output_candidate_count,
            bytes_reread: g.bytes_reread,
            skipped_reads: g.skipped_reads,
            completeness_label: g.completeness.label().to_string(),
            duration_millis: g.duration.as_millis() as u64,
        }
    }
}

/// Every field except `checksum` itself — kept as its own type so the
/// checksum can be computed over "everything else," deterministically,
/// without the checksum field being able to include itself.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshotPayload {
    pub schema_version: u32,
    pub scanner_core_version: String,
    pub endianness: String,
    pub architecture: String,
    pub primitive_type: String,
    pub alignment: String,
    pub chunk_size_bytes: u64,
    pub overlap_bytes: u64,
    pub max_candidates: Option<u64>,
    pub max_snapshot_bytes: Option<u64>,
    pub max_session_bytes: Option<u64>,
    pub process_pid: u32,
    pub process_creation_time_filetime: u64,
    /// Caller-supplied, never verified by this crate (matching
    /// `TargetDescriptor`'s existing "opaque hint, TS's responsibility to
    /// trust or not" pattern in `target.rs`).
    pub target_executable_hint: Option<String>,
    pub generation: u64,
    pub generation_history: Vec<SnapshotGenerationRecord>,
    pub candidate_count: u64,
    pub last_completeness_label: String,
    pub taken_at_unix_millis: u64,
}

/// A persistable, versioned, checksum-verified snapshot of a `ScanSession`'s
/// metadata (Stage 6 §6.9). "Checksum-verified" here means the non-
/// cryptographic corruption-detection check `fnv1a64` performs — see that
/// function's doc for the exact scope (accidental disk/transit corruption,
/// not a security or authenticity property). See the module doc for what
/// is deliberately excluded (live handle, candidate addresses/values).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SessionSnapshot {
    #[serde(flatten)]
    pub payload: SessionSnapshotPayload,
    pub checksum: u64,
}

/// A small, fast, non-cryptographic integrity hash (FNV-1a 64-bit) — this
/// guards against accidental disk/transit corruption (Stage 6 §6.24), not
/// against a deliberate adversary; a local snapshot file is not a security
/// boundary in the sense the mission's OWASP-style rules address.
fn fnv1a64(bytes: &[u8]) -> u64 {
    const OFFSET_BASIS: u64 = 0xcbf29ce484222325;
    const PRIME: u64 = 0x100000001b3;
    let mut hash = OFFSET_BASIS;
    for &b in bytes {
        hash ^= b as u64;
        hash = hash.wrapping_mul(PRIME);
    }
    hash
}

fn payload_checksum(payload: &SessionSnapshotPayload) -> ScannerResult<u64> {
    let bytes = serde_json::to_vec(payload).map_err(|e| {
        ScannerError::new(
            ErrorKind::InternalInvariantViolation,
            format!("failed to serialize snapshot payload for checksumming: {e}"),
        )
    })?;
    Ok(fnv1a64(&bytes))
}

fn is_known_primitive_type_label(label: &str) -> bool {
    PrimitiveType::ALL.iter().any(|p| p.to_string() == label)
}

impl SessionSnapshot {
    /// Captures the current, persistable-safe subset of `session`'s state.
    /// `target_executable_hint` is an optional, caller-supplied, unverified
    /// label (e.g. the executable filename) for display purposes only.
    pub fn capture(
        session: &ScanSession,
        target_executable_hint: Option<String>,
    ) -> ScannerResult<Self> {
        let identity: ProcessIdentity = session.identity();
        let chunk_config: ChunkPlanConfig = session.chunk_config();
        let resource_limits: SessionResourceLimits = session.resource_limits();
        let taken_at_unix_millis = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        let payload = SessionSnapshotPayload {
            schema_version: SNAPSHOT_SCHEMA_VERSION,
            scanner_core_version: env!("CARGO_PKG_VERSION").to_string(),
            endianness: if cfg!(target_endian = "little") {
                "little".to_string()
            } else {
                "big".to_string()
            },
            architecture: std::env::consts::ARCH.to_string(),
            primitive_type: session.primitive_type().to_string(),
            alignment: session.alignment().label().to_string(),
            chunk_size_bytes: chunk_config.chunk_size_bytes,
            overlap_bytes: chunk_config.overlap_bytes,
            max_candidates: resource_limits.max_candidates,
            max_snapshot_bytes: resource_limits.max_snapshot_bytes,
            max_session_bytes: resource_limits.max_session_bytes,
            process_pid: identity.pid,
            process_creation_time_filetime: identity.creation_time_filetime,
            target_executable_hint,
            generation: session.generation(),
            generation_history: session
                .generation_history()
                .iter()
                .map(SnapshotGenerationRecord::from)
                .collect(),
            candidate_count: session.candidate_count(),
            last_completeness_label: session.last_completeness().label().to_string(),
            taken_at_unix_millis,
        };
        let checksum = payload_checksum(&payload)?;
        Ok(SessionSnapshot { payload, checksum })
    }

    pub fn to_json(&self) -> ScannerResult<String> {
        serde_json::to_string_pretty(self).map_err(|e| {
            ScannerError::new(
                ErrorKind::InternalInvariantViolation,
                format!("failed to serialize session snapshot: {e}"),
            )
        })
    }

    /// Parses and validates `json`: schema version must match exactly
    /// ([`ErrorKind::UnsupportedSnapshotVersion`] otherwise), and the
    /// checksum must match a fresh recomputation over the parsed payload
    /// ([`ErrorKind::CorruptSnapshot`] otherwise). A snapshot that passes
    /// both checks is guaranteed to be a well-formed, unmodified artifact
    /// this build knows how to read — never a live session.
    pub fn from_json(json: &str) -> ScannerResult<Self> {
        let snapshot: SessionSnapshot = serde_json::from_str(json).map_err(|e| {
            ScannerError::new(
                ErrorKind::CorruptSnapshot,
                format!("malformed snapshot JSON: {e}"),
            )
        })?;

        if snapshot.payload.schema_version != SNAPSHOT_SCHEMA_VERSION {
            return Err(ScannerError::new(
                ErrorKind::UnsupportedSnapshotVersion,
                format!(
                    "snapshot schema_version {} is not supported by this build (expects exactly {})",
                    snapshot.payload.schema_version, SNAPSHOT_SCHEMA_VERSION
                ),
            ));
        }

        if !is_known_primitive_type_label(&snapshot.payload.primitive_type) {
            return Err(ScannerError::new(
                ErrorKind::CorruptSnapshot,
                format!(
                    "snapshot primitive_type \"{}\" is not a recognized value",
                    snapshot.payload.primitive_type
                ),
            ));
        }
        if AlignmentMode::from_label(&snapshot.payload.alignment).is_none() {
            return Err(ScannerError::new(
                ErrorKind::CorruptSnapshot,
                format!(
                    "snapshot alignment \"{}\" is not a recognized value",
                    snapshot.payload.alignment
                ),
            ));
        }

        let recomputed = payload_checksum(&snapshot.payload)?;
        if recomputed != snapshot.checksum {
            return Err(ScannerError::new(
                ErrorKind::CorruptSnapshot,
                "snapshot checksum mismatch — file is corrupt or was hand-edited",
            ));
        }

        Ok(snapshot)
    }

    /// Classifies whether the process this snapshot was taken from can
    /// still be found — a pure, read-only query; it never constructs a
    /// live `ScanSession`. Per §6.12, the caller (UI) must still require an
    /// explicit, user-initiated reattach even when this returns
    /// `RecoverableMetadata` — this method only answers "does a process
    /// matching this identity still exist," not "is it safe to resume."
    ///
    /// Deliberately checks [`ProcessHandle::status`] (`GetExitCodeProcess`),
    /// not just whether `OpenProcess` by PID succeeds: Windows can keep a
    /// PID's kernel process object (and therefore `OpenProcess`)
    /// successfully reachable for a short time after the process has
    /// already exited, as long as some other handle to it is still open
    /// elsewhere in the system — that must classify as `Inactive`, not
    /// `RecoverableMetadata`.
    pub fn classify_recovery_status(&self) -> SessionRecoveryStatus {
        let handle = match ProcessHandle::open_read_only(self.payload.process_pid) {
            Err(_) => return SessionRecoveryStatus::Inactive,
            Ok(h) => h,
        };
        if !matches!(handle.status(), Ok(crate::target::HandleStatus::Open)) {
            return SessionRecoveryStatus::Inactive;
        }
        match handle.process_creation_time_filetime() {
            Ok(current) if current == self.payload.process_creation_time_filetime => {
                SessionRecoveryStatus::RecoverableMetadata
            }
            _ => SessionRecoveryStatus::Stale,
        }
    }
}

/// The three restart-time states a persisted session may present as
/// (Stage 6 §6.12) — never "live."
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionRecoveryStatus {
    /// No process with the snapshot's PID exists right now.
    Inactive,
    /// A process with the snapshot's PID exists, but it is not the same
    /// process the snapshot was taken from (creation time differs) — the
    /// PID was reused by an unrelated process.
    Stale,
    /// A process matching both PID and creation time still exists. The
    /// snapshot's metadata could inform a fresh, explicit reattach, but
    /// nothing here performs that reattach automatically.
    RecoverableMetadata,
}

impl SessionRecoveryStatus {
    pub fn label(self) -> &'static str {
        match self {
            SessionRecoveryStatus::Inactive => "inactive",
            SessionRecoveryStatus::Stale => "stale",
            SessionRecoveryStatus::RecoverableMetadata => "recoverable_metadata",
        }
    }
}

fn validate_snapshot_id(id: &str) -> ScannerResult<()> {
    if id.is_empty() || id.len() > 200 {
        return Err(ScannerError::new(
            ErrorKind::InvalidConfiguration,
            "snapshot id must be 1-200 characters",
        ));
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(ScannerError::new(
            ErrorKind::InvalidConfiguration,
            "snapshot id must contain only ASCII letters, digits, '_', or '-' (no path separators or '..')",
        ));
    }
    Ok(())
}

fn snapshot_path(dir: &Path, snapshot_id: &str) -> PathBuf {
    dir.join(format!("{snapshot_id}{SNAPSHOT_FILE_SUFFIX}"))
}

/// Atomically writes `snapshot` under `dir` as `<snapshot_id>.solith-session-snapshot.json`
/// (Stage 6 §6.24: temp file + rename, so a crash mid-write never leaves a
/// half-written file at the real path). `snapshot_id` is validated to
/// reject path traversal — it is a bare identifier, never a path.
pub fn save_snapshot_to_dir(
    dir: &Path,
    snapshot_id: &str,
    snapshot: &SessionSnapshot,
) -> ScannerResult<PathBuf> {
    validate_snapshot_id(snapshot_id)?;
    std::fs::create_dir_all(dir).map_err(|e| {
        ScannerError::new(
            ErrorKind::AccessFailure,
            format!("failed to create snapshot directory {}: {e}", dir.display()),
        )
    })?;
    let json = snapshot.to_json()?;
    let final_path = snapshot_path(dir, snapshot_id);
    let tmp_path = dir.join(format!("{snapshot_id}{SNAPSHOT_FILE_TMP_SUFFIX}"));
    std::fs::write(&tmp_path, json.as_bytes()).map_err(|e| {
        ScannerError::new(
            ErrorKind::AccessFailure,
            format!(
                "failed to write snapshot temp file {}: {e}",
                tmp_path.display()
            ),
        )
    })?;
    std::fs::rename(&tmp_path, &final_path).map_err(|e| {
        ScannerError::new(
            ErrorKind::AccessFailure,
            format!(
                "failed to atomically replace snapshot file {}: {e}",
                final_path.display()
            ),
        )
    })?;
    Ok(final_path)
}

/// Loads and fully validates (size limit, schema version, checksum) the
/// snapshot named `snapshot_id` under `dir`.
pub fn load_snapshot_from_dir(dir: &Path, snapshot_id: &str) -> ScannerResult<SessionSnapshot> {
    validate_snapshot_id(snapshot_id)?;
    let final_path = snapshot_path(dir, snapshot_id);
    let metadata = std::fs::metadata(&final_path).map_err(|e| {
        ScannerError::new(
            ErrorKind::AccessFailure,
            format!("failed to stat snapshot file {}: {e}", final_path.display()),
        )
    })?;
    if metadata.len() > MAX_SNAPSHOT_FILE_BYTES {
        return Err(ScannerError::new(
            ErrorKind::CorruptSnapshot,
            format!(
                "snapshot file {} ({} bytes) exceeds the maximum of {MAX_SNAPSHOT_FILE_BYTES} bytes",
                final_path.display(),
                metadata.len()
            ),
        ));
    }
    let content = std::fs::read_to_string(&final_path).map_err(|e| {
        ScannerError::new(
            ErrorKind::AccessFailure,
            format!("failed to read snapshot file {}: {e}", final_path.display()),
        )
    })?;
    SessionSnapshot::from_json(&content)
}

/// Deletes the snapshot named `snapshot_id` under `dir`. Idempotent — a
/// missing file is not an error (Stage 6 §6.24's "safe deletion policy").
pub fn delete_snapshot_from_dir(dir: &Path, snapshot_id: &str) -> ScannerResult<()> {
    validate_snapshot_id(snapshot_id)?;
    let final_path = snapshot_path(dir, snapshot_id);
    match std::fs::remove_file(&final_path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(ScannerError::new(
            ErrorKind::AccessFailure,
            format!(
                "failed to delete snapshot file {}: {e}",
                final_path.display()
            ),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::completeness::ScanCompleteness;
    use crate::session::GenerationRecord;
    use std::time::Duration;

    fn sample_payload() -> SessionSnapshotPayload {
        SessionSnapshotPayload {
            schema_version: SNAPSHOT_SCHEMA_VERSION,
            scanner_core_version: "0.1.0".to_string(),
            endianness: "little".to_string(),
            architecture: "x86_64".to_string(),
            primitive_type: "u32".to_string(),
            alignment: "bytewise".to_string(),
            chunk_size_bytes: 1024 * 1024,
            overlap_bytes: 3,
            max_candidates: Some(1000),
            max_snapshot_bytes: None,
            max_session_bytes: None,
            process_pid: 4242,
            process_creation_time_filetime: 123456789,
            target_executable_hint: Some("game.exe".to_string()),
            generation: 2,
            generation_history: vec![],
            candidate_count: 17,
            last_completeness_label: "complete".to_string(),
            taken_at_unix_millis: 1_000_000,
        }
    }

    fn sample_snapshot() -> SessionSnapshot {
        let payload = sample_payload();
        let checksum = payload_checksum(&payload).unwrap();
        SessionSnapshot { payload, checksum }
    }

    #[test]
    fn round_trips_through_json_unchanged() {
        let snapshot = sample_snapshot();
        let json = snapshot.to_json().unwrap();
        let parsed = SessionSnapshot::from_json(&json).unwrap();
        assert_eq!(snapshot, parsed);
    }

    #[test]
    fn rejects_tampered_field_via_checksum_mismatch() {
        let snapshot = sample_snapshot();
        let mut json: serde_json::Value =
            serde_json::from_str(&snapshot.to_json().unwrap()).unwrap();
        json["candidateCount"] = serde_json::json!(999999);
        let tampered = serde_json::to_string(&json).unwrap();
        let err = SessionSnapshot::from_json(&tampered).unwrap_err();
        assert_eq!(err.kind, ErrorKind::CorruptSnapshot);
    }

    #[test]
    fn rejects_unsupported_schema_version() {
        let mut payload = sample_payload();
        payload.schema_version = SNAPSHOT_SCHEMA_VERSION + 1;
        let checksum = payload_checksum(&payload).unwrap();
        let snapshot = SessionSnapshot { payload, checksum };
        let json = snapshot.to_json().unwrap();
        let err = SessionSnapshot::from_json(&json).unwrap_err();
        assert_eq!(err.kind, ErrorKind::UnsupportedSnapshotVersion);
    }

    #[test]
    fn rejects_unrecognized_primitive_type_label() {
        let mut payload = sample_payload();
        payload.primitive_type = "not_a_real_type".to_string();
        let checksum = payload_checksum(&payload).unwrap();
        let snapshot = SessionSnapshot { payload, checksum };
        let json = snapshot.to_json().unwrap();
        let err = SessionSnapshot::from_json(&json).unwrap_err();
        assert_eq!(err.kind, ErrorKind::CorruptSnapshot);
    }

    #[test]
    fn rejects_malformed_json_outright() {
        let err = SessionSnapshot::from_json("{ this is not json").unwrap_err();
        assert_eq!(err.kind, ErrorKind::CorruptSnapshot);
    }

    #[test]
    fn generation_record_conversion_uses_stable_completeness_label_not_full_payload() {
        let record = GenerationRecord {
            generation: 3,
            mode_label: "changed",
            input_candidate_count: 10,
            output_candidate_count: 4,
            bytes_reread: 40,
            skipped_reads: 0,
            completeness: ScanCompleteness::Complete,
            duration: Duration::from_millis(12),
        };
        let snapshot_record = SnapshotGenerationRecord::from(&record);
        assert_eq!(snapshot_record.completeness_label, "complete");
        assert_eq!(snapshot_record.generation, 3);
        assert_eq!(snapshot_record.duration_millis, 12);
    }

    #[test]
    fn snapshot_id_rejects_path_traversal_and_separators() {
        for bad in ["../evil", "a/b", "a\\b", "", "..", "a.."] {
            let err = validate_snapshot_id(bad);
            assert!(err.is_err(), "expected {bad:?} to be rejected");
        }
        assert!(validate_snapshot_id("my-session_01").is_ok());
    }

    #[test]
    fn save_load_round_trip_and_atomic_replace_and_size_limit_and_deletion() {
        let dir = std::env::temp_dir().join(format!(
            "solith-snapshot-test-{}-{}",
            std::process::id(),
            fnv1a64(b"save_load_round_trip_and_atomic_replace_and_size_limit_and_deletion")
        ));
        let _ = std::fs::remove_dir_all(&dir);

        let snapshot = sample_snapshot();
        let path = save_snapshot_to_dir(&dir, "session-a", &snapshot).unwrap();
        assert!(path.exists());
        let loaded = load_snapshot_from_dir(&dir, "session-a").unwrap();
        assert_eq!(loaded, snapshot);

        // Overwrite (atomic replace) with a different payload.
        let mut payload2 = sample_payload();
        payload2.generation = 99;
        let checksum2 = payload_checksum(&payload2).unwrap();
        let snapshot2 = SessionSnapshot {
            payload: payload2,
            checksum: checksum2,
        };
        save_snapshot_to_dir(&dir, "session-a", &snapshot2).unwrap();
        let reloaded = load_snapshot_from_dir(&dir, "session-a").unwrap();
        assert_eq!(reloaded.payload.generation, 99);

        // Oversized file is rejected before parsing.
        let oversized_path = snapshot_path(&dir, "huge");
        std::fs::write(
            &oversized_path,
            vec![b'x'; (MAX_SNAPSHOT_FILE_BYTES + 1) as usize],
        )
        .unwrap();
        let err = load_snapshot_from_dir(&dir, "huge").unwrap_err();
        assert_eq!(err.kind, ErrorKind::CorruptSnapshot);

        // Deletion is idempotent.
        delete_snapshot_from_dir(&dir, "session-a").unwrap();
        assert!(!snapshot_path(&dir, "session-a").exists());
        delete_snapshot_from_dir(&dir, "session-a").unwrap();

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn classify_recovery_status_is_inactive_for_an_unreachable_pid() {
        // PID 4294967295 (u32::MAX) is never a real running process.
        let payload = SessionSnapshotPayload {
            process_pid: u32::MAX,
            ..sample_payload()
        };
        let checksum = payload_checksum(&payload).unwrap();
        let snapshot = SessionSnapshot { payload, checksum };
        assert_eq!(
            snapshot.classify_recovery_status(),
            SessionRecoveryStatus::Inactive
        );
    }

    #[test]
    fn classify_recovery_status_is_recoverable_for_this_very_process() {
        let handle = ProcessHandle::open_read_only(std::process::id()).unwrap();
        let creation_time = handle.process_creation_time_filetime().unwrap();
        let payload = SessionSnapshotPayload {
            process_pid: std::process::id(),
            process_creation_time_filetime: creation_time,
            ..sample_payload()
        };
        let checksum = payload_checksum(&payload).unwrap();
        let snapshot = SessionSnapshot { payload, checksum };
        assert_eq!(
            snapshot.classify_recovery_status(),
            SessionRecoveryStatus::RecoverableMetadata
        );
    }

    #[test]
    fn classify_recovery_status_is_stale_when_pid_matches_but_creation_time_does_not() {
        let payload = SessionSnapshotPayload {
            process_pid: std::process::id(),
            process_creation_time_filetime: 1, // definitely not this process's real creation time
            ..sample_payload()
        };
        let checksum = payload_checksum(&payload).unwrap();
        let snapshot = SessionSnapshot { payload, checksum };
        assert_eq!(
            snapshot.classify_recovery_status(),
            SessionRecoveryStatus::Stale
        );
    }
}
