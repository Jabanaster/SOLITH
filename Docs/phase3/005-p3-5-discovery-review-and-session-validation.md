# P3-5 — Discovery Review and Real Session-Binding Validation

**Branch.** `feature/solith-parallel-phase3-catalog-identity`, continuing from P3-4 (`Docs/phase3/004`, base SHA `45b34dc`). All changes remain uncommitted working-tree edits under `src/core/install-discovery/` and its tests. No Phase 2 file touched — reverified against `solith-phase0-convergence`'s (the live Phase 2 pointer-stability worktree) current dirty files (`src/app/components/PointerMapPanel.tsx`, `tests/pointer-map-ui-stability.e2e.test.ts`) — zero overlap.

## Independent code review (item 1)

Dispatched a fresh, independent code-reviewer pass over the 4 P3-4 fixes (`executable-role.ts`, `match.ts`, `nested-executable-discovery.ts`, `steam.ts`) plus their tests, with explicit adversarial questions about override risk, arbitrary-selection risk, fail-closed preservation, and invalid-appid acceptance.

**Verdict: safe, no CRITICAL/HIGH issues.** Specific findings:
- The Shipping-binary tie-break and the (then-undisclosed to the reviewer, now documented below) declared-order tie-break can never override steamAppId/displayName/hash/provider evidence — `matchInstalledToCatalog`'s tiers (`match.ts`) run entirely independently of, and after, install-discovery's executable-path resolution; neither tie-break can select a different `catalogGameId`.
- Both tie-breaks correctly fail closed (return `undefined`) when their own signal matches 0 or 2+ candidates — verified by tracing and by existing tests.
- `classifyExecutableRoles`' invariant holds: 2+ `PRIMARY_GAME` results are only possible when the caller supplied `knownCatalogExecutables` naming multiple candidates — an ambiguous multi-candidate install with NO catalog evidence always resolves to `UNKNOWN`, never `PRIMARY_GAME`. This is what guarantees the tie-breaks never invent identity.
- Removing the `steamAppId < 1_000_000` ceiling introduces no new invalid-appid acceptance: catalog-side appids are independently validated as positive integers by the remote-update schema (`manifest-schema.ts`) and bundled seed data is always real; install-side `Number.isFinite` parsing in `steam.ts` (pre-existing, untouched) already rejects non-numeric manifest values.
- New TOOL-classification regexes bias toward under-matching (a false-positive TOOL classification removes a candidate from consideration, pushing toward fail-closed, never toward a wrong match).
- `steam.ts`'s rewrite preserves the simple single-known-exe case; for an unknown appid with 2+ root `.exe` files and no catalog evidence, it now correctly fails closed instead of the old arbitrary-first-`.exe`-in-directory-order guess — an intentional, documented resolution-rate trade for correctness, not a safety regression.

**One MEDIUM finding, fixed this stage**: `tests/install-discovery-steam.test.ts`'s Palworld test claimed to validate the Shipping-binary tie-break end-to-end, but `STEAM_EXECUTABLE_LOOKUP`'s real entry for Palworld (1623730) lists only `Palworld-Win64-Shipping.exe` — so `resolvePrimaryExecutable` resolves it as the sole `PRIMARY_GAME` candidate directly, never entering the tie-break branch. The tie-break itself is correctly covered at the unit level (`tests/install-discovery-nested-executable-discovery.test.ts`, which explicitly supplies both names). **Fixed** by relabeling the steam.ts test and its fixture comment to accurately describe what it verifies (nested-known-executable resolution, the real regression it was originally written to catch) rather than overclaiming tie-break coverage it doesn't exercise.

## Test count reconciliation (item 2)

Both discrepancies are legitimate — different commands/file sets at different points in the branch's history, not regressions:

