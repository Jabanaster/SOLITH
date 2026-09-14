# Phase 1 / Stage 6 — Session Persistence

## §6.9 — session serialization boundary

**Before this mission: greenfield.** A full repo search confirmed no existing native-scanner session serialization anywhere — the only persistence-shaped code in the repository (`src/core/live-memory/research/session-snapshot.ts`) is a separate, TS-authored "research watchlist" concept that never touches `ScanSession`/`CoreScanSession` state.

**What is now persistable** (`SessionSnapshot`/`SessionSnapshotPayload`, `native/solith-scanner-core/src/session_snapshot.rs`):

- Schema/build identity: `schemaVersion`, `scannerCoreVersion`, `endianness`, `architecture`.
- Scan configuration: `primitiveType`, `alignment`, `chunkSizeBytes`, `overlapBytes`, `maxCandidates`, `maxSnapshotBytes`, `maxSessionBytes`.
- Process identity: `processPid`, `processCreationTimeFiletime` (the same `ProcessIdentity` the live session already tracks).
- Optional, caller-supplied, unverified `targetExecutableHint`.
- Session history: `generation`, `generationHistory` (flattened — see below), `candidateCount`, `lastCompletenessLabel`.
- `takenAtUnixMillis` — a fresh wall-clock timestamp captured at export time (not derived from the session's internal `Instant`, which is monotonic-only and cannot be converted to wall-clock).
- `checksum` (see §6.11).

**What is never persisted:**

- The live OS `ProcessHandle` — a `SessionSnapshot` carries only the plain-data identity fields, never the handle itself.
- Raw candidate addresses/values — see §6.10.
- Full `ScanCompleteness` payloads (e.g. a `CompleteWithSkippedRegions`'s `skipped: Vec<SkippedRange>`) — each `generationHistory` entry keeps only a stable `completenessLabel` string, keeping snapshot size bounded regardless of how many regions a real scan skipped.

**Persistence never bypasses stale-target safety and never auto-constructs a live session:** `SessionSnapshot::classify_recovery_status()` is a pure, read-only query — it opens a fresh `ProcessHandle` by PID purely to check identity, and returns one of three labels (see §6.12); nothing in this module, on either the save or load path, ever produces a `ScanSession`. Restoring a working session always requires a separate, explicit `createUnknownInitial` call from the caller.

## §6.10 — candidate snapshot persistence: evaluated, deferred with reason

**Determination: not persisted, by deliberate design, not by "not practical in Phase 1" default-punting.**

- **Size/serialization cost:** candidate data (`CandidateStore`: `Vec<u64>` addresses + values) is genuinely small enough to serialize cheaply — this was not the blocking concern.
- **Process identity coupling / stale-restore risk — the real, decisive reason:** candidate *addresses* are absolute virtual addresses from one specific process instance. Windows ASLR means a restarted process, or even a fresh attach to a different instance of the *same* executable, will almost certainly have different base addresses. A restored snapshot's stored addresses would be silently wrong for a newly-attached process — exactly the "unsafe restore semantics" this mission's own escape clause (`"Do not force persistence if it creates unsafe semantics"`) exists to prevent. This is not a hypothetical: §6.12 already forbids "automatically trust old addresses," and no amount of clever serialization changes that ASLR makes a bare address non-portable across process instances.
- **Versioning/integrity:** would be straightforward if addresses were safe to restore at all — moot given the above.

**What would make it safe (not attempted this stage, explicitly out of scope):** storing candidates as module-relative offsets (module base + offset) instead of absolute addresses, so a restore could re-resolve them against a freshly-attached process's own module bases. This requires module-enumeration/base-resolution support this crate does not yet have, and is recorded here as a real, evidenced recommendation for a future stage — not guessed at or half-implemented now. Only metadata (§6.9) is persisted this stage.

## §6.11 — persistence versioning

Every persisted field the mission's checklist names is present: `schemaVersion` (locked at `1`, `SNAPSHOT_SCHEMA_VERSION`), `scannerCoreVersion` (`env!("CARGO_PKG_VERSION")`), `endianness`, `architecture` (`std::env::consts::ARCH`), `primitiveType`, `processPid`+`processCreationTimeFiletime` (process identity), `takenAtUnixMillis` (timestamp), and a `checksum` (FNV-1a 64-bit, computed over every other field's canonical JSON serialization — a non-cryptographic integrity check appropriate for detecting accidental disk/transit corruption of a local file, not for defeating a deliberate adversary).

**Rejection is clean and total, never a partial/best-effort parse:**

- Schema version mismatch (older or newer than the one this build supports) → `ErrorKind::UnsupportedSnapshotVersion`, rejected before any further validation.
- Checksum mismatch (tampered or corrupted content) → `ErrorKind::CorruptSnapshot`.
- Malformed JSON → `ErrorKind::CorruptSnapshot`.
- Unrecognized `primitiveType`/`alignment` label (a corrupted or hand-edited value that parses as valid JSON but isn't a real enum spelling) → `ErrorKind::CorruptSnapshot`.

All four rejection paths are unit-tested (`rejects_unsupported_schema_version`, `rejects_tampered_field_via_checksum_mismatch`, `rejects_malformed_json_outright`, `rejects_unrecognized_primitive_type_label`) and the tamper case is additionally proven at the napi/JS boundary against a real saved-then-corrupted file (`session.test.js`'s snapshot round-trip test).

## §6.12 — session recovery

`SessionSnapshot::classify_recovery_status()` returns exactly one of three labels, never "live":

- **`inactive`** — no process with the snapshot's PID currently exists, *or* a process with that PID exists but has already exited (`GetExitCodeProcess` reports non-`Open`). The second half of this check is a real, deliberately-designed correctness fix within this mission: an initial implementation checked only whether `OpenProcess` by PID succeeded, and a real napi test (`session: a snapshot taken after the target exits classifies as inactive on reload`) caught it returning `recoverable_metadata` for an already-exited process — Windows can keep a PID's kernel process object (and therefore `OpenProcess`) reachable for a short time after exit, as long as some other handle to it is still open elsewhere in the system. The fix adds an explicit `HandleStatus::Open` check before trusting a creation-time match.
- **`stale`** — a process with the snapshot's PID exists, but its creation time does not match — the PID was reused by an unrelated process.
- **`recoverable_metadata`** — a process matching both PID and creation time still exists. Even here, nothing is auto-reattached: the caller (UI) must still initiate an explicit, user-driven reattach (a fresh `createUnknownInitial`), matching this document's §6.9 statement that this module never constructs a live session under any circumstance.

Tested end-to-end at both the core level (`classify_recovery_status_is_inactive_for_an_unreachable_pid`, `classify_recovery_status_is_recoverable_for_this_very_process`, `classify_recovery_status_is_stale_when_pid_matches_but_creation_time_does_not`) and the real napi/JS level against real spawned/killed fixture processes (`session.test.js`'s two persistence tests).
