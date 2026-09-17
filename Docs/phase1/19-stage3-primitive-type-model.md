# Phase 1 / Stage 3 — Canonical Primitive Type Model

## Design (`native/solith-scanner-core/src/types.rs`)

`PrimitiveType` — all 10 required types (i8/u8/i16/u16/i32/u32/i64/u64/f32/f64), with:

- **Byte width**: `byte_width()` — 1/1/2/2/4/4/8/8/4/8 respectively. Doubles as the minimum-overlap-minus-one value `exact_scan.rs` enforces per scan (mission §3.5).
- **Signedness**: `is_signed_integer()`/`is_unsigned_integer()`/`is_float()` — explicit predicates, not inferred from byte width.
- **JS representation**: `requires_bigint_for_js()` — `true` only for `I64`/`U64`. i8/u8/i16/u16/i32/u32 (max magnitude 2³²) and f32 (widens losslessly into f64) all fit a plain JS `number` exactly; only i64/u64 need `BigInt`. This is the single source of truth both `exact_scan.rs`'s napi-facing test/benchmark code and `solith-scanner-napi`'s `primitive_value_from_js`/`scan_match_to_js` consult — no second, independently-maintained "which types need bigint" list exists anywhere.

`PrimitiveValue` — a tagged union carrying the actual decoded scalar. i64/u64 are stored as native Rust `i64`/`u64`, never narrowed through `f64` at any point between decode and the napi boundary — this is the structural fix for D06's value-precision-loss half (Stage 2 already fixed the address half via `readPointer`-style BigInt).

## Decode/comparison/serialization semantics, defined once

| Dimension | Definition | Where |
|---|---|---|
| Decode | Little-endian, `bytes.len()` must equal `byte_width()` exactly or `None` is returned (never partial/garbage decode) | `PrimitiveValue::decode` |
| Encode | Little-endian, writes into a caller-provided exact-width buffer | `PrimitiveValue::encode_into` |
| Integer comparison | Exact bitwise/numeric equality (`==`) | `PrimitiveValue::eq_exact` |
| Float comparison | Ordinary IEEE-754 `==`: `+0.0 == -0.0` is `true`; `NaN == NaN` is `false`. No epsilon/approximate mode exists in exact scan (explicitly deferred to a later comparative/refinement stage, mission §3.7's own instruction) | `PrimitiveValue::eq_exact` |
| Mismatched-type comparison | Returns `false`, never panics — defensive, since `scan_exact` always compares like-typed values by construction and should never hit this path in practice | `PrimitiveValue::eq_exact` |
| JS representation | `number` for 8 of 10 types; `BigInt` for i64/u64 only | `requires_bigint_for_js()` |

## Why LE, why no epsilon by default

Little-endian matches the project's own 100%-consistent convention across every existing encode/decode site (independently re-confirmed during Stage 1's audit, doc 03 item 3 — zero big-endian usage anywhere in the repository). No epsilon mode in exact scan is a deliberate scope boundary: Stage 1 doc 03's own audit found the *existing* TypeScript scanner's `DELTA_EPSILON = 1e-4` is a real, magnitude-blind defect (P1-SCAN-003) precisely because a single fixed epsilon cannot be simultaneously correct at very large and very small magnitudes — building a new epsilon-based exact scan now would risk re-introducing exactly that defect. Exact scan means exact; magnitude-aware or user-configurable tolerance is refinement-stage work (Stage 4+, per the roadmap's `INCREASED_BY`/`DECREASED_BY` modes), not exact-scan work.

## Real, executed test coverage

- **Round-trip correctness for every type**, including zero/min/max boundary values (`types::tests::integer_round_trip_zero_min_max`).
- **Beyond-JS-safe-integer i64/u64 round-trip** (`i64_u64_beyond_js_safe_integer_round_trip_exactly`) — includes `u64::MAX`, `u64::MAX - 2` (the exact Stage 2 `Number()`-collision partner), and `2^53 + 1`.
- **Float specials**: `+0.0`/`-0.0` equality (`positive_zero_equals_negative_zero_under_exact_scan`), `NaN` self-inequality (`nan_is_never_exactly_equal_to_itself`), `+Infinity`/`-Infinity` round-trip and mutual inequality (`infinities_are_distinct_and_self_equal`) — all against real Rust `f32`/`f64` bit patterns, not approximations.
- **Malformed input**: `decode_rejects_wrong_length_buffer` — confirms `None`, not a panic or garbage read, for a truncated/oversized buffer.
- **Repo-convention confirmation**: `little_endian_decode_matches_repo_wide_convention` decodes a literal known-LE byte sequence and asserts the LE-correct value, not the BE-swapped one.

11/11 unit tests in `types.rs` pass — all listed above are real, currently-passing tests, not aspirational descriptions.
