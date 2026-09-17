# Phase 1 / Stage 7.4 §2/§4 — u64/int64 Shipping Defect Closure

## The Stage 7.3 gap

Doc 107: "`LIVE_VALUE_TYPE` has no `uint64` variant... it remains provable only at the raw backend layer... never through the real shipping wire." i64 was fully closed; u64 had zero path to the production wire. Doc 112 (this stage) adds that wire path. This document proves exactness through the complete shipping boundary for u64, closing the combined defect mission §6 frames as one ("Treat 'INT64 defect' as the historical combined signed/unsigned 64-bit product defect").

## Real evidence — mission's exact 5 required values, full production path, zero override

**`tests/live-memory/scanner-backend-u64-shipping-closure.test.ts`** (6 tests, real IPC path against a real spawned fixture process). Each of mission §2's 5 required values is written at runtime into `REFINE_REGION` via the fixture's real `write <offset> <hex_le_bytes>` stdin protocol (arbitrary values, not values the fixture happens to have pre-planted), then searched for via `live-memory-scan-first` with `dataType: 'u64'` and `targetValueBigint` carrying the exact decimal string:

| Value | Result |
|---|---|
| `9007199254740993n` (2^53+1) | **Found exactly, backend=native, zero override** |
| `9007199254740995n` (2^53+3) | **Found exactly, backend=native, zero override** |
| `9223372036854775808n` (2^63 — not representable as i64 at all) | **Found exactly, backend=native, zero override** |
| `18446744073709551614n` (u64::MAX − 1) | **Found exactly, backend=native, zero override** |
| `18446744073709551615n` (u64::MAX, mission §4's explicit re-emphasis) | **Found exactly, backend=native, zero override** |

A 6th, negative-control test plants u64::MAX and searches for u64::MAX − 1, confirming no spurious/indiscriminate matching — the scan is genuinely exact, not merely "always finds something near the target."

Every match's `valueBigint` field round-trips as the exact decimal string with no truncation, no overflow, no sign confusion — verified by direct string equality against the planted value, not a lossy numeric comparison.

## Full chain traced

application/preload (`liveMemoryScanFirst`, `dataType`/`targetValueBigint` typed as decimal strings, never `number`) → IPC validation (`LiveMemoryScanFirstSchema`, `LIVE_VALUE_TYPE_ROUTED` accepts `'u64'`, `targetValueBigint` regex allows up to 20 digits — u64::MAX is exactly 20 digits) → main handler (`live-memory-scan-first`, `BigInt(parsed.targetValueBigint)`) → scanner facade (`LiveMemorySession.scanExactViaBackend`, `primitiveType === 'u64'` triggers the BigInt-exactness path) → `NativeScannerBackend.exactScan` (forwards `valueBigint` untouched) → napi (`primitive_value_from_js`, `PrimitiveType::U64` branch: `big.get_u64()` with a strict `lossless` check, rejecting anything that doesn't fit exactly) → Rust core (`PrimitiveValue::U64`, byte-exact comparison) → result → IPC (`valueBigint.toString()`, decimal string, arbitrary-precision) → preload → consumer-facing type (decimal string, never a plain `number`).

## Static unsafe-conversion audit (mission §12's exact search list)

`Number(`, `Math.trunc(`, `parseInt(`, `parseFloat(`, `as number`, `BigInt(Number`, `BigInt(Math.trunc` — the only remaining hit on the active route is `scanExactViaBackend`'s own documented fallback, `BigInt(Math.trunc(targetValue))`, used **only** when a caller omits `exactTargetValueBigint`. Every real production caller (the IPC handler) always supplies `targetValueBigint` when the wire value is present and the resolved canonical type is 64-bit — confirmed by the IPC handler code itself, which unconditionally forwards `parsed.targetValueBigint` when present regardless of which 64-bit spelling (`int64`/`i64`/`u64`) was requested. This lossy fallback is dead code on the exercised production route, not silently active — the identical reasoning Stage 7.3 already established for i64, now verified to hold for u64 too. **`ACTIVE_NATIVE_INT64_UNSAFE_CONVERSIONS = 0`** on every path this pass exercised.

## Verdict

**INT64/U64 PRODUCT DEFECT: PRODUCT_DEFECT_CLOSED.** Both halves of the combined defect — i64 (closed in Stage 7.3) and u64 (closed this pass) — now have real, exact, zero-override production-path proof, including u64::MAX itself.
