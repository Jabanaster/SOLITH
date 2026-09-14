//! Unified byte/string/AOB pattern model (Stage 5, mission §5.2-§5.4).
//!
//! `PatternByte{mask, value}` is the single primitive every Stage 5 pattern
//! kind compiles down to: `(byte & mask) == value`. An exact byte is
//! `mask=0xFF`; a full-byte wildcard is `mask=0x00`; a nibble wildcard is
//! `mask=0xF0` or `mask=0x0F`. Raw byte-sequence scanning (§5.3), UTF-8/
//! UTF-16LE string scanning (§5.2), and AOB/wildcard scanning (§5.4) are
//! therefore not three separate matchers — they are three different ways to
//! *construct* a `Pattern`, all executed by the one matcher in
//! `pattern_scan.rs`. This directly satisfies mission §5.3's framing of raw
//! bytes as "the foundation under AOB" and §5.6's "do not build three
//! matchers."

use crate::error::{ErrorKind, ScannerError, ScannerResult};

/// A pattern longer than this is refused at construction (mission §5.2's
/// "maximum pattern length/resource guard"). 64 KiB is far beyond any
/// realistic AOB/string signature (the largest real CT corpus signatures
/// observed in this repo's own audited ingest pipeline — see doc 39 — are a
/// few dozen bytes) while still comfortably covering a full PE header or
/// similar structural signature, so this is a safety ceiling, not a
/// practical constraint.
pub const MAX_PATTERN_BYTES: usize = 64 * 1024;

/// One byte position in a compiled pattern: matches iff `(byte & mask) == value`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PatternByte {
    pub mask: u8,
    pub value: u8,
}

impl PatternByte {
    pub fn exact(byte: u8) -> Self {
        PatternByte {
            mask: 0xFF,
            value: byte,
        }
    }

    pub fn wildcard() -> Self {
        PatternByte {
            mask: 0x00,
            value: 0x00,
        }
    }

    /// High nibble fixed, low nibble wildcard (AOB syntax `A?`/`Ax`/`A*`).
    pub fn nibble_high(high_nibble: u8) -> Self {
        PatternByte {
            mask: 0xF0,
            value: (high_nibble & 0x0F) << 4,
        }
    }

    /// Low nibble fixed, high nibble wildcard (AOB syntax `?A`/`xA`/`*A`).
    pub fn nibble_low(low_nibble: u8) -> Self {
        PatternByte {
            mask: 0x0F,
            value: low_nibble & 0x0F,
        }
    }

    /// ASCII case-insensitive exact byte: for an ASCII letter, folds bit
    /// 0x20 (the sole difference between 'A'..'Z' and 'a'..'z') out of the
    /// comparison; every other byte value matches exactly. This is the
    /// "technically justified" scope for §5.2's "configurable case
    /// sensitivity" — full Unicode case folding is a materially larger,
    /// locale-sensitive problem this stage does not need to solve for a
    /// memory-scanner's string search, and is explicitly out of scope here.
    pub fn ascii_case_insensitive(byte: u8) -> Self {
        if byte.is_ascii_alphabetic() {
            PatternByte {
                mask: 0xDF,
                value: byte & 0xDF,
            }
        } else {
            PatternByte::exact(byte)
        }
    }

    #[inline]
    pub fn matches(&self, byte: u8) -> bool {
        (byte & self.mask) == self.value
    }

    pub fn is_exact(&self) -> bool {
        self.mask == 0xFF
    }
}

/// A compiled pattern: an ordered sequence of `PatternByte`s. Zero-length
/// patterns are rejected at every construction site (mission §5.3's
/// "zero-length pattern rejected"), so a `Pattern` in hand is always
/// non-empty and within `MAX_PATTERN_BYTES`.
#[derive(Debug, Clone)]
pub struct Pattern {
    bytes: Vec<PatternByte>,
}

impl Pattern {
    pub fn new(bytes: Vec<PatternByte>) -> ScannerResult<Self> {
        if bytes.is_empty() {
            return Err(ScannerError::new(
                ErrorKind::InvalidConfiguration,
                "pattern must not be empty (zero-length pattern rejected)",
            ));
        }
        if bytes.len() > MAX_PATTERN_BYTES {
            return Err(ScannerError::new(
                ErrorKind::InvalidConfiguration,
                format!(
                    "pattern length ({}) exceeds the maximum of {MAX_PATTERN_BYTES} bytes",
                    bytes.len()
                ),
            ));
        }
        Ok(Pattern { bytes })
    }

    pub fn len(&self) -> usize {
        self.bytes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.bytes.is_empty()
    }

    pub fn as_slice(&self) -> &[PatternByte] {
        &self.bytes
    }

