# Phase 1 / Stage 7 — Parity Results

## §7.8 — parity matrix: partial, not exhaustive

Mission §7.8 asks for a full matrix across 10 data types × 14 scan cases × 11 pattern cases. **This stage does not build that exhaustive matrix.** What exists instead, all real (no mocked target):

| Case | Legacy | Native | Result |
|---|---|---|---|
| u32 exact, aligned, small offset | found | found | match (unit + real-process) |
| u32 exact, >1 MiB region (real 4 MiB fixture region, sentinel at 1,500,000) | **not found** (silent skip, D02) | found, `complete` | EXPECTED_NATIVE_CORRECTION — doc 76 |
| i64 exact, unaligned real offset (449), magnitude 9×10^18 | **not found** (D03: alignment stride skips the offset entirely) | found, exact `valueBigint` | native closes both D03 and D06 for this real value — doc 76 |
| i64 exact, within safe-integer range | found (lossy `Number`, but round-trips for this magnitude) | found (exact `valueBigint`) | parity, native additionally exact |
| i64 exact, beyond `Number.MAX_SAFE_INTEGER` and clear of the i64::MAX rounding-overflow edge | **not found** (D06: `BigInt(Number(value))` re-encodes to different bytes than the exact planted value) | not tested at this exact magnitude via native in the real-process suite (covered by Stage 1-6's own `u64_beyond_js_safe_integer_survives_a_real_refine_exactly`) | legacy defect reconfirmed via `scanner-backend-legacy.test.ts` |
| i64 exact, `Number(value)` rounds to/past 2^63 | **uncaught throw inside `encodeValue`** (a real, newly-discovered legacy defect — see doc 85) | n/a | this adapter now surfaces a typed error instead of crashing |
| AOB, 5-byte pattern 6 MiB into an 8 MiB region | **not found** (same 1 MiB `readBuffer` ceiling, D01/D04) | found, exact address | EXPECTED_NATIVE_CORRECTION-shaped (real-process test asserts the concrete finding directly) — doc 76 |
| Identical match sets (both backends agree) | — | — | zero recorded differences (unit test) |
| Cancellation, process-exit, resource-limit | not exercised through the Stage 7 contract this stage (already exhaustively certified for the native path alone in Stage 6; not re-proven through the router this stage) | same | gap — noted, not hidden |

Not covered this stage: i8/u8/i16/u16/f32 through the routed contract specifically (the underlying legacy/native behavior for these types was already certified in Stages 1-6 and is structurally identical to the u32/i64 cases proven here, but no dedicated Stage 7 parity test exercises them); UTF-8/UTF-16LE string scan and byte-array scan through the contract (not routed this stage at all — `LiveMemorySession.scanFirst`'s string/byte paths remain legacy-only, see doc 83); the full CE-syntax AOB grammar (`??`, `*`, nibble wildcards, continuous CE syntax) through the routed contract specifically (Stage 5 already certified this exhaustively at the native-core level; not re-exercised through `ScannerBackendRouter` this stage); duplicate-results and no-match-vs-incomplete-coverage distinctions beyond what's shown above.

## §7.9 — real game parity

**Not performed this stage.** Stardew Valley is not currently installed on this machine (only its save-data folder under `%AppData%` exists; the executable is absent from every checked install location). Real, currently-installed, single-player-capable candidates confirmed present: Crusader Kings III, Going Medieval, Starfield, AdVenture Communist (all under Steam's `steamapps/common`). None was launched or scanned this stage — this is an honest, explicit gap, not a silent omission. The real-process evidence in doc 76 (against the actual `solith-scanner-fixture.exe` binary, a real spawned Windows process, not a mock) is offered as the closest available substitute this stage, and is NOT represented as satisfying §7.9/§7.30's real-game requirement.
