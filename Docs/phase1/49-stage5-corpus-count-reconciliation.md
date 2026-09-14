# Phase 1 / Stage 5.3 — Corpus Count Reconciliation

## Outcome, stated up front

**Not reconciled exactly.** Real, substantive investigation was performed (compiler source code inspection, complete git history review of every relevant file, a full fresh re-extraction of the hash-verified archive). It rules out the two most obvious explanations — a different corpus, and a code change since the certifying run — but does not produce a signature-by-signature account of the 8,778 gap. This is reported honestly rather than forced into a false resolution, per this mission's own "if one figure is wrong, prove why; if they count different concepts, rename them" framing: neither branch could be fully proven, so both numbers are kept, precisely labeled, with the investigation's real findings attached.

## The two pipelines involved

`personal-ct-library.summary.json` (2026-09-09T18:12:39.476Z, the historical/certified figures) is produced by `compileCtLibraryArchive` (`src/core/ct-library/write-library.ts`), which internally calls `compileCtZipArchive` (`src/core/registry/compile-ct-zip.ts`) — the exact per-table compiler that also uses `extractCheatTableRawScriptCatalog` + `extractAOBsFromCatalog` (`src/core/script-research/`). This session's Stage 5.2/5.3 fresh extraction calls those same two extraction functions **directly**, bypassing `compileCtZipArchive`'s own wrapper (its `maxCtBytes` per-file size cap, `maxArchiveBytes` 250 MB whole-archive cap — which the real 343 MB archive exceeds by default, meaning whatever produced the September run must have passed a larger override — and its zip-entry-path validation). This is a real, acknowledged methodology difference, addressed below.

## Ruling out "different corpus" (mission's own premise)

