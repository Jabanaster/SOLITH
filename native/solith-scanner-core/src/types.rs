//! Canonical scanner primitive type system (Stage 3, mission §3.2).
//!
//! Replaces the current TypeScript scanner's narrower `LiveValueType`
//! (`'int32' | 'uint32' | 'float' | 'double' | 'int64' | 'byte'` —
//! no i8/i16/u16/u64 at all) with the full i8–u64/f32/f64 matrix Stage 1
//! doc 06 §2.4 designed. Every decode/compare/serialize operation is
//! defined once here so `exact_scan.rs` (and later refinement/AOB stages)
//! never re-derive byte width or signedness ad hoc.

use std::fmt;

/// One of the 10 canonical scalar scan types.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PrimitiveType {
    I8,
    U8,
    I16,
    U16,
    I32,
    U32,
    I64,
    U64,
    F32,
    F64,
}

impl PrimitiveType {
    pub const ALL: [PrimitiveType; 10] = [
        PrimitiveType::I8,
        PrimitiveType::U8,
        PrimitiveType::I16,
        PrimitiveType::U16,
        PrimitiveType::I32,
        PrimitiveType::U32,
        PrimitiveType::I64,
        PrimitiveType::U64,
        PrimitiveType::F32,
        PrimitiveType::F64,
    ];

    /// Byte width — also the required minimum overlap-plus-one for chunked
    /// scanning (mission §3.5: overlap must be at least `width - 1`).
    pub fn byte_width(self) -> usize {
        match self {
            PrimitiveType::I8 | PrimitiveType::U8 => 1,
            PrimitiveType::I16 | PrimitiveType::U16 => 2,
            PrimitiveType::I32 | PrimitiveType::U32 | PrimitiveType::F32 => 4,
            PrimitiveType::I64 | PrimitiveType::U64 | PrimitiveType::F64 => 8,
        }
    }

    pub fn is_signed_integer(self) -> bool {
        matches!(
            self,
            PrimitiveType::I8 | PrimitiveType::I16 | PrimitiveType::I32 | PrimitiveType::I64
        )
    }

    pub fn is_unsigned_integer(self) -> bool {
        matches!(
            self,
            PrimitiveType::U8 | PrimitiveType::U16 | PrimitiveType::U32 | PrimitiveType::U64
        )
    }

    pub fn is_float(self) -> bool {
        matches!(self, PrimitiveType::F32 | PrimitiveType::F64)
    }

    /// Whether this type's value can cross the napi boundary as a plain JS
    /// `Number` without any precision loss (mission §3.2/§3.6: i64/u64 must
    /// not). i8/u8/i16/u16/i32/u32 are all well within
    /// `Number.MAX_SAFE_INTEGER` (max magnitude 2^32 ≪ 2^53); f32 widens
    /// losslessly into f64/Number; f64 already *is* the JS Number
    /// representation. Only i64/u64 require BigInt.
    pub fn requires_bigint_for_js(self) -> bool {
        matches!(self, PrimitiveType::I64 | PrimitiveType::U64)
    }
}

impl fmt::Display for PrimitiveType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            PrimitiveType::I8 => "i8",
            PrimitiveType::U8 => "u8",
            PrimitiveType::I16 => "i16",
            PrimitiveType::U16 => "u16",
            PrimitiveType::I32 => "i32",
            PrimitiveType::U32 => "u32",
            PrimitiveType::I64 => "i64",
            PrimitiveType::U64 => "u64",
            PrimitiveType::F32 => "f32",
            PrimitiveType::F64 => "f64",
        };
        f.write_str(s)
    }
}

/// A decoded scalar value, tagged by the type that produced it. i64/u64
/// stay native Rust `i64`/`u64` end to end — never narrowed through `f64`
/// (the current TypeScript scanner's `Number(BigInt)` mistake, Stage 1
/// D06) — so no precision can be lost between decode and comparison, and
/// none is lost again when the napi layer converts to `BigInt` (Stage 3
/// mission §3.6: "They must remain exact through: Rust -> napi -> Node/JS
/// -> assertion").
#[derive(Debug, Clone, Copy)]
pub enum PrimitiveValue {
    I8(i8),
    U8(u8),
    I16(i16),
    U16(u16),
    I32(i32),
    U32(u32),
    I64(i64),
    U64(u64),
    F32(f32),
    F64(f64),
}

