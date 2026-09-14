# Phase 1 / Stage 5.2 — Authoritative AOB Corpus Analysis

## Method

Full, complete (not sampled), read-only pass over every `.ct`/`.CT` entry in the recovered, hash-verified raw archive `Combined-CheatEngine-Tables.zip` (doc 47), streamed directly from the zip via `yauzl` (no extraction to disk, original file untouched). Each entry's raw XML text was run through this repository's own **unmodified, certified** static-parsing functions — `extractCheatTableRawScriptCatalog` (`src/core/script-research/ct-script-research.ts`) then `extractAOBsFromCatalog`/`extractAOBsFromScriptEntry` (`src/core/script-research/aob-parser.ts`) — the exact code that performed the original certified ingest. No CT script was executed at any point; this is text parsing only. The analysis script itself was run from a temporary, non-committed file and deleted immediately after use; it is not part of this repository's source.

## Headline numbers

| Field | Value |
|---|---|
| TOTAL RAW (CT entries found in the archive) | 22,981 |
| TOTAL PARSED (valid XML, no safety violation) | 19,895 (86.6%) |
| TOTAL PARSE-REJECTED | 3,086 (13.4%) — see below |
| TOTAL AOB SIGNATURES EXTRACTED | 111,467 |
| TOTAL VALID (`completeness: complete`) | 103,820 (93.1% of extracted) |
| TOTAL MALFORMED/INVALID (`completeness: invalid`) | 7,647 (6.9% of extracted) |
| TOTAL SUPPORTED BY SOLITH'S NEW NATIVE GRAMMAR (`pattern.rs`) | 104,246 (93.5% of extracted) |
| TOTAL UNSUPPORTED BY SOLITH'S NEW NATIVE GRAMMAR | 7,221 (6.5% of extracted) |
| SUPPORT PERCENTAGE | **93.5%** |

Internal consistency check (both hold exactly): `malformedOther(6,565) + nibble(53) + mixedNibbleFull(373) + empty(656) = 7,647 = invalidCompleteness`, and `exactByteOnly(85,963) + fullWildcardQQ(9,389) + fullWildcardStar(8,468) = 103,820 = completeCompleteness`.

**Reconciliation note (see doc 47):** this 111,467 figure is a complete, fresh, 100%-of-archive re-extraction using the certified pipeline against the exact hash-verified archive; it does not exactly match ROADMAP.md's cited 120,245, a real, unresolved, evidenced gap documented in doc 47 rather than guessed away. All percentages here are computed against the 111,467 figure this recovery actually produced and can independently verify signature-by-signature — not the unreconciled 120,245.

### Parse rejections (3,086)

