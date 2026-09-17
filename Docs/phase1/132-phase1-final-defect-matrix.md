# Phase 1 — Final Defect Matrix

> **Supersession notice (Phase 1 final closure).** Superseded as the current defect matrix by **doc 140**. Accurate as of `2618286`; the single open row (D05) is closed by doc 138, and five further defects found afterwards (D17-D21) are recorded in doc 140.


One authoritative table. Every Phase 1-scoped scanner defect, its native-path status, its **shipping-product** status, and the test / document / commit that certifies each.

## Two numbering schemes — read this first

`ROADMAP.md` and the Stage 7 evidence trail use **different D-numbers for the same defects**, and they are not interchangeable. This document uses the Stage 7.5 mission's numbering (D01-D15) and cross-references the ROADMAP's in every row.

| ROADMAP D# | ROADMAP description | This document |
|---|---|---|
| D01 | sibling truth-reporting gaps (`catch{continue}` sites) | **D06** |
| D02 | 1 MiB region-read cap | **D01** |
| D03 | forced alignment | **D02** |
| D04 | AOB repair above the cap / false `found:false` | **D03** |
| D05 | pointer-scan depth truncation/misreporting | **D05** (only coincidental match) |
| D06 | int64 mismatch at the IPC boundary | **D04** |

`NATIVE_PATH_FIXED` never implies `PRODUCT_DEFECT_CLOSED` — the rule stated in doc 71 and honored throughout. A defect is only `PRODUCT_DEFECT_CLOSED` when the **shipping** route reaches the fixed behavior by default.

## The matrix

### D01 — >1 MiB read cap / silent region skip *(ROADMAP D02)*

- **Original finding.** `native-memory-driver.ts:361` throws for any `readBuffer` above 1 048 576 bytes. `memory-scanner.ts` calls it with whole region sizes at six sites, each wrapped in `try { } catch { continue; }`, while pre-filtering only against a 64 MiB `maxRegionBytes` that has no relationship to the real ceiling. Audit 2: ~95.5 % of a real Stardew Valley process's writable memory unread.
- **Native path.** `NATIVE_PATH_FIXED` — `read_region_chunked` reads in bounded chunks with honest per-chunk status.
- **Shipping product.** `PRODUCT_DEFECT_CLOSED`.
- **Certifying test.** `scanner-backend-real-process.test.ts`; `signature-engine-fuzzy-backend.test.ts` case 11; `fuzzy-aob-real-process.test.ts` (6 MiB deep).
- **Certifying doc / commit.** 107 / `5a1559c`; extended to the fuzzy path by 124 / `46adeaf`.

### D02 — forced value-width alignment *(ROADMAP D03)*

- **Original finding.** Every legacy value read steps by the type's own width; there is no bytewise mode, so unaligned values are unreachable.
- **Native path.** `NATIVE_PATH_FIXED` — `alignment: "bytewise"` is the default and recommended mode.
- **Shipping product.** `PRODUCT_DEFECT_CLOSED`.
- **Certifying test.** `scanner-backend-alignment-closure.test.ts`; packaged u16-unaligned smoke in `verify-packaged-native-scan.mjs`.
- **Certifying doc / commit.** 113 / `80377d5`.

### D03 — AOB false-not-found from capped or failed reads *(ROADMAP D04)*

- **Original finding.** `aob-resolver.ts`'s `scanAobInProcess` and `signature-engine.ts`'s `scanFuzzySignature` both wrap their region read in `catch { continue; }` and return a bare `null`/`-1`, so an uncovered region is indistinguishable from a genuine absence.
- **Native path.** `NATIVE_PATH_FIXED` — `isAuthoritativeAbsence` is true only when matches are empty **and** completeness is `Complete`.
- **Shipping product.** `PRODUCT_DEFECT_CLOSED` — **exact AOB** at Stage 7.4, **fuzzy/drift AOB** at Stage 7.5. Doc 116 scoped its closure explicitly to exact matching; that remaining half is closed by the slice-based region read, which cannot stitch over a gap.
- **Certifying test.** `scanner-backend-ipc-real-path.test.ts`; `signature-engine-fuzzy-backend.test.ts` cases 05, 10, 11, 13, 13b, 17; `fuzzy-aob-real-process.test.ts` case 3.
- **Certifying doc / commit.** 116 / `f5db9fe` (exact); 124 / `46adeaf` (fuzzy).

### D04 — int64 / u64 unsupported, JS precision loss *(ROADMAP D06)*

- **Original finding.** `decodeValue`/`encodeValue` narrow int64 through `Number(BigInt)`; the wire had no name for i8/i16/u16/u64 at all.
- **Native path.** `NATIVE_PATH_FIXED` — `valueBigint` carries i64/u64 exactly, never routed through `f64`.
- **Shipping product.** `PRODUCT_DEFECT_CLOSED`.
- **Certifying test.** `scanner-backend-int64-end-to-end.test.ts`; `scanner-backend-u64-shipping-closure.test.ts`; `scanner-backend-wire-type-expansion.test.ts`; packaged u64 smoke.
- **Certifying doc / commit.** 112, 114 / `f5db9fe`, `80377d5`.