impl PrimitiveValue {
    pub fn primitive_type(&self) -> PrimitiveType {
        match self {
            PrimitiveValue::I8(_) => PrimitiveType::I8,
            PrimitiveValue::U8(_) => PrimitiveType::U8,
            PrimitiveValue::I16(_) => PrimitiveType::I16,
            PrimitiveValue::U16(_) => PrimitiveType::U16,
            PrimitiveValue::I32(_) => PrimitiveType::I32,
            PrimitiveValue::U32(_) => PrimitiveType::U32,
            PrimitiveValue::I64(_) => PrimitiveType::I64,
            PrimitiveValue::U64(_) => PrimitiveType::U64,
            PrimitiveValue::F32(_) => PrimitiveType::F32,
            PrimitiveValue::F64(_) => PrimitiveType::F64,
        }
    }

    /// Little-endian decode (matches this project's consistent LE
    /// convention throughout, confirmed by Stage 1 doc 03 item 3's
    /// repo-wide audit). `bytes.len()` must be exactly
    /// `primitive_type.byte_width()`.
    pub fn decode(primitive_type: PrimitiveType, bytes: &[u8]) -> Option<PrimitiveValue> {
        let width = primitive_type.byte_width();
        if bytes.len() != width {
            return None;
        }
        Some(match primitive_type {
            PrimitiveType::I8 => PrimitiveValue::I8(bytes[0] as i8),
            PrimitiveType::U8 => PrimitiveValue::U8(bytes[0]),
            PrimitiveType::I16 => PrimitiveValue::I16(i16::from_le_bytes(bytes.try_into().ok()?)),
            PrimitiveType::U16 => PrimitiveValue::U16(u16::from_le_bytes(bytes.try_into().ok()?)),
            PrimitiveType::I32 => PrimitiveValue::I32(i32::from_le_bytes(bytes.try_into().ok()?)),
            PrimitiveType::U32 => PrimitiveValue::U32(u32::from_le_bytes(bytes.try_into().ok()?)),
            PrimitiveType::I64 => PrimitiveValue::I64(i64::from_le_bytes(bytes.try_into().ok()?)),
            PrimitiveType::U64 => PrimitiveValue::U64(u64::from_le_bytes(bytes.try_into().ok()?)),
            PrimitiveType::F32 => PrimitiveValue::F32(f32::from_le_bytes(bytes.try_into().ok()?)),
            PrimitiveType::F64 => PrimitiveValue::F64(f64::from_le_bytes(bytes.try_into().ok()?)),
        })
    }

    /// Little-endian encode into a caller-provided buffer of exactly
    /// `byte_width()` bytes.
    pub fn encode_into(&self, out: &mut [u8]) {
        match self {
            PrimitiveValue::I8(v) => out[0] = *v as u8,
            PrimitiveValue::U8(v) => out[0] = *v,
            PrimitiveValue::I16(v) => out.copy_from_slice(&v.to_le_bytes()),
            PrimitiveValue::U16(v) => out.copy_from_slice(&v.to_le_bytes()),
            PrimitiveValue::I32(v) => out.copy_from_slice(&v.to_le_bytes()),
            PrimitiveValue::U32(v) => out.copy_from_slice(&v.to_le_bytes()),
            PrimitiveValue::I64(v) => out.copy_from_slice(&v.to_le_bytes()),
            PrimitiveValue::U64(v) => out.copy_from_slice(&v.to_le_bytes()),
            PrimitiveValue::F32(v) => out.copy_from_slice(&v.to_le_bytes()),
            PrimitiveValue::F64(v) => out.copy_from_slice(&v.to_le_bytes()),
        }
    }

