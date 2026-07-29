# Raw-Byte Rollback Feasibility and Disposition

## Finding: narrowly feasible, implemented

Prior evidence (`Lifecycle/remaining-risks.md` R-B11-LC-001) documented
"Raw-byte comparison requires native driver redesign" as the reason exact
rollback-state equality was unavailable. Direct inspection of the driver
boundary during Gate 2 shows this was not accurate for the *comparison*
half of the gap, and only a small additive change for the *write* half:

- `MemoryDriver.readBuffer(handle, address, size): Buffer` already existed
  and was already wired to the real `memoryjs` native addon (used by the
  memory scanner). Raw-byte **read** was already fully feasible with zero
  driver changes.
- The vendored `memoryjs` package (`vendor/memoryjs-3.5.1-patched/index.js`)
  already exports a native `writeBuffer(handle, address, buffer)` function —
  it was simply never exposed through this project's narrower
  `MemoryDriver` interface or `NativeMemoryDriver` wrapper. Raw-byte **write**
  required only additive exposure, not a native-driver redesign.

No new native dependency, no `node-gyp` change, no ABI change was required.

## Supported types, byte width, endianness

| LiveValueType | Byte width | Endianness | Raw-byte read | Raw-byte write |
|---|---|---|---|---|
| `byte` | 1 | n/a | Yes (`readBuffer`) | Yes (`writeBuffer`) |
| `int32` | 4 | little-endian (x86/x64 user-mode) | Yes | Yes |
| `uint32` | 4 | little-endian | Yes | Yes |
| `float` | 4 | little-endian (IEEE-754 binary32) | Yes | Yes |
| `double` | 8 | little-endian (IEEE-754 binary64) | Yes | Yes |
| `int64` | 8 | little-endian | Yes | Yes |
| `int16` / `uint16` / `uint64` / `boolean` | — | — | N/A — not supported `LiveValueType` values today (unchanged) |

`byteWidthForType()` in `src/core/live-memory/live-memory-session.ts` is the
single source of truth for these widths.

## Implementation (additive, non-breaking)

1. `src/core/live-memory/types.ts` — added `writeBuffer` to the
   `MemoryDriver` interface.
2. `src/core/live-memory/native-memory-driver.ts` — implemented `writeBuffer`
   by delegating to `memoryjs.writeBuffer`, with the same
   validateHandle/validateAddress/size-bound guards as the existing
   `readBuffer`.
3. `src/core/live-memory/live-memory-session.ts`:
   - `proposeWrite` best-effort captures `rawBefore` (exact bytes at the
     target address) before anything is written.
   - `confirmWrite` best-effort captures `rawAfter` (exact bytes immediately
     after the real write) and stores both alongside the existing
     `LiveWriteManifest` in the internal `confirmedWrites` ledger entry —
     never in the public `LiveWriteManifest`/`ConfirmWriteResult` /
     `RollbackResult` shapes, so raw bytes never cross the IPC boundary to
     the renderer and are never part of what gets logged.
   - `rollback` runs the byte-exact check **additively, after** the
     pre-existing `compareRollbackValue` numeric check — it can only ever
     make rollback *stricter* (reject a case the numeric check would have
     let through), never looser. When raw bytes were captured, the restore
     write is a single atomic `writeBuffer(rawBefore)` call instead of the
     old `writeMemory(valueBefore)` call, guaranteeing byte-for-byte
     fidelity (matters for NaN payloads and signed-zero encodings that a
     decoded-`number` round-trip cannot guarantee). When raw bytes are
     unavailable for an entry (capture failed, best-effort), rollback falls
     back to the exact pre-Gate-2 `writeMemory`-based restore — zero
     behavior change for that case.
4. `tests/fixtures/fake-memory-driver.ts` — extended so rollback tests can
   exercise the byte-level path without breaking the ~1,000 pre-existing
   tests that seed state via the untyped `setValue`/constructor path.

## Fail-closed guarantees preserved

- Ledger capacity is still checked **before** any memory write
  (`confirmWrite`) — unchanged.
- A confirmed write can still be rolled back exactly once — unchanged.
- All existing cleanup paths (`revokePendingAuthorizationsForCleanup`,
  `stopFreezeForCleanup`, `clearRollbackRecordsForCleanup`,
  `detachMemoryForCleanup`, `detach`, TTL purge) already clear the same Map
  entries that now also hold the raw-byte fields — no new cleanup path was
  needed; extending the existing entry shape was sufficient.
- Raw bytes are never logged, serialized, or returned across IPC. They live
  only inside the private `confirmedWrites`/`pendingRawBefore` maps.
- No dependency was added for comparison — `Buffer.prototype.equals` is a
  Node.js built-in.

## Residual risk, narrowed

R-B11-LC-001 is downgraded, not closed:

- The `int64` numeric safe-integer guard is unchanged (raw bytes are an
  *additional* safety net for int64, not a replacement — a value the driver
  API already can't represent exactly as a JS `number` is still rejected by
  the pre-existing check regardless of byte-level agreement).
- Best-effort capture means a small number of edge cases (raw-byte read/write
  failing at exactly the propose or confirm instant, e.g. a page becoming
  unreadable mid-operation) still fall back to the pre-existing numeric-only
  safety net for that one entry — this is a deliberate fail-open-to-the-old-
  already-shipped-behavior choice, not a new gap, and does not block the
  already-applied real write from completing.
- Raw-byte comparison for `int64`/`uint64` full 64-bit range remains bounded
  by the same driver API limitation noted before (memoryjs's `readMemory`
  for these types can return `bigint`, but this project's `MemoryDriver`
  interface still types `readMemory`'s return as `number` end-to-end); the
  byte-level check does not depend on that decode path at all (it compares
  `Buffer`s directly), so it is unaffected by that pre-existing limitation.

AcceptanceStatus for the residual (narrowed) risk: Proposed for acceptance —
not marked accepted on behalf of the project owner, per Gate 2 scope.
