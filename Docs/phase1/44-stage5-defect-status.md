# Phase 1 / Stage 5 — Defect Closure Accounting

Per the mission's explicit instructions (§5.19): the *native path* is evaluated separately from the *shipping product*, since production TypeScript remains untouched and active throughout this stage.

## AOB / large-region defect (D04) — native path becomes FIXED

**NATIVE_PATH_FIXED.** The old defect class (mission §5.11's own framing: "AOB searches could return `found:false` while large memory regions were not actually scanned") is structurally impossible in `pattern_scan.rs`: every non-`Complete` outcome (`CompleteWithSkippedRegions`, `Cancelled`, `ProcessExited`, `ResourceLimit`) is a distinct, named `ScanCompleteness` variant a caller must explicitly check — there is no code path that can return an empty `matches` vector while silently discarding the fact that some of the requested scope was not read. Proven with a real, deliberately-constructed reproduction of the exact defect class: a genuine `PAGE_NOACCESS` page hides a real planted pattern (`GUARD_HIDDEN_PATTERN`), and the scan reports zero matches **and** `complete_with_skipped_regions` — never `complete` — both in Rust (`zero_matches_under_unreadable_page_is_not_authoritative_not_found`) and from real JS against the compiled addon (`pattern: a real unreadable page reports skipped-region incompleteness, never authoritative not-found`). A companion test (`pattern: a genuinely absent pattern under full coverage is authoritatively not found`) proves the *positive* case too: a truly absent pattern under full, real coverage reports `complete` with zero matches — the two cases are distinguishable, which is the entire point of the truthful-completeness contract.

**PRODUCT_DEFECT_NOT_YET_CLOSED.** The shipping product's AOB/signature resolution (`src/core/live-memory/aob-resolver.ts`, `signature-engine.ts`) is untouched this stage, per the explicit "do not switch production scanner" boundary. D04 remains open at the product level until the native pattern engine is wired into that path.

## String / raw-byte support — native path implemented

**Implemented, real, and proven** (docs 36/37/42): UTF-8 and UTF-16LE string scanning (including real non-BMP surrogate pairs), raw byte-sequence scanning, and AOB (exact/full-wildcard/nibble-wildcard) all work against real spawned-process memory, through both the Rust API and the napi/JS boundary. No product-level equivalent existed before this stage to compare against — this is new native capability, not a fix to an existing native defect.

## 1 MiB scan cap — native reader/pattern path proven absent

**Unchanged from Stage 2/3/4's own accounting, now additionally proven for the pattern path specifically: foundation-complete, no cap anywhere in Stage 5's own new code.** `scan_pattern` builds on the same cap-free `plan_chunks`/`read_chunk` primitives every earlier native stage already certified — proven directly by this stage's own real 8 MiB fixture region (`PATTERN_REGION_SIZE`), with a real match planted 6 MiB in (`FAR_MARKER_OFFSET`) found intact by both the Rust and the real-JS test suites (`pattern_beyond_1mib_is_found_by_the_native_path` / `pattern: a signature well beyond the old 1 MiB cap is found by the native path`), and independently by `bench_pattern`'s real 256 MiB region scans. The *product* still runs the old TypeScript scanner with the old cap for AOB/string work (it has none today — this is genuinely new capability, not a capped one); this stage's native work does not change the product's cap status.

## Truth reporting (AOB/string/byte) — must be truthful

**Proven, not merely asserted**, mirroring Stage 4's own defect-status discipline:

- A pattern scan against a genuinely unreadable page reports `CompleteWithSkippedRegions`, never `Complete` — proven above (real `PAGE_NOACCESS` page, real hidden pattern).
- A resource-limited scan (`maxResults` reached, or `firstMatchOnly`) reports `ResourceLimit`, never `Complete` — proven by `max_results_resource_limit_is_reported_truthfully` and `first_match_only_returns_deterministic_lowest_address` (Rust) and their real-JS equivalents.
- A cancelled scan reports `Cancelled` and never silently returns a false "nothing found" — proven by `cancellation_stops_pattern_scan_before_full_region_is_covered` (Rust, asserts the far-away marker that lies past the cancellation point is correctly absent) and its real-JS equivalent.
- A stale (exited) target is rejected with `ProcessExited`, never silently treated as "0 matches" — proven by `stale_target_scan_reports_process_exited_not_zero_matches`.

No new unresolved Stage-5 P0/P1 defect was found during this stage's own testing (matching Stage 4's own outcome, not Stage 3's two caught-and-fixed real bugs) — three real test-authoring bugs were found and fixed (a completeness-`at_byte`-value over-assertion in a Rust test, and a region-selection-via-real-enumeration mistake in a JS test that has an exact documented Stage-2 precedent — see doc 42), none of them product defects.

## Summary table

| Item | Native path | Product |
|---|---|---|
| AOB / large-region cap (D04) | NATIVE_PATH_FIXED (proven via a real reproduction of the exact defect class) | PRODUCT_DEFECT_NOT_YET_CLOSED |
| String / raw-byte scanning | Implemented, real, and proven (new capability) | N/A — no prior product string/AOB scanner to compare against |
| 1 MiB scan cap (pattern path) | Foundation-complete, no cap anywhere in Stage 5's own code | Not applicable — product has no AOB/string scanner today |
| Truth reporting (pattern-specific) | Proven via dedicated real tests for skip/resource-limit/cancellation/stale-target | N/A — product has no pattern-scan completeness model to report truthfully or not |
| Nibble wildcard (design contingency from Stage 1 doc 06) | Implemented (doc 38), no current corpus evidence of necessity (doc 39) | N/A |
| Pointer depth (P1-SCAN-001) | Not Stage 5, as instructed | Not yet closed |
