# Phase 1 / Stage 1 — Scanner Surface Inventory

Repo: `G:\ACTIVE_PROJECTS\solith-phase0-convergence`, HEAD `3b8c1c33c014b440df9dbe9646fa8c647f6de37a`, branch `feature/solith-canonical-convergence-phase0`. Read-only audit — no production source was modified to produce this document.

## 0. Top-level architecture finding

There are **three largely independent process-memory implementations** in this repository, not one:

1. **`src/core/live-memory/*`** — the interactive scanner behind the Electron trainer UI (attach, first/next scan, AOB, pointer scan, freeze, write). Uses `memoryjs` via `native-memory-driver.ts`. This is the scanner Phase 1 exists to reconstruct.
2. **`src/core/runtime/*`** — a second, independent "headless/read-only verification" stack (signature validation, restart/session stability certification for the CT-import pipeline). Reuses `nativeMemoryDriver`'s low-level primitives but has its own session wrapper, its own AOB scanner, and its own policy/guard layer, structurally parallel to (not shared with) `live-memory`.
3. **`native/solith-readonly-scanner/`** — a standalone Rust/`windows-sys` binary with a third, fully independent implementation of OpenProcess/VirtualQueryEx/ReadProcessMemory/module-enumeration/pointer-chain resolution, invoked over stdio JSON by `src/core/runtime/readonly-scanner-helper.ts`. Read-only, validation-only — it never discovers new pointer chains, only re-walks already-known ones.

Phase 1's mandate (napi-rs + Rust native scanner core) targets stack #1. Stacks #2 and #3 are pre-existing, certified-adjacent infrastructure that Phase 1 should be aware of (to avoid re-duplicating work, and because #3 is already a real Rust/Win32 precedent in this codebase) but does not need to rebuild.

## 1. Process enumeration / process attach

| File | Key exports | Description |
|---|---|---|
| `src/core/live-memory/native-memory-driver.ts` | `nativeMemoryDriver.openProcess/closeProcess`, `listLiveMemoryProcesses()` | memoryjs-backed open/close; `listLiveMemoryProcesses` enumerates all processes (read-only, no attach) for the process picker, enriched via a PowerShell `Get-CimInstance Win32_Process` call for parent PID/path/start time. |
| `src/core/live-memory/live-memory-session.ts` | `LiveMemorySession.attach()` | Orchestrates attach: authorization check → online/write-consent guard → optional fingerprint verify → `driver.openProcess` → protected-target (anti-cheat) check → live OS identity capture/compare → stores `LiveProcessTarget`. |
| `src/core/live-memory/process-watcher.ts` | `matchCatalogProcess()`, `buildZeroInputAttachPlan()` | Zero-Input flow: matches a running process list against catalog executable names, builds an attach plan (fingerprint + guard) without itself opening a handle. |
| `src/core/live-memory/windows-process-identity.ts` | `queryWindowsProcessIdentity()`, `compareProcessIdentity()`, `isCompleteProcessIdentity()` | PowerShell (`Win32_Process`/`fsutil`)-based OS identity query (path, start time, volume serial, file index, exe SHA-256) used for PID-reuse mitigation; fail-closed comparison. 255 lines. |
| `src/core/runtime/process-discovery.ts` | `RuntimeProcessSummary`, `assertExplicitProcessSelection()` | Minimal process-summary type + explicit-selection assertion for the runtime (headless) stack. |
| `src/core/runtime/windows-readonly-process-module-reader.ts` | `openWindowsReadOnlyProcessSession()` | Second, parallel process-open/attach implementation wrapping `nativeMemoryDriver.openProcess` in a read-only, module-scoped session for the headless verification stack. |
| `native/solith-readonly-scanner/src/main.rs` | `open_process(pid)` | Third, independent attach implementation in Rust: raw `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION\|PROCESS_VM_READ, …)` + RAII `ProcessHandle` (closes on drop). |
| `src/core/process/index.ts` | `isGameRunning()` | Unrelated lightweight liveness check via `tasklist.exe`/`ps aux` — no handle, no memory access. |

## 2. Handle acquisition

