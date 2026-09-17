# P3-3 — Strict-Lane Remediation (identity model: roles, nesting, editions, providers, ambiguity, applicability)

**Branch.** `feature/solith-parallel-phase3-catalog-identity`, continuing from P3-2 (`Docs/phase3/002`). Still forked from certified `feature/solith-phase1-scanner-reconstruction`; still zero source-file overlap with either Phase 2 branch (verified at the end of this stage — see Final Report).

**Scope.** This stage re-audits Phase 3 under a stricter certification standard and remediates the gaps found, per an explicit instruction that Phase 3 is `ORIGINAL_PHASE_COMPLETE` under the historical standard but not yet re-certified under the new one. It does not change Phase 3's canonical Mandatory Work, Exit Gate, or Prohibited Shortcut.

## Pre-existing trainer-catalog failure — resolved, in-scope

`tests/trainer-library-persistence-lifecycle.test.ts` ("Header URL must be undefined after explicit clearing") is **inside** Phase 3's certification surface: it directly tests `trainer-catalog/store.ts`, a file this stage's own P3-1/P3-2 work already modifies. Root cause: `resolveArtworkField()`'s precedence protection (added deliberately, for a real reason — never let a low-priority incremental sync silently erase curated artwork) had no path for a genuine direct user edit to explicitly clear a field, which is what the test actually needed. Fixed with an opt-in `UpsertCatalogEntryOptions.explicitClearFields` escape hatch (all 15 existing call sites unaffected) rather than weakening the default protection. The test's `sources` fixture also used a `provider: 'manual'` value that was never a member of `ModPackSourceProvider` — invisible until now because `tsconfig.json`'s `include` is `src/**/*` only, so `tests/` is never type-checked; corrected to a real, valid shape. **`npm run test:trainer-catalog`: 169/169** (was 168/169).

## Identity model — final hierarchy

| Axis | Representation | Authoritative? |
|---|---|---|
| Game/catalog identity | `TrainerCatalogEntry.catalogGameId` | Yes — unchanged, sole authority |
| Provider | `CanonicalProvider` (provider-identity.ts), bridged from `InstallPlatform` and `ModPack.platform` | Yes, for "same real-world storefront" questions |
| Edition/variant | `detectEditionSignal()`/`groupCatalogEntriesByEdition()` (edition-signal.ts) | **No** — deliberately a signal/grouping layer only; catalogGameId stays authoritative; no schema change |
| Install identity | `InstallIdentity` (identity.ts, pre-existing, unchanged) | Yes, for "is this the same concrete install" |
| Executable identity (build/version) | BLAKE3 content hash (executable-identity/content-hash.ts) + VS_VERSIONINFO (pe-version-info.ts, new this stage) | Yes — content hash is the deterministic authority; version-info is corroborating/human-readable |
| Executable role | `ExecutableRole` (executable-role.ts) | Yes — PRIMARY_GAME/ALTERNATE_GAME/LAUNCHER/SERVER/BENCHMARK/TOOL/UPDATER/ANTI_CHEAT_BOOTSTRAP/UNKNOWN |
| Process identity | pid + matched catalogGameId (process-watcher.ts, P3-1) | Yes, for "which running process is this" |

Nothing here collapses two of these axes into one, and none of the new layers replace `catalogGameId`.

## Ambiguity resolution — exact hierarchy implemented

For an installed executable whose filename matches 2+ catalog entries (`match.ts`):
1. exact displayName match (unchanged)
2. authoritative content identity — installed executable's real SHA-256 vs. each candidate's `ModPackVersionFingerprint.executableHashPrefixes`
3. provider match — install's `InstallPlatform` bridged to the same `CanonicalProvider` as a candidate's `ModPack.platform`
4. otherwise **fail closed** — no catalogGameId, never a guess

Additionally, any match (any tier, including steamAppId) is rejected post-hoc if the install's own resolved executable classifies as a non-game role (`checkExecutableRoleApplicability`, trainer-applicability.ts) — a launcher/updater/server/benchmark/tool/anti-cheat-bootstrap is never accepted as "the game," even if it was (incorrectly) listed among a catalog entry's executables.

10 tests in `tests/install-discovery-ambiguous-match.test.ts` cover every tier plus the final fail-closed case (including two candidates sharing the same content-hash prefix, and the real default wiring against a real DB + real file).

## Nested executable discovery

