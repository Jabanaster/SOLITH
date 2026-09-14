# Phase 1 / Stage 1 — Known Defect Reproductions

All six defects named in the Phase 1 mission (A–F) were independently investigated against HEAD `3b8c1c33c0`. Five were **empirically reproduced by executing the real, unmodified, exported production functions** (`scanFirst`, `scanFirstRange`, `scanAobInProcess`, `scanForPointerPath`) against crafted `MemoryDriver` fixtures in a temporary, isolated diagnostic script (`tmp-phase1-scanner-repro.mts`, run via `npx tsx`, then deleted — never committed, never touched production source). One (B, forced 4-byte alignment) was **confirmed absent** by the same method. Raw console output from that run is quoted verbatim below each finding.

The fixtures deliberately reused the *exact* real 1 MiB cap check from `native-memory-driver.ts:361-364` (same constant, same throw shape) so that a region "behind the cap" behaves identically to how memoryjs would behave against a real process — this is not a synthetic stand-in for the defect, it exercises the real defect mechanism end-to-end through real production logic.

---

## A. 1 MiB region-read cap — CONFIRMED, ID **D02**

**Location**: `src/core/live-memory/native-memory-driver.ts:356-364`
```ts
readBuffer(handle: LiveProcessHandle, address: bigint, size: number): Buffer {
  try {
    validateHandle(handle, 'readBuffer');
    validateAddress(address, 'readBuffer');
    if (size <= 0 || size > 1048576) {
      // Max 1MB buffer reads
      throw new Error(`Invalid buffer size: ${size} (must be > 0 and <= 1MB)`);
    }
```
This is a hard per-call cap enforced by **throwing**, not truncating. Every scanner call site reads an entire region in one `readBuffer(baseAddress, region.size)` call, and regions are filtered only against a 64 MiB `maxRegionBytes` (`memory-scanner.ts:11`) — so any real region between 1 MiB and 64 MiB (common: managed-runtime heaps, `.data`/`.rdata` sections) throws at the driver boundary on every single scan attempt.

**Reproduction** (2 MiB fixture region, target value planted at offset 1,500,000 — inside the region, past the 1 MiB cap):
```
=== D02/E — scanFirst against a 2 MiB region behind the real 1 MiB readBuffer cap ===
scanFirst result: {"matches":0,"regionsScanned":0,"bytesScanned":0,"truncated":false}
```
The value exists in the region but is never seen: `matches.length=0`, `truncated=false` — a "not found" that is actually "never scanned," reported as a complete, trustworthy negative.

**Status: REPRODUCED.** Matches ROADMAP.md's cited measurement (Audit 2 §16 S3: ~95.5% of a real Stardew Valley process's writable memory unread, 42.1 MB of 893 MiB actually scanned).

---

## B. Forced 4-byte alignment — NOT PRESENT (confirmed absent by execution, not just static reading)

Every scan function steps by `valueSize(dataType)` (`memory-scanner.ts:60-72`: byte→1, int32/uint32/float→4, double/int64→8), not a hardcoded 4. `pointer-scanner.ts` uses an explicit 8-byte step (correct for pointer-sized reads).

**Reproduction** (byte value planted at region offset 7, not a multiple of 4):
```
=== B — forced 4-byte alignment: confirm ABSENCE against the real scanFirst (byte-type, offset 1 reachable) ===
scanFirst(byte) result matches: [{"address":"30000007","value":85}]
```
The value at the non-4-aligned offset 7 **is** found when scanning as `byte` (step=1). This directly falsifies a fixed 4-byte stride.

**Status: NOT REPRODUCIBLE against current source — genuinely absent.** There is also no `int16`/`uint16` type in `LiveValueType` at all, so the "narrower type invisible" failure mode as originally described cannot occur today (that type simply isn't offered). If this defect was observed against a different code version, it is not present at HEAD `3b8c1c33c0`. Recommend the owner confirm whether B should be struck from the Phase-1 ledger or whether it refers to a different, not-yet-located code path.

---

## C. AOB false negative / cap behavior — CONFIRMED, ID **D04**

**Location**: `src/core/live-memory/aob-resolver.ts:71-103` (`scanAobInProcess`) and `signature-engine.ts:246-280` (`scanExactSignature`). Neither imposes its own region-size cap; both inherit the native driver's 1 MiB `readBuffer` cap uncapped, and both swallow the resulting throw in a bare `catch { continue; }`. Return types (`bigint | null`, `SignatureMatch | null`) carry **no truncation/incompleteness signal at all** — structurally worse than the value scanner's `ScanResult.truncated`, which at least exists even where it's misreported.

**Reproduction** (AOB pattern `DE AD BE EF 13 37` planted at region offset 1,800,000 — past the 1 MiB cap):
```
=== D04 — scanAobInProcess against the same region (AOB pattern also beyond the 1 MiB cap) ===
scanAobInProcess result: null (not found)
```
A genuinely present pattern reports as `null` with zero signal that its containing region was never scanned.

**Status: REPRODUCED.** Consistent with ROADMAP.md's cited Audit 2 §16 S2 finding. Wording correction (Stage 2 normalization, per the mission's explicit instruction): 120,245 AOB signatures exist in the compiled CT corpus, and the coverage defect demonstrated above can make any signature whose required searchable memory lies outside successfully-read coverage unresolvable — this is not the same claim as "all 120,245 signatures are categorically broken," which has not been independently verified against the real corpus by execution and is not asserted here.

