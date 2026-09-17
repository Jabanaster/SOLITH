# Phase 1 / Stage 2 — Defect Status

Per the mission's explicit instruction: distinguishing **CLOSED** (the defect cannot recur because the mechanism that caused it no longer exists in the new code path) from **FOUNDATION_COMPLETE_BUT_DEFECT_NOT_YET_CLOSED** (the new foundation makes closing the defect possible/inevitable once Stage 3+ builds the actual scan modes on top of it, but nothing in production has switched over yet, so the old TypeScript defect still exists in the code path real users hit today).

## D02 — 1 MiB region-read cap

**FOUNDATION_COMPLETE_BUT_DEFECT_NOT_YET_CLOSED.**

The *mechanism* is closed at the architecture level: `native/solith-scanner-core`'s chunked reader has no cap analogous to `native-memory-driver.ts:361-364`'s hard 1 MiB `readBuffer` ceiling — a region of any size is read via a sequence of configurable, overlapping chunks (doc 13), and `region_over_1mib_is_fully_covered_and_sentinel_value_readable` proves a real >1 MiB region is read completely and correctly. **Not CLOSED** because:
1. The TypeScript scanner (`memory-scanner.ts`) is untouched — the real, user-facing scanner still has the cap today.
2. No scan *mode* (exact/range/unknown-initial/etc.) exists yet on top of the native reader — Stage 2 only proves raw bytes can be read past the old boundary, not that a value scan using those bytes is correct end to end.

## P1-SCAN-004 — no chunking / cross-region-boundary misses

**FOUNDATION_COMPLETE_BUT_DEFECT_NOT_YET_CLOSED**, with a scoped caveat.

Within-one-region chunking with overlap is real and proven (`chunk_boundary_straddling_pattern_is_read_intact_via_overlap`). **Cross-*region* stitching (a value literally split across two separately-`VirtualQueryEx`-enumerated regions) is explicitly out of Stage 2's scope** and remains open even at the foundation level — `read_regions_chunked` reads each selected region independently with no shared overlap window at region boundaries. This narrower residual gap should be evaluated during Stage 3's scan-mode design (is a cross-region value/pattern realistic enough to warrant a stitching mechanism, given real regions are typically far apart in practice) rather than assumed necessary or unnecessary here.

## P1-SCAN-005 — synchronous scanner blocking the main process

**FOUNDATION_COMPLETE_BUT_DEFECT_NOT_YET_CLOSED** — architecturally superseded, not yet load-bearing.

The native async foundation (`Task`-trait-based `read_region_chunked`, proven non-blocking from real JavaScript in the napi test suite) is a complete, working replacement for the *pattern* that caused this defect. The defect itself — `memory-scanner.ts`'s fully synchronous scan functions still blocking Electron's main thread — persists unchanged, since nothing in production calls the new native path yet.

## P1-SCAN-001 — no 32-bit/WOW64 pointer-width detection

**FOUNDATION_COMPLETE_BUT_DEFECT_NOT_YET_CLOSED**, with an explicit, undischarged validation gap.

`ProcessHandle::detect_architecture()` is a real, working `IsWow64Process`-based implementation (not a stub) — proven correct for the one case this environment can produce (a real 64-bit process correctly reporting `X64`/non-WOW64). **The positive case (a real 32-bit target reporting `X86OnWow64`) has not been executed against a real process** — this environment has no `i686-pc-windows-msvc` Rust target installed, so a genuine 32-bit fixture cannot currently be built. Per the mission's explicit "do not fabricate that validation" instruction, this is recorded as a **required later gate**: before this defect can be marked CLOSED (even at the foundation level), a real 32-bit target process must be attached and `detect_architecture()` must be shown to correctly report `X86OnWow64` with `pointer_width_bytes() == Some(4)`. Additionally, even once that validation exists, the defect's actual *use site* — `pointer-scanner.ts`'s hardcoded 8-byte pointer stride — is untouched TypeScript; closing this defect for real requires both the validated detection *and* a Stage 3+ pointer-scanner rewrite that consumes it (per doc 09's migration ladder, ladder increment P1.11).

