# Phase 1 / Stage 6 — Error Model

## §6.14 — structured error taxonomy

`ErrorKind` (`error.rs`), 12 variants (10 pre-existing + 2 new this mission):

| Variant | Since | Meaning |
|---|---|---|
| `TargetUnavailable` | Stage 2 | Target could not be opened, or a handle to it is no longer valid |
| `TargetExited` | Stage 2 | Target has exited (`GetExitCodeProcess`-confirmed) |
| `AccessFailure` | Stage 2 | OS denied access to an otherwise-valid handle/region/read |
| `RegionEnumerationFailure` | Stage 2 | `VirtualQueryEx` itself failed or returned untrustworthy data |
| `ReadFailure` | Stage 2 | A read failed for a reason other than access/exit |
| `InvalidConfiguration` | Stage 2 | Caller-supplied configuration is invalid |
| `AddressOverflow` | Stage 2 | Address/size arithmetic would overflow |
| `UnsupportedArchitecture` | Stage 2 | Target architecture undetermined/unsupported |
| `InternalInvariantViolation` | Stage 2 | A bug in this crate, not an environment condition |
| `ResourceExhaustion` | Stage 2 | A configured resource bound was reached |
| **`CorruptSnapshot`** | **Stage 6** | A persisted session-snapshot file failed its checksum, is malformed JSON, or has a corrupted enum-label field |
| **`UnsupportedSnapshotVersion`** | **Stage 6** | A persisted snapshot's schema version does not match this build's supported version |

Every `ScannerError` carries `kind: ErrorKind`, `message: String`, and `os_error_code: Option<u32>` — a caller can always branch on `kind` alone; `message`/`os_error_code` are diagnostic-only, never required for correct behavior. No random raw string is the primary API surface anywhere — `pattern.rs`'s separate `PatternParseErrorKind` converts into `ScannerError`'s `InvalidConfiguration` via `From`, keeping a single external taxonomy.

**Reviewed against the mission's example list, not blindly copied:** `ProcessNotFound`→`TargetUnavailable`, `AccessDenied`→`AccessFailure`, `ProcessExited`→`TargetExited`, `ReadFailed`→`ReadFailure`, `ArchitectureMismatch`→`UnsupportedArchitecture`, `ResourceLimit`→`ResourceExhaustion`, `InvalidPattern`→`InvalidConfiguration` (via the existing `PatternParseError` conversion) all already have a real, distinct home. `StaleSession` was considered and **not** added as a separate kind: every stale-session case observed in this codebase (`verify_not_stale()`'s failure path) is a target that has genuinely exited, and is already correctly reported as `TargetExited` — introducing a second, overlapping kind for the same real condition would violate the "do not add states without a real need" principle this mission applies elsewhere. `Cancelled` is deliberately not an `ErrorKind` at all — cancellation is a successful, expected outcome (`ScanCompleteness::Cancelled`), not a failure, and has never been modeled as one.

## §6.15 — Win32 diagnostics, audited

**Preserved, with the failing operation named, at every site that constructs a `ScannerError` from a Win32 call:** `target.rs`'s `OpenProcess` (both read-only and read-write variants), `GetExitCodeProcess`, `IsWow64Process`, and `GetProcessTimes` failure paths all call `ScannerError::with_os_code(kind, "OperationName(...) failed", os_error_code)` — the raw `GetLastError()` value and the specific API name both survive into the error's `Display` output (`"{kind}: {message} (os_error={code})"`), never collapsed into a generic "scan failed."

**Two real, reviewed exceptions, kept as-is with reasons, not silently missed:**

1. `reader.rs`'s `read_chunk` classifies a raw `ReadProcessMemory` failure via `GetLastError()` into `ChunkReadStatus::OsError { code }` — the numeric code is preserved, but travels through a different, read-result-level type (`ChunkReadResult`), not a `ScannerError`, because this function's return type is a per-chunk read outcome, not a fallible operation in the `Result<T, ScannerError>` sense. No diagnostic information is lost; it just isn't wrapped in the same envelope.
2. `region.rs`'s `enumerate_regions` deliberately discards `GetLastError()` on a `VirtualQueryEx` failure (`let _ = unsafe { GetLastError() };`, with an explicit comment stating this is intentional). This path returns `Ok(RegionEnumerationResult { stop_reason: Some(...), .. })`, not an `Err(ScannerError)`, so there is no `os_error_code` slot to put it in without changing that struct's shape. Reviewed this mission and left unchanged: no caller currently inspects a region-enumeration-failure Win32 code, and `RegionEnumerationResult`'s `stop_reason: Option<ErrorKind>` already gives a real, actionable classification (`TargetExited` vs `RegionEnumerationFailure`) without it. Recorded here as a known, reviewed, low-priority diagnostics gap for a future stage if real evidence of need appears — not fixed speculatively.

No secrets or irrelevant process data are ever included in any error message (confirmed by inspection — every message names an operation and, at most, an address/byte offset/PID, all already caller-supplied or caller-visible).

## §6.16 — partial read hardening, cross-referenced

Explicit real tests exist for every scenario the mission lists: readable→unreadable transition (`protection_change_to_noaccess_between_scans_is_reported_truthfully_not_as_a_crash`), decommit during use (`decommitted_region_is_skipped_not_crashed_and_recommit_restores_it`, and the mid-scan variant `region_is_decommitted_mid_scan_via_deterministic_progress_callback_sync`), guard/`PAGE_NOACCESS` pages (`zero_matches_under_unreadable_page_is_not_authoritative_not_found`, pre-existing from Stage 5, and `inaccessible_page_yields_completewithskippedregions_not_complete` from Stage 2). See doc 66 for the full region-mutation test inventory. Every one of these produces truthful completeness (`CompleteWithSkippedRegions` or a more specific non-`Complete` variant) with zero silent skip-as-success and zero crashes.
