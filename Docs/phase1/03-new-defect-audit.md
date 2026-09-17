# Phase 1 / Stage 1 — New Defect Audit (beyond the 6 known defects)

Audit of 17 categories from the mission's extended checklist (integer overflow through fake-vs-production divergence), run against the same file set as docs 01/02, at HEAD `3b8c1c33c0`. Read-only; no production source modified. IDs use the mission's suggested `P1-SCAN-NNN` format, distinct from the roadmap-level `D01`–`D18` ledger (which already covers the 6 known defects as D01–D06) and never reusing `P0-SCAN-001` (the already-closed `scanFirstRange` truth-reporting repair).

## Confirmed new defects

### P1-SCAN-001 — Hardcoded 8-byte pointer width, no 32-bit/WOW64 detection

**Location**: `pointer-scanner.ts:170-177` (8-byte stride, `readBigUInt64LE`), `native-memory-driver.ts:424-443` (`readPointer` always requests `'uint64'`). No bitness check exists anywhere in the codebase (confirmed via repo-wide grep for `Wow64`/`IsWow64`/`bitness`).

**Failure scenario**: attaching to a 32-bit (WOW64) target process, where real pointers are 4 bytes at 4-byte-aligned slots. Scanning with an 8-byte stride reads pairs of unrelated adjacent 32-bit pointers as one bogus 64-bit value and skips half the real pointer slots — a silent, total failure of pointer scanning against any 32-bit game, with no error surfaced.

### P1-SCAN-002 — `scanNextFromSnapshot` missing the NaN/non-finite guard its sibling has

**Location**: `memory-scanner.ts:391-432`. Its sibling `scanNextFromSnapshotMultiType` (line 548) explicitly drops non-finite decodes with a documented rationale ("arbitrary bytes frequently produce NaN... never a meaningful game stat"); `scanNextFromSnapshot` has no equivalent gate.

**Failure scenario**: a single-type `changed`/`unchanged` narrowing scan against `float`/`double` data will report large numbers of pure-noise NaN-vs-NaN "changed" matches (`NaN !== NaN` is `true` in JS), inflating the candidate list with garbage the multi-type sibling would have filtered.

### P1-SCAN-003 — Fixed absolute `DELTA_EPSILON = 1e-4` is magnitude-blind

**Location**: `memory-scanner.ts:302,316-319` (`increasedBy`/`decreasedBy`).

**Failure scenario**: for a `double` stat in the billions+ range, a single subtraction's IEEE-754 rounding error can already exceed `1e-4` in absolute terms — a legitimately exact delta match silently fails ("increased by exactly 12" never matches). For a stat that moves in increments smaller than `1e-4` (e.g. a fractional percentage), genuinely different deltas collapse into the same epsilon window and falsely match.

### P1-SCAN-004 — No chunking anywhere; values/patterns spanning adjacent regions are missed by construction

**Location**: every scan function (`memory-scanner.ts`, `pointer-scanner.ts`, `aob-resolver.ts`, `signature-engine.ts`) reads exactly one `readBuffer(region.baseAddress, region.size)` per enumerated region with a hard `buf.length` boundary — no cross-region stitching exists at all.