`Combined-CheatEngine-Tables.zip`'s SHA-256 was independently recomputed this session: `c7bc553387fe8c7b25c170fec3a89724be9ecd266f25f9eb467acd0a5e1ac9d7` — byte-for-byte identical to the hash recorded inside **both** the July 20 index and the September 9 summary's own metadata (each computed fresh, from the archive's actual bytes, at its own run time). Three independent hash computations, at three different times, all agree. **The archive did not change.** This premise is confirmed, not assumed.

## Ruling out "code changed since the certifying run"

Full git history of every file in the extraction/compile chain (`compile-ct-zip.ts`, `compile-ct-registry.ts`, `aob-parser.ts`, `ct-script-research.ts`, `write-library.ts`, `ct-library/index.ts`) was reviewed in the default `SOLITH` worktree, read-only:

| Commit | Date | Relevance |
|---|---|---|
| `e0593be`…`428f1a0` (7 commits) | 2026-07-19 – 07-22 | Built the pipeline; all predate the July 20 `personal-ct-catalog.index.json` snapshot or land within the same week |
| `9163da1` "fix: close Findings 1-5…" | 2026-08-21 | Only touched `ct-script-research.ts` (+16 lines): raised the XML nesting-depth limit 32→256 after finding it silently rejected real deeply-nested `.CT` content. **Predates** the September 9 run. |
| `cc7ce16` "preserve: capture gate2-5…" | 2026-09-12 | Touched `compile-ct-zip.ts` (+13 lines, adding a purely cosmetic `versionHint` display field) and `ct-library/index.ts` (+1 export line). **Postdates** the September 9 run, but the diff is inert with respect to counting/parsing/rejection logic — confirmed by direct read of the full diff. |

**No commit in this entire window changes file-acceptance, size caps, the `.ct$` filename filter, duplicate handling, or `normalizeAobPattern`'s token grammar.** The code that ran on September 9 and the code this session ran today are functionally identical for counting purposes. This rules out code drift as an explanation for the September-vs-fresh gap (it does **not** rule out code drift for the earlier July-vs-September gap, where the July run predates the August 21 depth-limit fix — but that fix moves counts in a direction inconsistent with what would be needed to explain the July/September gap either, per the count table below, so it is not the answer there either).

## Count table

| Field | Historical (Sept 9, `personal-ct-library.summary.json`) | Fresh (this session, full re-extraction) |
|---|---|---|
| RAW CT FILES | 23,953 | 22,981 |
| PARSED CT FILES | 20,865 (`compiledTables`) | 19,895 |
| REJECTED CT FILES | 3,088 | 3,086 |
| COMPILED TABLES | 20,865 | 19,895 |
| CHEAT ENTRIES | 713,349 | not measured this pass (script scoped to script/AOB extraction only — pointer/cheat aggregation was out of scope for this recovery; see "What this reconciliation does not cover" below) |
| POINTER ENTRIES | 442,602 | not measured this pass |
| SCRIPT ENTRIES | 150,502 | 134,876 |
| RAW AOB OCCURRENCES | 120,245 | 111,467 |
| NORMALIZED AOB OCCURRENCES | not broken out at this level in the historical artifact | 111,467 (every extracted signature is run through `normalizeAobPattern` regardless of validity) |
| VALID AOB OCCURRENCES | not broken out at this level in the historical artifact | 103,820 |
| INVALID AOB OCCURRENCES | not broken out at this level in the historical artifact | 7,647 |
| UNIQUE NORMALIZED AOBS | not broken out at this level | 14,015 |
| DUPLICATE AOB OCCURRENCES (cross-corpus) | not broken out at this level | 97,452 |
| DUPLICATE AOB OCCURRENCES (pipeline's own per-catalog dedup marking, `duplicateSignatures`) | not summed at the top level | 3,111 — **a different, narrower concept than the row above; not collapsed into it** (mission's own instruction). The pipeline's own dedup only flags a duplicate when a *different symbol* reuses an identical pattern within the *same CT file's own script catalog*; it does not compare across different files, which is what the 97,452 cross-corpus figure measures. |
| AOBSCAN (bare) | not broken out at this level | 56,814 |
| AOBSCANMODULE | not broken out at this level | 53,613 |
| AOBSCANREGION | not tracked historically | 1,040 |

**Why the historical artifact lacks most of these breakdowns:** `personal-ct-library.summary.json` only ever persisted `totals` (the six top-level sums) and a per-game roll-up (`tableCount`/`cheatCount`/`pointerCount`/`scriptCount`/`aobSignatureCount`) — it never recorded a corpus-wide completeness/scanType/duplicate breakdown. That granularity only exists in the per-table `metadata` inside the shard files, and — as Stage 5.2 already found and re-confirms here — only ~6,789 of the certified corpus's signatures retain that per-signature metadata at all; the rest are lightweight (id/name/kind only). This is a real, structural limit of the historical artifact itself, not a gap in this investigation.

**Additional, separately-unresolved inconsistency found in the historical artifact itself:** summing `personal-ct-library.summary.json`'s own 746 per-game `aobSignatureCount` values yields 118,323, not the artifact's own stated top-level total of 120,245 — a 1,922 internal discrepancy inside the single historical artifact, independent of anything this session did. Not resolved; reported as found.

## Diffing the 8,778 gap (mandatory, best-available)

No per-signature list exists for the historical 120,245 run — only its aggregate total, plus the internally-partial 118,323 per-game sum. A true signature-by-signature diff against the fresh 111,467 is **not possible** with available evidence. What follows is the most honest classification achievable:

| Reason | Count | Confidence |
|---|---|---|
| Raw-file-count difference (23,953 vs 22,981 = 972 files not present in this session's fresh count of the same archive) | 972 files, proportionally ≈4,714 AOB signatures at this corpus's own measured 4.85 AOB/file average | **Estimate, not verified** — the mechanism producing this file-count difference could not be identified (see below) |
| `xx`/`x`/`XX`/`X` alternate wildcard notation | 16,392 token occurrences (real, exact, from the fresh 111,467-signature set) | **Exact, but NOT part of the 8,778 gap** — these signatures are already inside the 111,467 figure; they were previously misclassified `invalid` and are reclassified `valid`/`supported` by this mission's grammar change (doc 50), not additional missing signatures |
| Nibble wildcard (`A?`/`?A`) | 426 (exact) | **Exact, also NOT part of the 8,778 gap** — already inside 111,467, unchanged status (already SOLITH-native-supported since Stage 5, still `invalid` per the legacy TS pipeline) |
| Continuous/unspaced hex, real CE syntax (doc 51) | Present among the 6,565 `malformedOther`-classified signatures (exact sub-count not separately re-run this pass; qualitatively confirmed dominant in the top-malformed-token list — many 20-70+ character continuous hex/wildcard runs) | **Real, but not quantified separately, and NOT part of the 8,778 gap either** — also already inside 111,467, currently misclassified invalid under this session's simplistic whitespace tokenizer, likely legitimate real CE syntax per doc 51's finding |
| Duplicate | N/A to the gap — duplicates are counted identically by both pipelines (`aobReport.signatures.length` includes duplicates in both) | — |
| Unsupported directive / parser rejection / extraction bug / nested script behavior / stale-cache artifact | **Unattributed** — none could be confirmed or ruled out with available evidence | Unresolved |
| Counting-stage difference (pre- vs post-normalization) | **Ruled out** — both pipelines count `signatures.length` (raw, pre-completeness-filter) as the headline "aobSignatures" total; confirmed by direct source read | Ruled out |
| Other / genuinely unattributed remainder | ≈4,064 (8,778 − the ≈4,714 file-count-proportional estimate above) | Unresolved |

**The single largest concrete, code-confirmed difference is the raw-file-count gap (23,953 vs 22,981).** Its cause could not be established: it is not a different archive (hash-proven identical), not a code change (git-history-proven unchanged), and not explained by the other five zip archives found alongside it in `CHEAT_ENGINE_COMMUNITY_ARCHIVES\` (their combined `.ct` entry count, 11,759, does not cleanly supply an additional 972-file, 8,778-signature contribution when checked — see doc 47's archive inventory). The most likely remaining explanation, unconfirmed, is that the September 9 run's exact invocation (CLI arguments, `maxCtBytes`/`maxArchiveBytes` overrides, or working directory/environment) differed from what this recovery could reconstruct, and no log of that specific invocation survives anywhere this investigation could reach.

## What this reconciliation does not cover

Pointer and cheat totals were not re-derived this pass — Stage 5.2/5.3's recovery work scoped itself to AOB-signature extraction and grammar analysis (the actual subject of Stage 5's scanner work), not a full from-scratch re-derivation of the entire CT registry (pointers, scripts, cheats). Re-deriving those would require calling `parseCheatTableXml` per file in addition to the AOB extraction already done; not performed here to keep this investigation scoped to what Stage 5 certification actually depends on.

## Conclusion

Per this mission's own escape clause: the two figures are **renamed, not collapsed**. **CERTIFIED-RUN AOB COUNT = 120,245** (produced 2026-09-09, exact invocation unrecoverable) and **REPRODUCIBLE FRESH-EXTRACTION AOB COUNT = 111,467** (produced this session, fully reproducible against the same hash-verified archive and the same unmodified certified pipeline code) are two real, independently-computed numbers whose full reconciliation could not be completed with available evidence, after genuine investigation rather than a first-look "corpus unavailable" shrug. Stage 5's certification gate item "[ ] 120,245 vs 111,467 reconciled exactly" is **not met**.
