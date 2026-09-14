# Phase 1 / Stage 5.3 — Continuous/Unspaced Hex: Cheat Engine Reference

## Directive

Owner decision #3: "DO NOT implement continuous/unspaced hex notation yet. First verify whether Cheat Engine actually accepts it and under what grammar." This document performs the verification only. **Nothing in `native/solith-scanner-core` was changed for continuous-hex notation.**

## Local evidence checked first

- No local copy of Cheat Engine's source is present in this repository or its recovered corpus locations.
- Recovered CT examples (doc 48): many real, published signatures use continuous/concatenated hex, some with embedded `??` wildcard runs (e.g. `E8????????`, `0F84????????`, `897D??897D??897D??8B068B55??8B80????????8D`), found across genuinely different games/authors — a real, widespread pattern, not an isolated typo.
- This repo's own certified parser (`normalizeAobPattern`, `src/core/script-research/aob-parser.ts`) and SOLITH's native grammar (`pattern.rs`, before or after this mission's `xx`/`x` change) both tokenize **only** on whitespace — neither has ever attempted 2-characters-at-a-time tokenization of an unspaced run. This is existing-logic evidence only, not CE-behavioral evidence.

## Upstream research (mission's own "if necessary" escalation)

Cheat Engine's official wiki (`wiki.cheatengine.org`, the canonical community/dark byte-maintained reference) directly answers this:

> AOBString definition is composed by a list of one or several bytes optionally separated by spaces.

**Answer to the mission's question: YES — Cheat Engine's real `aobscan`/`aobscanmodule`/`aobscanregion` accept continuous, unspaced hex.** This is not ambiguous; it is the documented, intended behavior of the reference implementation this entire ecosystem's `.CT` files are authored against.

### Exact grammar found

- **Tokenization is 2-characters-at-a-time, independent of whitespace.** Spaces are an optional, purely cosmetic separator a script author may insert or omit freely — even inconsistently within the same pattern.
- **Three wildcard characters are recognized: `?`, `*`, and `x`** (case-insensitive per the examples shown), not just `?`/`*` as SOLITH's grammar (doc 38) previously assumed.
- **Wildcard placement is per-nibble, not per-byte:** each 2-character byte group independently allows *either* character position to be a hex digit *or* a wildcard character. A single wildcard character within a 2-character group is a **nibble** wildcard (interpreted as "any hex value 0-15" for that nibble) — e.g. `5x`, `6?`, `*D`.
- **A full-byte wildcard is either an isolated wildcard character surrounded by spaces, or two consecutive wildcard characters written as one byte** — e.g. standalone `x`/`?`/`*`, or `xx`/`??`/`**`.
- **Verbatim example patterns given by the wiki, showing every form together:**
  ```
  5x 48 8D 6x 24 E0
  xx 48 8D xx 24 E0
  x 48 8D x 24 E0
  005x8xxxxxE0        (fully unspaced — tokenizes as 00 5x 8x xx xx E0)
  ```

Source: [Auto Assembler:aobScan — Cheat Engine wiki](https://wiki.cheatengine.org/index.php?title=Auto_Assembler%3AaobScan), corroborated by the argument-syntax hint in Cheat Engine's own source (`autoassembler.pas`, error string `"AOBSCAN(name,11 22 33 ** 55)"`, GitHub `cheat-engine/cheat-engine`) showing the same `**`-as-wildcard convention. The exact tokenizer function within the Delphi source could not be located in the time available (the fetched excerpt cut off before the low-level byte-parsing routine); the wiki's specification, backed by concrete worked examples, is treated as sufficient and authoritative on its own — it is the canonical reference this entire CT-authoring community writes against, not a third-party guess.

## Why this is not implemented in this mission anyway

Owner decision #3 defers implementation regardless of what the research finds ("yet"). Beyond that instruction, two real reasons support waiting:

1. **This is a materially larger grammar change than `xx`/`x`.** It requires re-architecting `parse_aob`/`parse_token` from whitespace-token-based parsing to fixed-width 2-character-group parsing with optional-whitespace stripping — not an additive alias, a structural change to the tokenizer.
2. **It also reveals a second, separate, previously-unknown gap this mission was not asked to address:** real CE allows `*` (and `x`, per this finding) as a **nibble**-position wildcard character (e.g. `9*`, `5x`), not only as a full-byte wildcard. SOLITH's grammar (even after this mission's `xx`/`x` full-byte addition) does not yet accept `x`/`*` in the nibble position — only `?`. Implementing continuous-hex support properly would need to solve both problems together, which is more than this mission's scope authorizes.

**Corpus count impact, not yet realized:** because this is real, legitimate CE syntax, an unknown portion of the 6,565 `malformedOther`-classified signatures in doc 48/49 are very likely **not actually malformed** — they are legitimate continuous-hex patterns that this repository's whitespace-based tokenizer cannot currently parse. This is flagged as a real, evidence-backed overcount in the prior "malformed" figures, not corrected by re-classifying them here (that would require implementing the tokenizer change first).

## Recommendation for a future, separately-authorized mission

1. Re-architect `parse_aob` to tokenize in fixed 2-character groups after stripping whitespace, rather than splitting on whitespace.
2. Extend nibble-wildcard detection to accept `x`/`X`/`*` in the nibble position (currently only `?` is recognized), backed by this same wiki citation.
3. Re-run doc 48's corpus classification against the corrected tokenizer to get an honest, corrected "true malformed" count once continuous-hex and nibble-`x`/`*` patterns are properly recognized instead of bucketed as malformed.

None of this is performed in this mission, per owner decision #3.