`nested-executable-discovery.ts`: bounded (default depth 6), deterministic (depth-then-relative-path sorted — never dependent on filesystem enumeration order) recursive scan, replacing `install-discovery/index.ts`'s `findFirstExecutable` (renamed `resolveInstallExecutable`), which previously only checked a directory's immediate contents via `entries.find(...)`'s first filesystem-order match. A regression was caught and fixed during this stage: applying full recursion to the *library-root-level* check (as opposed to each child install directory) reached into a sibling game's nested executable and misreported it as installed at the library root — pinned to `maxDepth: 0` there, with a dedicated regression test in both the unit suite and confirmed via the pre-existing `trainer-library-preview-gates.test.ts` (which failed, then passed once fixed).

## Executable roles

`executable-role.ts`: real filename-pattern classification (launcher/updater/crash-reporter/benchmark/tool/anti-cheat/server), catalog-known-executable tie-breaking for PRIMARY_GAME vs. ALTERNATE_GAME, fails closed to UNKNOWN when 2+ game-like candidates exist with no catalog evidence. No canonical role enum existed anywhere in the codebase before this stage (checked: schema.v1, TrainerCatalogEntry, InstalledGameRecord) — the naming here is new, not a duplicate of existing terminology.

## Provider normalization

Audited for the literally-described chaos (Steam/steam/STEAM/Valve string variants) and found the real defect is structural: three independently-declared, incompatible provider unions (`InstallPlatform`, `ModPack.platform`, `bundled-community-games`'s own inline union) with no bridge between them, not casing chaos (each was already a real TS literal union). `provider-identity.ts` adds one canonical representation with explicit typed mappings from both existing unions — no persisted-schema change — plus a free-form label normalizer for the literal aliases named in the audit. Wired as a real tier-3 disambiguation signal in `match.ts`, not left unused.

## Edition/variant identity

Additive signal layer only (`edition-signal.ts`, `find-edition-groups.ts`) — detects real "... Edition"/GOTY-style keywords, groups catalog rows by resolved base title, cross-references content hash to flag likely-duplicate catalog rows. **Deliberately does not add a persisted edition/variant column or table** — that is a real, separate schema-migration decision requiring its own audit of `trainer_catalog_games`'s existing rows, indexes, and IPC contracts, which this stage does not make unilaterally. `catalogGameId` remains the sole authoritative identity; this layer never merges or collapses catalog rows itself.

## Trainer applicability

`trainer-applicability.ts`'s `checkExecutableRoleApplicability` is a standalone, read-only Phase 3 boundary — wired into `match.ts` as described above. Per this stage's explicit instruction, it does **not** touch Phase 2's `buildZeroInputAttachPlan` or any live-memory attach/pointer code; a future attach flow can call it directly. "Wrong build/version rejected via SHA-256 fingerprint mismatch" already existed (`verifyDefinitionFingerprint`, unchanged); "trainer attached to wrong edition" is addressed by the edition-signal layer being informational-only (no automatic cross-edition attachment exists to reject in the first place — editions are already separate catalogGameIds today).

## LIEF / PE-metadata capability gap — researched, partially closed

Verified (not re-guessed) that `node-lief@1.3.2` has no import/export/resource/signature API by reading its full `.d.ts`. Researched real alternatives rather than re-attempting proven-nonexistent APIs: **`resedit`/`pe-library`** (pure JS, MIT, mature, built for exactly this) reads VS_VERSIONINFO — verified end-to-end against a real Windows executable and adopted for `pe-analyzer.ts`'s `fileVersion`/`productVersion`/`companyName`/`productName` fields (Docs/phase3 commit `a637de4`). Checked `pe-library`'s own type surface for import/export tables — absent there too. Checked `authenticode` (npm) as a possible signature-verification candidate; not adopted (immature, 2 published versions, not evaluated further given no live requirement forces closing that specific gap this session). **Final status: import/export table parsing and Authenticode signature verification remain genuinely unavailable in any pure-JS library found — not solvable without a heavier native binding, out of proportionate scope for this stage. Documented, not faked.**

## Verification (this stage)

- `npx tsc --noEmit` (root): clean throughout every commit in this stage
- `npx tsc -p tsconfig.electron.json --noEmit`: clean throughout
- `npm run test:trainer-catalog`: **169/169** (pre-existing failure resolved)
- `npm run test:install-discovery`: **94/94**
- `npm run test:executable-identity`: **28/28**
- `npm run test:trainer-health`: 5/5
- `tests/trainer-research.test.ts`: 7/7 (extended with real VS_VERSIONINFO assertions)
- 8 isolated commits, each independently typechecked and tested before the next

## Phase 2 files touched

`NONE`. Re-verified at the end of this stage against the live `feature/solith-phase2-pointer-stability` worktree's current dirty files.
