# Phase 1 / Stage 5.4 — Final Corpus-of-Record Coverage

## Method

The full 111,467-occurrence corpus-of-record (doc 54) was re-extracted from scratch, read-only, via the exact certified pipeline (`extractCheatTableRawScriptCatalog` + `extractAOBsFromCatalog`, unmodified, `src/core/script-research/`) against the hash-verified archive (`Combined-CheatEngine-Tables.zip`, SHA-256 `c7bc553387fe8c7b25c170fec3a89724be9ecd266f25f9eb467acd0a5e1ac9d7`), with zero sampling. Every extracted signature's raw, pre-normalization pattern text (`rawPattern`) was then classified by calling the new `validateAobPattern` napi export — the real, compiled, unmodified Rust `parse_aob` function (doc 55) — directly. This is ground truth from the actual parser, not a re-implementation of its rules in a second language, eliminating the classification-drift risk that would come from hand-porting the grammar to TypeScript for analysis purposes.

The one-off classification script used to produce these numbers was scratch-only (per this mission's read-only/no-corpus-mutation discipline) and was not committed; its exact extraction and classification logic is documented here so the result is independently reproducible from the same archive and the same napi export.

## Headline counts

| Field | Count |
|---|---|
| RAW OCCURRENCES | 111,467 |
| VALID | 110,163 |
| MALFORMED | 1,304 |
| SUPPORTED VALID | 110,163 |
| UNSUPPORTED VALID | **0** |
| UNIQUE NORMALIZED (uppercase, whitespace-collapsed raw-pattern text) | 13,581 |

**GRAMMAR COVERAGE = SUPPORTED VALID / VALID = 110,163 / 110,163 = 100.000%**

This satisfies Stage 5.4 §H's required target exactly, with malformed entries correctly excluded from the coverage denominator per the mission's own formula.

## Malformed breakdown (by real parser error kind)

| Error kind | Count |
|---|---|
| `empty_pattern` | 656 |
| `invalid_hex_token` | 139 |
| `invalid_separator` | 18 |
| `odd_length_token` | 205 |
| `unsupported_token` | 286 |
| **Total** | **1,304** |

## Honest verification that 100% was not reached by reclassifying valid syntax as noise

Per the mission's explicit instruction ("Do not redefine valid syntax as malformed merely to reach 100%"), every malformed bucket was manually sampled (20 examples per error kind, plus every entry matching a broad "looks plausibly like real CE hex/wildcard syntax" filter — 40 such entries found, all reviewed individually). All are confirmed non-CE-syntax noise, not missed grammar:

- `empty_pattern` (656): genuinely empty raw pattern text — CT scripts with a call site the certified extraction regex matched but which carried no pattern argument.
- `invalid_hex_token` (139): format-string placeholders (`%s`), variable-name captures (`AIRBYTES`, `bytes1`), diagnostic error-message text mistakenly captured by the extraction regex (`"ERROR: Could not find unique AOB..."`), a real script author typo (`8N` — `N` is not a hex digit or a CE wildcard character), and two distinct real script templates (repeated across multiple `.ct` files, evidently copied between authors) containing a lone standalone `"0"` token — a single hex digit with no partner, which does not correspond to any documented CE grammar rule and is a genuine authoring typo, not an unimplemented syntax family.
- `invalid_separator` (18): `MODULE,PATTERN`-shaped text (e.g. `"WHGame.dll,01 4F 04 80 00 00"`) and array-literal-shaped text (`"b[2],b[3],b[4],0,0,..."`) — pre-existing certified-extraction-pipeline argument-splitting artifacts, not AOB syntax at all.
- `odd_length_token` (205): variable-name captures (`"bytes"`, `"STATICBYTES"`) and, notably, real hex byte sequences wrapped in literal double-quote characters that were captured as part of the pattern text (e.g. `"\"8B 86 D8 00 00 00 B1 FF\""`) — an extraction/quoting artifact from the original script's argument formatting, not a CE grammar gap (the quote characters themselves are what make the wrapping tokens odd-length and non-hex).
- `unsupported_token` (286): dominated by a single recurring non-AOB string (`'-X'`) — clearly not Cheat Engine AOB syntax.

One further edge case was noted but not implemented: a small number of real signatures use a `y`/`Y` character alongside genuine `xx` wildcard runs (e.g. `"68xxxxxxxx50E8xxxxxxxx83C40885C0741633C9390Dyyyyyyyy0F94C1890Dyyyyyyyy"`). Doc 51's authoritative Cheat Engine wiki citation names exactly three wildcard characters — `?`, `*`, `x` — and does not document `y` as a fourth. Per this mission's "do not guess" instruction, `y` is correctly left unimplemented; these specific signatures are correctly classified `invalid_hex_token`, not a missed grammar family.

## Syntax family breakdown (descriptive, informational — see caveat)

Classified with a JS classifier mirroring `pattern.rs`'s real tokenizer logic (whitespace tokens; isolated single wildcard = full wildcard; even-length token split into 2-character byte groups; each group classified) — independent of, and only descriptive alongside, the authoritative `validateAobPattern` pass/fail verdict used for every count above.

| Family | Count |
|---|---|
| Exact, spaced | 85,959 |
| Exact, continuous | 2,121 |
| Full wildcard (`??`/`*`/`xx`, any spelling) | 17,835 |
| `xx`/`x` involved (full-wildcard alias, not otherwise counted above) | 2,217 |
| Nibble wildcard (any of `?`/`x`/`*` in nibble position) | 436 |
| Continuous run combined with a wildcard | 1,591 |
| Mixed forms (not cleanly bucketed above) | 4 |
| Other | 0 |
| **Total (= VALID)** | **110,163** |

The nibble-wildcard count here (436) is slightly higher than doc 48's original 426 raw-corpus count because doc 48 counted only `'?'`-based nibble wildcards (the pre-Stage-5.4 grammar); this reanalysis's nibble detection also recognizes the newly-implemented `x`/`X`/`*` nibble-position wildcards (doc 55), correctly finding a handful of additional real nibble-wildcard signatures that were not classified as such before this mission's grammar extension.

## Comparison to doc 48/52's prior (Stage 5.3) numbers

Doc 52's Stage 5.3 figures (106,433 supported / 3,349 unsupported-but-valid / 1,685 malformed, 96.95% coverage) are **superseded** by this document. The 3,349 "unsupported valid" (continuous-hex-like) signatures from Stage 5.3 are now, correctly, inside this document's 110,163 VALID/SUPPORTED count — that is exactly the gap this mission's continuous-hex implementation (doc 55) was built to close. The malformed count also dropped from doc 52's 1,685 to this document's 1,304, because the earlier heuristic "true noise" classification was itself an approximation; this document's malformed count comes directly from the real parser's authoritative verdict, not a heuristic.
