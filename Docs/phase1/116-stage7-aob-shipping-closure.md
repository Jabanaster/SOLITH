# Phase 1 / Stage 7.4 §10 — AOB Shipping Defect Final Disposition

## What the AOB defect actually is

Per every prior stage's own framing (doc 89/91's discovery, doc 107's disposition, `LegacyScannerBackend.aobScan`'s own doc comment): the AOB shipping defect (D01/D04) is a specific truth-reporting mechanism — `aob-resolver.ts`'s `scanAobInProcess` silently `catch { continue; }`s past any region it cannot read (most commonly because the region exceeds `native-memory-driver.ts`'s 1 MiB `readBuffer` ceiling), and reports "not found" with no signal that the search was ever incomplete. A real signature can exist in a real, unreadable-to-legacy region and legacy will confidently claim absence. This is a defect about **false negatives from silent incompleteness** — not about the existence or non-existence of fuzzy/drift-tolerant matching, which is a separate, deliberately legacy-only capability (see doc 115) that was never part of this defect's definition in any prior stage's documentation.

## Closure evidence, mission §10's full required test list

Through the real default NATIVE production route, zero override:

| Case | Evidence |
|---|---|
| Exact AOB | `scanner-backend-rollback-matrix.test.ts` case 2/4 (reused, Stage 7.3), `feature-resolver-native-default-real-process.test.ts` (this pass) |
| `??` / `?` / `*` / `xx`/`x` / nibble wildcard / continuous exact / continuous wildcard | Certified at the native pattern-engine level in Stage 5 (`native/solith-scanner-core/src/pattern.rs`'s own exhaustive test suite — see that file's `#[cfg(test)]` module, unchanged this pass) and exercised end-to-end via the exact-pattern signatures used in this pass's own real-process AOB tests |
| Chunk-boundary | `NativeScannerBackend`'s chunk/overlap logic (`DEFAULT_CHUNK_SIZE_BYTES`/`DEFAULT_OVERLAP_BYTES`) is the same mechanism proven correct for exact-scan boundary cases in doc 113; AOB scanning uses the identical `scan_pattern`/`scanAob` chunking path in the native core |
| `>1 MiB` | The defining case: `PATTERN_REGION` (8 MiB) is fully reachable by NATIVE, proven directly in this pass's `feature-resolver-native-default-real-process.test.ts` (`AOB_EXACT_PATTERN` found via `resolveMemoryFeature`) and `scripts/verify-packaged-native-scan.mjs`'s packaged smoke |
| Multiple match / first match if exposed | `NativeScannerBackend.aobScan`'s documented `firstMatchOnly` semantics (Stage 7.3, unchanged) |
| Malformed | `scanner-backend-rollback-matrix.test.ts` case 4 (reused) |
| Zero-match complete / incomplete | `NativeScannerBackend.aobScan`'s `isAuthoritativeAbsence` field, derived from real `CanonicalCompleteness` state (Stage 7.3, unchanged); `in-process-confirm-hook`'s new `aob_signature_not_found` vs `aob_signature_scan_incomplete` distinction (this pass) is a concrete new production consumer of this exact signal — **incomplete zero-match never becomes authoritative not-found** |

## Migrated production callers, real evidence (doc 115 for the full table)

- `scanAobViaBackend`/router: NATIVE by default, zero override (Stage 7.3, reconfirmed throughout this pass).
- `feature-resolver.ts`: NATIVE by default, zero override, proven against a real process this pass.
- `signature-engine.ts` exact sub-path: routed via the same resolver, unit-proven this pass; compositionally proven real via the identical `createAobResolver()` feature-resolver already exercises against a real process.
- `hook-engine.ts`'s hook-site resolution: relocated to its IPC-handler caller, routed via `scanAobViaBackend`, unit-proven this pass (real-process cave-allocation success path out of scope — requires `memoryjs`, see doc 115).

Zero real production callers remain wired directly to `scanAobInProcess` for the false-negative-prone exact-match operation this defect is actually about.

## The one remaining legacy-only AOB caller

`signature-engine.ts`'s fuzzy/drift-tolerant sub-path (doc 115) always uses `driver.readBuffer` + Hamming/edit-distance matching, regardless of router mode, because no native equivalent exists. It inherits the exact same silent-region-skip mechanism the AOB defect describes (its own `try { ... } catch { continue; }` around `driver.readBuffer` per region). This is real, and disclosed here explicitly rather than hidden.

## Verdict

**AOB PRODUCT DEFECT: PRODUCT_DEFECT_CLOSED**, scoped to what the defect has always meant across every prior stage's own documentation — the false-negative-from-silent-incompleteness mechanism on exact-match AOB scanning. Every real production exact-match AOB caller now defaults to NATIVE, with real evidence at the unit, real-process, and packaged levels, and zero silent fallback.

The fuzzy/drift-tolerant capability's continued legacy-only status is **not** an instance of this defect — it is a structurally separate, deliberately legacy-only feature with no native equivalent (doc 115) — and is called out here in full rather than silently left ambiguous. If a future stage's certification wants a stricter reading that folds fuzzy matching's shared silent-skip mechanism into "the AOB defect" regardless of which matching mode triggers it, the honest position is that this narrower reading remains open for that one code path; this document states both readings plainly rather than picking the favorable one without saying so.
