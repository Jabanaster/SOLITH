# Phase 1 / Stage 7.5 §3-§8 — Fuzzy AOB Migration

Audit and architecture decision: doc 122. This document records what was built, what it proves, and what it deliberately did not change.

## Architecture as built

**SHARED_BACKEND_RESOLVER.** No new Rust. No heuristic ported to native.

```
process-watcher.resolveDefinitionFeatures
  └─ signature-engine.resolveSignatureWithCoverage
       ├─ exact  → exactAobResolver  → LiveMemorySession.scanAobViaBackend  → router → backend
       └─ fuzzy  → fuzzyAobResolver  → LiveMemorySession.scanFuzzyAobViaBackend
                                          └─ router.routedMemorySourceOperation
                                               └─ scanFuzzySignatureViaSource(source)
                                                    ├─ source.enumerateRegions()
                                                    ├─ source.enumerateModules()
                                                    ├─ source.readRegion()        → bytes
                                                    └─ findBestDriftAobInBuffer() → pure, no I/O
```

The drift algorithm is unchanged and still pure. Only the reads moved.

## Contract additions (`scanner-backend.ts`)

| Type | Purpose |
|---|---|
| `CanonicalMemoryRegion` | BigInt base/size plus readable/writable/executable |
| `CanonicalTargetModule` | Module identity — metadata, not scan data (see below) |
| `CanonicalRegionSlice` | One contiguous run of bytes actually read |
| `CanonicalRegionReadOutcome` | Slices + `CanonicalCompleteness` + metrics |

`ScannerBackend` gains `enumerateRegions()`, `enumerateModules()`, `readRegion(region, bounds, control?)`.

The slice model is the load-bearing design choice. A region read returns **one slice per gap-free run**, never a single stitched buffer. A chunk that cannot be read ends the current run and is recorded as a skipped range. A pattern that would have straddled an unreadable gap therefore cannot be matched *and* cannot be reported as absent — it is structurally impossible for a resolver built on this seam to reproduce D03.

## Backend implementations

### Native (`scanner-backend-native.ts`)

`enumerateRegions()` maps `NativeScanTarget.enumerateRegions()` and caches the native `JsRegion` objects by base address, so `readRegion` hands the addon back the exact region it produced rather than a reconstruction.

`readRegion()` calls `readRegionChunked(region, 64 KiB, 7-byte overlap, cancellation, progress)` and reassembles chunks **by absolute address**: a chunk starting before the current run's end has its already-held prefix dropped, so the deliberate overlap (which exists so a pattern straddling a chunk boundary stays matchable) does not duplicate bytes in the reassembled image. A `partial_read` appends what was read, closes the run, and records the unread tail as skipped. An over-budget region is refused as a named `max_region_bytes` skipped range rather than returned as a clean empty read.

`enumerateModules()` delegates to an injected `TargetModuleProvider`, and **throws `unsupported_operation` when none is bound** rather than returning `[]`.

### Legacy (`scanner-backend-legacy.ts`)

A pure adapter that preserves every legacy limitation, deliberately:

- `readBuffer` still throws above 1 MiB, so under LEGACY a large region still yields nothing. Repairing that here would make explicit rollback a fiction and leave SHADOW_COMPARE nothing real to compare.
- Legacy's `MemoryRegion` carries only `writable`, with no readable/executable bits, so `isReadable` is reported `true` for every region — which is legacy's own existing assumption, not an invention of this adapter.

What changes is only the silence. The same 1 MiB failure now surfaces as a `complete_with_skipped_regions` range carrying the real reason. **The defect stays; the lie does not.**

### Router (`scanner-backend-router.ts`)

`routedMemorySourceOperation<T>(pid, 'fuzzyAobScan', run, classify?)` hands `run` a `ScannerMemorySource` — the read-only half of `ScannerBackend`, deliberately narrower so a resolver cannot reach `exactScan`/`aobScan`/`attach`/`detach` and the routing decision stays the router's. LEGACY / NATIVE / SHADOW_COMPARE dispatch, no-hidden-fallback discipline, and diagnostics recording are identical to `routedExactScan`/`routedAobScan`.

