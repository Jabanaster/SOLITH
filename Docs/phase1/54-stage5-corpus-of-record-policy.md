# Phase 1 / Stage 5.4 — Corpus-of-Record Policy

## Locked owner decision

Effective this mission, the reproducible corpus-of-record for all current and future Stage 5 AOB grammar-coverage certification is:

**111,467 extracted AOB occurrences**, from the hash-verified archive:

```
G:\SOLITH\REFERENCE\CHEAT_ENGINE_COMMUNITY_ARCHIVES\Combined-CheatEngine-Tables.zip
SHA-256: c7bc553387fe8c7b25c170fec3a89724be9ecd266f25f9eb467acd0a5e1ac9d7
```

The historical count **120,245** is preserved, unmodified and undeleted, under the explicit status:

```
HISTORICAL_CERTIFIED_RUN_COUNT_UNRECONCILED
```

## Why 111,467 is authoritative for current certification

- The raw archive exists on disk, at a documented, stable location.
- Its SHA-256 hash is known and has been independently recomputed three times (July 20's own recorded hash, September 9's own recorded hash, and this session's fresh `sha256sum`), all three agreeing exactly (doc 47).
- That hash matches the archive the historical certifying run itself recorded as its own source.
- Extraction is fully reproducible: the exact, unmodified, certified extraction pipeline (`extractCheatTableRawScriptCatalog` + `extractAOBsFromCatalog`, `src/core/script-research/`) was re-run against the full archive this session, with zero sampling, and produces 111,467 every time.
- The exact parser/compiler code that produced this figure is available, unmodified, and reviewed in full (doc 49's git-history audit).
- Per-signature classifications exist for all 111,467 occurrences (doc 48, reanalyzed in doc 56 against the current grammar) — every one can be independently re-verified today by anyone with access to the archive.

## Why 120,245 is not the current denominator

- The September 9, 2026 run's exact producing invocation (CLI arguments, environment, any `maxCtBytes`/`maxArchiveBytes` overrides) is unrecoverable — no log or record of it survives anywhere this investigation could reach (doc 47/49).
- No per-signature output from that run survives — only its six aggregate totals persisted in `personal-ct-library.summary.json`. There is nothing to re-verify against.
- Repeated, genuine forensic reconstruction attempts (Stage 5.2's initial recovery, Stage 5.3's git-history and archive-inventory investigation, doc 49) could not reproduce it from the same hash-identical archive using the same unmodified pipeline code.
- Using an unreproducible number as a certification denominator would make the certification itself non-reproducible — the opposite of what a certification is supposed to guarantee.

120,245 is not described as "wrong" anywhere in this evidence trail. It is a real number produced by a real historical run; its exact provenance is simply unrecoverable today. It remains preserved, permanently, as `HISTORICAL_CERTIFIED_RUN_COUNT_UNRECONCILED`.

## Non-authoritative estimates

Doc 49's prior ≈4,714 / ≈4,064 proportional estimates for the unreconciled 8,778-signature gap are forensic arithmetic only, never independently verified. Per this mission's explicit instruction, they are not used anywhere in this mission's certification totals, grammar coverage, defect closure, or corpus-of-record counts, and doc 49 has been updated to label them explicitly `NON-AUTHORITATIVE FORENSIC ESTIMATE` wherever they still appear for historical-trail completeness. No new estimate is introduced by this mission.

## Effect on prior documents

Docs 39, 46, 47, 48, and 53 have each been updated with a short pointer noting that 120,245 is preserved as historical evidence only, and that this document (54) is the authoritative current corpus-of-record policy. None of those documents' prior findings are retracted — the historical investigation record stands as written.
