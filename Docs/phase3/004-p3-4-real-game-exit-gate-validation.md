# P3-4 — Real-Game Exit-Gate Validation

**Branch.** `feature/solith-parallel-phase3-catalog-identity`, continuing from P3-3 (`Docs/phase3/003`, ending SHA `45b34dc`). Every change in this stage lives in `src/core/install-discovery/{steam,match,executable-role,nested-executable-discovery}.ts` and their tests — no Phase 2 file touched (verified against `solith-phase0-convergence`'s live dirty files: `PointerMapPanel.tsx`, `pointer-map-ui-stability.e2e.test.ts` — zero overlap).

**Scope.** ROADMAP.md Phase 3's Exit Gate requires "real-game validation across providers ... and at minimum the 7 curated titles" and names two by name: "Stardew Valley and Palworld both bind a session." This stage executes that validation against real installed copies rather than fixtures alone, and fixes what it found.

## The 7 curated titles — real availability

Recovered from `feature/solith-phase1-scanner-reconstruction:ROADMAP.md` line 556 (Phase 12 roster, same 7 the Phase 3 Exit Gate references): Stardew Valley, Palworld, DREDGE, Crimson Desert, Baldur's Gate 3, Starfield, Atomfall.

Checked real Steam libraries (`libraryfolders.vdf` across all 4 configured drives), Epic Games Launcher manifests, and GOG Galaxy storage — not repeating any prior "no installs available" claim:

| Title | Steam AppID | Installed? | Evidence |
|---|---|---|---|
| Stardew Valley | 413150 | **Yes** | `Z:\SteamLibrary\steamapps\common\Stardew Valley` |
| Palworld | 1623730 | **Yes** | `Z:\SteamLibrary\steamapps\common\Palworld` |
| DREDGE | 1562430 | **Yes** | `Z:\SteamLibrary\steamapps\common\DREDGE` |
| Crimson Desert (Enhanced) | 3321460 | **Yes** | `Z:\SteamLibrary\steamapps\common\Crimson Desert` (Steam's current release title is "Crimson Desert Enhanced") |
| Baldur's Gate 3 | 1086940 | **Yes** | `D:\SteamLibrary\steamapps\common\Baldurs Gate 3` |
| Starfield | 1716740 | **Yes** | `D:\SteamLibrary\steamapps\common\Starfield` |
| Atomfall | — | **No** | Not in any Steam library, Epic manifest, or GOG storage on this machine — genuine blocker, not a pass |

6 of 7 confirmed real, installed, ownable titles. Atomfall is a hard blocker (missing game), not scored as a failure of Phase 3 code.

## "Bind a session" — what was actually tested

`GameSession` (`src/core/cheat-system/types.ts`) requires a resolved `catalogGameId` and a `gameProcess.path`. Phase 3 owns the identity/catalog half of that (install discovery → executable resolution → catalog match); Phase 2 owns live process attach. Per this mission's explicit boundary, this stage validates the Phase 3 half against real installs and real production catalog data — file inspection, real discovery, and real catalog matching — and does **not** launch any game or invoke Phase 2's live-attach path. No game was launched, no anti-cheat/EULA/process was touched, no game file was modified.

Real production catalog data was used: the live `AppData/Roaming/solith/solith.db` (6,018 real catalog rows) was copied read-only into the session scratchpad and queried via `resetForTesting()`/`getFullCatalogForMatching()` — the actual database was never opened or written.

## Defects found and fixed (all in Phase-3-owned files, no schema/ingestion change)

### 1. Steam scan path never used the certified nested-discovery/role/ambiguity code (`steam.ts`)

`scanSteamInstalls()` — the real path every one of these 6 installs goes through — did not call `resolvePrimaryExecutable`/`discoverGameExecutables`/`classifyExecutableRoles` at all. It used a separate, older `resolveSteamExecutable()`: check a hardcoded per-appid executable list (`steam-executable-lookup.ts`) at the install **root only**, then fall back to the **first `.exe` found in filesystem enumeration order** — the exact "arbitrary first match" pattern Phase 3 exists to eliminate.

Reproduced against real installs:
- **Palworld**: known name `Palworld-Win64-Shipping.exe` lives at `Pal/Binaries/Win64/`, not root → root check failed → fallback returned the root-level `Palworld.exe` launcher stub instead of the real game binary.
- **Crimson Desert**: known name `CrimsonDesert.exe` lives at `bin64/`, not root → this is the literal "Crimson Desert resolution gap" ROADMAP.md Phase 3 names as its own motivating example.
- **Baldur's Gate 3**: both known names (`bg3.exe`, `bg3_dx11.exe`) live at `bin/`, not root, and root has no `.exe` at all → resolved to no executable.

**Fix**: `resolveSteamExecutable()` now delegates to the already-certified `resolvePrimaryExecutable()`, seeded with the curated known-executable names as evidence, fails closed instead of guessing. Confirmed against a fixture reproducing Palworld's exact real shape (`tests/install-discovery-steam.test.ts`).

### 2. Two Unreal Engine Shipping-binary + root-wrapper candidates fail closed unnecessarily (`nested-executable-discovery.ts`)

When a catalog entry legitimately lists both a root-level wrapper and the nested Shipping binary as valid executables (the DB catalog row for Palworld does), both classify `PRIMARY_GAME` and `resolvePrimaryExecutable` correctly refuses to guess — but that guess is not actually needed here: the `-Win64-Shipping.exe`-style suffix is a real, publicly-documented Unreal Engine convention identifying the actual cooked game binary. Added a narrow tie-break: among 2+ already-catalog-validated `PRIMARY_GAME` candidates, prefer the Shipping-suffixed one. Never applies to unrelated/unknown candidates (existing fail-closed test for that case is unchanged and still passes).

### 3. Real bundled helper binaries misclassified as game candidates (`executable-role.ts`)

Found via real installs, none previously covered by any role pattern:
- `EpicWebHelper.exe` (Epic Online Services' embedded browser helper, bundled with Palworld)
- `createdump.exe` (Microsoft's CoreCLR crash-dump generator, bundled with any self-contained .NET game — Stardew Valley) — this alone blocked Stardew Valley, one of the two Exit-Gate-named titles, from ever resolving a primary executable (2 unrelated `GAME_CANDIDATE`s → fail closed)
- `crashpad_handler.exe` (Google Crashpad, bundled with Crimson Desert)
- `CefSharp.BrowserSubprocess.exe` (bundled with Baldur's Gate 3's launcher)

All four are real, evidenced, publicly-documented third-party binaries — added to the existing regex-based classification (`SDK_HELPER_RE`, `CRASH_REPORTER_RE` extension), same evidentiary bar as the existing anti-cheat list.

### 4. Hardcoded `steamAppId < 1_000_000` ceiling in the match index (`match.ts`)

`matchInstalledToCatalog()`'s `bySteamId` index silently excluded any catalog entry whose `steamAppId` was 1,000,000 or greater from steamAppId-tier matching — no comment, no test ever exercised it with a real modern appid. This is the same defect *class* as D07 (a hardcoded ceiling), recurring inside D07's own fix. Confirmed it directly blocked Baldur's Gate 3 (appid 1,086,940) from binding at all, since BG3 also has no single unambiguous executable to fall back on. **Removed the ceiling entirely** — no legitimate reason for it was found (Starfield 1,716,740, Palworld 1,623,730, Crimson Desert Enhanced 3,321,460 are all real, valid, already-catalogued appids above it). Added a regression test using a real appid (Palworld, 1,623,730) that a prior fixture had defined but never actually exercised through the steamAppId tier.

## Real-game validation results (production entry point: `scanSteamInstalls` → `matchInstalledToCatalog`, real catalog DB copy)

| Title | AppID | Executable resolved | Catalog identity | Verdict |
|---|---|---|---|---|
| Stardew Valley | 413150 | `Stardew Valley.exe` (root) | `stardew-valley` | **PASS** |
| Palworld | 1623730 | `Pal/Binaries/Win64/Palworld-Win64-Shipping.exe` (nested) | `palworld` | **PASS** |
| DREDGE | 1562430 | `DREDGE.exe` (root) | `dredge` | **PASS** |
| Starfield | 1716740 | `Starfield.exe` (root) | `starfield` | **PASS** |
| Baldur's Gate 3 | 1086940 | none (genuinely ambiguous: `bg3.exe` vs `bg3_dx11.exe`, no further evidence) | `baldur-s-gate-3` (via steamAppId, ceiling fix) | **PARTIAL** — catalog identity correct; executable-level fail-closed blocks a live session bind until a further disambiguation signal exists |
| Crimson Desert Enhanced | 3321460 | `bin64/CrimsonDesert.exe` (nested — resolution gap fixed) | `crimson-desert` (**wrong edition** — see below) | **FAIL** (data, not code) |
| Atomfall | — | — | — | **BLOCKED** (not installed on this machine — cannot be run without purchasing/downloading it, which is out of scope) |

Both Exit-Gate-named titles (Stardew Valley, Palworld) now **PASS** against real installs and the real production catalog.

### Crimson Desert — real, unresolved catalog data defect (not fixed this stage)

The real install (Steam appid 3,321,460, current title "Crimson Desert Enhanced") resolves its executable correctly (`bin64/CrimsonDesert.exe`, gap fixed above), but the production catalog has **two** rows for this game — `crimson-desert` (fling source, executable `CrimsonDesert.exe`, no `steamAppId`) and `crimson-desert-enhanced` (plitch source, executable `CrimsonDesertEnhanced.exe` — a name that does not exist on disk, no `steamAppId`). Because only the stale `crimson-desert` row's executable name matches a real file, `matchInstalledToCatalog` binds to it via an *unambiguous single-candidate* match — the ambiguity-resolution hierarchy never even engages, since there is no on-disk collision, only a wrong catalog record.

This is a real catalog **data** defect (missing `steamAppId`, a probably-guessed executable filename on the "Enhanced" row) — not a matching-logic bug. Per this mission's explicit scope limits (no backend ingestion changes, no catalog-schema migration, no unilateral edits to persisted catalog seed rows without an ingestion audit), it is **not fixed in this stage**. Documented here with exact reproduction; smallest correct fix is to backfill `steamAppId: 3321460` and the real executable name onto the `crimson-desert-enhanced` row (and decide whether `crimson-desert` should be retired/merged) through the catalog ingestion pipeline, not by hand-patching this worktree's copy of production data.

## Tests added this stage

- `tests/install-discovery-steam.test.ts`: real-shape Palworld fixture (root wrapper + nested Shipping binary) proving the nested binary is now resolved, not the wrapper.
- `tests/install-discovery-nested-executable-discovery.test.ts`: Palworld real-install-shape Shipping-binary tie-break test.
- `tests/install-discovery-executable-role.test.ts`: `EpicWebHelper.exe`, `createdump.exe`, `crashpad_handler.exe` real-evidence classification tests.
- `tests/install-discovery-match.test.ts`: steamAppId ≥ 1,000,000 matches (Palworld, 1,623,730) — the exact case the removed ceiling broke.

## Verification (this stage)

- `npx tsc --noEmit` (root): clean
- `npx tsc -p tsconfig.electron.json --noEmit`: clean
- `npm run test:install-discovery`: **100/100** (was 94/94)
- `npm run test:trainer-catalog`: **183/183**
- `npm run test:trainer-health`: **5/5**
- `npm run test:executable-identity`: **28/28**
- `npm run test:definitions`: **112/112**
- `tests/trainer-research.test.ts`: **7/7**
- `tests/game-taglines.test.ts`, `tests/discovery.test.ts`, `tests/trainer-catalog-full-window.test.ts`: **19/19** (spot-checked for regressions in files sharing the touched regexes/index)
- Real-game end-to-end script (scratchpad, not committed): `scanSteamInstalls()` → `matchInstalledToCatalog()` against a read-only copy of the real production catalog DB and the 6 real installed titles — results tabulated above.

## Phase 2 files touched

`NONE`. Verified against `solith-phase0-convergence`'s (the live Phase 2 pointer-stability worktree) current dirty files (`PointerMapPanel.tsx`, `pointer-map-ui-stability.e2e.test.ts`) — zero overlap with anything touched this stage.

## Remaining gap

Crimson Desert catalog data (missing `steamAppId`, wrong executable name on the current edition's row) — real, reproduced, root-caused, correctly left for an ingestion-pipeline fix rather than a unilateral hand-patch to this worktree's copy of shared production data. Atomfall could not be validated on this machine (not installed) — a genuine blocker for 100% of the 7-title roster, independent of code correctness.