## Module scoping — the one judgment call

The native scanner core has no module enumeration (`NativeScanTarget` has `enumerateRegions` and no module equivalent). `NativeScannerBackend.aobScan` already handles this by ignoring `moduleName` and searching every readable region — an accepted, documented Stage 7.4 limitation.

**That resolution was not copied to the fuzzy path**, because the two cases are not equivalent. Widening an *exact* AOB search costs some time and little else: an exact 8-byte match either exists or does not. Widening a *drift-tolerant* search with a substitution budget across an entire address space will find something, and it will be the wrong thing.

This is not a hypothetical. An early draft of the real-process test searched the fixture's own 5-byte `FAR_MARKER_PATTERN` with a one-substitution budget, and legacy returned a confident match at a completely unrelated address — a coincidental hit, in a small fixture process. A commercial game has three orders of magnitude more memory.

So `LiveMemorySession` injects the OS module list into the native backend, both backends see the same modules, and module-scoped resolution keeps identical fail-closed semantics across backends. Real module enumeration inside the native core is forward-assigned to Stage 8; until then this is an explicit, disclosed shared-metadata seam, not a hidden legacy scan path.

## Coverage truth reaches the caller

`resolveSignatureWithCoverage` returns `{ match, completeness, isAuthoritativeAbsence, fuzzyBackend }`. `completeness` is `null` only on the unbound legacy fallback, where there genuinely is no coverage signal to report — and `isAuthoritativeAbsence` is correspondingly `false`, so an unbound miss is never promoted to a confident not-found.

`ResolvedFeatureAddress` and the IPC-serialized `SerializedResolvedFeature` gain `fuzzyBackend` and `signatureCoverage`, both additive.

## Required classifications (mission §5)

| Path | Status |
|---|---|
| signature-engine exact | `MIGRATED_TO_BACKEND` |
| signature-engine fuzzy | `MIGRATED_TO_BACKEND` |
| feature-resolver | `MIGRATED_TO_BACKEND` |
| hook-engine | routed through caller/backend seam (`live-memory-ipc.ts:1358` resolves the hook site via `scanAobViaBackend`) |
| `LegacyScannerBackend` | `LEGACY_ROLLBACK_ONLY` |

**NORMAL PRODUCTION DIRECT LEGACY AOB CALLERS: 0** (Stage 7.4 reported 1 — the fuzzy sub-path). Full inventory: doc 126.

## Evidence

### Fixture matrix — 23 cases, independent ground truth (mission §4)

`tests/live-memory/signature-engine-fuzzy-backend.test.ts`. Every buffer is constructed in the test, so each case's expected address, distance, drift kind and completeness are known from the fixture rather than from a second backend.

| # | Case | Expected | Result |
|---|---|---|---|
| 01 | exact match | base+0x100, d=0, exact | PASS |
| 02 | one tolerated mismatch | base+0x120, d=1, hamming | PASS |
| 03 | multiple tolerated mismatches | base+0x140, d=2 | PASS |
| 04 | tolerance boundary (d == maxDistance) | matched | PASS |
| 05 | beyond tolerance | null, **authoritative** | PASS |
| 06 | shifted/drifted (insertion) | base+0x1a0, d=1, edit | PASS |
| 07 | wildcard-containing | base+0x1c0, d=0 | PASS |
| 08 | multiple candidates | later d=0 beats earlier d=2 | PASS |
| 09 | tie/scoring | hamming preferred over edit | PASS |
| 10 | no match | null, **authoritative** | PASS |
| 11 | **>1 MiB location** | native finds it; legacy null + **not** authoritative | PASS |
| 12 | unaligned location | base+0x101, d=0 | PASS |
| 13 | inaccessible region | null, skipped named, not authoritative | PASS |
| 13b | pattern straddling an unreadable hole | null, not authoritative | PASS |
| 14 | cancellation | `cancelled`, not authoritative | PASS |
| 15 | process exit | `process_exited`, not authoritative | PASS |
| 16 | resource limit | skipped, not authoritative | PASS |
| 17 | module absent | null, **authoritative** (fail closed) | PASS |
| 18 | module scoping restricts range | match outside module not returned | PASS |
| 19 | hint window | excludes outside, includes inside, `shiftBytes` correct | PASS |
| 20 | unbound module provider | `unsupported_operation`, not `[]` | PASS |
| 21 | unattached native backend | typed `attach_failed` | PASS |
| 22 | bound module provider | used verbatim | PASS |