| Suite | Number | Command | Files |
|---|---|---|---|
| install-discovery | 86 | `npx tsx --test tests/install-discovery-*.test.ts` | 9 files matching the glob |
| install-discovery | 100 | `npm run test:install-discovery` | 11 files — the script also runs `tests/installed-game-identity.test.ts` and `tests/trainer-library-preview-gates.test.ts`, which don't match the `install-discovery-*` glob |
| install-discovery | 104 | `npm run test:install-discovery` (current) | same 11 files; +4 tests added this stage (declared-order opt-in/BG3/fail-closed cases) |
| trainer-catalog | 169 | `npm run test:trainer-catalog` | reported mid-P3-3, before `trainer-catalog-edition-signal.test.ts` (13 tests) and `trainer-catalog-find-edition-groups.test.ts` (1 test) existed / were wired into the script |
| trainer-catalog | 183 | `npm run test:trainer-catalog` (current) | 169 + 14 = 183 — confirmed exact: `npx tsx --test tests/trainer-catalog-edition-signal.test.ts tests/trainer-catalog-find-edition-groups.test.ts` reports exactly 14 tests |

No test was deleted, weakened, or skipped to produce either higher number.

## Certification distinction (item 3): installed-file discovery/catalog matching vs. live session binding

These are two architecturally separate mechanisms in this codebase, confirmed by reading (not modifying) the real code paths:

1. **Install-discovery / catalog reconciliation** (`src/core/install-discovery/*`, owned by this lane): scans the filesystem for installed games, resolves one canonical executable path per install, and matches it to a `catalogGameId` via `matchInstalledToCatalog`. This is what P3-1 through P3-4 fixed (D07's catalog windows, nested discovery, ambiguity resolution, the steamAppId ceiling). It powers the Library UI and trainer-applicability gating. **It is not, by itself, a live session.**
2. **Live process-watch / session binding** (`electron/catalog-process-watch.ts` polling `matchAllCatalogProcesses` in Phase 2's `src/core/live-memory/process-watcher.ts`, real production code, not modified this stage): polls actually-running OS processes every 15s, matches each one's executable **basename** directly against `listCatalogExecutableIndex()` (the full, unbounded catalog's executable-name index — a different, independent index from anything install-discovery builds), and produces the `catalogGameId` + `pid` + `executable` detection that `GameSession` (`src/core/cheat-system/types.ts`) requires. This never auto-attaches memory — it stops at "detected," consistent with the codebase's proposal-first philosophy.

ROADMAP.md Phase 3's Exit Gate text — "Stardew Valley and Palworld both bind a session" — is precisely mechanism #2. It was validated directly this stage (see below), not inferred from mechanism #1's success.

## Real session-binding validation (item 4)

Launching installed games was explicitly authorized for this validation. No game was purchased/downloaded, no game file modified, no anti-cheat/protection touched, no Phase 2 code edited. Games were launched via the standard `steam://rungameid/<appid>` protocol (the same mechanism a real user's Steam client uses) since Steam itself was not already running.

**Stardew Valley (appid 413150) — REAL PASS.** Launched; confirmed a real running process (`Stardew Valley.exe`, PID 13288, `Z:\SteamLibrary\steamapps\common\Stardew Valley\Stardew Valley.exe`). Called the exact production function `electron/catalog-process-watch.ts`'s poller calls — `matchAllCatalogProcesses(listLiveMemoryProcesses(), listCatalogExecutableIndex())`, against the real live OS process list (367 processes) and a read-only copy of the real production catalog — and got a real detection:
```
{"catalogGameId":"stardew-valley","displayName":"Stardew Valley","pid":13288,"executable":"Stardew Valley.exe"}
```
This is the actual application code path, exercised against a real running game, not a script-only or fixture substitute.

**Palworld (appid 1623730) — REAL PASS.** Launched via `steam://rungameid/1623730`; UE5 cold start took ~1 minute. Confirmed real running processes: the root wrapper `Palworld.exe` (PID 3872) appeared first, and the real Unreal Engine binary `Palworld-Win64-Shipping.exe` (PID 2824, ~1GB resident) appeared roughly a minute later as a child process — both alive simultaneously, exactly matching the architecture identified in P3-4. Ran the same production function against the real live process list:
```
{"catalogGameId":"palworld","displayName":"Palworld","pid":3872,"executable":"Palworld.exe"}
```
The production catalog's real `executables` list for Palworld includes both `Palworld-Win64-Shipping.exe` and `Palworld.exe`, so `matchAllCatalogProcesses` (which matches whichever known name is actually running, independent of install-discovery's single-canonical-path problem) correctly bound the wrapper process the moment it appeared, before the Shipping binary even existed as a process. This is a real, concrete demonstration that mechanism #2 (live session-bind) is architecturally robust to exactly the "which of 2 known executables is real" question that mechanism #1 (install-discovery) needed dedicated fixes for.

Both Stardew Valley and Palworld were confirmed bound **concurrently** (both detections present in the same poll, no cross-contamination) before being closed at the end of this validation (processes I started for this test; no other task's process was touched).

## BG3 bg3.exe vs bg3_dx11.exe ambiguity (item 5)

Investigated existing explicit-selection/running-process signals before adding anything:
- No existing per-install "preferred executable" override field exists anywhere in the codebase (checked `RawInstalledGame`, `InstalledGameRecord`, settings).
- The live process-watch path (mechanism #2 above) has no ambiguity problem at all for this case — it matches whichever of `bg3.exe`/`bg3_dx11.exe` is *actually running* by basename, independent of install-discovery's single-canonical-path resolution. That mechanism is Phase 2-owned and was not touched.
- Found a real, already-established codebase convention instead of inventing renderer-history infrastructure: index 0 of an `executables` array is treated as "the primary executable" in three independent, pre-existing places — `mod-pack-adapter.ts`'s `primaryExecutable = executables[0] ?? ...`, `import-definition-ct.ts` (×4), and `bundled-definition-seed.ts`. `steam-executable-lookup.ts` and `bundled-community-games.ts` (both hand-authored literal source files, not scraped/derived data) already declare Baldur's Gate 3 as `['bg3.exe', 'bg3_dx11.exe']`, `bg3.exe` first, in both independent places.

**Implemented, bounded, within owned files only**: `resolvePrimaryExecutable` gained a second, **opt-in-only** tie-break (`trustDeclaredExecutableOrder`, default `false`) that trusts `knownCatalogExecutables[0]` only when the caller has verified its source's order is curator-intentional. `steam.ts` opts in, because `STEAM_EXECUTABLE_LOOKUP` is exactly such a hand-authored source. The trainer-catalog DB's own `executables` field (populated via a `[...new Set(...)]` merge over community mod-pack versions, order not verified intentional) is deliberately **not** opted in — this stays scoped to the one source verified safe. The existing "Game32.exe/Game64.exe, no evidence" fail-closed test is unchanged and still passes, since it doesn't opt in.

Real-world result: Baldur's Gate 3 now resolves `bin/bg3.exe` as its install-discovery executable, and (independently, via mechanism #2) would live-bind on whichever renderer the user actually launches.

## Regression checks and updated seven-title matrix (item 6)

- `npx tsc --noEmit`: clean.
- `npm run test:install-discovery`: **104/104** (was 100/100 at P3-4).
- Full BG3/Palworld/declared-order test additions pass; existing fail-closed assertions unchanged and still pass.

| Title | AppID | Executable resolved (install-discovery) | Catalog identity | Live session bind (real launch) | Verdict |
|---|---|---|---|---|---|
| Stardew Valley | 413150 | root `Stardew Valley.exe` | `stardew-valley` | **REAL PASS** — PID 13288, real detection via `matchAllCatalogProcesses` | **PASS (full, incl. live bind)** |
| Palworld | 1623730 | nested `Pal/Binaries/Win64/Palworld-Win64-Shipping.exe` | `palworld` | **REAL PASS** — PID 3872 (wrapper) then PID 2824 (Shipping) both live, real detection | **PASS (full, incl. live bind)** |
| DREDGE | 1562430 | root `DREDGE.exe` | `dredge` | not exercised live this stage (not required by Exit Gate text) | PASS (install/catalog only) |
| Starfield | 1716740 | root `Starfield.exe` | `starfield` | not exercised live this stage (not required by Exit Gate text) | PASS (install/catalog only) |
| Baldur's Gate 3 | 1086940 | `bin/bg3.exe` (declared-order fix, this stage) | `baldur-s-gate-3` | not exercised live this stage | PASS (install/catalog only) |
| Crimson Desert Enhanced | 3321460 | nested `bin64/CrimsonDesert.exe` | wrong edition (`crimson-desert`) | not applicable | FAIL (catalog data — Job 2's ownership) |
| Atomfall | — | — | — | — | BLOCKED (not installed; not downloaded per instruction) |

Both games launched for live-bind validation were closed (processes I started) once the validation completed.

## Phase 2 files touched

`NONE`.