| File | Key exports | Description |
|---|---|---|
| `src/core/live-memory/native-memory-driver.ts` | `openProcess`, `loadMemoryjs()`, `validateHandle()` | Lazily `require`s `memoryjs` via `createRequire` (project is ESM), falling back to `vendor/memoryjs-3.5.1-patched/index.js`. Requests a write-capable handle (`PROCESS_VM_WRITE\|PROCESS_VM_OPERATION` added). Validates handle shape (`pid`, `opaque`) on every call. |
| `vendor/memoryjs-3.5.1-patched/lib/*.cc` (1545-line `memoryjs.cc`) | native `openProcess`/`closeProcess` bindings | Vendored, patched N-API C++ addon (patched for a Windows/Node-24 install bug — see `vendor/memoryjs-3.5.1-patched/NOTES.md`). Not authored by this project. |
| `src/core/in-process-script/native-bridge.ts` | `allocateCodeCave()`, `writeProcessBuffer()`, `readProcessBuffer()` | Separate, fourth `require('memoryjs')` consumer — code-cave allocation for the in-process-script/injection feature, out of value-scanner scope but shares the native dependency. |
| `native/solith-readonly-scanner/src/main.rs` | `struct ProcessHandle` | RAII Rust handle, entirely independent of memoryjs. |

Direct `memoryjs` import sites (exhaustive, 2 real `require()` call sites): `native-memory-driver.ts` (sanctioned production driver) and `native-bridge.ts` (code-cave injection, unrelated to scanning).

## 3. VirtualQueryEx / region enumeration

| File | Key exports | Description |
|---|---|---|
| `src/core/live-memory/native-memory-driver.ts` | `getRegions()` | Calls memoryjs's `getRegions` (native `VirtualQueryEx` loop), then filters in JS (§4). |
| `native/solith-readonly-scanner/src/main.rs` (`readable_region_contains`) | — | Independent, single-address `VirtualQueryEx` confirmation check before a pointer-chain read — not a full enumerator. |

## 4. Readable-region / protection filtering

| File | Logic |
|---|---|
| `native-memory-driver.ts:339-345` | `MEM_COMMIT` required; excludes `PAGE_NOACCESS`/`PAGE_GUARD` (deny-list); `writable` computed from `PAGE_READWRITE\|PAGE_WRITECOPY\|PAGE_EXECUTE_READWRITE\|PAGE_EXECUTE_WRITECOPY`. **Does not read the `Type` field at all** — `MEM_IMAGE`/`MEM_PRIVATE`/`MEM_MAPPED` are never distinguished anywhere in the scanner. |
| `memory-scanner.ts` (all `scanFirst*`) | Additionally requires `writable === true` and `0 < size <= maxRegionBytes` — read-only committed regions are never scanned by the value scanner (by design: the scanner only surfaces addresses a later write could target). |
| `pointer-scanner.ts` (`findPointersNear`) | Does **not** filter by writability — pointers commonly live in read-only/const data too. |
| `native/solith-readonly-scanner/src/main.rs` (`is_readable`) | Independent **allow-list** predicate (`PAGE_READONLY\|PAGE_READWRITE\|PAGE_WRITECOPY\|PAGE_EXECUTE_READ\|PAGE_EXECUTE_READWRITE\|PAGE_EXECUTE_WRITECOPY`), structurally divergent from the TypeScript driver's deny-list — functionally similar today but could silently disagree if Windows protection flags are ever combined unusually. |

## 5. Memory reads / chunk sizing / region-size caps