Case 11 also asserts `classifyFuzzySignatureDifference` attributes the legacy/native disagreement to `EXPECTED_NATIVE_CORRECTION`, not to a native bug.

**FUZZY FIXTURE CASES: 23.**

### Real process (mission §6)

`tests/live-memory/fuzzy-aob-real-process.test.ts`, against a real spawned `solith-scanner-fixture.exe` with a real read-only attach:

| Test | Result |
|---|---|
| NATIVE default, zero override, drifted pattern resolved at true address, `fallbackCount` 0 | PASS |
| Explicit LEGACY rollback resolves the same pattern in a legacy-reachable region; toggles back to NATIVE with no rebuild | PASS |
| 16-byte signature 6 MiB deep: NATIVE resolves it; LEGACY returns null **and** `isAuthoritativeAbsence === false` | PASS |
| Cancellation: `cancelled`, no match, not authoritative | PASS |

**REAL FUZZY NATIVE: PASS. REAL FUZZY LEGACY: PASS. UNRESOLVED REAL DIFFERENCES: 0** — the only legacy/native difference observed is the 6-MiB case, classified `EXPECTED_NATIVE_CORRECTION` against the named, understood cause (D01).

### Packaged (mission §7)

`scripts/verify-packaged-fuzzy-scan.mts`:

```
resolved module path: ...\dist\win-unpacked\resources\native\solith-scanner-napi\index.js
planted at: 0x19101ad0000 (6291456 bytes into PATTERN_REGION)
resolved  : 0x19101ad0000
distance  : 1  driftKind: hamming  mode: fuzzy
completeness: complete
PASS
```

The addon is required by absolute packaged path, and its resolved realpath is asserted to be under `dist/win-unpacked` and **not** under `node_modules`. `verify-packaged-native-scan.mjs` re-run alongside: sentinel, u16 unaligned, u64 exact and exact-AOB all still PASS.

**PACKAGED FUZZY: PASS.**

### Routing modes (mission §8)

| Requirement | Evidence |
|---|---|
| DEFAULT = NATIVE | real-process test asserts `getScannerRoutingMode() === 'NATIVE'` with no override; 3/3 games confirm (doc 127) |
| Runtime rollback NATIVE → LEGACY without rebuild | real-process test 2, same router instance |
| LEGACY → NATIVE toggle back | same test |
| SHADOW_COMPARE functional | closeout suite: legacy authoritative, native error recorded not swallowed |
| No silent fallback | `fallbackCount === 0` asserted in real-process, canary, and failure-injection suites |
| Fuzzy exact + drift sub-paths both obey routing mode | fixture matrix + real-process |

## Test-fixture defect found and fixed

While running the pre-existing `feature-resolver-native-default-real-process.test.ts`, its legacy-rollback case failed — and reproduced at unmodified `6fcd0c5`, twice, with a different wrong address each run.

Cause: `fixture.rs`'s `apply_write_command` decoded the caller's hex into a heap `Vec<u8>` and left it there, so every pattern planted via `write` existed **twice** in the target process, with the heap copy at the lower address. That directly contradicted the test's own comment ("not a value that happens to already exist as a coincidental byte sequence elsewhere in the process").

Fixed by scrubbing the decode buffer before it drops. 3/3 deterministic passes after. Commit `1788f56`. This was a pre-existing defect independent of this stage's migration, and it means doc 121's "LOCAL_TECHNICAL_CERTIFICATION: PASS" was recorded against a suite that had a real failing test.

## Test counts at certification

| Suite | Result |
|---|---|
| Rust | 185/185, 1 ignored |
| NAPI | 52/52 |
| JS/TS | 1896/1896 + 10/10 |
| live-memory | 395/395 |
| renderer typecheck | PASS |
| electron typecheck | PASS |
| vite / electron / native / package builds | PASS |
| npm audit | 0 |
