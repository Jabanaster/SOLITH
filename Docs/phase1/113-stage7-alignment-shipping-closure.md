# Phase 1 / Stage 7.4 §3 — Alignment Shipping Defect Closure

## The Stage 7.3 gap

Doc 107 closed alignment for u32/i64 through the default NATIVE route but explicitly left it open because u16 had no wire path at all: "`LIVE_VALUE_TYPE` has no `uint16`/`int16` variant at all; the wire schema itself cannot express a u16 scan request, for any backend." Doc 112 (this stage) closes that gap. This document closes the alignment defect itself.

## Real evidence, through the real default NATIVE route, zero override

**`tests/live-memory/scanner-backend-alignment-closure.test.ts`** (4 tests, all real IPC path against a real spawned fixture process):

| Width | Fixture constant | Offset | Aligned? | Result |
|---|---|---|---|---|
| u16 | `BOUNDARY_U16_VALUE` (0xBEEF) | `BOUNDARY_U16_OFFSET` (1,048,575) | No — odd offset, also straddles the 1×1 MiB chunk boundary | **Found exactly, backend=native** |
| u32 | `BOUNDARY_U32_VALUE` (0xCAFEF00D) | `BOUNDARY_U32_OFFSET` (2,097,150) | No — `% 4 == 2`, straddles the 2×1 MiB boundary | **Found exactly, backend=native** |
| u64 | `BOUNDARY_U64_VALUE` (0x0123456789ABCDEF) | `BOUNDARY_U64_OFFSET` (3,145,724) | No — `% 8 == 4`, straddles the 3×1 MiB boundary | **Found exactly, backend=native** |

Each of these three cases is not merely "unaligned" but also deliberately positioned to straddle a real chunking boundary the native scanner's own internal chunk/overlap logic must handle correctly (`DEFAULT_CHUNK_SIZE_BYTES = 64 KiB` with a 7-byte overlap) — the strongest form of this proof, not a token unaligned offset chosen for convenience.

**i16/i32/i64** unaligned proof is in `scanner-backend-wire-type-expansion.test.ts` (doc 112): fixture.rs plants `I16_VALUE`/`I32_VALUE`/`I64_VALUE` at `I16_OFFSET=193`/`I32_OFFSET=321`/`I64_OFFSET=449` — each documented in fixture.rs itself as `// unaligned` — and all three are found exactly through the same default NATIVE route.

**Explicit aligned-only behavior still works**: the alignment-closure test file's 4th case reconfirms `U32_VALUE` (4-byte-aligned) is still found normally — the unaligned/boundary proofs above are additive, not a regression of the ordinary aligned path.

## Alignment table (mission's exact required shape)

| Type | Result |
|---|---|
| u16 | **PASS** |
| i16 | **PASS** |
| u32 | **PASS** |
| i32 | **PASS** |
| u64 | **PASS** |
| i64 | **PASS** |

## Verdict

**ALIGNMENT PRODUCT DEFECT: PRODUCT_DEFECT_CLOSED.** All 6 required widths are proven exact-match-correct at genuinely unaligned (and, for u16/u32/u64, chunk-boundary-straddling) offsets through the real default production route, with zero override, real fixture evidence, no synthetic stand-in.