    /// Whether `buf[offset..offset+self.len()]` matches this pattern.
    /// `buf` must have at least `offset + self.len()` bytes; callers only
    /// ever invoke this after bounds-checking (see `pattern_scan.rs`), so it
    /// is `debug_assert`-checked rather than fallible.
    #[inline]
    pub fn matches_at(&self, buf: &[u8], offset: usize) -> bool {
        debug_assert!(buf.len() >= offset + self.bytes.len());
        self.bytes
            .iter()
            .zip(&buf[offset..offset + self.bytes.len()])
            .all(|(pb, &b)| pb.matches(b))
    }
}

/// Which Stage 5 scan surface produced/requested a pattern — carried on the
/// scan result per mission §5.10's "pattern/string type" result field.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PatternKind {
    RawBytes,
    Utf8,
    Utf16Le,
    Aob,
}

impl std::fmt::Display for PatternKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            PatternKind::RawBytes => "raw_bytes",
            PatternKind::Utf8 => "utf8",
            PatternKind::Utf16Le => "utf16le",
            PatternKind::Aob => "aob",
        };
        f.write_str(s)
    }
}

// ---------------------------------------------------------------------------
// Raw byte-sequence patterns (mission §5.3).
// ---------------------------------------------------------------------------

pub fn pattern_from_raw_bytes(bytes: &[u8]) -> ScannerResult<Pattern> {
    Pattern::new(bytes.iter().map(|&b| PatternByte::exact(b)).collect())
}

// ---------------------------------------------------------------------------
// String patterns (mission §5.2). Null-terminator handling is an explicit,
// separate mode rather than an implicit always-on/always-off behavior, per
// the mission's instruction — `Required` appends the encoding's own
// null-terminator bytes (one 0x00 for UTF-8, two 0x00 bytes for UTF-16LE) to
// the compiled pattern so a match only counts if immediately followed by a
// real terminator; `None` (the default) matches the string content alone,
// wherever it occurs (including mid-buffer, non-terminated occurrences).
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NullTerminatorMode {
    None,
    Required,
}

/// Encodes `s` as UTF-8 pattern bytes. Rust's `&str` is already guaranteed
/// valid UTF-8 by construction, so this never fails on encoding grounds —
/// see `pattern_from_utf8_bytes` for the boundary that validates *untrusted*
/// bytes (mission §5.2's explicit "validate input encoding" / "invalid
/// encoding policy" requirement).
pub fn pattern_from_utf8_str(
    s: &str,
    case_sensitive: bool,
    null_terminator: NullTerminatorMode,
) -> ScannerResult<Pattern> {
    if s.is_empty() {
        return Err(ScannerError::new(
            ErrorKind::InvalidConfiguration,
            "empty string rejected (mission §5.2 empty-string rejection)",
        ));
    }
    let mut bytes: Vec<PatternByte> = s
        .as_bytes()
        .iter()
        .map(|&b| {
            if case_sensitive {
                PatternByte::exact(b)
            } else {
                PatternByte::ascii_case_insensitive(b)
            }
        })
        .collect();
    if null_terminator == NullTerminatorMode::Required {
        bytes.push(PatternByte::exact(0x00));
    }
    Pattern::new(bytes)
}

/// Validates `bytes` as UTF-8 before compiling — the explicit "invalid
/// encoding policy" boundary: malformed UTF-8 is refused with
/// `InvalidConfiguration`, never silently reinterpreted as Latin-1/ASCII
/// (mission §5.2's "do NOT silently treat strings as ASCII").
pub fn pattern_from_utf8_bytes(
    bytes: &[u8],
    case_sensitive: bool,
    null_terminator: NullTerminatorMode,
) -> ScannerResult<Pattern> {
    let s = std::str::from_utf8(bytes).map_err(|e| {
        ScannerError::new(
            ErrorKind::InvalidConfiguration,
            format!("invalid_utf8_encoding: {e}"),
        )
    })?;
    pattern_from_utf8_str(s, case_sensitive, null_terminator)
}

/// Encodes `s` as UTF-16LE pattern bytes. `str::encode_utf16` already
/// produces correct surrogate pairs for non-BMP characters and correct
/// single code units for the BMP (including ASCII), so this is correct for
/// every category mission §5.2 lists (ASCII subset, multibyte UTF-8 source
/// text re-encoded to UTF-16, BMP, and non-BMP/surrogate-pair characters)
/// without any special-casing here.
pub fn pattern_from_utf16le_str(
    s: &str,
    case_sensitive: bool,
    null_terminator: NullTerminatorMode,
) -> ScannerResult<Pattern> {
    if s.is_empty() {
        return Err(ScannerError::new(
            ErrorKind::InvalidConfiguration,
            "empty string rejected (mission §5.2 empty-string rejection)",
        ));
    }
    let mut bytes: Vec<PatternByte> = Vec::with_capacity(s.len() * 2);
    for unit in s.encode_utf16() {
        let [lo, hi] = unit.to_le_bytes();
        if case_sensitive || hi != 0x00 || !lo.is_ascii_alphabetic() {
            // Non-ASCII code units (hi != 0) and non-alphabetic ASCII code
            // units are matched exactly regardless of case-sensitivity —
            // case folding only ever applies to the ASCII-letter low byte
            // of a code unit whose high byte is 0x00.
            bytes.push(PatternByte::exact(lo));
            bytes.push(PatternByte::exact(hi));
        } else {
            bytes.push(PatternByte::ascii_case_insensitive(lo));
            bytes.push(PatternByte::exact(hi));
        }
    }
    if null_terminator == NullTerminatorMode::Required {
        bytes.push(PatternByte::exact(0x00));
        bytes.push(PatternByte::exact(0x00));
    }
    Pattern::new(bytes)
}