No caps on match count, and no Vectorscan/napi-rs pattern engine is wired in anywhere (confirmed via repo-wide grep — the only `napi-rs`-adjacent hit is an unrelated transitive dependency in a separate backend service, `solith-hub-backend`).

---

## D. Pointer depth/truncation — CONFIRMED, ID **D05**

**Location**: `src/core/live-memory/pointer-scanner.ts:60-140`. `truncated` is only ever set `true` from (a) `scansPerformed >= MAX_TOTAL_SCANS`, or (b) `findPointersNear`'s own byte-budget cutoff. It is **never** set when the outer depth loop exits because `candidates.length >= MAX_RESULTS` (20) — the exact loop guard at line 102 (`candidates.length < MAX_RESULTS`) that stops depth iteration in that case leaves `truncated` untouched, and `levelsSearched` frozen at whatever depth last executed.

**Reproduction** (30 valid, module-anchored pointer candidates seeded at depth 1 alone — 10 more than `MAX_RESULTS`; `maxDepth` explicitly configured to 3):
```
=== D05 — scanForPointerPath: maxDepth configured 3, but MAX_RESULTS cap silently stops at depth 1 ===
scanForPointerPath result: {"candidates":20,"levelsSearched":1,"scansPerformed":1,"truncated":false}
```
`maxDepth=3` was configured; the run stopped after depth 1 (`levelsSearched:1`), returned exactly the 20-result cap, dropped 10 otherwise-valid candidates, never explored depths 2–3, and reported `truncated:false` throughout — the exact `maxDepth=3 / levelsSearched=1 / truncated=false` pattern named in the mission brief, reproduced against the real function with a concrete, reviewable fixture.

**Status: REPRODUCED.**

A second, narrower gap exists in `findPointersNear` itself (`pointer-scanner.ts:162-167`): an unreadable region is caught and skipped without affecting `truncated` — the same silent-catch shape as the value scanner's sibling defects (E, below).

---

## E. Sibling scan truth-reporting gaps — CONFIRMED, ID **D01**

Commit `c38d039` ("fix: scanFirstRange must set truncated when a region is unreadable") repaired exactly one function, `scanFirstRange`, and its own commit message states the scope explicitly: *"the other scan* functions in this file share the same catch-and-continue shape but are not exercised by any corrected test in this PR, so they are left untouched."*

**Five siblings in `memory-scanner.ts` share the identical shape and remain unfixed:**

| Function | Gap location | Sets `truncated` on unreadable-region catch? |
|---|---|---|
| `scanFirst` | `:160-166` | **No** |
| `scanFirstUnknown` | `:362-367` | **No** |
| `scanNextFromSnapshot` | `:405-412` | **No** |
| `scanNextFromSnapshotMultiType` | `:533-539` | **No** |
| `scanFirstByComparison` (backs `scanFirstAutoMatrix`) | `:610-615` | **No** |

**Reproduction** (same 2 MiB/1-MiB-cap fixture as A, run through both the broken and the repaired function for direct contrast):
```
=== D02/E — scanFirst against a 2 MiB region behind the real 1 MiB readBuffer cap ===
scanFirst result: {"matches":0,"regionsScanned":0,"bytesScanned":0,"truncated":false}

=== E — scanFirstRange against the same region (the ALREADY-FIXED sibling, for contrast) ===
scanFirstRange result: {"matches":0,"regionsScanned":0,"bytesScanned":0,"truncated":true}
```
Identical missed value in both cases (same fixture, same underlying failure); `scanFirstRange` honestly reports `truncated:true`, `scanFirst` reports `truncated:false` — the precise, currently-shipping asymmetry between the repaired function and its untouched siblings. `memory-scanner.test.ts:110-125` (`'scanFirst skips a region that becomes unreadable without aborting the whole scan'`) exists and passes today, and it never asserts `result.truncated` — consistent with (and independent confirmation of) this gap.

