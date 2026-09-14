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

    /// High nibble fixed, low nibble wildcard (AOB syntax `A?`).
    pub fn nibble_high(high_nibble: u8) -> Self {
        PatternByte {
            mask: 0xF0,
            value: (high_nibble & 0x0F) << 4,
        }
    }

    /// Low nibble fixed, high nibble wildcard (AOB syntax `?A`).
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
// AOB grammar (mission §5.4). Canonical SOLITH AOB grammar:
//   - whitespace-separated tokens
//   - exact byte:        two hex digits, e.g. "AA"
//   - full wildcard:     one-or-more '?' (canonically "??"), or one-or-more
//                        '*' — both accepted, matching the tolerance this
//                        repo's own already-certified CT AOB parser
//                        (`src/core/script-research/aob-parser.ts`) already
//                        extends to real-world Cheat Engine scripts (doc 39)
//   - nibble wildcard:   exactly one hex digit + one '?', in either order
//                        ("A?" = high nibble A, low wildcard; "?F" = low
//                        nibble F, high wildcard) — supported for broader
//                        signature compatibility per mission §5.4, though
//                        doc 39's real-corpus-evidence review found no
//                        occurrence of this syntax in this repo's own
//                        already-certified CT ingest pipeline
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PatternParseErrorKind {
    InvalidHexToken,
    MalformedWildcard,
    EmptyPattern,
    UnsupportedToken,
    InvalidSeparator,
}

impl std::fmt::Display for PatternParseErrorKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            PatternParseErrorKind::InvalidHexToken => "invalid_hex_token",
            PatternParseErrorKind::MalformedWildcard => "malformed_wildcard",
            PatternParseErrorKind::EmptyPattern => "empty_pattern",
            PatternParseErrorKind::UnsupportedToken => "unsupported_token",
            PatternParseErrorKind::InvalidSeparator => "invalid_separator",
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

fn parse_token(token: &str) -> Result<PatternByte, PatternParseError> {
    if token.contains(',') || token.contains(';') {
        return Err(PatternParseError {
            kind: PatternParseErrorKind::InvalidSeparator,
            message: format!(
                "token \"{token}\" contains a non-whitespace separator; AOB tokens must be whitespace-separated"
            ),
        });
    }

    let chars: Vec<char> = token.chars().collect();

    // A full-byte wildcard represents exactly one byte, so only a 1- or
    // 2-character run of '?'/'*' is accepted as an alias for it (matching
    // this repo's own already-certified CT AOB parser's "??"/"?" tolerance
    // — doc 39); a longer run does not correspond to any single-byte token
    // and falls through to the malformed-wildcard classification below.
    if !chars.is_empty() && chars.len() <= 2 && chars.iter().all(|&c| c == '?') {
        return Ok(PatternByte::wildcard());
    }
    if !chars.is_empty() && chars.len() <= 2 && chars.iter().all(|&c| c == '*') {
        return Ok(PatternByte::wildcard());
    }

    if chars.len() == 2 {
        let (a, b) = (chars[0], chars[1]);
        let a_hex = hex_digit_value(a);
        let b_hex = hex_digit_value(b);
        match (a_hex, b_hex, a == '?', b == '?') {
            (Some(hi), Some(lo), false, false) => {
                return Ok(PatternByte::exact((hi << 4) | lo));
            }
            (Some(hi), None, false, true) => {
                return Ok(PatternByte::nibble_high(hi));
            }
            (None, Some(lo), true, false) => {
                return Ok(PatternByte::nibble_low(lo));
            }
            _ => {
                // Falls through to the length-based classification below.
            }
        }
    }

    if chars.len() == 1 {
        if hex_digit_value(chars[0]).is_some() {
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

    let looks_hex_like = chars
        .iter()
        .any(|&c| c.is_ascii_alphanumeric() && hex_digit_value(c).is_none());
    if looks_hex_like {
        return Err(PatternParseError {
            kind: PatternParseErrorKind::InvalidHexToken,
            message: format!("token \"{token}\" contains a non-hex character"),
        });
    }

    let all_wildcard_ish = chars.iter().all(|&c| c == '?' || c == '*');
    if all_wildcard_ish {
        return Err(PatternParseError {
            kind: PatternParseErrorKind::MalformedWildcard,
            message: format!(
                "wildcard token \"{token}\" is malformed; use \"??\" for a full-byte wildcard or \"A?\"/\"?A\" for a nibble wildcard"
            ),
        });
    }

    Err(PatternParseError {
        kind: PatternParseErrorKind::UnsupportedToken,
        message: format!("unrecognized token \"{token}\" (expected a 2-hex-digit byte, \"??\", or a nibble wildcard like \"A?\")"),
    })
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
    if tokens.len() > MAX_PATTERN_BYTES {
        return Err(PatternParseError {
            kind: PatternParseErrorKind::MalformedWildcard,
            message: format!(
                "pattern has {} tokens, exceeding the maximum of {MAX_PATTERN_BYTES}",
                tokens.len()
            ),
        });
    }
    let bytes: Vec<PatternByte> = tokens
        .into_iter()
        .map(parse_token)
        .collect::<Result<_, _>>()?;
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
    fn pattern_length_guard_rejects_oversized_pattern() {
        let huge = vec![PatternByte::exact(0xAA); MAX_PATTERN_BYTES + 1];
        let err = Pattern::new(huge).unwrap_err();
        assert_eq!(err.kind, ErrorKind::InvalidConfiguration);
    }
}