## D01 — sibling scan-function truth-reporting gaps

**FOUNDATION_COMPLETE_BUT_DEFECT_NOT_YET_CLOSED.**

The architectural root cause (a `boolean truncated` flag that five TypeScript functions inconsistently set) is closed at the type-system level in the new foundation: `ScanCompleteness` is an exhaustive Rust enum every reader function returns unconditionally — there is no code path in `solith-scanner-core` that can return match/read data without also returning a completeness value, which structurally prevents the class of bug where a function forgets to set a completeness signal (the compiler enforces it). Proven for the reader's own completeness reporting (`inaccessible_page_yields_completewithskippedregions_not_complete`, `process_exit_is_reported_truthfully_not_silently_ignored`). **Not CLOSED** because the five actual TypeScript functions named in Stage 1 doc 02 (`scanFirst`, `scanFirstUnknown`, `scanNextFromSnapshot`, `scanNextFromSnapshotMultiType`, `scanFirstByComparison`) are untouched — they still silently omit setting `truncated` today. Closing D01 for real requires Stage 3+ to actually replace these functions' call sites with the native reader.

## D04 — AOB cap-induced false negative, no truncation signal in return type

**FOUNDATION_COMPLETE_BUT_DEFECT_NOT_YET_CLOSED.**

Foundation-level: the chunked reader (which any future native AOB engine will be built on) has no cap analogous to the TypeScript `aob-resolver.ts`'s uncapped-but-1MiB-limited region read, and always returns a real completeness value alongside its data — the structural precondition for an AOB result to distinguish "not found" from "not fully scanned" (mission's explicit requirement) is now satisfiable. **Not CLOSED**: no AOB pattern-matching logic exists anywhere in `solith-scanner-core` yet (this is explicitly out of Stage 2's owned scope — doc 09's ladder puts the native AOB engine at P1.9, several increments away) — today's `aob-resolver.ts`/`scanAobInProcess` is completely untouched and still exhibits the exact defect Stage 1 doc 02 reproduced.

## Summary table

| ID | Status | What's actually closed | What remains |
|---|---|---|---|
| D02 | FOUNDATION_COMPLETE_BUT_DEFECT_NOT_YET_CLOSED | Chunked reading proven past 1 MiB, real region | Production scanner untouched; no scan mode built on the reader yet |
| P1-SCAN-004 | FOUNDATION_COMPLETE_BUT_DEFECT_NOT_YET_CLOSED (partial scope) | Within-region chunk-boundary overlap proven | Cross-region stitching explicitly deferred to Stage 3 evaluation |
| P1-SCAN-005 | FOUNDATION_COMPLETE_BUT_DEFECT_NOT_YET_CLOSED | Real non-blocking async reader proven from JS | Production scanner still fully synchronous |
| P1-SCAN-001 | FOUNDATION_COMPLETE_BUT_DEFECT_NOT_YET_CLOSED | Real detection code, negative case proven | Positive (32-bit) case not executable in this environment; pointer-scanner.ts untouched |
| D01 | FOUNDATION_COMPLETE_BUT_DEFECT_NOT_YET_CLOSED | Exhaustive completeness enum, compiler-enforced | 5 TypeScript functions still silently omit `truncated` |
| D04 | FOUNDATION_COMPLETE_BUT_DEFECT_NOT_YET_CLOSED | Reader precondition (cap-free + completeness) satisfiable | No native AOB engine built yet; TypeScript AOB path untouched |

**No defect in this ledger is claimed CLOSED at the end of Stage 2** — this is intentional and expected: Stage 2's mission was explicitly scoped to foundation only (region enumeration + chunked reader + correctness plumbing), never to a working scan mode. Marking any of the above CLOSED before a real scan mode exists and the production scanner has actually switched over would be the exact "falsely mark later scanning semantics fixed merely because the reader can now access the bytes" overclaim the mission explicitly warns against.
