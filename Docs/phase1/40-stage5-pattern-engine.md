# Phase 1 / Stage 5 — Pattern Matcher Architecture

## One matcher, three constructors (mission §5.6)

`native/solith-scanner-core/src/pattern.rs` defines a single primitive, `PatternByte{mask, value}` (`(byte & mask) == value`), and a single compiled type, `Pattern` (an ordered `Vec<PatternByte>`). Raw bytes, UTF-8/UTF-16LE strings, and AOB patterns are three different *constructors* of the same `Pattern` — not three matchers:

- `pattern_from_raw_bytes` → every byte `mask=0xFF` (exact)
- `pattern_from_utf8_str`/`pattern_from_utf16le_str` → the string's encoded bytes, each `mask=0xFF` (or the ASCII case-insensitive mask, doc 36)
- `parse_aob` → a mix of exact/full-wildcard/nibble-wildcard `PatternByte`s per the grammar (doc 38)

`pattern_scan.rs::scan_pattern` is the one engine that executes all three, structurally mirroring Stage 3's already-proven `exact_scan.rs` (chunk planning, per-chunk read/classify, address-ascending dedup, completeness propagation).

## Efficient skip logic where possible (mission §5.6)

`build_horspool_skip_table` implements a real Boyer-Moore-Horspool bad-character table, built from the pattern's *exact* bytes at every position except the last:

- If the **last** pattern byte is exact, a full 256-entry skip table is built once per scan and consulted after every position check — a mismatch at the window's last byte skips ahead by that byte's precomputed distance (up to the full pattern length) instead of advancing by 1.
- If the last byte is a wildcard/nibble-wildcard, there is no reliable single-byte identity to anchor a skip on, so the scan falls back to a plain shift-by-one — still fully correct, simply without the acceleration.
- Wildcard bytes *elsewhere* in the pattern (not the last position) contribute no table entries, which is always safe: the default (full-pattern-length) skip is a conservative upper bound that can never skip past a genuine match, only ever forgo some acceleration a fully-exact pattern would have gotten.

Real, measured effect (doc 43): the 16-byte wildcard AOB case (`aob_wildcard_medium_16B`, last byte kept exact) achieves throughput within ~5% of the equal-length fully-exact raw-byte case — proving wildcards cost little *as long as the anchoring last byte stays exact*, and documenting (rather than hiding) the case where they would not.

## Chunk-boundary safety (mission §5.7)

Identical mechanism to Stage 3: `PatternScanOptions::default_for` sets `chunk_config.overlap_bytes = pattern.len() - 1`, guaranteeing every possible pattern-length window is fully contained in at least one chunk regardless of where it straddles a chunk boundary. `validate_options` refuses a caller-supplied overlap smaller than this, exactly like `exact_scan.rs::validate_options`. Real proof across four representative lengths (chunk-boundary-straddling offsets, real spawned-process fixture, Rust + JS): 2-byte raw bytes, 8-byte raw bytes, 16-byte string, and 32-byte wildcard AOB — all four found intact and exactly once, per mission §5.7's explicit length matrix and its "exact/wildcard/string, no miss, no duplicate" requirement.

## Region-boundary semantics (mission §5.8) — explicit policy: NOT stitched

A pattern is never stitched across two independently-enumerated `Region`s. Each region is scanned as its own self-contained chunk sequence (`plan_chunks(region.base_address, region.size, ...)`), so a match candidate can only ever be found if it lies fully within one region's `[base, base+size)` span.

**Why not stitch, even when two regions are address-contiguous:** `VirtualQueryEx` groups memory by matching `Protect`/`State`/`Type` metadata — two regions reported back-to-back in address space are not guaranteed to be one contiguous, uniformly-readable OS mapping (a change in protection, commit state, or backing type is exactly why they were enumerated as two entries rather than one). Silently stitching would mean silently assuming a property `VirtualQueryEx` itself does not assert. A real trainer/CT signature also does not depend on this in practice — a compiled signature targets bytes within one function or one image section, which is one region.

**Proof of the policy, honestly scoped:** `pattern_scan.rs::region_boundary_is_not_stitched_across_two_regions` proves the *mechanism* structurally (each region's own chunk plan never reads past its own bounds, so a pattern split across a synthetic region-A-tail/region-B-head boundary is not found in either). Forcing two **genuinely OS-adjacent** `VirtualQueryEx` regions on demand is not reliably controllable from user-mode Windows (the same category of honest scope limit as Stage 4 doc 30's PID-reuse-forcing limit) — this is stated explicitly here rather than fabricating a real-adjacency test that cannot be deterministically constructed.

## Vectorscan adoption boundary (mission §5.18)

Reviewing the frozen Step 0.13.5 Vectorscan decision against Stage 5's actual workload:

- **NATIVE MATCHER** (this stage's `pattern_scan.rs`): owns interactive/general single-target, single-session AOB/string/byte semantics — exact bytes, full-byte wildcards, nibble wildcards, deterministic address-ascending ordering, first-match/all-match modes, real cancellation/progress/completeness. This is the correct, and only, engine for SOLITH's live scanner UI.
- **VECTORSCAN**: remains reserved for a distinct future workload this stage does not touch — batch validation/repair of hundreds-to-thousands of *compiled* signatures against the *same* memory snapshot (the existing `src/core/runtime/aob-repair-analyzer.ts` use case), where Vectorscan's multi-pattern-simultaneous design is a genuine structural advantage a single-pattern interactive scanner does not need.
- **Compatibility check**: Vectorscan (hyperscan-family) represents patterns as regex-like automata; SOLITH's nibble-wildcard semantics (`mask`/`value` at sub-byte granularity) do not map onto a byte-granular regex character class without either (a) expanding a nibble wildcard into 16 alternative byte values per position (multiplicative blowup for multiple nibble wildcards in one pattern) or (b) losing nibble precision entirely. **Decision: nibble-wildcard patterns must never be routed through Vectorscan** — full-byte-wildcard and exact-byte-only patterns are the only subset that could ever map cleanly, and only for the future batch use case, not this stage's interactive scanner.
- **No Vectorscan integration was performed this stage** — none was justified: Stage 5's actual workload (one pattern, one session, real-time UI feedback) is exactly what the native matcher above already serves correctly, and the mission explicitly scopes Vectorscan integration to "unless evidence strongly justifies it and it does not expand scope," which does not hold here.

## Result model (mission §5.10)

`PatternMatch{address: u64, length: u32}` plus the scan-level `kind: PatternKind` (echoing which of raw-bytes/UTF-8/UTF-16LE/AOB was requested) — matches the mission's minimum ("address, pattern/string type, match length") without returning the full matched memory bytes by default (a caller with the address can re-read the exact bytes itself if it needs them, avoiding needless data duplication in the result set). Bounded via `max_results`, consistent with Stage 3/4's own pagination/limit conventions (doc 37).
