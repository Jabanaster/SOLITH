# Phase 1 / Stage 5 — CT AOB Corpus Pattern Analysis

## Scope limit, stated up front

The 120,245-signature compiled CT corpus ROADMAP.md cites (`CT parsing/ingest | CERTIFIED | ... 120,245 AOBs, live-verified`) is user-local CT-library data, ingested in a prior real session on the machine that produced that certification. **It is not a file committed to this git repository** — this worktree contains no `registry.json`/corpus snapshot with the actual 120,245 parsed signatures. Confirmed by search: no file anywhere in this repository (tracked or in `Docs/`) contains the literal count `713,349` (the certified cheat count from the same ROADMAP line) or any corpus-data artifact under a `registry`/`corpus` name. This is a real, honest data-availability limit — the same category of limit this project has already documented transparently elsewhere (Stage 4 doc 30's PID-reuse-forcing limit, doc 35's long-path issue) — not a shortcut taken to avoid the analysis.

Per the mission's own instruction ("Use existing parsed/compiled metadata where available. Do not execute arbitrary CT scripts for this analysis."), this analysis instead uses the metadata that **is** available and audited in this repository: the real, already-certified CT AOB *extraction pipeline itself* (`src/core/script-research/aob-parser.ts`) and its real test corpus (`tests/aob-parser.test.ts`) — the exact code path that produced the 120,245-signature certification in the first place.

## What the existing, certified pipeline's own grammar recognizes

`normalizeAobPattern` (the function every one of the 120,245 real signatures was normalized through during the certified ingest) recognizes exactly three token shapes:

```ts
if (/^[0-9a-fA-F]{2}$/.test(token)) return token.toUpperCase();  // exact byte
if (/^\?+$/.test(token)) return '??';                             // full-byte wildcard (any run of '?')
if (/^\*+$/.test(token)) return '*';                              // full-byte wildcard (any run of '*')
// anything else: warnings.push(`Invalid AOB token "${token}".`)   // marks the signature 'invalid'
```

There is **no nibble-wildcard branch anywhere in this function**. Any real script signature using `A?`/`?F`-style nibble syntax would have hit the `Invalid AOB token` branch during the certified ingest and been marked `completeness: 'invalid'` in that run's own extraction report.

## Real sample evidence (from this repo's own certified test corpus)

`tests/aob-parser.test.ts` exercises the parser against a real, verbatim Cheat Engine script excerpt from an actual game's real CT table (Avowed — the same game ROADMAP's own certification/backup evidence references elsewhere, e.g. `tests/backups/avowed-wingdk.test.ts`):

```
aobscanmodule(playerHealth,Avowed-Win64-Shipping.exe,48 8B ?? * 89 45 F8)
```

This single real signature already exercises: exact bytes (`48`, `8B`, `89`, `45`, `F8`), the `??` full-byte-wildcard spelling, and the `*` full-byte-wildcard spelling — in the same 8-token pattern. A second real test case (`aobscan(globalThing,AA BB ?? CC)` / `aobscanmodule(badThing,Game.exe,AA ZZ)`) demonstrates the pipeline's own invalid-token handling (`ZZ` → `Invalid AOB token "ZZ"` → `completeness: 'invalid'`) — proving the *mechanism* that would have caught a nibble-wildcard signature had one existed in the certified corpus.

## Findings

| Category | Finding |
|---|---|
| Exact-byte-only patterns | Present (every real signature includes at least one) |
| Full-byte wildcard patterns | Present, in both `??` and `*` spellings — the existing pipeline's own tolerance for either |
| Nibble wildcard patterns | **Zero occurrences found** — no such syntax exists anywhere in this repo's own certified parser grammar or its real test corpus; a nibble-wildcard token would have been rejected as `Invalid AOB token` by the exact code path that produced the 120,245-signature certification |
| Unusual syntax | None found beyond the `??`/`*` wildcard-alias tolerance already documented in the parser itself |
| Module-qualified patterns | Present — `aobscanmodule(symbol, module, pattern)` is a first-class, already-parsed case (`parsed.module`) |
| Script-embedded patterns | All samples are embedded in real Cheat Engine Auto Assembler script bodies (`[ENABLE]`/`label`/`registersymbol` context), not bare signature lists — matching real-world CT table structure |
| Malformed patterns | Handled explicitly and already tested (`AA ZZ` → invalid) |

## Conclusion driving Stage 5's grammar decision (doc 38)

Full-byte wildcards (both spellings) and exact bytes are unambiguously required — directly evidenced by the real, certified corpus's own ingest pipeline and its real test samples. Nibble wildcards have **no evidence of necessity** from this repository's own audited data, but were implemented anyway (doc 38) because the marginal engineering cost is near-zero given `PatternByte`'s existing mask/value design — an honest "implemented without evidence of current need, for compatibility" status, not an overclaim of corpus support.