    /// Exact-scan comparison semantics (mission §3.7), defined explicitly
    /// rather than left implicit:
    ///
    /// - Integers: exact bitwise/numeric equality (unambiguous).
    /// - Floats: ordinary IEEE-754 `==` — `+0.0 == -0.0` is `true` (the two
    ///   encodings are numerically equivalent, and a user typing "0" into
    ///   the scanner should match either representation); `NaN == NaN` is
    ///   `false` (IEEE semantics: a NaN payload is never a meaningful exact
    ///   match target, and two arbitrary-bytes-decoded-as-NaN candidates
    ///   are not "the same value" just because both are NaN). No
    ///   epsilon/approximate mode exists in exact scan — that is explicitly
    ///   deferred to a later comparative/refinement stage per the mission.
    ///
    /// Comparing values of different `PrimitiveType`s is not meaningful and
    /// returns `false` (callers should never construct this case; `scan_exact`
    /// always compares like-typed values by construction).
    pub fn eq_exact(&self, other: &PrimitiveValue) -> bool {
        match (self, other) {
            (PrimitiveValue::I8(a), PrimitiveValue::I8(b)) => a == b,
            (PrimitiveValue::U8(a), PrimitiveValue::U8(b)) => a == b,
            (PrimitiveValue::I16(a), PrimitiveValue::I16(b)) => a == b,
            (PrimitiveValue::U16(a), PrimitiveValue::U16(b)) => a == b,
            (PrimitiveValue::I32(a), PrimitiveValue::I32(b)) => a == b,
            (PrimitiveValue::U32(a), PrimitiveValue::U32(b)) => a == b,
            (PrimitiveValue::I64(a), PrimitiveValue::I64(b)) => a == b,
            (PrimitiveValue::U64(a), PrimitiveValue::U64(b)) => a == b,
            (PrimitiveValue::F32(a), PrimitiveValue::F32(b)) => a == b,
            (PrimitiveValue::F64(a), PrimitiveValue::F64(b)) => a == b,
            _ => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn byte_widths_are_correct_for_every_type() {
        assert_eq!(PrimitiveType::I8.byte_width(), 1);
        assert_eq!(PrimitiveType::U8.byte_width(), 1);
        assert_eq!(PrimitiveType::I16.byte_width(), 2);
        assert_eq!(PrimitiveType::U16.byte_width(), 2);
        assert_eq!(PrimitiveType::I32.byte_width(), 4);
        assert_eq!(PrimitiveType::U32.byte_width(), 4);
        assert_eq!(PrimitiveType::F32.byte_width(), 4);
        assert_eq!(PrimitiveType::I64.byte_width(), 8);
        assert_eq!(PrimitiveType::U64.byte_width(), 8);
        assert_eq!(PrimitiveType::F64.byte_width(), 8);
        assert_eq!(PrimitiveType::ALL.len(), 10);
    }

    #[test]
    fn only_i64_and_u64_require_bigint() {
        for t in PrimitiveType::ALL {
            let expects_bigint = matches!(t, PrimitiveType::I64 | PrimitiveType::U64);
            assert_eq!(t.requires_bigint_for_js(), expects_bigint, "{t}");
        }
    }

    fn round_trip(pt: PrimitiveType, value: PrimitiveValue) {
        let mut buf = vec![0u8; pt.byte_width()];
        value.encode_into(&mut buf);
        let decoded = PrimitiveValue::decode(pt, &buf).expect("decode failed");
        assert!(decoded.eq_exact(&value), "{pt}: round-trip mismatch");
    }

    #[test]
    fn integer_round_trip_zero_min_max() {
        round_trip(PrimitiveType::I8, PrimitiveValue::I8(0));
        round_trip(PrimitiveType::I8, PrimitiveValue::I8(i8::MIN));
        round_trip(PrimitiveType::I8, PrimitiveValue::I8(i8::MAX));
        round_trip(PrimitiveType::U8, PrimitiveValue::U8(0));
        round_trip(PrimitiveType::U8, PrimitiveValue::U8(u8::MAX));
        round_trip(PrimitiveType::I16, PrimitiveValue::I16(i16::MIN));
        round_trip(PrimitiveType::I16, PrimitiveValue::I16(i16::MAX));
        round_trip(PrimitiveType::U16, PrimitiveValue::U16(u16::MAX));
        round_trip(PrimitiveType::I32, PrimitiveValue::I32(i32::MIN));
        round_trip(PrimitiveType::I32, PrimitiveValue::I32(i32::MAX));
        round_trip(PrimitiveType::U32, PrimitiveValue::U32(u32::MAX));
        round_trip(PrimitiveType::I64, PrimitiveValue::I64(i64::MIN));
        round_trip(PrimitiveType::I64, PrimitiveValue::I64(i64::MAX));
        round_trip(PrimitiveType::U64, PrimitiveValue::U64(u64::MAX));
        round_trip(PrimitiveType::U64, PrimitiveValue::U64(0));
    }

    #[test]
    fn i64_u64_beyond_js_safe_integer_round_trip_exactly() {
        // 2^53 and neighbors — exactly the magnitude where JS Number would
        // start losing precision if this ever routed through one (Stage 1
        // D06's failure mode). Rust i64/u64 have no such boundary.
        let big_u = (1u64 << 53) + 1;
        round_trip(PrimitiveType::U64, PrimitiveValue::U64(big_u));
        round_trip(PrimitiveType::U64, PrimitiveValue::U64(u64::MAX));
        round_trip(PrimitiveType::U64, PrimitiveValue::U64(u64::MAX - 2)); // Stage 2's known Number()-collision partner
        round_trip(PrimitiveType::I64, PrimitiveValue::I64(-((1i64 << 53) + 1)));
    }

    #[test]
    fn float_round_trip_and_special_values() {
        round_trip(PrimitiveType::F32, PrimitiveValue::F32(0.0));
        round_trip(PrimitiveType::F32, PrimitiveValue::F32(-0.0));
        round_trip(PrimitiveType::F32, PrimitiveValue::F32(f32::INFINITY));
        round_trip(PrimitiveType::F32, PrimitiveValue::F32(f32::NEG_INFINITY));
        round_trip(PrimitiveType::F64, PrimitiveValue::F64(f64::INFINITY));
        round_trip(PrimitiveType::F64, PrimitiveValue::F64(f64::NEG_INFINITY));
        // NaN is intentionally NOT round-tripped through eq_exact here —
        // see nan_is_never_exactly_equal_to_itself below, since eq_exact(NaN,
        // NaN) is false by design and round_trip() asserts eq_exact.
    }

    #[test]
    fn positive_zero_equals_negative_zero_under_exact_scan() {
        // Documented Stage 3 §3.7 choice: ordinary IEEE equality, where
        // +0.0 == -0.0 is true.
        assert!(PrimitiveValue::F32(0.0).eq_exact(&PrimitiveValue::F32(-0.0)));
        assert!(PrimitiveValue::F64(0.0).eq_exact(&PrimitiveValue::F64(-0.0)));
    }

    #[test]
    fn nan_is_never_exactly_equal_to_itself() {
        // Documented Stage 3 §3.7 choice: NaN is not equal to anything,
        // including another NaN, under ordinary exact numeric scan.
        assert!(!PrimitiveValue::F32(f32::NAN).eq_exact(&PrimitiveValue::F32(f32::NAN)));
        assert!(!PrimitiveValue::F64(f64::NAN).eq_exact(&PrimitiveValue::F64(f64::NAN)));
    }

    #[test]
    fn infinities_are_distinct_and_self_equal() {
        assert!(PrimitiveValue::F64(f64::INFINITY).eq_exact(&PrimitiveValue::F64(f64::INFINITY)));
        assert!(PrimitiveValue::F64(f64::NEG_INFINITY)
            .eq_exact(&PrimitiveValue::F64(f64::NEG_INFINITY)));
        assert!(
            !PrimitiveValue::F64(f64::INFINITY).eq_exact(&PrimitiveValue::F64(f64::NEG_INFINITY))
        );
    }

    #[test]
    fn decode_rejects_wrong_length_buffer() {
        assert!(PrimitiveValue::decode(PrimitiveType::I32, &[1, 2, 3]).is_none());
        assert!(PrimitiveValue::decode(PrimitiveType::I32, &[1, 2, 3, 4, 5]).is_none());
    }

    #[test]
    fn mismatched_type_comparison_is_false_not_a_panic() {
        assert!(!PrimitiveValue::I32(5).eq_exact(&PrimitiveValue::U32(5)));
        assert!(!PrimitiveValue::F32(5.0).eq_exact(&PrimitiveValue::F64(5.0)));
    }

    #[test]
    fn little_endian_decode_matches_repo_wide_convention() {
        // 0x00000001 LE bytes -> decimal 1, not 16777216 (which would be BE).
        let bytes = [0x01, 0x00, 0x00, 0x00];
        let decoded = PrimitiveValue::decode(PrimitiveType::I32, &bytes).unwrap();
        assert!(decoded.eq_exact(&PrimitiveValue::I32(1)));
    }
}
