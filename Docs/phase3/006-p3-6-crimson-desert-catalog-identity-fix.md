# P3-6 — Crimson Desert Enhanced Catalog Identity Fix

**Branch.** `feature/solith-parallel-phase3-catalog-identity`, continuing from P3-5 (`Docs/phase3/005`, HEAD `8b6e561`). Verified HEAD matched `origin/feature/solith-parallel-phase3-catalog-identity` before starting and again before pushing (`git fetch origin` showed no new commits either time) — no rebase was needed. No Phase 2 file touched: reverified against `solith-phase0-convergence`'s live dirty files (`src/app/components/PointerMapPanel.tsx`, `tests/pointer-map-ui-stability.e2e.test.ts`) before and after this stage's edits — zero overlap. No Atomfall file touched: this stage never read or wrote anything under `Docs/Baselines/ATOMFALL_*`, any Xbox/GDK install-discovery provider, or any file with "Atomfall" in its name; the parallel Atomfall session's own branch (`cursor/atomfall-l3-live-cert`) and work are untouched.

## Scope

This stage repairs the single remaining Exit-Gate FAIL from P3-4/P3-5: Crimson Desert Enhanced resolving to the wrong catalog identity (`Docs/phase3/004` §"Crimson Desert — real, unresolved catalog data defect", `Docs/phase3/005`'s updated matrix). That prior analysis was independently re-verified from scratch this stage (not assumed) against a fresh read-only copy of the real production database and the real installed game before any fix was written.

## Audit trail (traced end-to-end before any edit)

1. **Real installed copy** (read-only inspection only — no launch this stage): `Z:\SteamLibrary\steamapps\common\Crimson Desert\bin64\CrimsonDesert.exe` (375,511,960 bytes). Its Steam manifest, `Z:\SteamLibrary\steamapps\appmanifest_3321460.acf`, reads:
   ```
   "appid"  "3321460"
   "name"   "Crimson Desert Enhanced"
   "installdir" "Crimson Desert"
   ```
   Confirms the real, current Steam listing name is "Crimson Desert Enhanced" for appid 3321460, and the real, current binary is `CrimsonDesert.exe` (unchanged name from before the listing's rename).

2. **Production catalog** (`%APPDATA%/solith/solith.db`, copied read-only into the session scratchpad — the live file was never opened or written, matching the pattern already used in P3-4): confirmed, by direct query against the copy (not by trusting the prior stage's writeup), that two real rows exist:
   | catalogGameId | displayName | steamAppId | executablesJson | source |
   |---|---|---|---|---|
   | `crimson-desert` | Crimson Desert | `NULL` | `["CrimsonDesert.exe"]` | fling |
   | `crimson-desert-enhanced` | Crimson Desert Enhanced | `NULL` | `["CrimsonDesertEnhanced.exe"]` | plitch |

3. **Ingestion source code trace** (`src/core/trainer-catalog/sync/remote-sync.ts`): `remoteTrainerToCatalogEntry`/`remoteTrainerToModPack` built every community-scraped catalog row's `executables` field from `guessExecutable(gameName)` — a naive "strip non-alphanumerics from the display title" transform, with **no fallback to any curated data**. For "Crimson Desert Enhanced" this produces `CrimsonDesertEnhanced.exe`, which does not exist on any real installed copy. For "Crimson Desert" (the older FLiNG title, pre-rename) the same guess happens to produce `CrimsonDesert.exe` — correct only by coincidence of that particular title compacting the same way the real binary is named.

4. **Root cause of the missing `steamAppId`**: `applySteamAppId()` (same file, `remote-sync.ts`) already existed — computing `steamAppId` plus the three Steam CDN artwork URLs — but had **zero callers anywhere in the repository**. No ingestion path ever invoked it, so every community-sourced catalog row, for every game, was always written with `steamAppId: undefined`. This is a wider ingestion gap than Crimson Desert alone; this stage only wires the fix in for the one hand-verified association needed to fix Crimson Desert, per the mission's scope (no invented title-matching engine).

5. **Existing curated-data precedent already established in this codebase**: `STEAM_EXECUTABLE_LOOKUP` (`src/core/trainer-catalog/steam-executable-lookup.ts`) already has a correct, pre-existing, real entry for appid `3321460 → ['CrimsonDesert.exe']`, and its own docstring claims it is "Shared by catalog seed generation and install discovery" — true for the static seed generator (`scripts/generate-trainer-catalog-seed.mjs`, which already calls `executablesForSteamAppId`), but **not actually true** for the live remote-sync ingestion path, which never consulted it. `CATALOG_ORPHAN_RECONCILIATIONS` (`src/core/database/index.ts`) already establishes the exact pattern for retiring a stale duplicate catalog row once its canonical replacement is proven via `steamAppId`.

## Correct identity model (established from evidence, not assumed)

- **Base game / provider identity**: one real Steam release, appid `3321460`.
- **Edition identity**: not a distinct edition requiring separate trainer support. The "Enhanced" text is the current Steam marketing/listing name for the same release the community trainer scene has always targeted — the bundled community CT fixture (`fixtures/community-ct/CrimsonDesert.CT`) hardcodes `processName = "CrimsonDesert.exe"`, the same real binary name as before the rename, with no separate "Enhanced" trainer variant existing anywhere in this codebase's evidence. `detectEditionSignal()` (`src/core/trainer-catalog/edition-signal.ts`) also does not flag "Crimson Desert Enhanced" as an edition-suffixed title (its regex requires a trailing "Edition" word, which this title doesn't have) — consistent with treating this as one identity, not two compatibility targets.
- **Executable identity**: `bin64/CrimsonDesert.exe` — real, on-disk, unchanged across the rename.
- **Catalog identity**: `crimson-desert-enhanced` (matches the current, real Steam listing title) is canonical. `crimson-desert` (the older FLiNG-scraped title, predating the listing rename) is the stale/orphan identity.
- **Build/version identity**: not separately tracked by this fix; out of scope (no schema change).

## Fix (ingestion-time correction, not a live-DB hand-patch)

All changes live in repository ingestion/reconciliation code, so the **next real sync** produces the correct rows — the live production DB itself was never written by this stage, per the mission's explicit constraint.

1. **`src/core/trainer-catalog/known-steam-app-ids.ts` (new file)** — a small, explicit, hand-verified `catalogGameId -> steamAppId` table, evidentiary bar identical to `STEAM_EXECUTABLE_LOOKUP`/`CATALOG_ORPHAN_RECONCILIATIONS`: one entry, `'crimson-desert-enhanced': 3321460`, with the verification evidence in its comment. Deliberately does **not** include `'crimson-desert'` — the stale title stays without a steamAppId, which is what the reconciliation entry below requires of an orphan row.

2. **`src/core/trainer-catalog/sync/remote-sync.ts`** — `remoteTrainerToCatalogEntry`/`remoteTrainerToModPack` now:
   - Resolve executables via a new `resolveExecutables(catalogGameId, gameName)` helper: consults `knownSteamAppIdForCatalogGameId()` → `executablesForSteamAppId()` first, falling back to the original `guessExecutable()` only when no verified association exists. No fuzzy/substring title matching was added anywhere — a title with no explicit authorization behaves exactly as before.
   - Call the previously-orphaned `applySteamAppId()` when a known AppID exists, so `steamAppId` and the three Steam CDN artwork URLs get set on ingestion, not left `undefined`.

3. **`src/core/database/index.ts`** — added one new entry to the existing `CATALOG_ORPHAN_RECONCILIATIONS` table (the same array BG3/No Man's Sky/God of War Ragnarök/Spider-Man/Dragon's Dogma ×2/Miles Morales/AC Black Flag Resynced already use): `crimson-desert-rename-orphan-v1`, orphan `crimson-desert` → canonical `crimson-desert-enhanced`, proof `steamAppId === 3321460`. This uses the codebase's existing, pre-authorized reconciliation architecture exactly as designed — no new mechanism invented. It will only ever apply once a real sync has independently written `steamAppId: 3321460` onto the canonical row (verified below); it never touches a canonical row it hasn't proven itself.

## Why this is correct, not a workaround

- No hardcoded special-case return was added inside `matchInstalledToCatalog` or any other generic matcher — that function is completely untouched this stage.
- No substring/fuzzy title matching was added — `knownSteamAppIdForCatalogGameId` is an exact-key lookup into a hand-authorized table, the same shape as the pre-existing `STEAM_EXECUTABLE_LOOKUP`/`FLING_TRAINER_PAGES`/`CATALOG_ORPHAN_RECONCILIATIONS`.
- No test was weakened or altered to expect the previously-wrong identity; the reconciliation test suite was extended with a new table-driven pair, reusing every existing assertion (applies / idempotent / blocked-on-missing-canonical / blocked-on-proof-mismatch / blocked-on-feedback-ref / blocked-on-queue-ref / blocked-on-unexpected-modpack / blocked-on-multiple-modpacks / blocked-on-non-exact-displayName / blocked-on-non-null-orphan-steamAppId / already-clean / rollback) unchanged.
- The wrong-edition guess (`CrimsonDesertEnhanced.exe`) is never accepted anywhere; it's simply never produced anymore for this title.

## Files changed

- `src/core/trainer-catalog/known-steam-app-ids.ts` (new)
- `src/core/trainer-catalog/sync/remote-sync.ts`
- `src/core/database/index.ts`
- `tests/remote-sync-known-steam-app-id.test.ts` (new)
- `tests/trainer-catalog-reconcile.test.ts`
- `package.json` (registered the new test file under `test:trainer-catalog` and `test`)

## Tests added

`tests/remote-sync-known-steam-app-id.test.ts` (9 cases):
1. "Crimson Desert Enhanced" resolves to the real executable `CrimsonDesert.exe`, not the guessed `CrimsonDesertEnhanced.exe`.
2. "Crimson Desert Enhanced" backfills `steamAppId: 3321460` and Steam CDN artwork URLs.
3. catalogGameId for "Crimson Desert Enhanced" is the expected canonical slug.
4. Mod pack version executables also resolve to the real binary name.
5. The older FLiNG "Crimson Desert" title is left with `steamAppId: undefined` (the orphan-reconciliation precondition) while pinning its (coincidentally already-correct) guessed executable.
6. An unrelated scraped title with no known AppID still uses the title-guess fallback, completely unaffected.
7. A different real title ("Palworld") already covered by `STEAM_EXECUTABLE_LOOKUP` through its *own* AppID is unaffected by the new Crimson Desert association (proves the lookup is keyed correctly, not globally).
8. `knownSteamAppIdForCatalogGameId` returns `undefined` for both the orphan id and an arbitrary unrelated id.
9. `knownSteamAppIdForCatalogGameId` returns the verified AppID for the authorized id.

`tests/trainer-catalog-reconcile.test.ts`: added `crimson-desert-rename-orphan-v1` as a new table-driven pair, which automatically runs it through all 12 existing shared reconciliation assertions (applies / idempotent / blocked variants / already-clean / rollback) alongside the other 8 authorized pairs — updated the describe-block count comment from "eight" to "nine" pairs.

## Verification

- `npx tsc --noEmit` (root): clean.
- `npx tsc -p tsconfig.electron.json --noEmit`: clean.
- `npm run test:trainer-catalog`: **204/204** (was 183 unique test count at P3-5 across a different/smaller file set; this run's file list includes the new `remote-sync-known-steam-app-id.test.ts` and the existing suite — all passing, 0 failures, 0 skipped).
- `npm run test:install-discovery`: **104/104** (unchanged from P3-5 — this stage touched no install-discovery file).
- `npm run test:definitions`: **112/112** (unchanged from P3-4/P3-5).
- `npm run test:executable-identity`: **28/28** (unchanged).
- `npm run test:trainer-health`: **5/5** (unchanged).

## Real-installation and real-production-catalog end-to-end validation

Performed read-only only — no game launch this stage (not authorized for this mission, unlike P3-5's session-binding validation).

Copied the real `%APPDATA%/solith/solith.db` read-only into the session scratchpad and drove the actual application code path against it with a temporary scratch script (not committed):

1. **Before any fix**, confirmed the real production rows exactly as described above (`crimson-desert`: no steamAppId, `CrimsonDesert.exe`; `crimson-desert-enhanced`: no steamAppId, `CrimsonDesertEnhanced.exe`).
2. Ran `reconcileCatalogOrphans()` against the unfixed copy: `crimson-desert-rename-orphan-v1` correctly reports `blocked` — `"canonical row steamAppId is null, expected 3321460"` (fails closed; touches nothing).
3. Simulated one real plitch re-sync of "Crimson Desert Enhanced" through the actual fixed `remoteTrainerToCatalogEntry`/`upsertCatalogEntryWithIdentityReview` code path. Result: the canonical row is updated in place (no identity-review deferral — same displayName, no steamAppId conflict) to `steamAppId: 3321460`, `executables: ["CrimsonDesert.exe"]`.
4. Ran `scanSteamInstalls()` for real against this machine's real Steam libraries and `matchInstalledToCatalog()` against the corrected catalog copy. Result — the real, live application code path, not a script-only substitute:
   ```
   catalogGameId: 'crimson-desert-enhanced'
   catalogDisplayName: 'Crimson Desert Enhanced'
   executablePath: 'Z:\SteamLibrary\steamapps\common\Crimson Desert\bin64\CrimsonDesert.exe'
   identityStatus: 'verified'
   ```
   This resolves via the **steamAppId tier** (`matchInstalledToCatalog`'s `bySteamId` map, tier 1) — the install's real Steam-manifest appid (3321460) now matches the corrected canonical row's `steamAppId` before the executable-name tier is ever consulted. This is a stronger, more deterministic fix than merely correcting the executable name: even the (still-present, unreconciled) stale `crimson-desert` row's `CrimsonDesert.exe` entry can no longer produce a wrong match, because the higher-precedence identity tier resolves first.
5. Re-ran `reconcileCatalogOrphans()` after the simulated re-sync: `crimson-desert-rename-orphan-v1` now correctly finds the canonical row's proof satisfied, but reports `blocked` — `"unexpected trainer_mod_packs references for orphan (found 2 row(s))"`. Direct inspection of the real production `trainer_mod_packs` table confirmed why: the real `crimson-desert` row has **two** mod pack references (`crimson-desert-pack`, source `bundled`, in addition to the expected `fling-crimson-desert`), which the reconciliation's existing, deliberately conservative safety check correctly refuses to guess about rather than deleting data it can't fully account for. This is the same fail-closed behavior every other reconciliation pair in this table already exercises for this exact scenario (see `tests/trainer-catalog-reconcile.test.ts`'s "blocks and leaves data untouched when orphan has more than one dependent mod pack" case) — not a defect in this stage's fix.

**Net result**: the primary Exit-Gate defect — Crimson Desert Enhanced resolving to the wrong catalog identity — is fixed and verified end-to-end against the real installed game and a real copy of the production catalog. The stale `crimson-desert` row remains present as inert, correctly-flagged data-hygiene debt (blocked pending a manual look at its extra bundled mod-pack reference), but it can no longer be selected in preference to the correct identity, because the fix resolves through the higher-precedence steamAppId tier.

## Regression safety — neighboring games and editions checked

- `Palworld`, `Stardew Valley`, `DREDGE`, `Starfield`, `Baldur's Gate 3` — all still resolve exactly as documented in P3-4/P3-5; `test:install-discovery` (104/104) and `test:trainer-catalog` (204/204) both green confirm no regression.
- A synthetic "Palworld" scrape through the modified `remoteTrainerToCatalogEntry` (test case 7 above) confirms the new Crimson Desert association is not globally applied — it is keyed exactly to `crimson-desert-enhanced` and nothing else.
- A synthetic unrelated title with no curated association (test case 6) confirms the pre-existing `guessExecutable()` fallback behavior is completely unchanged for every other community-scraped title.
- All 8 pre-existing `CATALOG_ORPHAN_RECONCILIATIONS` pairs (BG3, No Man's Sky, God of War Ragnarök, Spider-Man Remastered, Dragon's Dogma 2, Miles Morales, Dragon's Dogma Dark Arisen, AC Black Flag Resynced) still pass every one of their existing assertions unchanged.

## Phase 2 files touched

`NONE`. Reverified against `solith-phase0-convergence`'s live dirty files (`src/app/components/PointerMapPanel.tsx`, `tests/pointer-map-ui-stability.e2e.test.ts`) immediately before committing — zero overlap.

## Atomfall files touched

`NONE`. No file with "Atomfall" in its name, no Xbox/GDK install-discovery provider file, and no file from the parallel Atomfall session's branch (`cursor/atomfall-l3-live-cert`) was read for editing or written this stage.

## Updated seven-title matrix

| Title | Status |
|---|---|
| Stardew Valley | PASS |
| Palworld | PASS |
| DREDGE | PASS |
| Starfield | PASS |
| Baldur's Gate 3 | PASS |
| Crimson Desert Enhanced | **PASS** (this stage) |
| Atomfall | owned by a separate, concurrently active session — no evidence doc from that session exists yet on this branch as of this stage; status not claimed here |

## Phase 3 status

`NOT RECERTIFIED — ATOMFALL STATUS OWNED BY SEPARATE SESSION, CHECK ITS OWN EVIDENCE`