// ---------------------------------------------------------------------------
// AOB grammar (mission §5.4, extended Stage 5.4 §D-§G to full Cheat Engine
// continuous-hex grammar per doc 51's authoritative wiki evidence). Canonical
// SOLITH/CE AOB grammar:
//
//   - Whitespace between bytes is OPTIONAL and purely cosmetic. A pattern is
//     first split on whitespace into tokens; each token is independently
//     tokenized 2-characters-at-a-time into byte groups (matching Cheat
//     Engine's own real tokenizer, doc 51) — so "AA BB CC" and "AABBCC"
//     compile to the identical `Vec<PatternByte>` (Stage 5.4 §G normalization
//     requirement). Tabs/newlines/repeated spaces are all valid separators
//     (`str::split_whitespace`'s standard Unicode-whitespace behavior).
//   - A single-character token consisting of exactly one wildcard character
//     (`?`, `*`, or `x`/`X`) surrounded by whitespace is a standalone
//     full-byte wildcard — the "isolated wildcard character" form doc 51's
//     wiki citation documents (e.g. "x 48 8D x 24 E0").
//   - Every other token must have EVEN length (an odd-length continuous run
//     cannot be split into whole bytes and is rejected — Stage 5.4 §F). It is
//     split into consecutive 2-character byte groups; each group represents
//     one byte:
//       - two hex digits            -> exact byte ("AA")
//       - one hex digit + one       -> nibble wildcard, either order
//         wildcard char                ("A?"/"Ax"/"A*" = high nibble fixed;
//                                       "?A"/"xA"/"*A" = low nibble fixed) —
//                                      any of `?`/`x`/`X`/`*` is accepted in
//                                      the nibble position (doc 51's finding
//                                      that CE's nibble wildcard is not
//                                      limited to '?')
//       - two wildcard chars        -> full-byte wildcard ("??", "xx", "**",
//                                      or any mixed pair such as "x?")
//       - anything else             -> `InvalidHexToken`
//   - An odd-length run composed entirely of wildcard characters (e.g.
//     "???", "xxx") is `MalformedWildcard` (an over-long attempt at a
//     wildcard alias); an odd-length run containing any hex digit is
//     `OddLengthToken` (a truncated/malformed continuous-hex run).
//
// This single 2-char-group tokenizer subsumes both the historical
// whitespace-token grammar (every historical token happened to already be 1
// or 2 characters) and Stage 5.4's continuous-hex requirement — spaced and
// unspaced input are not two code paths, they are the same path fed
// differently-separated input.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PatternParseErrorKind {
    InvalidHexToken,
    MalformedWildcard,
    EmptyPattern,
    UnsupportedToken,
    InvalidSeparator,
    OddLengthToken,
}

impl std::fmt::Display for PatternParseErrorKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            PatternParseErrorKind::InvalidHexToken => "invalid_hex_token",
            PatternParseErrorKind::MalformedWildcard => "malformed_wildcard",
            PatternParseErrorKind::EmptyPattern => "empty_pattern",
            PatternParseErrorKind::UnsupportedToken => "unsupported_token",
            PatternParseErrorKind::InvalidSeparator => "invalid_separator",
            PatternParseErrorKind::OddLengthToken => "odd_length_token",
        };
        f.write_str(s)
    }
}

#[derive(Debug, Clone)]
pub struct PatternParseError {
    pub kind: PatternParseErrorKind,
    pub message: String,
}

impl std::fmt::Display for PatternParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.kind, self.message)
    }
}

impl std::error::Error for PatternParseError {}

impl From<PatternParseError> for ScannerError {
    fn from(e: PatternParseError) -> Self {
        ScannerError::new(ErrorKind::InvalidConfiguration, e.to_string())
    }
}

fn hex_digit_value(c: char) -> Option<u8> {
    c.to_digit(16).map(|d| d as u8)
}

/// `?`, `*`, and `x`/`X` are the three wildcard characters Cheat Engine's
/// real AOB tokenizer recognizes (doc 51). Disjoint from `hex_digit_value`'s
/// domain (`x`/`X` is not a hex digit), so every character is classified as
/// exactly one of: hex digit, wildcard, or invalid.
fn is_wildcard_char(c: char) -> bool {
    c == '?' || c == '*' || c.eq_ignore_ascii_case(&'x')
}

