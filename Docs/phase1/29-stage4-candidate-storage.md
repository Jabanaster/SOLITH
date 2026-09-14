# Phase 1 / Stage 4 — Candidate Storage

## Design chosen: packed address vector + flat fixed-width value buffer

`native/solith-scanner-core/src/session.rs::CandidateStore`:

```rust
pub struct CandidateStore {
    primitive_type: PrimitiveType,
    addresses: Vec<u64>,  // one u64 per candidate
    values: Vec<u8>,      // primitive_type.byte_width() bytes per candidate, flat
}
```

No per-candidate heap object exists anywhere — `push`/`address`/`value` operate on plain slice indexing and `PrimitiveValue::decode`/`encode_into` (both already Stage 3 functions, reused unchanged). Iterating `n` candidates allocates nothing beyond the two backing `Vec`s themselves.

## Alternatives considered and why this one was chosen

| Design | Verdict | Why |
|---|---|---|
| One JS/Rust object per candidate (`Vec<CandidateObject>` or a boxed struct) | **Rejected** | This is exactly the "millions of JS objects" mission §4.3 explicitly forbids storing; even kept entirely on the Rust side, a `Vec<Box<dyn Any>>`-style per-candidate heap allocation would cost far more than the packed layout below and fragment badly at scale. |
| Page-relative offsets (store `(page_base, offset)` pairs instead of absolute `u64` addresses) | **Rejected for this stage** | Would save bytes only when many candidates share the same page and the page-base table itself is small relative to the candidate count — a real win for very dense same-page candidate sets, but it adds a second table plus an indirection cost for every lookup, and Stage 4's own benchmark (doc 33) shows the *value* buffer's own width already dominates cost more than the address field does for the wider (4-8 byte) types. Revisit with real evidence once a dense-same-page workload is profiled; the plain `u64` address is simpler and already correct. |
| Bitmaps (one bit per possible address, presence-only) | **Rejected** | A bitmap answers "is this address a candidate" in O(1) but cannot store the *value* at all (needed for every refinement mode here) and, for a realistic 64-bit-but-effectively-48-bit user-mode address space, a naive bitmap is absurdly large; a *segmented* bitmap (one bit per aligned slot within each region) is a legitimate future optimization for `UNKNOWN_INITIAL`'s own bytewise/aligned capture phase specifically (before any value needs to be retained), but was not implemented this stage — the packed-vector design already meets every required property (bounded growth, deterministic ordering, pagination) without it. |
| Segmented/chunked storage (one `CandidateStore` per source region or per size-bounded segment) | **Rejected for this stage** | Genuinely useful for very large candidate sets that need partial eviction/streaming to disk — out of scope for a stage whose own resource limits (`SessionResourceLimits`) already cap total candidates/bytes to a bounded, in-memory-safe size (mission §4.11's "do not OOM the Electron process," satisfied by capping input rather than by streaming). |
| Compact snapshots (store only a hash/checksum of the value, not the value itself) | **Rejected** | Every refinement mode this stage implements needs the *actual* previous value (for `CHANGED`/`UNCHANGED`'s exact comparison, `INCREASED_BY`'s exact-delta arithmetic, etc.) — a hash cannot support any of them. |

## Deterministic ordering (mission §4.3)

`CandidateStore` never re-sorts; `create_unknown_initial` naturally produces addresses in strictly ascending order (regions are enumerated in ascending-address order by `region.rs`, and within a region, chunks/offsets are walked ascending), and `refine()` preserves that same order (survivors are appended to a fresh `CandidateStore` in the same ascending pass over the existing sorted candidates). `candidates_page`'s test (`candidates_page_is_bounded_and_deterministically_ordered`, doc 32) asserts strict ascending order across a real page.

## Bounded growth and resource accounting (mission §4.3/§4.11)

`SessionResourceLimits{max_candidates, max_snapshot_bytes, max_session_bytes, max_generations_retained}`. `resource_exhausted()` is checked both between chunks and (via `scan_buffer`-style within-loop checks, mirroring Stage 3's `scan_buffer_for_matches_bounded`) *within* a chunk's own decode loop during `create_unknown_initial`, so a single dense chunk cannot push the candidate count arbitrarily far past the configured cap before the next check fires — the same scalability fix Stage 3 had to make for its own `max_results` (doc 25's "real bug #2"), applied proactively here rather than discovered as a bug.

`CandidateStore::memory_bytes()` is the exact, real-time accounting: `len * 8 + len * byte_width` — always current, never estimated.

`refine()` never needs its own resource-limit check: its output candidate count can only be ≤ its input count (every mode is a filter, never an expansion), so a session that started within budget can never exceed it via refinement alone.

## Documented memory cost per million candidates (mission §4.3's explicit requirement)

| Primitive type | Byte width | Bytes/candidate (`8 + width`) | Cost per 1,000,000 candidates |
|---|---|---|---|
| i8 / u8 | 1 | 9 | 9.00 MB |
| i16 / u16 | 2 | 10 | 10.00 MB |
| i32 / u32 / f32 | 4 | 12 | 12.00 MB |
| i64 / u64 / f64 | 8 | 16 | 16.00 MB |

These are exact formulas (not estimates) verified by the unit test `candidate_store_memory_bytes_matches_documented_formula` and cross-checked against real captured sessions in doc 33's benchmark table (e.g. a real 16 MiB u8/bytewise capture reports exactly 144.00 MB for 16,777,216 candidates = `16,777,216 * 9 / 1,048,576`).

## Pagination to JS (mission §4.3/§4.14)

`candidates_page(offset, limit)` returns a bounded `Vec<(u64, PrimitiveValue)>` slice — the napi layer's `getResults(offset, limit)` wraps this directly with no additional buffering, so a caller retrieving a million-candidate session's results in pages of, say, 10,000 never has more than one page's worth of converted JS values alive at once.