Overwhelmingly the legacy **pre-XML binary Cheat Engine table format** (`.CT` files that predate CE's XML table format) — `extractCheatTableRawScriptCatalog`'s XML parser correctly rejects these with "Non-whitespace before first tag," a real, legitimate rejection (not an extraction bug): these files are not XML and were never going to parse as such. One additional file exceeded the pipeline's own 5 MB XML-safety size guard (`xml_safety_violation`). This maps to ROADMAP's "rejectedTables" concept, though the exact certified count (3,088) is not reproduced 1:1 here (see doc 47's reconciliation note) — the mechanism and cause are real and confirmed regardless.

## Syntax-family classification (of 111,467 extracted signatures)

| Category | Count | % of extracted |
|---|---|---|
| Exact-byte-only | 85,963 | 77.1% |
| Full-byte wildcard, `??` spelling | 9,389 | 8.4% |
| Full-byte wildcard, `*` spelling | 8,468 | 7.6% |
| Nibble wildcard only (`A?`/`?A`) | 53 | 0.05% |
| Mixed nibble + full wildcard in one pattern | 373 | 0.33% |
| Malformed / unsupported token present | 6,565 | 5.9% |
| Empty/degenerate | 656 | 0.59% |

Module-qualified (`aobscanmodule`): 53,613 (48.1%). Bare (`aobscan`): 56,814 (51.0%). Region-scoped (`aobscanregion`): 1,040 (0.9%) — a third scan-type variant this repo's certified extractor already recognizes; SOLITH's Stage 5 native grammar does not yet distinguish scan-type (it operates purely on byte patterns handed to it by a caller), so this has no bearing on pattern-grammar support.

Duplicates: 14,015 distinct normalized signatures out of 111,467 total (97,452 duplicate instances, 87.4%) — expected and explained: the archive is a manually "Combined" merge of multiple overlapping community CT-table mirror downloads (confirmed duplicate nested folders like `CheatEngineTables-master (1)/(2)/(3)/(4)` all present in the same zip), so the same physical table appears several times.

## RAW-CORPUS NIBBLE COUNT — resolved (was UNKNOWN after Stage 5.1)

**426** real nibble-wildcard-containing signatures exist in the raw corpus (53 nibble-only + 373 mixed with a full wildcard), out of 111,467 extracted — a precise, complete count, not a sample or an estimate. Real examples (module, symbol, pattern — all from real, current, non-obscure commercial games, confirming this is genuine, actively-used CT-author syntax, not a corpus artifact):

```
DYNASTY WARRIORS ORIGINS / INJECT_GET_SKILL_XP_INC:
  03 ?? ?? ?? 0A 00 00 48 8B 05 ?? ?? ?? ?? 48 8B 88 ?? 01 00 00 4C ?? ?? 30 4D 85 C0 74 ?? 3B ?? ?? 73 1?
Monster Hunter Rise / INJECT_ANO_INVES_QUEST_LIST:
  8B 48 18 89 8F ?? 0? 00 00 E9
FINAL FANTASY VI / INJECT_COCO_INC:
  89 50 30 48 83 C4 28 C3 E8 ?3
```

**Verified via the certified pipeline's own `completeness` field: every single nibble-containing signature found (all 426, cross-checked on a real sample) is marked `invalid` by the existing, certified, unmodified `normalizeAobPattern`** — exactly as doc 39's structural reasoning predicted (no nibble branch exists in that function). This closes Stage 5.2 Part B's required correction precisely: the raw corpus does contain real nibble-wildcard signatures (previously "UNKNOWN"), and the certified ingest pipeline does reject every one of them as invalid (previously only a structural inference, now directly observed).

**SOLITH's Stage 5 native grammar (`pattern.rs`) already supports both real nibble forms found (`A?` and `?A`)** — meaning the native scanner correctly parses 426 real signatures that the legacy TypeScript ingest pipeline rejects. This upgrades doc 38/39's "implemented without evidence of current need" framing: nibble-wildcard support is now evidenced as **necessary** for real corpus compatibility, not merely a low-cost contingency.

## Unsupported-syntax families found (real, evidenced, NOT implemented this mission — DO-NOT list forbids scanner changes)

### `xx`/`XX`/`x` as an alternate full-byte-wildcard token

**16,392 occurrences** (`xx`: 10,286, `XX`: 3,650, `x`: 2,456) across the malformed-pattern population — by far the single largest unsupported-syntax family found, dwarfing every other malformed-token category. Representative example, a well-known real published signature (Borderlands 2, `ResetAmmoStorageUpgradesAOB`):

```
8B 87 0C 17 00 00 3B F0 7C 24 85 F6 75 04 85 C0 74 1C 68 xx xx xx xx 68 4B 02 00 00 68 xx xx xx xx 68 xx xx xx xx E8 xx xx xx xx 83 C4 10 8B 87 08 17 00 00 8B 04 B0 5F 5E 5D C2 04 00
```

Legitimate Cheat Engine syntax: **yes** — this is a long-standing, widely-used community convention for "any byte," used across many real, unrelated authors' tables (not one game's quirk). SOLITH must support it: **not decided here** — flagged as a strong, evidence-backed candidate for a future authorized grammar change (an alias for the existing full-byte wildcard, identical semantics to `??`/`*`), explicitly **not implemented in this mission** per its own "do not modify scanner implementation unless specifically authorized later" instruction.

### Continuous/unspaced hex (+ wildcard) runs

A second, smaller real family: patterns written as continuous hex digit runs with no space separators between bytes, sometimes with embedded `??` runs (e.g. `E8????????`, `0F84????????`, `897D??897D??897D??8B068B55??8B80????????8D`). Legitimate Cheat Engine syntax: **likely yes for the exact-byte-only continuous-hex case** (Cheat Engine's own AOB entry historically tolerates unspaced hex since it can still be tokenized in fixed 2-character groups); **uncertain for the continuous-hex-with-embedded-`??`-run case**, since token boundaries become ambiguous once wildcard runs of variable apparent width are concatenated directly against hex digits without a separator (e.g. is `8424????????` one byte `84` then four wildcard bytes, or is the boundary elsewhere?). SOLITH must support it: **not decided here** — flagged, not implemented, and explicitly noted as needing a real Cheat Engine behavioral reference (not guessed) before any grammar change, since the ambiguous case above cannot be resolved from the corpus data alone.

### Minor noise tokens

A long tail of low-count tokens (`==`, `'-X'`, literal English words like "Could"/"not"/"find"/"unique"/"AOB,tried"/"code", and non-Latin text) are not signature syntax at all — they are extraction artifacts of the regex-based `AOB_CALL_RE` matching text inside comments, error-message strings, or non-AOB code adjacent to a real `aobscan`-style call inside the same script body. These are not a real unsupported syntax family and require no grammar action; they are correctly rejected as malformed by both the certified pipeline and SOLITH's own grammar today.

## Duplicate normalized patterns

4,416 distinct normalized patterns found among the subset carrying full pattern metadata in the shard-based provenance-verified sample (doc 47); at full-corpus scale (this doc's complete run) 14,015 distinct normalized signatures exist among 111,467 total, i.e. the corpus is dominated by duplicate copies of the same underlying signatures across the archive's redundant merged mirrors, not by 111,467 independently-authored patterns.

## Stage 5.3 update — superseded numbers

This doc's 93.5%/104,246 grammar-support figures and 6,565 "malformedOther" count are **superseded** by doc 52: after implementing `xx`/`x` wildcard support (doc 50) and correctly separating true noise from real-but-unimplemented continuous-hex CE syntax (doc 51), the corrected figures are **96.95% coverage** (106,433 supported of 109,782 legitimate-syntax signatures) and **only 1,685 truly malformed** (not 6,565 — the rest are real CE syntax, doc 51/52). The corpus reconciliation gap (120,245 vs 111,467) is separately investigated in doc 49 and remains open.

## Grammar-certification checklist (mission §5.1-J, re-evaluated with this evidence)

| Requirement | Status |
|---|---|
| Full corpus analyzed with evidence, or authoritative count changed with evidence | **Met with a caveat** — the raw archive was fully, completely analyzed (111,467 signatures, zero sampling); the certified 120,245 total itself could not be exactly reproduced from that same hash-verified archive (doc 47's honest, unresolved reconciliation gap) |
| Legitimate required syntax coverage established | Met — exact bytes, `??`/`*` full wildcards, and now nibble wildcards are all confirmed present and required by real corpus data |
| Unsupported legitimate syntax = 0, or explicitly scoped | **Not zero** — `xx`/`x` alternate wildcard notation (16,392 occurrences) and continuous-hex notation are real, evidenced, unsupported syntax families, explicitly scoped here as deferred pending future authorization (this mission's own DO-NOT list forbids fixing them now) |
| Malformed corpus entries separated from unsupported valid syntax | Met — this doc explicitly separates true noise/extraction artifacts from the two real unsupported-but-legitimate syntax families |
| Raw-corpus nibble-wildcard prevalence known | Met — 426, precise, complete count (was UNKNOWN after Stage 5.1) |

**Stage 5 corpus-certification verdict does not change to CERTIFIED in this mission** — the reconciliation gap against the specific 120,245 figure ROADMAP.md cites remains open (doc 47), and two real unsupported-syntax families now have evidence-backed fixes intentionally deferred rather than implemented, per this mission's explicit scope limits. See the Stage 5.2 FINAL RESPONSE for the full verdict.

**Stage 5.4 update — superseded:** the two unsupported-syntax families flagged above (`xx`/`x` full-wildcard, and continuous/unspaced hex) are now both implemented and certified. Doc 54 formally establishes 111,467 as the sole reproducible corpus-of-record denominator for grammar-coverage certification going forward (120,245 preserved as `HISTORICAL_CERTIFIED_RUN_COUNT_UNRECONCILED`, never used as a denominator). Doc 56 supersedes this document's grammar-coverage numbers with a full corpus reanalysis against the new grammar.