/// Parses one 2-character byte group — the fixed unit Cheat Engine's real
/// tokenizer operates on regardless of whitespace (doc 51). `token` is only
/// used for error messages.
fn parse_byte_group(a: char, b: char, token: &str) -> Result<PatternByte, PatternParseError> {
    let a_hex = hex_digit_value(a);
    let b_hex = hex_digit_value(b);
    let a_wild = is_wildcard_char(a);
    let b_wild = is_wildcard_char(b);
    match (a_hex, b_hex) {
        (Some(hi), Some(lo)) => Ok(PatternByte::exact((hi << 4) | lo)),
        (Some(hi), None) if b_wild => Ok(PatternByte::nibble_high(hi)),
        (None, Some(lo)) if a_wild => Ok(PatternByte::nibble_low(lo)),
        (None, None) if a_wild && b_wild => Ok(PatternByte::wildcard()),
        _ => {
            // Distinguish "looks like a typo'd hex digit" (alphanumeric but
            // not a valid hex digit or wildcard char, e.g. "GG") from
            // "not hex-like at all" (symbols, e.g. "#!") — matching the
            // pre-Stage-5.4 error classification so existing callers keyed
            // on error kind see no behavior change for these cases.
            let a_bad_alnum = a.is_ascii_alphanumeric() && a_hex.is_none() && !a_wild;
            let b_bad_alnum = b.is_ascii_alphanumeric() && b_hex.is_none() && !b_wild;
            if a_bad_alnum || b_bad_alnum {
                Err(PatternParseError {
                    kind: PatternParseErrorKind::InvalidHexToken,
                    message: format!(
                        "byte group \"{a}{b}\" in token \"{token}\" contains a non-hex character"
                    ),
                })
            } else {
                Err(PatternParseError {
                    kind: PatternParseErrorKind::UnsupportedToken,
                    message: format!(
                        "unrecognized byte group \"{a}{b}\" in token \"{token}\" (expected a 2-hex-digit byte, a full wildcard, or a nibble wildcard)"
                    ),
                })
            }
        }
    }
}

/// Parses one whitespace-delimited token into one or more `PatternByte`s —
/// one for a normal 2-character byte, more than one for a continuous
/// multi-byte run (e.g. "AABBCC" -> 3 bytes), exactly one for the isolated
/// single-wildcard-character form (e.g. standalone "x").
fn parse_token(token: &str) -> Result<Vec<PatternByte>, PatternParseError> {
    if token.contains(',') || token.contains(';') {
        return Err(PatternParseError {
            kind: PatternParseErrorKind::InvalidSeparator,
            message: format!(
                "token \"{token}\" contains a non-whitespace separator; AOB tokens must be whitespace-separated"
            ),
        });
    }

    let chars: Vec<char> = token.chars().collect();

    if chars.len() == 1 {
        let c = chars[0];
        if is_wildcard_char(c) {
            // Isolated wildcard character surrounded by whitespace: a
            // standalone full-byte wildcard (doc 51's "x 48 8D x 24 E0").
            return Ok(vec![PatternByte::wildcard()]);
        }
        if hex_digit_value(c).is_some() {
            return Err(PatternParseError {
                kind: PatternParseErrorKind::InvalidHexToken,
                message: format!(
                    "token \"{token}\" is a single hex digit; a byte token must be exactly two hex digits"
                ),
            });
        }
        return Err(PatternParseError {
            kind: PatternParseErrorKind::UnsupportedToken,
            message: format!("unrecognized single-character token \"{token}\""),
        });
    }

    if !chars.len().is_multiple_of(2) {
        // An odd-length run cannot be split into whole 2-character byte
        // groups. A run made entirely of wildcard characters (e.g. "xxx",
        // "???") is a recognizable over-long wildcard-alias typo, kept as
        // `MalformedWildcard` for message continuity with prior stages;
        // any other odd-length continuous run (e.g. "AAB") is a genuinely
        // truncated continuous-hex pattern, Stage 5.4 §F's `OddLengthToken`.
        if chars.iter().all(|&c| is_wildcard_char(c)) {
            return Err(PatternParseError {
                kind: PatternParseErrorKind::MalformedWildcard,
                message: format!(
                    "wildcard token \"{token}\" is malformed; use \"??\"/\"xx\" for a full-byte wildcard or \"A?\"/\"?A\" for a nibble wildcard"
                ),
            });
        }
        return Err(PatternParseError {
            kind: PatternParseErrorKind::OddLengthToken,
            message: format!(
                "continuous token \"{token}\" has odd length ({}) and cannot be split into whole bytes",
                chars.len()
            ),
        });
    }

    chars
        .chunks(2)
        .map(|pair| parse_byte_group(pair[0], pair[1], token))
        .collect()
}