**Status: REPRODUCED**, for all five listed siblings by code-shape identity with the one directly executed (`scanFirst`); the same `catch { continue; }` (no `truncated = true`) shape is present verbatim in the other four at the cited line numbers.

---

## F. int64 mismatch — CONFIRMED, ID **D06**

**Location**: `types.ts:179-182` (`ScanMatch.value: number`), `memory-scanner.ts:92-93,111-112` (`encodeValue`/`decodeValue` coerce int64 through `BigInt(value)`/`Number(bigint)`), `native-memory-driver.ts:79-94,120-127,212-232` (generic `readMemory` maps `LiveValueType 'int64'` straight to the native string `'int64'`, then asserts `typeof result !== 'number'` throws — while the file's own comment at line 81 states memoryjs's native binding actually returns a `bigint` for 64-bit types).

**Reproduction** (real int64 max value `9223372036854775807n`, planted as raw bytes, read back through the real, exported `scanFirstRange` → `decodeValue` path):
```
=== D06 — int64 precision loss through the real scanFirstRange -> decodeValue path ===
true 64-bit value (bytes) : 9223372036854775807
scanFirstRange match.value: 9223372036854776000
Number.isSafeInteger(reportedValue): false
Collision check: Number(9223372036854775807n) === Number(9223372036854775805n) -> true
```
The real 64-bit value is misreported as a different number, fails `Number.isSafeInteger`, and — the collision check shows — **two genuinely different real int64 values become indistinguishable** once decoded through the scanner's number-typed pipeline. A caller cannot exact-match, compare, or safely display either value once scanned.

**Separate, unconfirmed-at-runtime sub-finding**: per the native driver's own comment and its `typeof result !== 'number'` guard, a generic `driver.readMemory(handle, addr, 'int64')` call (used by `scanNext` during refinement, and by `RealtimeScanner.pollOnce`) would receive a `bigint` from real memoryjs and throw on every call, which its caller's surrounding `catch { continue; }` would misreport as "address unreadable" rather than a type mismatch. This sub-finding is **logically derived from the code's own documented understanding of memoryjs's behavior**, not independently executed against the real native addon in Stage 1 (that requires a live Windows attach with a built `memoryjs`/vendored addon and a real target process — deferred to Stage 2/real-game validation per the mission's own test-architecture section). Flagged here as HIGH CONFIDENCE, not yet empirically closed.

`live-memory-session.ts`'s `compareRollbackValue` already fails closed on `!Number.isSafeInteger` for int64 at the write-rollback layer (tests: `rollback-float-integrity.test.ts:12-15`, `rollback-byte-integrity.test.ts:175-186`, both passing today) — proof the codebase already knows about and partially mitigates this class of problem for writes, but no equivalent full-precision path exists anywhere in the scan/read pipeline.

**Status: REPRODUCED** (precision loss + collision, via real executed code); native-`readMemory('int64')`-throws sub-claim carried forward as logically-proven-but-not-runtime-verified.

---

## Reproduction harness disposition

`tmp-phase1-scanner-repro.mts` was written to the repo root, executed once via `npx tsx tmp-phase1-scanner-repro.mts`, its full console output captured into this document, then **deleted** (`rm tmp-phase1-scanner-repro.mts`) before this document was finalized. `git status --short` confirms a clean worktree with no trace of the harness remaining. It imported only already-exported production functions (`scanFirst`, `scanFirstRange` from `memory-scanner.ts`; `scanAobInProcess` from `aob-resolver.ts`; `scanForPointerPath` from `pointer-scanner.ts`) and supplied hand-written `MemoryDriver` fixtures — it modified no production file, and left none behind.

## Summary table

| ID | Defect | Status | Real function exercised |
|---|---|---|---|
| D01 | Sibling scan-function truth-reporting gaps (`scanFirst` + 4 others) | REPRODUCED | `scanFirst` (direct); 4 siblings by identical code-shape |
| D02 | 1 MiB region-read cap silently drops 1 MiB–64 MiB regions | REPRODUCED | `scanFirst`, `scanFirstRange` |
| — (B) | Forced 4-byte alignment | ABSENT — not reproducible at HEAD `3b8c1c33c0` | `scanFirst` |
| D04 | AOB/signature cap-induced false negative, no truncation signal in return type | REPRODUCED | `scanAobInProcess` |
| D05 | Pointer-scan depth/result-cap truncation misreported as `truncated:false` | REPRODUCED | `scanForPointerPath` |
| D06 | int64 precision loss / value collision through the number-typed pipeline | REPRODUCED (scan path); driver-throw sub-claim logically proven, not yet runtime-verified | `scanFirstRange` |