### D05 — pointer-scan depth truncation / misreporting *(ROADMAP D05)*

- **Original finding.** Audit 2 §16 S4: `levelsSearched: 1` reported against `maxDepth: 3`, with `truncated: false`.
- **Native path.** `NOT_ADDRESSED` — no native pointer scanner exists.
- **Shipping product.** **`PRODUCT_DEFECT_NOT_YET_CLOSED`.**
- **Certifying test / doc / commit.** none — untouched by every Stage 7.x pass, unconditionally and by instruction.
- **Disposition.** **Cannot be forward-assigned.** ROADMAP line 165 assigns D05 to Phase **1**, and line 116 splits pointer scanning as "1 (truth-reporting), 2 (feature)" — so the *truth-reporting* half is Phase 1 scope and only the *feature* work belongs to Phase 2. This is the single defect that keeps Phase 1 open. See docs 134 and 136.

### D06 — scan completeness truth reporting *(ROADMAP D01)*

- **Original finding.** `truncated` is set only for caller-configured byte/match budgets, never when a region is skipped after a read throws — across five sibling functions.
- **Native path.** `NATIVE_PATH_FIXED` — `ScanCompleteness` is a required part of every outcome.
- **Shipping product.** `PRODUCT_DEFECT_CLOSED` for every routed path (exact value, exact AOB, fuzzy AOB). `LegacyScannerBackend` now reports the previously-silent skip as a named `complete_with_skipped_regions` range while preserving the underlying limitation for honest rollback.
- **Residual.** The unrouted legacy value-scan paths (`scanFirstAutoMatrix`, `scanNext`, `scanFirstUnknown`, `scanNextFromUnknown`) retain the original reporting behavior. Named in doc 126, forward-assigned to Stage 8.
- **Certifying test.** `scanner-backend-failure-injection-real.test.ts`; `scanner-backend-failure-injection-closeout.test.ts`; fuzzy fixture matrix 13/13b/14/15/16.
- **Certifying doc / commit.** 59, 71, 107, 125 / `23dc555`, `5a1559c`, `06c98e4`.

### D07 — cancellation semantics

- **Native path.** `NATIVE_PATH_FIXED` — real `ScanCancellationHandle`, deterministic, observed between region reads.
- **Shipping product.** `PRODUCT_DEFECT_CLOSED`. The legacy/native asymmetry (legacy honors only a pre-flight check, having no chunk-level interruption point) is documented in the contract rather than hidden.
- **Certifying test.** `scanner-backend-cancellation.test.ts`; fuzzy matrix 14; `fuzzy-aob-real-process.test.ts` case 4.
- **Certifying doc / commit.** 61, 102 / `5a1559c`.

### D08 — stale target / PID reuse

- **Native path.** `NATIVE_PATH_FIXED` — live `GetExitCodeProcess` check on every `status()`, never cached.
- **Shipping product.** `PRODUCT_DEFECT_CLOSED`.
- **Certifying test.** `target-process-authorization.test.ts`; `process-watcher.test.ts`.
- **Certifying doc / commit.** 30, 62 / `58f6cbd`, `23dc555`.

### D09 — process exit during scan

- **Native path.** `NATIVE_PATH_FIXED` — `process_exited` completeness with `atByte`.
- **Shipping product.** `PRODUCT_DEFECT_CLOSED`; never an authoritative absence.
- **Certifying test.** `scanner-backend-failure-injection-real.test.ts`; fuzzy matrix 15.
- **Certifying doc / commit.** 96, 104, 125 / `ea62d79`, `06c98e4`.

### D10 — result-volume / IPC bounding

- **Original finding.** `NativeScannerBackend.exactScan` had no default match bound at all; a real NATIVE scan of Godlike Burger accumulated 151 382 matches into one unbounded array.
- **Native path.** `NATIVE_PATH_FIXED` — `DEFAULT_MAX_MATCHES = 10_000` applied whether or not the caller supplies a bound.
- **Shipping product.** `PRODUCT_DEFECT_CLOSED`.
- **Certifying test.** `scanner-backend-ipc-real-path.test.ts`; observed live in doc 127's canary (both capped titles).
- **Certifying doc / commit.** 82, 92 / `37f86b8`.

### D11 — session persistence safety

