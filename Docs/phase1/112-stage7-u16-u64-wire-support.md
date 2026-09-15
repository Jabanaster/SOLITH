# Phase 1 / Stage 7.4 §1 — Complete Primitive Wire Type Support

## What was actually missing

Investigation before writing any code found the gap was narrower than the mission text implied. The native stack — `native/solith-scanner-core/src/types.rs`'s `PrimitiveType` (10 variants, `ALL` constant), `exact_scan.rs`, and `native/solith-scanner-napi/src/lib.rs`'s `primitive_type_from_str`/`primitive_value_from_js` — already fully implements and tests all 10 canonical primitive types (i8, u8, i16, u16, i32, u32, i64, u64, f32, f64), including strict BigInt-exactness enforcement for i64/u64 (`get_i64()`/`get_u64()` with a `lossless` check, rejecting any value that doesn't fit exactly). `NativeScannerBackend.exactScan` (`src/core/live-memory/scanner-backend-native.ts`) already forwarded `primitiveType` as a raw string straight through to napi with no narrowing. `CanonicalPrimitiveType` (`scanner-backend.ts`) already declared the full 10-type union.

The actual gap was entirely at the wire boundary: `electron/ipc-validation.ts`'s `LIVE_VALUE_TYPE` enum only recognized the 6 legacy names (`int32`, `uint32`, `float`, `double`, `int64`, `byte`), and `scanner-backend.ts`'s `LIVE_VALUE_TYPE_TO_CANONICAL` mapping table only had entries for those 6. There was no wire-level way to name i8, i16, u16, or u64 at all — not a native-side limitation, a TypeScript-side one.

## What changed

One canonical primitive-type mapping, used consistently:

- `scanner-backend.ts`'s `LIVE_VALUE_TYPE_TO_CANONICAL` now also self-maps all 10 canonical short names (`i8`→`i8`, `u16`→`u16`, etc.) alongside the unchanged 6 legacy aliases. A new exported type, `RoutedWireValueType`, is the union of both vocabularies.
- `electron/ipc-validation.ts` adds `LIVE_VALUE_TYPE_ROUTED` (16 literal strings: the 6 legacy names plus the 10 canonical names) and uses it for the two schemas behind the routed backend contract — `LiveMemoryScanFirstSchema` and `LiveMemoryScanFirstStartSchema`. Every other schema (`LiveMemoryReadSchema`, `LiveMemoryScanNextSchema`, `LiveMemoryScanFirstAutoMatrixSchema`, `ResearchViewSchema`, etc. — all legacy-only surfaces tied to `MemoryDriver`'s own 6-value `LiveValueType`) is deliberately left on the original, narrower `LIVE_VALUE_TYPE` — widening those would let a request pass validation only to fail deeper inside code that never claimed to support these widths, and none of those surfaces are part of this stage's named scope.
- `live-memory-session.ts`'s `scanExactViaBackend`/`startExactScanOperation` now type `dataType` as `RoutedWireValueType` instead of the narrower `LiveValueType`; the i64/u64-precision BigInt-fallback gate was generalized from `dataType === 'int64'` to `primitiveType === 'i64' || primitiveType === 'u64'` (checking the already-resolved canonical type, so it is correct regardless of which wire spelling — legacy or canonical — the caller used).
- `electron/preload.ts` and `src/types/global.d.ts` widen `liveMemoryScanFirstStart`'s `dataType` literal union to the same 16 strings. `liveMemoryScanFirst`'s payload was already typed as a bare `string` in both files, so no change was needed there.
- `LegacyScannerBackend`'s existing `CANONICAL_TO_LIVE_VALUE_TYPE` table (already built in Stage 7.3, already mapping i8/i16/u16/u64 to `undefined`) needed no change at all — it already throws a structured `unsupported_operation` `ScannerBackendError` for these four widths, which is exactly the correct behavior: legacy genuinely cannot serve them, and the router's LEGACY mode should fail closed and honestly, not silently narrow or crash.

This is fully backward compatible: every existing caller/test using the 6 legacy wire names (`int32`, `byte`, etc.) is unaffected, and the widening is additive.

## Real evidence

`tests/live-memory/scanner-backend-wire-type-expansion.test.ts` — 11 tests, all through the real registered `live-memory-scan-first` IPC handler against a real spawned fixture process, default (zero-override) NATIVE backend: i8, u8, i16, u16, i32, u32, i64, u64 (twice — a mid-range value and u64::MAX), f32, f64. All 11 pass. `i16`/`i32`/`i64` here are simultaneously the first wire-level proof of these type names existing at all AND real evidence toward the alignment defect, since fixture.rs plants these three at deliberately unaligned offsets (see doc 113 for the dedicated alignment-closure evidence).

**U16/I16 WIRE: PASS. U64 WIRE: PASS.**
