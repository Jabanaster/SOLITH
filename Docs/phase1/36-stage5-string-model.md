# Phase 1 / Stage 5 — String Scan Model

## Encodings

`native/solith-scanner-core/src/pattern.rs` implements two string encodings, both compiling down to the same `Pattern`/`PatternByte` primitive `pattern_scan.rs` already uses for raw bytes and AOB (mission §5.6's "one matcher, three constructors" architecture — see doc 40):

- **UTF-8** (`pattern_from_utf8_str`/`pattern_from_utf8_bytes`): the string's own UTF-8 byte sequence, one `PatternByte` per byte.
- **UTF-16LE** (`pattern_from_utf16le_str`): `str::encode_utf16()`'s code units, each written little-endian (2 bytes), matching Windows' native wide-string convention.

Both reject the empty string (`InvalidConfiguration`) — mission §5.2's explicit empty-string rejection.

## Input-encoding validation (mission §5.2: "do NOT silently treat strings as ASCII")

`pattern_from_utf8_str`/`pattern_from_utf16le_str` take a Rust `&str`, which is already guaranteed valid UTF-8 by the type system — no silent ASCII/Latin-1 reinterpretation is possible by construction. The real validation boundary is `pattern_from_utf8_bytes`, which takes untrusted raw bytes and calls `std::str::from_utf8`, returning `InvalidConfiguration: invalid_utf8_encoding: ...` on malformed input rather than lossily reinterpreting it — proven by `utf8_bytes_pattern_rejects_invalid_encoding` (a real invalid byte sequence `[0xFF, 0xFE, 0x00]`).

## Unicode coverage proven (mission §5.2's required test matrix)

| Category | Proof |
|---|---|
| ASCII subset | `utf8_pattern_matches_ascii_and_multibyte`, real fixture `UTF8_ASCII_TEXT="PlayerHealth100"` |
| Multibyte UTF-8 | Real fixture `UTF8_MULTIBYTE_TEXT` = Latin-1-supplement accents ("café") + a Cyrillic word + a CJK word — exercises 2-byte, 2-byte-Cyrillic, and 3-byte UTF-8 sequences in one real spawned-process string |
| Unicode BMP | `UTF16LE_TEXT="ScoreValue"` (all BMP code points) |
| Surrogate pairs / non-BMP | `UTF16LE_NONBMP_TEXT="Win\u{1F600}!"` (U+1F600 GRINNING FACE) — `str::encode_utf16()` produces a real surrogate pair automatically; `utf16le_pattern_handles_non_bmp_surrogate_pairs` (Rust) and the real fixture-backed `utf16le_nonbmp_surrogate_pair_string_is_found`/`pattern: non-BMP Unicode (surrogate pair) UTF-16LE string is found` (Rust integration + real napi JS) all prove the compiled 4-byte pattern matches the real UTF-16LE bytes Windows itself would store |
| Null characters where allowed | `NullTerminatorMode::Required` explicitly appends a real null terminator (1 byte for UTF-8, 2 for UTF-16LE) and only matches when one is actually present — proven by `utf8_pattern_null_terminator_required_mode` |
| Invalid encoding policy | `pattern_from_utf8_bytes` rejects malformed UTF-8 explicitly (above) |

## Case sensitivity (mission §5.2: "if technically justified")

`PatternByte::ascii_case_insensitive(byte)` folds bit `0x20` (the sole difference between ASCII `'A'..'Z'` and `'a'..'z'`) out of the comparison for ASCII-alphabetic bytes only; every other byte (digits, symbols, non-ASCII) still matches exactly. This is the "technically justified" scope: full Unicode case folding (locale-sensitive, multi-codepoint expansions like German ß→SS) is a materially larger problem a memory scanner's string search does not need to solve, and is explicitly out of scope — documented here rather than silently approximated. For UTF-16LE, the fold applies only to a code unit's low byte when its high byte is `0x00` (i.e. an ASCII-range code point); non-ASCII code units are always matched exactly regardless of the `caseSensitive` flag. Proven by `utf8_pattern_case_insensitive_matches_either_case` and `utf16le_pattern_case_insensitive_ascii_only`.

## Null-terminator mode (mission §5.2: "as an explicit mode")

`NullTerminatorMode::{None, Required}` is a caller-selected enum, not an implicit always-on/always-off default:
- `None` (used by most tests above): matches the string's content bytes wherever they occur, terminated or not.
- `Required`: appends the encoding-native terminator (`0x00` for UTF-8, `0x00 0x00` for UTF-16LE) to the compiled pattern, so a match only counts when immediately followed by a real terminator in memory.

## Maximum pattern length / resource guard (mission §5.2)

`Pattern::new` refuses any pattern (string, byte, or AOB) exceeding `MAX_PATTERN_BYTES` (64 KiB) with `InvalidConfiguration` — far beyond any realistic signature (see doc 39's real-corpus evidence) while still bounding a worst-case allocation. Proven by `pattern_length_guard_rejects_oversized_pattern`.

## What this stage does not do

String *refinement* (UNCHANGED/CHANGED against a previously-captured string candidate set) is not implemented this stage — see doc 44's defect-status accounting and the mission §5.12 decision recorded there: `CandidateStore`'s fixed-per-type byte-width invariant would need to change to support variable-length values, which the mission itself permits deferring when it would add "significant complexity."
