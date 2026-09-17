# Phase 1 / Stage 1 — Formal Scan Mode Semantics

Formal semantics for every scan mode the mission requires (1.9), written against the target architecture in doc 06 — this is the specification the Stage 2+ Rust core's `scan::*` modules must implement, and the specification doc 08's algorithm tests must verify against. Each mode states: required prior state, comparison rule, type compatibility, float behavior, NaN behavior, signedness, overflow behavior, result retention, and memory cost — exactly the dimensions the mission names.

Current-behavior column cites today's TypeScript implementation for traceability; "target" is the Stage 2+ contract.

## EXACT

| Dimension | Current (`memory-scanner.ts`) | Target |
|---|---|---|
| Required prior snapshot | None (first scan) | None |
| Comparison rule | `currentValue === comparison.value` (next-scan) or `Buffer.indexOf`/`decodeValue` byte match (first-scan) | Same rule; comparison against a user-supplied literal value |
| Type compatibility | All 6 `LiveValueType`s | All types in doc 06 §2.4's matrix, including string/bytes/AOB (an "exact" string/AOB scan is just "find this literal") |
| Float behavior | `scanFirst` uses raw byte match (no epsilon) for `float`/`double` — an exact scan for `3.14` only matches the bit-identical encoding of the literal `3.14`, which is the correct behavior for "user typed the exact HUD number" | Unchanged — exact means exact, no epsilon. If a caller wants tolerance, they use BETWEEN. |
| NaN behavior | A target value of `NaN` cannot be typed/compared meaningfully (`NaN !== NaN`); not specially handled today | Explicitly reject a `NaN`/non-finite target value at the API boundary with a clear error, rather than silently returning zero matches |
| Signedness | Type-driven (`int32` vs `uint32` are byte-identical for values in the shared positive range, differ only in decode/comparison of the value ≥ 2^31 case) | Unchanged; the full i8–u64 matrix (doc 06) makes signedness an explicit, first-class per-scan choice rather than 2 of 6 possible types |
| Overflow behavior | `encodeValue`'s `writeInt32LE`/`writeUInt32LE` throw `ERR_OUT_OF_RANGE` if the target value doesn't fit the chosen type's signed/unsigned range (verified directly during this Stage 1 pass — see doc 04's benchmark harness, which hit exactly this by accident with an out-of-range int32 literal) | Kept and made an explicit, caller-facing validation error ("value 3735928559 does not fit in a signed int32; did you mean uint32?") instead of a generic Buffer range exception |
| Result retention | Matches list (`address`, `value`) up to `maxMatches` | Same, `regionKind` added (doc 06 §3) |
| Memory cost | O(matches), bounded by `maxMatches` (default 10,000) | Same bound, same default unless Stage 2 evidence justifies changing it |

## UNKNOWN_INITIAL

| Dimension | Current | Target |
|---|---|---|
| Required prior snapshot | None — this mode *creates* the baseline (`scanFirstUnknown`) | None |
| Comparison rule | N/A at capture time; filtering happens in a follow-up CHANGED/INCREASED/etc. scan against the captured baseline | Unchanged two-step design (capture, then narrow) |
| Type compatibility | Byte-level capture, type-agnostic until `scanNextFromSnapshot`/`scanNextFromSnapshotMultiType` interprets it | Unchanged |
| Float behavior | N/A at capture (raw bytes); interpretation happens at narrowing time (see CHANGED etc.) | Unchanged |
| NaN behavior | N/A at capture; `scanNextFromSnapshotMultiType` already drops non-finite decodes (`Number.isFinite` gate) at narrowing time — `scanNextFromSnapshot` (single-type) does **not** have this gate today (asymmetry noted for doc 03) | Target: the same finite-value gate applied uniformly to both the single-type and multi-type narrowing paths |
| Signedness | N/A at capture | N/A at capture |
| Overflow behavior | N/A — raw bytes, no encode/decode at capture time | N/A |
| Result retention | Full raw-byte region copies (`RegionSnapshot[]`), up to `DEFAULT_UNKNOWN_MAX_TOTAL_BYTES` = 512 MiB, held in a JS `Buffer.from()` copy per region | Target: Rust-owned baseline storage (doc 06 §1.9/§3), no JS-heap copy; same 512 MiB default budget unless Stage 2 evidence justifies a change |
| Memory cost | O(bytesScanned), up to 512 MiB, resident in the JS heap for the life of the session's `unknownSnapshots` Map entry (per-cheat keyed; doc 03 additional-defect audit examines whether these are ever released) | O(bytesScanned) same bound, but resident in Rust-owned memory, explicitly released when the caller consumes it via a narrowing scan or explicitly discards it |

