# Phase 1 / Stage 5.3 — Final Grammar Coverage

## Method

Full, complete (not sampled) re-classification of all 111,467 raw AOB occurrences (doc 48/49's fresh, hash-verified extraction) against SOLITH's **post-Stage-5.3** native grammar (exact byte, `?`/`??`/`*`/`xx`/`x`/`XX`/`X` full wildcard, `A?`/`?A` nibble wildcard — i.e. `pattern.rs` as it stands after doc 50's change), classifying each signature's **raw, pre-normalization** pattern text directly (not pre-filtered through the old TS pipeline's own normalization) so this measurement is not biased by a grammar that predates this mission's own change.

Per mission §I's own instruction ("malformed entries do not count against supported-valid coverage"), unsupported signatures were further split into two sub-populations: those whose only unsupported tokens are plausibly real continuous-hex CE syntax (doc 51 — even-length runs of only hex digits/`?`/`*` characters, consistent with CE's real 2-characters-per-byte tokenization) versus true noise (extraction artifacts, comment fragments, non-signature text — not real CE syntax under any known grammar).

## Results

| Field | Count |
|---|---|
| TOTAL RAW AOB OCCURRENCES | 111,467 |
| SUPPORTED VALID AOB OCCURRENCES (parses under SOLITH's current native grammar) | 106,433 |
| UNSUPPORTED VALID AOB OCCURRENCES (real CE syntax — continuous-hex-like — not yet implemented, doc 51) | 3,349 |
| MALFORMED AOB OCCURRENCES (true noise, not real CE syntax under any known grammar) | 1,685 |
| VALID AOB OCCURRENCES (SUPPORTED + UNSUPPORTED-VALID) | 109,782 |

Internal consistency: 106,433 + 3,349 + 1,685 = 111,467 (exact).

**GRAMMAR COVERAGE = SUPPORTED VALID / VALID = 106,433 / 109,782 = 96.95%.**

## Against the mission's 100% target

Mission §I's stated target is "100% of legitimate required CE syntax for Stage 5." This is **not reached** — the remaining 3.05% gap is entirely the continuous-hex/nibble-via-`x`-or-`*` family doc 51 documents and owner decision #3 explicitly defers ("DO NOT implement continuous/unspaced hex notation yet"). This is not an oversight; it is the direct, intended consequence of that decision. Closing it requires the tokenizer re-architecture doc 51 recommends for a future, separately-authorized mission.

## Before/after this mission

| | Pre-Stage-5.3 (doc 48, old grammar) | Post-Stage-5.3 (this doc, `xx`/`x` added) |
|---|---|---|
| Supported | 104,246 (93.5% of 111,467) | 106,433 (95.5% of 111,467; 96.95% of the 109,782 legitimate-syntax denominator) |
| Gain from `xx`/`x` support | — | +2,187 signatures reclassified from unsupported to supported |

## True malformed count, corrected

Doc 48's original figure of 6,565 "malformedOther" signatures is superseded here: only **1,685** are genuinely malformed/non-CE-syntax. The remaining 4,880 (6,565 − 1,685) were over-counted as malformed in doc 48 — 2,187 are now recognized `xx`/`x` full-wildcard signatures (doc 50), and 3,349 more (2,187 is already inside the 106,433 figure; the continuous-hex-like 3,349 is the separate, still-unsupported-but-real remainder) are real CE syntax this mission identified but did not implement. This correction is carried into doc 48's own update (see below).