/// Parses one AOB pattern string per the grammar documented above. Returns a
/// `PatternParseError` (never panics, never partially applies a malformed
/// pattern) identifying exactly which mission §5.4 error category applies.
pub fn parse_aob(input: &str) -> Result<Pattern, PatternParseError> {
    let tokens: Vec<&str> = input.split_whitespace().collect();
    if tokens.is_empty() {
        return Err(PatternParseError {
            kind: PatternParseErrorKind::EmptyPattern,
            message: "AOB pattern must contain at least one token".to_string(),
        });
    }
    // Every byte consumes at least one non-whitespace character, so the
    // total non-whitespace character count is always an upper bound on the
    // resulting byte count — a safe, correctness-preserving fail-fast guard
    // against unbounded allocation from adversarially long input, now that a
    // single token can expand into many bytes (continuous-hex runs).
    let total_chars: usize = input.chars().filter(|c| !c.is_whitespace()).count();
    if total_chars > MAX_PATTERN_BYTES {
        return Err(PatternParseError {
            kind: PatternParseErrorKind::MalformedWildcard,
            message: format!(
                "pattern has {total_chars} non-whitespace characters, exceeding the maximum representable length of {MAX_PATTERN_BYTES} bytes"
            ),
        });
    }
    let mut bytes: Vec<PatternByte> = Vec::new();
    for token in tokens {
        bytes.extend(parse_token(token)?);
    }
    Pattern::new(bytes).map_err(|e| PatternParseError {
        kind: PatternParseErrorKind::EmptyPattern,
        message: e.message,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raw_bytes_pattern_rejects_empty() {
        let err = pattern_from_raw_bytes(&[]).unwrap_err();
        assert_eq!(err.kind, ErrorKind::InvalidConfiguration);
    }

    #[test]
    fn raw_bytes_pattern_matches_exact_sequence() {
        let pattern = pattern_from_raw_bytes(&[0xDE, 0xAD, 0xBE, 0xEF]).unwrap();
        let buf = [0x00, 0xDE, 0xAD, 0xBE, 0xEF, 0x00];
        assert!(pattern.matches_at(&buf, 1));
        assert!(!pattern.matches_at(&buf, 0));
    }

    #[test]
    fn utf8_pattern_rejects_empty_string() {
        let err = pattern_from_utf8_str("", true, NullTerminatorMode::None).unwrap_err();
        assert_eq!(err.kind, ErrorKind::InvalidConfiguration);
    }

    #[test]
    fn utf8_pattern_matches_ascii_and_multibyte() {
        let pattern = pattern_from_utf8_str("café", true, NullTerminatorMode::None).unwrap();
        assert_eq!(pattern.len(), "café".len());
        let mut buf = vec![0u8; 4];
        buf.extend_from_slice("café".as_bytes());
        assert!(pattern.matches_at(&buf, 4));
    }

    #[test]
    fn utf8_pattern_case_insensitive_matches_either_case() {
        let pattern = pattern_from_utf8_str("Hello", false, NullTerminatorMode::None).unwrap();
        assert!(pattern.matches_at(b"..hello..", 2));
        assert!(pattern.matches_at(b"..HELLO..", 2));
        assert!(pattern.matches_at(b"..HeLLo..", 2));
        assert!(!pattern.matches_at(b"..hellz..", 2));
    }

    #[test]
    fn utf8_pattern_null_terminator_required_mode() {
        let pattern = pattern_from_utf8_str("hi", true, NullTerminatorMode::Required).unwrap();
        assert_eq!(pattern.len(), 3);
        assert!(pattern.matches_at(b"xxhi\x00yy", 2));
        assert!(!pattern.matches_at(b"xxhiZyy", 2));
    }

    #[test]
    fn utf8_bytes_pattern_rejects_invalid_encoding() {
        let invalid = [0xFF, 0xFE, 0x00];
        let err = pattern_from_utf8_bytes(&invalid, true, NullTerminatorMode::None).unwrap_err();
        assert_eq!(err.kind, ErrorKind::InvalidConfiguration);
        assert!(err.message.contains("invalid_utf8_encoding"));
    }

    #[test]
    fn utf16le_pattern_matches_ascii_subset() {
        let pattern = pattern_from_utf16le_str("Hi", true, NullTerminatorMode::None).unwrap();
        assert_eq!(pattern.len(), 4);
        let buf = [0x48, 0x00, 0x69, 0x00];
        assert!(pattern.matches_at(&buf, 0));
    }

    #[test]
    fn utf16le_pattern_handles_non_bmp_surrogate_pairs() {
        // U+1F600 (grinning face) is non-BMP; encode_utf16 must produce a
        // real surrogate pair, and the compiled pattern must match the
        // real 4-byte UTF-16LE encoding of that pair.
        let s = "\u{1F600}";
        let pattern = pattern_from_utf16le_str(s, true, NullTerminatorMode::None).unwrap();
        assert_eq!(pattern.len(), 4);
        let mut expected = Vec::new();
        for unit in s.encode_utf16() {
            expected.extend_from_slice(&unit.to_le_bytes());
        }
        assert!(pattern.matches_at(&expected, 0));
    }

    #[test]
    fn utf16le_pattern_case_insensitive_ascii_only() {
        let pattern = pattern_from_utf16le_str("Ok", false, NullTerminatorMode::None).unwrap();
        let lower = [0x6F, 0x00, 0x6B, 0x00]; // "ok"
        let upper = [0x4F, 0x00, 0x4B, 0x00]; // "OK"
        assert!(pattern.matches_at(&lower, 0));
        assert!(pattern.matches_at(&upper, 0));
    }

    #[test]
    fn aob_parses_exact_bytes() {
        let pattern = parse_aob("AA BB CC").unwrap();
        assert_eq!(pattern.len(), 3);
        assert!(pattern.matches_at(&[0xAA, 0xBB, 0xCC], 0));
        assert!(!pattern.matches_at(&[0xAA, 0xBB, 0xCD], 0));
    }

    #[test]
    fn aob_parses_full_wildcards_both_spellings() {
        let p1 = parse_aob("AA ?? CC").unwrap();
        let p2 = parse_aob("AA ? CC").unwrap();
        let p3 = parse_aob("AA * CC").unwrap();
        for p in [&p1, &p2, &p3] {
            assert!(p.matches_at(&[0xAA, 0x00, 0xCC], 0));
            assert!(p.matches_at(&[0xAA, 0xFF, 0xCC], 0));
            assert!(!p.matches_at(&[0xAA, 0x00, 0xCD], 0));
        }
    }

    #[test]
    fn aob_parses_nibble_wildcards() {
        let pattern = parse_aob("A? ?F").unwrap();
        assert_eq!(pattern.len(), 2);
        // "A?": high nibble A, low wildcard.
        assert!(pattern.matches_at(&[0xA0, 0x0F], 0));
        assert!(pattern.matches_at(&[0xAF, 0xFF], 0));
        assert!(!pattern.matches_at(&[0xB0, 0x0F], 0));
        // "?F": low nibble F, high wildcard.
        assert!(!pattern.matches_at(&[0xA0, 0x00], 0));
    }

    #[test]
    fn aob_parses_xx_wildcard_lowercase() {
        let p = parse_aob("AA xx CC").unwrap();
        assert!(p.matches_at(&[0xAA, 0x00, 0xCC], 0));
        assert!(p.matches_at(&[0xAA, 0xFF, 0xCC], 0));
        assert!(!p.matches_at(&[0xAA, 0x00, 0xCD], 0));
    }

    #[test]
    fn aob_parses_xx_wildcard_uppercase() {
        let p = parse_aob("AA XX CC").unwrap();
        assert!(p.matches_at(&[0xAA, 0x00, 0xCC], 0));
        assert!(p.matches_at(&[0xAA, 0xFF, 0xCC], 0));
    }

    #[test]
    fn aob_parses_x_wildcard_lowercase() {
        let p = parse_aob("AA x CC").unwrap();
        assert!(p.matches_at(&[0xAA, 0x00, 0xCC], 0));
        assert!(p.matches_at(&[0xAA, 0xFF, 0xCC], 0));
    }

    #[test]
    fn aob_parses_x_wildcard_uppercase() {
        let p = parse_aob("AA X CC").unwrap();
        assert!(p.matches_at(&[0xAA, 0x00, 0xCC], 0));
        assert!(p.matches_at(&[0xAA, 0xFF, 0xCC], 0));
    }

    #[test]
    fn aob_parses_xx_mixed_with_exact_bytes() {
        let p = parse_aob("48 8B xx 89 45 F8").unwrap();
        assert_eq!(p.len(), 6);
        assert!(p.matches_at(&[0x48, 0x8B, 0x00, 0x89, 0x45, 0xF8], 0));
        assert!(p.matches_at(&[0x48, 0x8B, 0x77, 0x89, 0x45, 0xF8], 0));
        assert!(!p.matches_at(&[0x48, 0x8B, 0x00, 0x89, 0x45, 0xF9], 0));
    }

    #[test]
    fn aob_parses_xx_mixed_with_qq_wildcard() {
        let p = parse_aob("AA ?? xx BB").unwrap();
        assert_eq!(p.len(), 4);
        assert!(p.matches_at(&[0xAA, 0x11, 0x22, 0xBB], 0));
    }

    #[test]
    fn aob_parses_xx_mixed_with_star_wildcard() {
        let p = parse_aob("AA * xx BB").unwrap();
        assert_eq!(p.len(), 4);
        assert!(p.matches_at(&[0xAA, 0x11, 0x22, 0xBB], 0));
    }

    #[test]
    fn aob_parses_xx_mixed_with_nibble_wildcard() {
        let p = parse_aob("A? xx ?F").unwrap();
        assert_eq!(p.len(), 3);
        assert!(p.matches_at(&[0xA5, 0x99, 0x1F], 0));
        assert!(!p.matches_at(&[0xB5, 0x99, 0x1F], 0));
    }

    #[test]
    fn aob_parses_x_as_nibble_wildcard() {
        // Stage 5.3 rejected "4x"/"x4" (hex digit mixed with 'x' in one
        // token) because no evidence then supported 'x' as a nibble
        // wildcard character. Stage 5.4's doc 51 (Cheat Engine's own wiki,
        // e.g. "5x 48 8D 6x 24 E0") proves 'x' IS a real nibble-position
        // wildcard, same as '?' — so this syntax is now accepted, not
        // rejected. "4x" = high nibble 4, low wildcard; "x4" = low nibble
        // 4, high wildcard.
        let p1 = parse_aob("AA 4x CC").unwrap();
        assert!(p1.matches_at(&[0xAA, 0x40, 0xCC], 0));
        assert!(p1.matches_at(&[0xAA, 0x4F, 0xCC], 0));
        assert!(!p1.matches_at(&[0xAA, 0x50, 0xCC], 0));

        let p2 = parse_aob("AA x4 CC").unwrap();
        assert!(p2.matches_at(&[0xAA, 0x04, 0xCC], 0));
        assert!(p2.matches_at(&[0xAA, 0xF4, 0xCC], 0));
        assert!(!p2.matches_at(&[0xAA, 0x05, 0xCC], 0));
    }

    #[test]
    fn aob_parses_star_as_nibble_wildcard() {
        // Doc 51's wiki example "*D" — '*' as a nibble-position wildcard.
        let p = parse_aob("AA *D CC").unwrap();
        assert!(p.matches_at(&[0xAA, 0x0D, 0xCC], 0));
        assert!(p.matches_at(&[0xAA, 0xFD, 0xCC], 0));
        assert!(!p.matches_at(&[0xAA, 0x0E, 0xCC], 0));
    }

    #[test]
    fn aob_parses_mixed_wildcard_chars_as_full_byte_wildcard() {
        // "Two consecutive wildcard characters" per doc 51 need not be the
        // same character.
        let p = parse_aob("AA x? CC").unwrap();
        assert!(p.matches_at(&[0xAA, 0x00, 0xCC], 0));
        assert!(p.matches_at(&[0xAA, 0xFF, 0xCC], 0));
    }

    #[test]
    fn aob_parses_continuous_exact_bytes() {
        // Stage 5.4 §G: spaced and continuous exact-byte input must
        // normalize to the identical compiled pattern.
        let spaced = parse_aob("AA BB CC DD").unwrap();
        let continuous = parse_aob("AABBCCDD").unwrap();
        assert_eq!(spaced.as_slice(), continuous.as_slice());
        assert!(continuous.matches_at(&[0xAA, 0xBB, 0xCC, 0xDD], 0));
    }

    #[test]
    fn aob_parses_continuous_full_wildcard_forms() {
        // Doc 51's "AA??BB"/"AA**BB"/"AAxxBB" continuous-wildcard family
        // (Stage 5.4 §E).
        for src in ["AA??BB", "AA**BB", "AAxxBB", "AAXXBB"] {
            let p = parse_aob(src).unwrap();
            assert_eq!(p.len(), 3);
            assert!(p.matches_at(&[0xAA, 0x00, 0xBB], 0));
            assert!(p.matches_at(&[0xAA, 0xFF, 0xBB], 0));
            assert!(!p.matches_at(&[0xAA, 0x00, 0xBC], 0));
        }
    }

    #[test]
    fn aob_parses_continuous_nibble_wildcard_forms() {
        // "A?BB"/"?ABB" continuous nibble family (Stage 5.4 §E), and their
        // spaced equivalents must normalize identically.
        let p1 = parse_aob("A?BB").unwrap();
        let p1_spaced = parse_aob("A? BB").unwrap();
        assert_eq!(p1.as_slice(), p1_spaced.as_slice());
        assert!(p1.matches_at(&[0xA5, 0xBB], 0));
        assert!(!p1.matches_at(&[0xB5, 0xBB], 0));

        let p2 = parse_aob("?ABB").unwrap();
        assert!(p2.matches_at(&[0x5A, 0xBB], 0));
        assert!(!p2.matches_at(&[0x5B, 0xBB], 0));
    }

    #[test]
    fn aob_parses_wiki_verbatim_examples() {
        // Doc 51's exact verbatim Cheat Engine wiki examples.
        let p1 = parse_aob("5x 48 8D 6x 24 E0").unwrap();
        assert_eq!(p1.len(), 6);
        assert!(p1.matches_at(&[0x5A, 0x48, 0x8D, 0x6F, 0x24, 0xE0], 0));

        let p2 = parse_aob("xx 48 8D xx 24 E0").unwrap();
        assert_eq!(p2.len(), 6);
        assert!(p2.matches_at(&[0x00, 0x48, 0x8D, 0xFF, 0x24, 0xE0], 0));

        let p3 = parse_aob("x 48 8D x 24 E0").unwrap();
        assert_eq!(p3.len(), 6);
        assert!(p3.matches_at(&[0x00, 0x48, 0x8D, 0xFF, 0x24, 0xE0], 0));

        // Fully unspaced: tokenizes as 00 5x 8x xx xx E0.
        let p4 = parse_aob("005x8xxxxxE0").unwrap();
        assert_eq!(p4.len(), 6);
        assert!(p4.matches_at(&[0x00, 0x5A, 0x81, 0x00, 0xFF, 0xE0], 0));
        assert!(!p4.matches_at(&[0x01, 0x5A, 0x81, 0x00, 0xFF, 0xE0], 0));
    }

    #[test]
    fn aob_rejects_odd_length_continuous_hex() {
        let err = parse_aob("AAB").unwrap_err();
        assert_eq!(err.kind, PatternParseErrorKind::OddLengthToken);
    }

    #[test]
    fn aob_rejects_odd_length_wildcard_run_as_malformed_wildcard() {
        let err = parse_aob("?????").unwrap_err();
        assert_eq!(err.kind, PatternParseErrorKind::MalformedWildcard);
    }

    #[test]
    fn aob_accepts_tabs_and_newlines_as_separators() {
        let p = parse_aob("AA\tBB\nCC").unwrap();
        assert_eq!(p.len(), 3);
        assert!(p.matches_at(&[0xAA, 0xBB, 0xCC], 0));
    }

    #[test]
    fn aob_ignores_leading_and_trailing_whitespace() {
        let p = parse_aob("  AA BB  ").unwrap();
        assert_eq!(p.len(), 2);
    }

    #[test]
    fn aob_rejects_overlong_x_run_as_malformed_wildcard() {
        let err = parse_aob("AA xxx CC").unwrap_err();
        assert_eq!(err.kind, PatternParseErrorKind::MalformedWildcard);
    }

    #[test]
    fn aob_rejects_empty_pattern() {
        let err = parse_aob("").unwrap_err();
        assert_eq!(err.kind, PatternParseErrorKind::EmptyPattern);
        let err2 = parse_aob("   ").unwrap_err();
        assert_eq!(err2.kind, PatternParseErrorKind::EmptyPattern);
    }

    #[test]
    fn aob_rejects_invalid_hex_token() {
        let err = parse_aob("AA GG CC").unwrap_err();
        assert_eq!(err.kind, PatternParseErrorKind::InvalidHexToken);
    }

    #[test]
    fn aob_rejects_malformed_wildcard() {
        let err = parse_aob("AA ??? CC").unwrap_err();
        assert_eq!(err.kind, PatternParseErrorKind::MalformedWildcard);
    }

    #[test]
    fn aob_rejects_unsupported_token() {
        let err = parse_aob("AA #! CC").unwrap_err();
        assert_eq!(err.kind, PatternParseErrorKind::UnsupportedToken);
    }

    #[test]
    fn aob_rejects_invalid_separator() {
        let err = parse_aob("AA,BB,CC").unwrap_err();
        assert_eq!(err.kind, PatternParseErrorKind::InvalidSeparator);
    }

    #[test]
    fn aob_rejects_single_stray_hex_digit() {
        let err = parse_aob("AA B CC").unwrap_err();
        assert_eq!(err.kind, PatternParseErrorKind::InvalidHexToken);
    }

    #[test]
    #[ignore = "manual perf comparison (Stage 5.4 §L) — run with `cargo test --release -- --ignored parser_overhead`"]
    fn parser_overhead_spaced_vs_continuous_is_comparable() {
        // Stage 5.4 §L: matching-engine throughput cannot differ between
        // spaced and continuous AOB syntax, because both compile to the
        // identical `Vec<PatternByte>` (proven structurally by the
        // `as_slice()` equality assertions in the tests above) and are
        // executed by the exact same `Pattern::matches_at`/`scan_pattern`
        // code — there is no separate runtime path to regress. This test
        // measures the one thing that *can* legitimately differ: one-time
        // parse overhead of `parse_aob` itself, which is negligible either
        // way relative to a real memory scan.
        let spaced = "48 8B 05 11 22 33 44 89 90 91 92 93 94 95 96 97";
        let continuous = "488B0511223344899091929394959697";
        let iterations = 200_000;

        let start = std::time::Instant::now();
        for _ in 0..iterations {
            std::hint::black_box(parse_aob(spaced).unwrap());
        }
        let spaced_elapsed = start.elapsed();

        let start = std::time::Instant::now();
        for _ in 0..iterations {
            std::hint::black_box(parse_aob(continuous).unwrap());
        }
        let continuous_elapsed = start.elapsed();

        println!(
            "parse_aob x{iterations}: spaced={spaced_elapsed:?} continuous={continuous_elapsed:?}"
        );
    }

    #[test]
    fn pattern_length_guard_rejects_oversized_pattern() {
        let huge = vec![PatternByte::exact(0xAA); MAX_PATTERN_BYTES + 1];
        let err = Pattern::new(huge).unwrap_err();
        assert_eq!(err.kind, ErrorKind::InvalidConfiguration);
    }
}