- **Native path.** `NATIVE_PATH_FIXED` — versioned, checksummed snapshots; no live handle or raw candidate data persisted; `snapshot_id` rejects path separators and `..`.
- **Shipping product.** `PROVABLY_NOT_APPLICABLE` to the routed scan route — that route uses `NativeScanTarget`, which has no persistence at all (doc 125's structural proof, asserted mechanically).
- **Certifying test.** `scanner-backend-failure-injection-closeout.test.ts`.
- **Certifying doc / commit.** 63, 125 / `06c98e4`.

### D12 — packaged native addon loading

- **Native path.** `NATIVE_PATH_FIXED`.
- **Shipping product.** `PRODUCT_DEFECT_CLOSED` — the addon loads strictly from the packaged path, asserted not to resolve through `node_modules`, and `MODULE_NOT_FOUND` is distinguished from a present-but-corrupt binary.
- **Certifying test.** `verify-packaged-native-scan.mjs`; `verify-packaged-fuzzy-scan.mts`; `scanner-backend-failure-injection-real.test.ts`.
- **Certifying doc / commit.** 78, 90, 117, 124 / `06c98e4`.

### D13 — direct legacy scanner bypasses

- **Original finding.** `aob-resolver.ts` and `signature-engine.ts` call `MemoryDriver` directly, bypassing `memory-scanner.ts` entirely.
- **Shipping product.** `PRODUCT_DEFECT_CLOSED` **for primitive/AOB scan paths**: normal production direct legacy AOB callers = 0 (was 1 at Stage 7.4).
- **Residual.** Value-scan fan-out, pointer paths and point reads still reach the driver directly. Each is named and classified in doc 126; none is an AOB or routed-primitive path.
- **Certifying test.** `scanner-backend-failure-injection-closeout.test.ts` (static assertion); full inventory in doc 126.
- **Certifying doc / commit.** 115, 126 / `f5db9fe`, `46adeaf`.

### D14 — fuzzy / drift AOB legacy-only path

- **Original finding.** Doc 119: "NORMAL_PRODUCTION_LEGACY_AOB_CALLERS: 1 (not 0) — `signature-engine.ts`'s fuzzy/drift-tolerant sub-path", believed to be a permanent capability gap.
- **Native path.** `NATIVE_PATH_FIXED` via `SHARED_BACKEND_RESOLVER` — no new Rust; the drift matcher was always a pure function over buffers, and the primitives it needs (region enumeration, chunked completeness-reporting reads) already existed natively.
- **Shipping product.** `PRODUCT_DEFECT_CLOSED`.
- **Certifying test.** `signature-engine-fuzzy-backend.test.ts` (23 cases); `fuzzy-aob-real-process.test.ts` (4 cases); `verify-packaged-fuzzy-scan.mts`; doc 127's 3/3 canary.
- **Certifying doc / commit.** 122, 124 / `46adeaf`, `c53df4d`.

### D15 — native build / CI reproducibility

- **Shipping product.** `PRODUCT_DEFECT_CLOSED` locally and in the fresh worktree; remote CI status recorded in doc 129.
- **Certifying test.** fresh-worktree run (doc 128); `pr-windows.yml` Rust fmt/clippy/test gates; `verify-electron-output` 33/33.
- **Certifying doc / commit.** 109, 123, 128, 129 / `c529352`, `6fcd0c5`.

## Additional defect found and closed during Stage 7.5

### D16 — test fixture leaked a duplicate of every planted pattern

- **Finding.** `fixture.rs`'s `apply_write_command` decoded the caller's hex into a heap `Vec<u8>` and never cleared it, so each pattern planted via `write` existed twice in the target, the spare copy at a lower address. Any first-match AOB scan could legitimately return the wrong one.
- **Impact.** `feature-resolver-native-default-real-process.test.ts`'s legacy-rollback case failed non-deterministically at `6fcd0c5`, which means doc 121's `LOCAL_TECHNICAL_CERTIFICATION: PASS` was not accurate when recorded.
- **Status.** `PRODUCT_DEFECT_CLOSED` (test infrastructure only — no shipping code path was affected).
- **Certifying test / doc / commit.** the same test, 3/3 deterministic after the fix / doc 124 / `1788f56`.

## Summary

| Defect | Shipping status |
|---|---|
| D01 1 MiB cap | `PRODUCT_DEFECT_CLOSED` |
| D02 alignment | `PRODUCT_DEFECT_CLOSED` |
| D03 AOB false-not-found | `PRODUCT_DEFECT_CLOSED` |
| D04 int64/u64 | `PRODUCT_DEFECT_CLOSED` |
| **D05 pointer depth** | **`PRODUCT_DEFECT_NOT_YET_CLOSED`** |
| D06 completeness truth | `PRODUCT_DEFECT_CLOSED` (routed paths; residual named) |
| D07 cancellation | `PRODUCT_DEFECT_CLOSED` |
| D08 stale target | `PRODUCT_DEFECT_CLOSED` |
| D09 process exit | `PRODUCT_DEFECT_CLOSED` |
| D10 result/IPC bounding | `PRODUCT_DEFECT_CLOSED` |
| D11 session persistence | `PROVABLY_NOT_APPLICABLE` to the routed route; native path fixed |
| D12 packaged addon | `PRODUCT_DEFECT_CLOSED` |
| D13 legacy bypasses | `PRODUCT_DEFECT_CLOSED` for primitive/AOB paths; residual named |
| D14 fuzzy AOB | `PRODUCT_DEFECT_CLOSED` |
| D15 build/CI reproducibility | `PRODUCT_DEFECT_CLOSED` |
| D16 fixture duplicate pattern | `PRODUCT_DEFECT_CLOSED` |

**No defect is `UNKNOWN`, `N/A` or `UNRECONCILED`.** Exactly one — **D05** — is open, and it cannot be forward-assigned out of Phase 1 (doc 134).