| File | Key facts |
|---|---|
| `native-memory-driver.ts:361-364, 387-389` | **Hard 1 MiB cap** on both `readBuffer` and `writeBuffer`, enforced by **throwing**, not by chunking/truncating: `if (size <= 0 \|\| size > 1048576) throw`. This is the real-driver mechanism behind D02 (see doc 02). |
| `memory-scanner.ts:11-25` | Per-scan budget constants: `DEFAULT_MAX_REGION_BYTES` = 64 MiB (regions larger than this are filtered out and never scanned at all — a second, silent, undocumented-to-the-user cap layered on top of the 1 MiB read cap), `DEFAULT_MAX_TOTAL_BYTES` = 2 GiB, `DEFAULT_UNKNOWN_MAX_TOTAL_BYTES` = 512 MiB, `DEFAULT_MAX_MATCHES` = 10,000. Comment documents a real regression (Stardew Valley's ~957 MiB committed footprint being truncated by an earlier 512 MiB cap, producing 0 matches instead of 1) — i.e. this exact class of silent-cap bug has already caused one real, observed failure in production history. |
| Every `scanFirst*`/`findPointersNear`/`scanAobInProcess` call site | Reads an **entire region in one `driver.readBuffer` call** — there is **no chunked reading anywhere in the current scanner**. Any region between 1 MiB and 64 MiB (extremely common: big managed-runtime heaps, `.data`/`.rdata` sections) throws at the native-driver boundary and is silently skipped by the caller's `catch`. |
| `src/core/runtime/windows-readonly-process-module-reader.ts` + `src/core/runtime/signature-scanner.ts` | The **only** genuinely chunked reader in the repo (`DEFAULT_SCAN_CHUNK_BYTES` = 1 MiB, chunks + reports `truncated` based on real policy budget) — but this belongs to the separate runtime/verification stack (#2 above), not the live scanner. |

## 6. First scan vs. subsequent/refinement scans

All in `src/core/live-memory/memory-scanner.ts` (714 lines, the largest scanner-logic file):

| Function | Role |
|---|---|
| `scanFirst()` | Exact-value first scan, `Buffer.indexOf` + own-type-width alignment check. |
| `scanFirstRange()` | First scan for `[min, max]` (HUD-rounding ambiguity). **Repaired** truth-reporting (P0-SCAN-001). |
| `scanFirstUnknown()` | Captures a raw-byte baseline snapshot of every writable region — no value interpretation yet. |
| `scanNext()` | Re-reads a prior candidate list address-by-address, filters by `ScanComparison`. |
| `scanNextFromSnapshot()` | Consumes an unknown-scan snapshot once, decodes both baseline and current bytes at one `dataType`. |
| `scanNextFromSnapshotMultiType()` | Same, but tries every `LiveValueType` at each offset simultaneously ("All" scan). |
| `scanFirstByComparison()` / `scanFirstAutoMatrix()` | Fan-out convenience: runs every compatible first-scan mode × every data type in one pass; explicitly documented as the "Solith UX-friendly alternative to a Cheat-Engine-style single-type/single-mode dropdown." |

Session wiring: `live-memory-session.ts` exposes `scanFirst`, `scanFirstAutoMatrix`, `scanNext`, `scanFirstUnknown`, `scanNextFromUnknown` (guarded by a per-cheat-keyed `unknownSnapshots: Map`), plus `readMany()` for the Watch Live panel.

## 7. Scan mode semantics (current)

Defined in `types.ts:206-216` (`ScanComparison`) and `memory-scanner.ts:443,564-581` (`AutoFirstScanMode`). Central evaluator: `matchesComparison()` (`memory-scanner.ts:304-327`) — `exact`, `changed`, `unchanged`, `increased`, `decreased`, `increasedBy`, `decreasedBy`, `greaterThan`, `lessThan`, `between`. `DELTA_EPSILON = 1e-4` applies only to `increasedBy`/`decreasedBy`; `exact` stays strict `===` (matched against a user-typed HUD value). Formal per-mode semantics (prior snapshot required, type compatibility, float behavior, overflow behavior, retention cost) are re-derived and made explicit in doc `07-scan-semantics.md`.

## 8. Integer types / signed-unsigned / int64-BigInt

- `LiveValueType = 'int32' | 'uint32' | 'float' | 'double' | 'int64' | 'byte'` (`types.ts:14`) — **no `int8`/`int16`/`uint16`/`uint64` variants exist**, narrower than a full i8–i64/u8–u64 matrix.
- `int64` decode: `Number(buf.readBigInt64LE(offset))` (`memory-scanner.ts:111-112`) — precision loss above `Number.MAX_SAFE_INTEGER`, empirically reproduced in doc 02 (D06).
- Pointer values (effectively `uint64`) are the one exception kept as native `bigint` end-to-end via `MemoryDriver.readPointer` (`types.ts:118-126`, `native-memory-driver.ts:424-443`) — the driver's own comment documents *why* (memoryjs's real native binding returns `bigint` for 64-bit types even though the generic `readMemory`'s declared TS return type says `number`).
- `live-memory-session.ts` (`compareRollbackValue`) explicitly checks `Number.isSafeInteger` for `int64` before comparing during rollback — a fail-closed acknowledgment of the same limitation, at the write-safety layer only (not the scan layer).

## 9. Float/double, NaN, epsilon

- `scanFirstRange`/`scanFirstByComparison` drop non-finite decodes (`Number.isFinite(value)`); `scanNextFromSnapshotMultiType` drops a match if either the previous or current decode is non-finite ("arbitrary bytes frequently produce NaN when read as float/double... never a meaningful game stat").
- `scanFirst`/`scanNext`/`scanFirstUnknown`/`scanNextFromSnapshot` (single-type paths) have **no equivalent `Number.isFinite` gate** — see doc 03 for the audit of this asymmetry.
- `DELTA_EPSILON = 1e-4` — fixed absolute tolerance regardless of magnitude (see doc 03 for the large-magnitude failure mode this implies).

## 10. String / byte-array scans

**No dedicated "scan memory for a string/byte-array" feature exists.** The only string read is a fixed-length, single-address inspection (`src/core/live-memory/research/memory-viewer.ts`: 32-byte UTF-8-only read, truncated at first NUL) — not a scan. No UTF-16 support anywhere in the scanner subsystem. Byte-array *matching* that does exist is exclusively AOB pattern matching (§11).

## 11. AOB/pattern scans, wildcards, alignment

**Four distinct AOB/pattern-matching implementations exist:**

| # | File | Notes |
|---|---|---|
| 1 | `aob-resolver.ts` (103 lines) | Canonical live-scanner engine: `parseAobSignature`/`findAobInBuffer` (naive O(n·m) search, `?`/`??` wildcards)/`scanAobInProcess`. No region-size cap of its own (inherits the 1 MiB driver cap uncapped — see doc 02 D04). Returns only the first match; `bigint \| null` with no truncation signal at all. |
| 2 | `signature-engine.ts` (384 lines) | Builds on #1; adds drift-tolerant fuzzy matching (bounded Hamming/edit distance) plus a `hintAddress ± maxShiftBytes` optimization for re-resolving after a game patch. Same unbounded-region-read/no-truncation-signal shape as #1. |
| 3 | `src/core/runtime/signature-scanner.ts` (80 lines) | Independent reimplementation for the runtime/verification stack — chunked, `AbortSignal`-cancellable, wall-clock-timeout-budgeted, and reports `truncated`/`timedOut` honestly. Architecturally the "right" pattern that #1/#2 should converge toward. |
| 4 | `src/core/script-research/aob-parser.ts` | Not a memory scanner — statically parses `aobScan(...)` calls out of imported Cheat Engine script text. |

Alignment: `scanFirst`/`scanFirstRange`/`scanFirstByComparison` check `found % step === 0` / iterate `offset += step` where `step = valueSize(dataType)` — i.e. alignment is **the selected type's own width** (1/4/8), never a hardcoded 4. AOB scans (#1–#3) are byte-granular (no alignment constraint), correct for instruction-pattern matching. `native/solith-readonly-scanner` has no AOB/pattern scanning at all.

## 12. Cancellation, progress, truncation

| Mechanism | Where |
|---|---|
| `truncated: boolean` on every `ScanResult`/`UnknownScanSnapshot`/`TypedScanResult`/`AutoFirstScanMatrixResult` | `memory-scanner.ts` — inconsistently set (see doc 02, defect D01). |
| `truncated`/`scansPerformed`/`levelsSearched` | `pointer-scanner.ts` (`PointerScanResult`) — separate, also inconsistently set (doc 02, D05). |
| `AbortSignal` + `timedOut` | `src/core/runtime/signature-scanner.ts` only — **the interactive scanner (`memory-scanner.ts`, `pointer-scanner.ts`, `aob-resolver.ts`, `signature-engine.ts`) has no cancellation primitive at all.** A manual scan runs to completion or its byte/match cap; it cannot be aborted mid-flight by the caller. |
| Progress reporting | **Not implemented** for any interactive scan — no progress callback/event exists in the scanner functions or the IPC layer (`live-memory-scan-*` IPC handlers are plain request/response, not streaming). |

## 13. Unreadable-region / partial-read / process-exit / stale-handle

| File | Handling |
|---|---|
| `memory-scanner.ts` | Every region read wrapped `try { readBuffer } catch { ... }` — inconsistent (see doc 02, D01/E). |
| `live-memory-session.ts` (`verifyAttachedProcessIdentity`) | Re-queries live OS identity before any destructive confirm/rollback/freeze-tick; process exit or PID reuse produces a fail-closed error rather than silently proceeding. |
| `real-time-scanner.ts` (`pollOnce`) | If **all** candidates become unreadable in one poll, stops with `stopReason: 'stalled'`; a per-candidate failure just drops that candidate. |
| `native/solith-readonly-scanner/src/main.rs` | Returns structured status codes (`l2_unreadable`, `process_exited`, `module_missing`, `access_denied`) instead of throwing; RAII guarantees `CloseHandle` even on early error returns — a real precedent for the truthful-completeness model Phase 1 needs (§1.11 of the mission). |

## 14. Scan result storage / session persistence

**No durable, on-disk scan-result persistence exists.** All scan state (`unknownSnapshots`, `pendingProposals`, `confirmedWrites`, `addressCache`) lives in-memory inside `LiveMemorySession` for the attach's lifetime; `detach()` clears all of it. The closest thing to persistence is `research/session-snapshot.ts`'s `SessionSnapshotManager` (Research Lab watch-address snapshots), a diagnostic feature, not general scan storage.

## 15. Pointer scanning / value-scanner interaction

| File | Role |
|---|---|
| `pointer-scanner.ts` (181 lines) | `scanForPointerPath()` — reverse/BFS pointer scan bridging "value scanner found a raw address" to a restart-stable module+offset chain. Bounds: `DEFAULT_MAX_DEPTH=3` (cap 6), `MAX_RESULTS=20`, `MAX_TOTAL_SCANS=25`, `DEFAULT_MAX_OFFSET_PER_LEVEL=2048`. |
| `pointer-resolver.ts` (38 lines) | `resolvePointerPath()` — the inverse (forward) resolution, used every attach to turn a stored pointer path back into a live address. |
| `live-memory-session.ts` (`pointerScan()`) | The one place the value scanner and pointer scanner meet: a value-scan hit's address is fed as `targetAddress` into `scanForPointerPath`. |
| `native/solith-readonly-scanner` (`validate_pointer`) | Read-only re-validation of an already-known chain only; never discovers new chains. |

## 16. Electron IPC boundary

| File | Role |
|---|---|
| `electron/live-memory-ipc.ts` (1829 lines) | Registers every `ipcMain.handle('live-memory-*', ...)` channel: attach/detach/read/propose-write/confirm-write/rollback, `scan-first`/`scan-first-auto-matrix`/`scan-next`/`scan-first-unknown`/`scan-next-from-unknown`, `pointer-scan`, `scan-aob`, correlation/freeze/research channels. Plain request/response — no streaming, no cancellation channel. |
| `electron/preload.ts` (524 lines) | `contextBridge` wrappers for every channel — the sole sanctioned renderer↔main surface. |
| `electron/ipc-validation.ts` (797 lines) | Payload schema/shape validation in front of every scan/attach/write handler. |
| `electron/sender-validation.ts` | WebContents sender-id validation for consent-token binding. |

## 17. Native modules present today

| Path | Type |
|---|---|
| `native/solith-readonly-scanner/` (590-line `main.rs`) | Standalone Rust **binary** (not a `.node` addon, no napi-rs) — invoked as a child process over stdio JSON, not `require()`'d. Uses `windows-sys`. Depends on `Cargo.toml`/`Cargo.lock`; pre-built artifacts checked into `target/release/`. |
| `vendor/memoryjs-3.5.1-patched/` | Vendored N-API C++ addon (`node-addon-api`, not napi-rs) — the real memory-access layer for the interactive scanner. |

**No napi-rs usage exists anywhere in the tree today** — Phase 1's `napi-rs: FULL ADOPTION` freeze (Step 0.13.5) is net-new integration work, not an upgrade of an existing binding.

## 18. Duplicate / parallel implementations — explicit call-outs

1. **Two full scanning stacks**: `src/core/live-memory/*` (interactive) vs. `src/core/runtime/*` (headless verification) — share only `nativeMemoryDriver`'s low-level primitives.
2. **Two process-open/attach session wrappers**: `LiveMemorySession.attach()` vs. `openWindowsReadOnlyProcessSession()`.
3. **Four AOB pattern-matching engines** (§11).
4. **Two region-readability predicates expressed differently** (deny-list vs. allow-list, §4) — a latent consistency risk.
5. **Three memory-viewer/hex-dump implementations**: `research/memory-viewer.ts`, `runtime/memory-viewer.ts`, `research/hex-inspector.ts`.
6. **Two pointer-candidate analyzers with different rigor**: `research/pointer-candidate-analysis.ts` (scores real BFS results) vs. `runtime/pointer-candidates.ts` (naive "near a module" heuristic, no dereferencing).
7. **One canonical fake/mock scanner** (`tests/fixtures/fake-memory-driver.ts`) — good hygiene (all 17 `tests/live-memory/*.test.ts` files converge on it), but it is a materially more permissive fixture than the real driver — it has **no 1 MiB cap at all** (confirmed in doc 02) — meaning the entire scanner unit-test suite is structurally blind to D02/D04/D05's real-driver trigger condition.
8. **A third, fully separate native process-memory implementation in Rust** (`native/solith-readonly-scanner`) — by design, a minimal read-only-only surface, but it is genuinely triplicated low-level Win32 logic alongside memoryjs's C++ addon.

## Flat file list with line counts

**`src/core/live-memory/` — 7,507 lines / 34 files** (largest: `live-memory-session.ts` 1314, `memory-scanner.ts` 714, `native-memory-driver.ts` 478, `live-correlation-watcher.ts` 434, `signature-engine.ts` 384, `memory-manager.ts` 403, `windows-process-identity.ts` 255, `process-watcher.ts` 253, `types.ts` 249, `zero-input-prepare.ts` 217, `dual-read-controls.ts` 222, `pointer-scanner.ts` 181, `palworld-cheats.ts` 166, `write-policy.ts` 162, `real-time-scanner.ts` 140, `research/memory-viewer.ts` 145, `index.ts` 149, `feature-resolver.ts` 130, `research/session-snapshot.ts` 137, `remote-connection-observer.ts` 112, `ct-promote.ts` 106, `aob-resolver.ts` 103, `research/pointer-candidate-analysis.ts` 100, `game-connection-baselines.ts` 92, `audit-log.ts` 80, `research/hex-inspector.ts` 75, `installed-exe-hash.ts` 74, `single-player-waiver.ts` 73, `local-pack-export.ts` 73, `online-guard.ts` 66, `watch-confidence.ts` 49, `cleanup-coordinator.ts` 58, `session-cleanup.ts` 52, `write-consent.ts` 44, `pointer-resolver.ts` 38, `single-player-waiver-shared.ts` 38, `research/index.ts` 25, `live-trainer-control.ts` 19).

**`src/core/runtime/` — 2,409 lines / 20 files** (largest: `headless-verification.ts` 408, `aob-repair-analyzer.ts` 390, `readonly-scanner-helper.ts` 242, `delta-engine.ts` 225, `protected-target-guard.ts` 192, `windows-readonly-process-module-reader.ts` 183, `restart-validation.ts` 170, `signature-resolution.ts` 114, `signature-validation.ts` 111, `write-policy.ts` 63, `memory-snapshot.ts` 48, `pointer-candidates.ts` 42, `memory-viewer.ts` 31, `runtime-policy.ts` 25, `process-discovery.ts` 14, `headless-verification-worker.ts` 15, `module-inspection.ts` 16, `index.ts` 16, `memory-reader.ts` 17, `address-resolver.ts` 7).

**Electron IPC boundary**: `electron/live-memory-ipc.ts` 1829, `electron/ipc-validation.ts` 797, `electron/preload.ts` 524, `electron/sender-validation.ts` 96.

**Native binary (Rust)**: `native/solith-readonly-scanner/src/main.rs` 590.

**Vendored native addon (C++)**: `vendor/memoryjs-3.5.1-patched/lib/memoryjs.cc` 1545 + 14 supporting files (~2,629 lines total), `index.js` 326.

**Test fixtures / scanner tests**: `tests/fixtures/fake-memory-driver.ts` 365; 17 files under `tests/live-memory/*.test.ts` plus `tests/aob-parser.test.ts`, `tests/aob-repair-analyzer.test.ts`, `tests/memory-research.test.ts`, `tests/live-memory-rollback-freeze-ipc-validation.test.ts`, `tests/fixtures/gate2-2-memory-fixture/` (real compiled C# child-process fixture).

## Test/benchmark infrastructure summary (full detail in doc 08)

- Default `npm test` runs 100% against `FakeMemoryDriver`/`BufferMemoryReader` in-process mocks — **zero real memoryjs, zero real OS process** in the default path.
- Real-process coverage exists only in opt-in Playwright e2e suites (`gate2-2*`…`gate2-5*`, `injector-process-integration.test.ts`), Windows-only, not part of `npm test`.
- **No scanner-specific benchmark/perf harness exists anywhere in the repo.** The closest artifacts are two ad hoc, assertion-free exploratory scripts (`scripts/explore-palworld-pointer-scan.mts`, `scripts/explore-palworld-wide-scan.mts`) run by hand against a real Palworld process.
- The primary "Audit 2" source document that `ROADMAP.md` cites by section number (§16, §16 S1–S7, §20) **could not be located as a committed file anywhere in this repository, its branches, or an available snapshot archive** — every fact from it that reached this repo exists only as inline citation inside `ROADMAP.md`. This gap is carried forward explicitly rather than assumed away; see doc 02 for how each defect was independently re-verified against live code regardless.
