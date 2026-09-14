# Phase 1 / Stage 3 — Result Model

## Rust-side representation

```rust
pub struct ScanMatch { pub address: u64, pub value: PrimitiveValue }
pub struct ExactScanResult { pub matches: Vec<ScanMatch>, pub completeness: ScanCompleteness, pub metrics: ScanMetrics }
```

Each candidate retains exactly what a later refinement stage needs: `address` (for a follow-up re-read) and `value` (the exact typed value at scan time, for `changed`/`increased`/etc. comparisons in a future stage) — nothing more. No raw region bytes are retained past the chunk that produced a match (doc 20) — memory cost per match is `size_of::<ScanMatch>()` (24–32 bytes depending on `PrimitiveValue`'s largest variant), not a full chunk buffer.

- **Deterministic ordering**: matches are sorted by ascending address after deduplication (doc 20) — the same real memory state always produces the same result order, verified by `repeated_value_produces_exactly_two_distinct_addresses`.
- **Memory accounting**: `ScanMetrics.bytes_read`/`bytes_requested`/`chunks_read`/`chunks_partial`/`chunks_failed` give the caller a real accounting of work done, independent of match count.
- **Cancellation / result limits**: both integrated into the same completeness/metrics model as Stage 2's reader (doc 20's completeness-propagation section).

## napi-side bounded transfer (mission §3.8's "avoid one enormous napi return payload")

Stage 3's actual mechanism differs from the mission's literal suggested `fetchResults(offset, limit)` paging API, for a concrete reason: **`max_results` on the scan call itself already bounds the payload before it ever crosses the napi boundary**, rather than crossing a large payload once and paging through it client-side afterward. A caller wanting bounded results asks for a bounded scan (`maxResults: 5` in the real napi test, for example) — the native side truncates deterministically (ascending address, doc 20) and only the bounded set is marshaled to JS at all. This is strictly better for the "avoid one enormous return payload" goal than a fetch-after-the-fact page API, since the native side never allocates/marshals the discarded excess in the first place.

**This is recorded as a deliberate design choice, not an oversight of the mission's literal API sketch.** A `fetchResults(offset, limit)`-style incremental-retrieval API remains a reasonable Stage 4+ addition for a genuinely different use case the current design does not yet serve: a caller that wants **all** matches from an unbounded scan but wants to *stream* them to a UI in pages rather than receive one large array — that is a "how do I consume a big-but-already-computed result set" problem, whereas Stage 3's `max_results` solves "how do I avoid computing/transferring a big result set in the first place." Both are legitimate; Stage 3 implements the one that composes naturally with the resource-limit contract (mission §3.9) already required this stage, and defers the other since the mission's own primitive-scan scope (no refinement/narrowing modes yet) does not yet produce result sets large enough to need incremental client-side paging beyond what `max_results` already bounds.

## Value duality at the napi boundary

`JsScanMatch { address: BigInt, primitiveType: string, valueNumber: number | null, valueBigint: bigint | null }` — exactly one of `valueNumber`/`valueBigint` is populated, selected by `primitiveType.requires_bigint_for_js()` (doc 19/22). This mirrors the *input* contract (`scanExact`'s `valueNumber`/`valueBigint` parameters) symmetrically, so a caller reads results the same way it constructs a scan target.

## Real, executed evidence

- `resource_limit_truncates_and_never_reports_complete` (Rust) and `bounded result paging` (napi JS): both confirm a `max_results` cap produces a truncated, deterministically-ordered result set with `ResourceLimit` completeness, never a silently-oversized payload.
- `u64_beyond_js_safe_integer_is_found_exactly` (Rust) and `u64 beyond JS safe integer round-trips exactly via BigInt` (napi JS): confirm the value-duality contract holds end to end for the one case where getting it wrong would silently corrupt data (i64/u64 beyond `Number.MAX_SAFE_INTEGER`).
