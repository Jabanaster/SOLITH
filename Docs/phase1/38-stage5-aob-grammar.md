# Phase 1 / Stage 5 — AOB Pattern Grammar

## Canonical SOLITH AOB grammar

Whitespace-separated tokens (`str::split_whitespace`, so any run of spaces/tabs is a valid separator — comma/semicolon-joined tokens are explicitly rejected, see below):

| Token | Meaning | Compiles to |
|---|---|---|
| `AA` (2 hex digits) | Exact byte | `PatternByte{mask: 0xFF, value: 0xAA}` |
| `??` | Full-byte wildcard (canonical) | `PatternByte{mask: 0x00, value: 0x00}` |
| `?` | Full-byte wildcard (alias) | same |
| `*` | Full-byte wildcard (alias, CE-script compatible — see doc 39) | same |
| `A?` | Nibble wildcard: high nibble `A` fixed, low nibble wild | `PatternByte{mask: 0xF0, value: 0xA0}` |
| `?F` | Nibble wildcard: low nibble `F` fixed, high nibble wild | `PatternByte{mask: 0x0F, value: 0x0F}` |

Implemented in `native/solith-scanner-core/src/pattern.rs::parse_aob`/`parse_token`.

## Nibble wildcards: evaluated, implemented, evidence-scoped (mission §5.4)

Nibble wildcards are **implemented** (both `A?` and `?A` forms), because they cost almost nothing extra given `PatternByte`'s `mask`/`value` design — the identical primitive already used for full-byte wildcards, with no new matcher logic. However, doc 39's real-corpus-evidence review found **zero occurrences** of nibble-wildcard syntax anywhere in this repository's own already-certified CT AOB ingest pipeline (`src/core/script-research/aob-parser.ts`) or its real-signature test corpus — that pipeline's own grammar (`normalizeAobPattern`) does not recognize nibble wildcards at all; any such token in a real script would be flagged `Invalid AOB token` and the whole signature marked `completeness: 'invalid'` by the existing, certified pipeline. So: **implemented for broader signature compatibility, not because current evidence shows it is required.**

## Parser error categories (mission §5.4's exact required list)

`PatternParseErrorKind` — exhaustive, stable, `Display`-formatted with a fixed string prefix a caller can pattern-match on (matching this crate's existing `ErrorKind` convention):

| Kind | When | Example |
|---|---|---|
| `invalid_hex_token` | A 2-character token has a non-hex, non-`?` character in a hex position, or a lone hex digit with no partner | `"AA GG CC"`, `"AA B CC"` |
| `malformed_wildcard` | A run of 3+ `?`/`*` characters — represents more than one byte's worth of wildcard, not a valid single-byte token | `"AA ??? CC"` |
| `empty_pattern` | Zero tokens after whitespace-splitting | `""`, `"   "` |
| `unsupported_token` | Any other unrecognized token shape | `"AA #! CC"` |
| `invalid_separator` | A token containing `,`/`;` — signals the caller likely used the wrong separator | `"AA,BB,CC"` |

Every category has a dedicated, real (not simulated) test: `aob_rejects_invalid_hex_token`, `aob_rejects_malformed_wildcard`, `aob_rejects_empty_pattern` (both `""` and whitespace-only), `aob_rejects_unsupported_token`, `aob_rejects_invalid_separator`, plus `aob_rejects_single_stray_hex_digit`. At the napi boundary, `scanAob` surfaces these synchronously (before any `AsyncTask`/`Promise` is constructed) with the stable `"<kind>: <detail>"` message contract this crate already uses everywhere else — proven from real JS in `pattern: a malformed AOB pattern is rejected with a stable error, not silently accepted`.

## Grammar design notes

- `??`/`?`/`*` are all accepted as full-byte-wildcard spellings specifically because this repository's own already-certified CT ingest parser (`aob-parser.ts`) already tolerates real Cheat Engine scripts using either `?`/`??` or `*` (`normalizeAobPattern` normalizes both) — SOLITH's native grammar deliberately matches that existing tolerance rather than being stricter than the pipeline that feeds it real signatures.
- A run of exactly 1 or 2 wildcard characters is the accepted alias range (one byte's worth); 3+ is rejected as `malformed_wildcard` rather than silently accepted or silently truncated — an AOB token always represents exactly one byte, so a longer run has no defined meaning.
- Parser errors never partially apply a malformed pattern — `parse_aob` either returns a fully-compiled `Pattern` or an error; there is no code path that could scan against a half-parsed pattern.