**Failure scenario**: a value or AOB pattern whose bytes straddle the boundary between two adjacent, separately-enumerated committed regions can never be found, independent of and in addition to the already-known 1 MiB cap (D02). Fixing D02 alone (e.g. by chunking a single region's read) would not fix this without also reading a small overlap window *across* region boundaries.

### P1-SCAN-005 — All first-scan functions are fully synchronous with no yield points

**Location**: `scanFirst`/`scanFirstRange`/`scanFirstUnknown`/`scanFirstByComparison` (`memory-scanner.ts`) — no `async`, no `await`, no yield point in any loop body.

**Failure scenario**: a scan approaching the 2 GiB `maxTotalBytes` budget (documented at ~2.2s for ~1 GiB) blocks the entire Electron main process — all other IPC traffic, freeze ticks, and UI responsiveness — for the scan's full duration. This is also the concrete, structural reason today's scanner cannot support cancellation at all: there is no point in the loop where a cancellation check could run without first restructuring it to yield periodically. Directly informs doc 06's async-worker-pool design decision.

### P1-SCAN-006 — `unknownSnapshots` Map has no cap on key count or TTL

**Location**: `live-memory-session.ts:269` (declaration), `:721-730` (`scanFirstUnknown` sets, no cap check), `:742-756` (`scanNextFromUnknown` is the *only* eviction path, and only runs if the caller follows through for that exact key).

**Failure scenario**: each unknown-value baseline can hold up to 512 MiB of raw region-byte copies (`memory-scanner.ts:25`), keyed per-cheat. A user who starts several unknown-value discovery flows without completing each one (abandoned scratch work, changed their mind mid-flow) accumulates multiple abandoned ~512 MiB entries for the life of the attach session — unbounded main-process memory growth with no LRU/TTL, unlike the session's own `confirmedWrites` ledger, which has both `MAX_CONFIRMED_WRITES` and `CONFIRMED_WRITE_TTL_MS` (`live-memory-session.ts:95,106`) — i.e. this discipline exists elsewhere in the same file and was not applied here.

### P1-SCAN-007 — `confirmWrite` TOCTOU race across its `await`

**Location**: `live-memory-session.ts:864-934`. `pendingProposals.get(proposalId)` happens before an `await this.remoteConnectionObserver(...)`; the proposal is only deleted from the map *after* the write executes, and nothing re-checks `pendingProposals.has(proposalId)` after the await (only `this.revoking` is rechecked, line 902).

**Failure scenario**: two `confirmWrite(proposalId)` calls for the same proposal in close succession (renderer double-submit, retried IPC call) can both read the still-present proposal before either awaits, both pass validation, and both call `driver.writeMemory` — a genuine double-write, plus a second `recordConfirmedWrite` that overwrites the first ledger entry with `rawBefore: null` (because `pendingRawBefore.delete` already ran on the first call), silently degrading that entry's exact-byte rollback fidelity. Note: `rollback()` has a materially better-protected analogous path (re-checks current memory against `manifest.valueAfter` before proceeding) — this defect is specific to `confirmWrite`, not general to the propose/confirm/rollback family.

### P1-SCAN-008 — No batching/pagination for scan results crossing IPC

**Location**: `electron/live-memory-ipc.ts:485-532` (`live-memory-scan-first`, `live-memory-scan-first-auto-matrix`), serialized via `serializeScanResult`/`serializeAutoMatrixResult` (lines 1713-1753).

**Failure scenario**: up to `DEFAULT_MAX_MATCHES` (10,000) matches — multiplied across every mode×dataType bucket for the auto-matrix endpoint — cross Electron's structured-clone IPC boundary in a single message with no streaming or paging. A worst-case result set is a large, un-chunked serialization/deserialization cost on both ends and a large single-message payload.

### P1-SCAN-009 — Additional hardcoded caps not in the previously-known list

Catalogued for the redesign document (doc 06), not necessarily defects individually, but material to the migration/exit-gate design: `MIN_ADDR`/`MAX_ADDR` user-mode bounds (`native-memory-driver.ts:152-153`), `MAX_FREEZE_DURATION_MS` (6h), `MAX_CONFIRMED_WRITES` (50), `CONFIRMED_WRITE_TTL_MS` (30min), `MIN_FREEZE_INTERVAL_MS`/`MAX_FREEZE_INTERVAL_MS` (50/5000ms) — all `live-memory-session.ts`; pointer-scanner's `DEFAULT_MAX_OFFSET_PER_LEVEL` (2048)/`DEFAULT_MAX_CANDIDATES_PER_LEVEL` (3)/`DEFAULT_MAX_BYTES_PER_SCAN` (128 MiB); `MAX_FREEZES_PER_PROCESS`(8)/`MAX_FREEZES_GLOBAL`(32) (`freeze-concurrency-registry.ts`); audit-log `DEFAULT_MAX` (500 entries); research-tool window/region caps (`hex-inspector.ts`, `memory-viewer.ts`); `openProcess` PID sanity bound (0–999,999).

### P1-SCAN-010 — `FakeMemoryDriver` is materially more permissive than the real driver, beyond the known 1 MiB gap

**Location**: `tests/fixtures/fake-memory-driver.ts`. Three additional divergences from `native-memory-driver.ts`, beyond the already-known missing 1 MiB `readBuffer`/`writeBuffer` cap:
1. **No address-range validation** — the real driver's `validateAddress()` (rejects outside `[0x10000, 0x7FFFFFFF0000]`) has no equivalent in the fake; tests can exercise addresses the real driver would categorically reject.
2. **No finite-value validation on writes** — the real driver's `writeMemory` throws on non-finite (`NaN`/`Infinity`) values; the fake's does not.
3. **No PID upper-bound check** — the real driver rejects `pid > 999999`; the fake accepts any PID.

**Failure scenario**: the entire scanner/session unit-test suite (100% `FakeMemoryDriver`-based, per doc 01/08) is structurally unable to catch a class of bug where production code relies on the real driver's validation throwing (or not throwing) in a specific case, because the fake silently permits inputs the real driver would reject. This compounds the already-known 1 MiB-cap test-blindness (doc 02) into a broader "the fixture is not a faithful contract double" finding, material to doc 08's test-strategy redesign.

## Explicitly checked, not found / does not apply

| # | Category | Finding |
|---|---|---|
| 1 | Integer/address overflow | `toNativeAddress()` throws rather than truncates above `Number.MAX_SAFE_INTEGER`; all bigint deltas used as `Number()` are pre-bounded (offset/module-relative, never full addresses); `validateAddress` fails closed. No overflow path found. |
| 3 | Endianness | 100% consistent `*LE` usage across every encode/decode/read/write site, including the fake driver. Correct for the x86/x64-only target. |
| 6 | Duplicate results within one scan | `scanFirst`'s `searchOffset = found + 1` strictly advances past each hit; all `offset += step` loops are non-overlapping; region enumeration returns non-overlapping VAD regions by OS contract. No duplication path found (auto-matrix's same-address-different-bucket behavior is intentional multi-interpretation, not a duplicate-address bug). |
| 7 | Stale results after process restart | The OS-level `HANDLE` is bound to the process kernel object, not the numeric PID — a PID-reuse scenario causes reads against the stale handle to fail/throw (caught, not silently misdirected to the new process). App-level identity re-verification (`verifyAttachedProcessIdentity`) is enforced on every write/rollback/freeze-tick path but is *not* called from any pure-read scan path — noted as a defense-in-depth gap worth tracking, but not a demonstrated failure given the OS-handle behavior. |
| 11 | Progress exceeding 100% / false-complete states | No progress-percentage computation exists anywhere in the scan pipeline or its two renderer consumers today — there is no such computation to be wrong. Directly informs doc 06's requirement that the new progress model be bounded `[0,100]` by construction from day one. |
| 13 (scan-interleaving portion) | Concurrent scan races | All first-scan functions are synchronous with no internal `await`; Node's run-to-completion semantics preclude true interleaving of two scan calls' internal loops. (The `confirmWrite` TOCTOU race, a genuinely different code path, is P1-SCAN-007 above.) |
| 14 (BigInt-serialization portion) | Raw BigInt hitting IPC/JSON | Every IPC serialization site consistently `.toString()`s bigints before returning them; none pass a raw `BigInt` into a response payload. (The batching/pagination gap is P1-SCAN-008 above.) |
| 15 | Result ordering nondeterminism | Region enumeration and per-region match iteration are both strictly sequential with no parallel fan-out; order is deterministic and reproducible for a fixed process memory state (it legitimately differs *between separate process launches* due to ASLR, which is expected, not a defect). |

## Total Phase-1 defect ledger

6 known/reproduced (D01–D06, doc 02) + 10 newly confirmed (P1-SCAN-001 through P1-SCAN-010, this document) = **16 total Phase-1-scope scanner defects**, all dispositioned (either reproduced-and-designed-against in doc 06/07, or catalogued for the migration ladder in doc 09). Zero orphans: every defect ID above is referenced from at least one of doc 06 (architecture fix), doc 07 (semantics fix), or doc 09 (migration-ladder disposition).