## CHANGED / UNCHANGED

| Dimension | Current | Target |
|---|---|---|
| Required prior snapshot | Yes — either a prior `ScanMatch[]` (`scanNext`) or an `UnknownScanSnapshot` (`scanNextFromSnapshot`/`MultiType`) | Yes — same two-flavor design (refine an existing candidate list, or narrow an unknown-value baseline) |
| Comparison rule | `changed`: `currentValue !== previousValue`; `unchanged`: `currentValue === previousValue` | Unchanged rule |
| Type compatibility | All scan types | All scan types including strings/bytes (`changed` on a string = byte-sequence inequality) |
| Float behavior | Strict `!==`/`===` on the decoded `number` — for floats, this means a value that changed by less than one ULP due to re-encoding round-trip would still correctly register as unchanged (decode is deterministic), but two floats that are mathematically "the same" after independent computation paths (e.g. `0.1+0.2` vs `0.3`) could differ at the bit level and register as spuriously "changed" | Target: keep strict equality as the default (matches CE's own behavior and avoids false "unchanged" on genuinely-different bit patterns), but document this explicitly as a known float-comparison caveat rather than leaving it implicit |
| NaN behavior | `NaN !== NaN` is true in JS, so two NaN readings would incorrectly register as "changed" even though the bit pattern may be identical garbage in both reads (`scanNextFromSnapshotMultiType` already filters non-finite values out before this comparison runs; `scanNext`/`scanNextFromSnapshot` do not) | Target: apply the same finite-value pre-filter uniformly (closing the current asymmetry, same as under UNKNOWN_INITIAL above) |
| Signedness | Type-driven | Type-driven, unchanged |
| Overflow behavior | N/A (comparison only, no arithmetic) | N/A |
| Result retention | Narrowed `ScanMatch[]`/`TypedScanMatch[]` | Same, `regionKind` added |
| Memory cost | O(kept matches) ≤ O(previous matches) | Same |

## INCREASED / DECREASED

| Dimension | Current | Target |
|---|---|---|
| Required prior snapshot | Yes, same as CHANGED/UNCHANGED | Yes |
| Comparison rule | `increased`: `currentValue > previousValue`; `decreased`: `currentValue < previousValue` | Unchanged |
| Type compatibility | All scan types with a natural ordering (numeric types; strings/bytes excluded — "increased" has no meaning for a byte sequence) | Numeric types only, explicitly rejected for string/bytes/AOB at the API boundary (today this restriction is implicit/type-system-only; make it an explicit, documented runtime validation too, since the native core's `ScanType` enum admits string/bytes generally) |
| Float behavior | Strict `>`/`<` on decoded values | Unchanged |
| NaN behavior | `NaN > x` and `NaN < x` are both always `false` in JS — a NaN reading is silently excluded from both increased and decreased today (an implicit, not explicit, correctness property) for `scanNextFromSnapshotMultiType` (which pre-filters non-finite values before comparison anyway) but is **not** pre-filtered for `scanNext`/`scanNextFromSnapshot`, where a NaN `currentValue` would fall through `matchesComparison`'s `>`/`<` and correctly evaluate false — so the *outcome* happens to be correct today even without an explicit filter, but only by relying on IEEE-754 comparison semantics rather than an intentional design decision | Target: make the finite-value requirement **explicit** in the Rust comparator (not an accidental byproduct of `>`/`<` semantics), so the behavior remains correct even if a future comparison rule doesn't share that byproduct |
| Signedness | Type-driven | Type-driven |
| Overflow behavior | A value that wraps (e.g. `uint32` wrapping from `0` to `4294967295` after a decrement) would register as `increased` (4294967295 > previous), which is numerically correct for the *encoded* value but may not match the game's *intended* semantic (an underflowed counter) | Target: unchanged — this is correct scanner behavior (report what the bytes say); a "did this counter wrap" interpretation is a UI/UX layer concern, not a scanner-semantics one, and is explicitly out of scope here |
| Result retention | Narrowed matches | Same |
| Memory cost | O(kept matches) | Same |

## INCREASED_BY / DECREASED_BY

| Dimension | Current | Target |
|---|---|---|
| Required prior snapshot | Yes | Yes |
| Comparison rule | `increasedBy`: `abs(current - previous - delta) < DELTA_EPSILON`; `decreasedBy`: `abs(previous - current - delta) < DELTA_EPSILON`, where `DELTA_EPSILON = 1e-4` | Unchanged rule, but see overflow/magnitude caveat below |
| Type compatibility | Numeric types | Numeric types |
| Float behavior | Epsilon-tolerant by design (documented rationale: `100.0 - 12.3` rarely equals `87.7` exactly at the bit level) | Unchanged |
| NaN behavior | `Math.abs(NaN - ...) < EPSILON` is always `false` — a NaN reading is naturally excluded, same accidental-not-explicit property as above | Target: make explicit, same as INCREASED/DECREASED |
| Signedness | Type-driven | Type-driven |
| Overflow behavior | **A fixed absolute epsilon (`1e-4`) is magnitude-blind**: for a `double` value in the billions, `1e-4` is far tighter than floating-point precision can guarantee (spurious non-matches), while for values very close to zero it is far looser than meaningful (spurious matches on noise). This is a genuine, currently-shipping design gap, not previously named as one of the 6 known defects — flagged here and cross-referenced into doc 03's new-defect ledger. | Target: a relative-or-absolute hybrid epsilon (e.g. `max(1e-4, relativeEpsilon * max(abs(current), abs(previous)))`), evidence-tuned during Stage 2 implementation against real game value ranges, not shipped as a single magic constant |
| Result retention | Narrowed matches | Same |
| Memory cost | O(kept matches) | Same |

## BETWEEN / RANGE

| Dimension | Current (`scanFirstRange`, the already-repaired sibling) | Target |
|---|---|---|
| Required prior snapshot | None (first scan) or prior matches (next-scan `between` comparison) | Same two-flavor support |
| Comparison rule | `value >= min && value <= max` (inclusive both ends) | Unchanged |
| Type compatibility | Numeric types | Numeric types |
| Float behavior | `Number.isFinite(value)` gate already present (the one function in today's codebase that has this consistently) | Unchanged — this is the model the target design generalizes to every other mode (see the NaN-behavior "target" cells above) |
| NaN behavior | Explicitly excluded via the finite-value gate | Unchanged, already correct |
| Signedness | Type-driven | Type-driven |
| Overflow behavior | `min <= max` is validated and throws if violated (`scanFirstRange:207-209`) — the one mode with explicit input validation today | Unchanged, extend the same validate-and-throw discipline to every mode's inputs (e.g. INCREASED_BY's delta, EXACT's target value per the overflow-behavior row above) |
| Result retention | Matches up to `maxMatches` | Same, `regionKind` added |
| Memory cost | O(matches) | Same |

## Cross-cutting notes carried into doc 06's completeness contract

- Every mode above returns matches **and** a completeness value (doc 06 §4) in the target design — `ScanCompleteness` is orthogonal to which mode ran; a `Cancelled` or `CompleteWithSkippedRegions` result is possible for any mode, including BETWEEN even though it's the one mode that already reports truncation reasonably honestly today.
- The float/NaN "accidentally correct via IEEE-754 semantics rather than explicit design" pattern found in INCREASED/DECREASED/INCREASED_BY/DECREASED_BY above is exactly the kind of implicit correctness the native rewrite should eliminate — Rust's `f64`/`f32` types still have the same IEEE-754 NaN-comparison semantics, but the target design makes the finite-value requirement an explicit, tested precondition rather than relying on it as a byproduct, so a future refactor of the comparator cannot silently break it.