**Stage 5.3 update:** nibble-wildcard necessity is now evidenced, not merely a contingency (doc 48: 426 real occurrences). A third full-wildcard spelling, `xx`/`x` (case-insensitive), was also found (16,392 real occurrences, doc 48) and is now implemented (doc 50). Real, official Cheat Engine documentation (doc 51) additionally reveals continuous/unspaced hex notation and `x`/`*`-as-nibble-wildcard as further legitimate CE syntax, not yet implemented pending separate authorization.

## Stage 5.1 — exhaustive corpus-recovery search (repeat, read-only)

Stage 5.1's mission required a second, exhaustive attempt to recover the real 120,245-signature corpus before accepting this scope limit as final. The following locations were searched, read-only, with no CT scripts executed and no corpus data mutated:

- This worktree's tracked and untracked files, including `data/` (contains only `trainer-catalog-seed.json`) and every `.gitignore`d path pattern.
- Every local and remote-tracking branch/ref in this repository (91 refs, enumerated via `git branch -a`), via `git ls-tree -r` per ref, for any `registry`/`corpus`/`SOLITH_PHASE0_EVIDENCE` path.
- The three preserved refs the mission named by name: `preserve/ct-selective-import-2026-09-12`, `preserve/review-gate2-5-working-tree-2026-09-12`, `review/gate2-5-doc-audit` — inspected via `git ls-tree`/`git show`, not merged. `preserve/ct-selective-import-2026-09-12`'s own registered worktree (`solith-ct-import-phase2`) contains exactly one real `.CT` file (`fixtures/community-ct/CrimsonDesert.CT`), not a 23,953-file corpus.
- Dangling/unreachable git objects (`git fsck --unreachable --dangling`) — every dangling commit's tree was checked for a `SOLITH_PHASE0_EVIDENCE`-named path; none found.
- The exact citation trail ROADMAP.md itself gives for its own certified figures: `> **Reconstruction evidence.** 38-step-0.14-roadmap-source-reconciliation.md, 39-step-0.14-roadmap-consistency-audit.md, 40-step-0.14-final-roadmap-certification.md in SOLITH_PHASE0_EVIDENCE/2026-09-12/`. This directory does not exist anywhere in this repository's git history (any ref) and was not found on local disk under this worktree.
- The registry-compilation tooling's own declared output path (`scripts/compile-ct-registry.mjs` defaults to `data/registry/Avowed_Master_Registry.json`, a single-CT-file, single-game compile) — that path does not exist on disk in any worktree checked, and by its own design compiles one CT file at a time, not a 23,953-file corpus in one artifact.
- Common real-world CT-library locations on the local machine (Desktop, Downloads) — found exactly one real, single CT file (`Downloads/Avowed-Win64-Shipping.CT`), not a corpus.

**Conclusion: the full 120,245-signature corpus and the `SOLITH_PHASE0_EVIDENCE/2026-09-12/` artifact trail that certified it are genuinely unavailable in this repository and on this machine's accessible, documented locations.** This is not a new limit — it is the same limit this doc already reported, now confirmed by a second, exhaustive, read-only pass rather than accepted on the first search alone. Per the mission's own instruction, Stage 5 corpus certification (mission §5.1-J's first checklist item) **cannot be marked complete** on this evidence; see doc 46 for the certification-repair verdict.

## Structural finding on nibble wildcards (Stage 5.1) — corrected Stage 5.2

Re-examining `normalizeAobPattern`'s three-branch grammar (quoted above): because this is the *exact, unmodified function* that performed the certified ingest, and because it has no nibble-wildcard branch at all, any nibble-wildcard token presented to it would have hit the `Invalid AOB token` branch and been marked `completeness: 'invalid'` rather than surviving into the certified, normalized 120,245-signature output as a *supported, compiled* entry.

**Correction (Stage 5.2, per that mission's explicit instruction):** Stage 5.1's prior wording overstated this. What the evidence above proves is only that **zero nibble-wildcard signatures could have survived that normalization path as supported compiled entries** — it does **not** prove that zero nibble-wildcard signatures existed in the original *raw* CT corpus before normalization discarded/flagged them as invalid.

**Update — resolved, not just corrected (Stage 5.2 recovery, doc 47/48):** the raw corpus was subsequently recovered and fully analyzed. **RAW-CORPUS NIBBLE COUNT = 426** (53 nibble-only + 373 mixed with a full wildcard), out of 111,467 real extracted signatures — a precise, complete, non-sampled count, no longer unknown. Every one of them is independently confirmed marked `completeness: invalid` by this exact, unmodified `normalizeAobPattern`, exactly as this section's structural reasoning predicted. See doc 48 for the full analysis and real examples from current commercial games (DYNASTY WARRIORS ORIGINS, Monster Hunter Rise, FINAL FANTASY VI, and others).

## What this analysis does not prove

It does not produce an exact per-signature-type count across the real 120,245-signature corpus (e.g., "N% are exact-byte-only") — that would require the actual corpus data, which is not present in this repository. Any such percentage would be fabricated. What it does prove, from real and audited in-repo evidence, is the *syntax vocabulary* the corpus's own certified ingest pipeline recognizes and has been exercised against with a real sample from an actual game's CT table.
