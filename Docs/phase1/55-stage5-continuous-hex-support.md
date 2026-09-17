# Phase 1 / Stage 5.4 — Continuous Cheat Engine Hex Grammar Support

## Authorization

Owner decision #4 (Stage 5.4): "AUTHORIZE support for legitimate Cheat Engine continuous/unspaced hex AOB syntax." Implemented exactly against the authoritative Cheat Engine wiki evidence captured in doc 51 (Stage 5.3) — no guessed syntax.

## Grammar implemented

`native/solith-scanner-core/src/pattern.rs`'s `parse_aob`/`parse_token` was re-architected from a pure whitespace-token parser into a 2-character-byte-group tokenizer, matching Cheat Engine's own real tokenizer (doc 51):

1. The pattern is split on whitespace into tokens (whitespace remains an optional, purely cosmetic separator — tabs and newlines work identically to spaces).
2. A single-character token consisting of exactly one wildcard character (`?`, `*`, `x`/`X`) is a standalone full-byte wildcard — the "isolated wildcard character" form (doc 51's `x 48 8D x 24 E0`).
3. Every other token must have even length. An odd-length token cannot be split into whole bytes:
   - if it is composed entirely of wildcard characters (e.g. `xxx`, `?????`), it is `malformed_wildcard` (an over-long wildcard-alias typo);
   - otherwise (e.g. `AAB`), it is `odd_length_token` — a genuinely truncated continuous-hex run.
4. An even-length token is split into consecutive 2-character byte groups. Each group is classified independently:
   - two hex digits → exact byte (`AA`)
   - one hex digit + one wildcard character, either order → nibble wildcard (`A?`/`Ax`/`A*` = high nibble fixed; `?A`/`xA`/`*A` = low nibble fixed) — `?`, `x`/`X`, and `*` are all accepted in the nibble position, not only `?` (doc 51's finding that CE's nibble wildcard is not limited to `?`)
   - two wildcard characters, any combination → full-byte wildcard (`??`, `xx`, `**`, or mixed pairs such as `x?`)
   - anything else → `invalid_hex_token`

This single tokenizer subsumes both spaced and continuous input — they are not two code paths. `"AA BB CC"` and `"AABBCC"` produce the byte-for-byte identical compiled `Pattern`, proven by direct `as_slice()` equality assertions in the unit tests (Stage 5.4 §G's normalization requirement).

## Scope change from Stage 5.3

Stage 5.3 rejected `"4x"`/`"x4"` (a hex digit mixed with `'x'` in one token) because no evidence then supported `'x'` as a nibble-position wildcard character. Doc 51's authoritative Cheat Engine wiki citation (verbatim examples `5x 48 8D 6x 24 E0`, `*D`) proves it is real, documented CE grammar. This mission implements it; the corresponding Stage 5.3 test (`aob_rejects_x_embedded_in_hex_token`) was replaced with `aob_parses_x_as_nibble_wildcard`, documenting the evidence-driven reason for the change.

## Error classification (Stage 5.4 §F)

A new `PatternParseErrorKind::OddLengthToken` variant was added, contained entirely within `pattern.rs` (confirmed by grep — no external code matches on the full enum). Existing error kinds' classification rules for non-length-related invalid input are unchanged: an alphanumeric-but-non-hex-non-wildcard character (e.g. `"GG"`) is still `invalid_hex_token`; pure symbol junk (e.g. `"#!"`) is still `unsupported_token`; an odd-length all-wildcard run is still `malformed_wildcard`.

## Ambiguity rules covered

| Case | Behavior |
|---|---|
| Odd-length continuous pattern | `odd_length_token` (or `malformed_wildcard` if entirely wildcard characters) |
| Invalid hex characters | `invalid_hex_token` |
| Malformed wildcard placement | `malformed_wildcard` (over-long same-position wildcard run) |
| Mixed spaced/unspaced input | Each whitespace token tokenized independently — fully supported, no special-casing needed |
| Tabs/newlines as separators | `str::split_whitespace`'s standard Unicode-whitespace behavior — already correct, tested |
| Leading/trailing whitespace | Trimmed implicitly by `split_whitespace` — tested |
| Empty pattern | `empty_pattern` (unchanged) |

No malformed string is accepted merely to raise corpus coverage — every acceptance rule traces directly to doc 51's wiki evidence.

## Normalization (Stage 5.4 §G)

`Pattern`'s canonical representation is its `Vec<PatternByte>` sequence. Because spaced and continuous input for an equivalent signature tokenize through the identical 2-character-group logic, they produce identical `PatternByte` sequences by construction — verified directly (`aob_parses_continuous_exact_bytes`, `aob_parses_continuous_nibble_wildcard_forms`, and the real-process integration test `continuous_hex_aob_matches_real_memory_and_normalizes_identically_to_spaced`, all asserting `as_slice()` equality between a spaced and a continuous compiled pattern for the same signature).

## Tests added

**Unit (`pattern.rs`):** `aob_parses_x_as_nibble_wildcard`, `aob_parses_star_as_nibble_wildcard`, `aob_parses_mixed_wildcard_chars_as_full_byte_wildcard`, `aob_parses_continuous_exact_bytes`, `aob_parses_continuous_full_wildcard_forms`, `aob_parses_continuous_nibble_wildcard_forms`, `aob_parses_wiki_verbatim_examples` (doc 51's exact `5x 48 8D 6x 24 E0` / `xx 48 8D xx 24 E0` / `x 48 8D x 24 E0` / `005x8xxxxxE0` examples), `aob_rejects_odd_length_continuous_hex`, `aob_rejects_odd_length_wildcard_run_as_malformed_wildcard`, `aob_accepts_tabs_and_newlines_as_separators`, `aob_ignores_leading_and_trailing_whitespace`. All existing regression tests (`??`, `?`, `*`, `xx`, `x`, `A?`, `?F`) remain green.

**Real-process integration (`pattern_scan_integration.rs`, Stage 5.4 §I):** `continuous_hex_aob_matches_real_memory_and_normalizes_identically_to_spaced` — plants no new fixture data, reuses the exact real bytes the existing spaced tests (`AOB_EXACT_OFFSET`, `AOB_WILDCARD_OFFSET`, `AOB_NIBBLE_OFFSET`) already prove against, and proves continuous exact/`??`/`xx`/nibble forms all find the same real address in a real spawned process, plus asserts spaced/continuous `Pattern` equality.

**Real compiled-addon napi tests (`pattern.test.js`, Stage 5.4 §J):** continuous exact-byte match, continuous full-wildcard match (`??`/`xx`/`XX`), continuous nibble-wildcard match, malformed continuous (odd-length) rejection with a stable `odd_length_token` error, and spaced-vs-continuous canonical match-set equivalence — all against the real compiled `.node` addon and a real spawned fixture process, no mocks.

**Grammar validation export:** a new pure, scan-free `validateAobPattern` napi export (wrapping `parse_aob` directly, no scan side effects) was added so real corpus-wide classification (doc 56) can call the exact real compiled parser instead of re-implementing its rules a second time — with its own napi test (`validateAobPattern classifies real corpus-of-record syntax families without scanning`).

## Results

Rust: 157/157 tests pass (96 unit + 15 exact_scan + 8 fixture + 22 pattern_scan + 17 session — 1 additional `#[ignore]`d manual perf test not counted, see doc 57 Part L), `cargo fmt --check` clean, `cargo clippy --all-targets --all-features -- -D warnings` clean.

napi: 46/46 tests pass (23 pattern + 23 session), real compiled addon, real spawned fixture, no mocks.
