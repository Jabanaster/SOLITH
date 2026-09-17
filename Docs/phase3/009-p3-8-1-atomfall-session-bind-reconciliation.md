# P3-8.1 — Atomfall Session-Bind Reconciliation

**Status.** Closes the two items `Docs/phase3/008` disclosed but did not fix:
(1) Atomfall's live session binding selected the launcher process
(`Launcher\Atomfall.exe`) instead of the engine (`bin\Atomfall_dx12.exe`)
while both were alive; (2) the exact final SHA had not executed the
repository's blocking remote CI suite because PR #38 targeted the shared
Phase 3 branch, not master. This document addresses (1). `Docs/phase3/010`
addresses (2) plus the fresh-worktree and final-certification evidence.

## 1 — Phase 3's identity model for session binding

`ROADMAP.md`'s Phase 3 exit gate requires "Stardew Valley and Palworld both
bind a session" via the production `matchAllCatalogProcesses()` pipeline
(`src/core/live-memory/process-watcher.ts`), fed by
`listCatalogExecutableIndex()` (`src/core/trainer-catalog/store.ts`) and the
real live process list (`listLiveMemoryProcesses()`). Nothing in the
Roadmap's identity model treats "whichever process a platform's launcher
happens to keep alive" as canonical — the model's game/executable/process
identity chain is: catalog-declared executables → the real, playable game
binary → whichever live process actually **is** that binary. A launcher
stub that merely spawns the real engine and stays resident is not the game;
it is infrastructure the platform uses to start the game (see
`executable-role.ts`'s pre-existing `LAUNCHER`/`TOOL`/`SERVER` roles, which
already model exactly this distinction for install-time executable
resolution). For Atomfall, when both `Launcher\Atomfall.exe` and
`bin\Atomfall_dx12.exe` are live, the correct canonical session target is
the engine binary, `Atomfall_dx12.exe` — this is not a case where the
Roadmap permits launcher binding; it was an unfixed defect in the
live-process tie-break, not an intentional design choice.

## 2 — Traced mechanism (no speculation)

Production path: `electron/catalog-process-watch.ts:100` calls
`matchAllCatalogProcesses(processes, catalogEntries)`, where `processes`
comes from `listLiveMemoryProcesses()` (real OS process snapshot) and
`catalogEntries` comes from `listCatalogExecutableIndex()` (the real
`trainer_catalog_games.executablesJson` column). The real production
catalog row for Atomfall is `["Atomfall.exe","Atomfall_dx12.exe"]`; for
Palworld it is `["Palworld-Win64-Shipping.exe","Palworld.exe"]` — declared
order is inconsistent between the two (launcher-first for Atomfall,
engine-first for Palworld), which rules out "declared executable ordering"
as the mechanism. Reading the prior `matchAllCatalogProcesses`
implementation: it built an `executable name → catalog entry` map, then
iterated the live `processes` array once, taking the **first** process
whose name matched an as-yet-unseen game and skipping every later match for
that same game (`if (!match || seenGameIds.has(match.catalogGameId))
continue;`). Selection was therefore determined purely by **live
process-list enumeration order at poll time** — not by declared executable
order, not by aliases, not by path score, not by wrapper preference as a
deliberate rule, and not by the catalog executable index's row order. Both
Atomfall's launcher and Palworld's wrapper simply tended to appear earlier
in the OS snapshot than their respective engine processes.

## 3 — Fix at the correct architectural layer

`src/core/live-memory/process-watcher.ts`'s `matchAllCatalogProcesses` now
collects **every** live process matching a game's declared executables
(not just the first), and — only when 2+ are alive concurrently for the
same game — ranks them by executable role via the existing, shared
`classifyExecutableRoles()` (`src/core/install-discovery/executable-role.ts`)
rather than by process-list position. `executable-role.ts` gained one new
generic regex, `ENGINE_BUILD_SUFFIX_RE`, recognizing two independent,
real, publicly-documented naming conventions for a build's actual playable
binary as distinct from a bare `<GameName>.exe` launcher stub: Unreal
Engine's cooked Shipping-configuration naming
(`<Name>-Win64-Shipping.exe`, already used elsewhere by
`nested-executable-discovery.ts`'s `SHIPPING_BINARY_RE` for install-time
resolution) and graphics-API-suffixed multi-renderer builds
(`<Name>_dx12.exe`, etc.) — the latter needed because neither
`Atomfall.exe` nor `Palworld.exe` contains "launcher"/"bootstrap", so the
pre-existing `LAUNCHER_RE` name check cannot distinguish them from their
engine siblings by name alone. No `if (catalogGameId === 'atomfall')`
branch exists anywhere in the fix — both Atomfall and Palworld are resolved
by the same generic rule, and Palworld's previously-accepted
wrapper-PID bind (an artifact of the identical first-match bug, not a
deliberate design choice — see §2) is corrected alongside Atomfall's,
not preserved as a special case.

When a game has only one live-matching process (every existing
single-executable catalog entry: Steam/GOG/Epic titles, DREDGE, Starfield,
Crimson Desert, and Stardew Valley's two name variants, which are never
both alive at once), the new grouping step is a no-op — `matches.length ===
1` returns immediately, identical to the old first-match behavior.

## 4 — Atomfall live session-bind proof (3 launches)

Production discovery: launched Atomfall via `shell:appsFolder`, clicked
PLAY once the launcher GUI rendered, waited for `Atomfall_dx12.exe` to
spawn, then ran the real production pipeline (`listLiveMemoryProcesses()` +
`listCatalogExecutableIndex()` + `matchAllCatalogProcesses()`) against a
byte-identical copy of the real `%APPDATA%/solith/solith.db`
(`ELECTRON_USER_DATA_PATH` pointed at the copy; `initDatabase()` called
directly — no fallback/empty DB).

| Launch | Launcher PID | Engine PID | Selected executable | Selected PID | Result |
|---|---|---|---|---|---|
| 1 | 7596 | 33744 | `Atomfall_dx12.exe` | 33744 | **PASS** |
| 2 | 31116 | 21412 | `Atomfall_dx12.exe` | 21412 | **PASS** |
| 3 | 11976 | 14900 | `Atomfall_dx12.exe` | 14900 | **PASS** |

**3/3 PASS.** Every launch produced a fresh launcher PID and a fresh engine
PID (real process starts, not the same PIDs reused); every launch selected
the engine PID, not the launcher PID. Real live process records (launch 1,
representative):

```json
{ "pid": 7596,  "name": "Atomfall.exe",       "executablePath": "C:\\Program Files\\WindowsApps\\Rebellion.Windscale_1.23.105.0_x64__2vbwqmt31j4mr\\Launcher\\Atomfall.exe" },
{ "pid": 33744, "name": "Atomfall_dx12.exe",  "executablePath": "C:\\Program Files\\WindowsApps\\Rebellion.Windscale_1.23.105.0_x64__2vbwqmt31j4mr\\bin\\atomfall_dx12.exe", "parentPid": 7596, "parentProcessName": "Atomfall.exe" }
```

Catalog entry used (real production DB row, not a fixture):
`{"catalogGameId":"atomfall","displayName":"Atomfall","executables":["Atomfall.exe","Atomfall_dx12.exe"]}`.

## 5 — Palworld / existing wrapper regression

Palworld launched live via Steam (`steam://rungameid/1623730`); both
`Palworld.exe` (wrapper) and `Palworld-Win64-Shipping.exe` (engine) were
alive concurrently (parent/child: Shipping spawned by the wrapper).
Production pipeline, same real production catalog copy:

```json
{ "pid": 27792, "name": "Palworld.exe", "executablePath": "Z:\\SteamLibrary\\steamapps\\common\\Palworld\\Palworld.exe" },
{ "pid": 26796, "name": "Palworld-Win64-Shipping.exe", "executablePath": "Z:\\SteamLibrary\\steamapps\\common\\Palworld\\Pal\\Binaries\\Win64\\Palworld-Win64-Shipping.exe", "parentPid": 27792, "parentProcessName": "Palworld.exe" }
```

Selected: `Palworld-Win64-Shipping.exe`, PID 26796. **PASS** — and, per §3,
this is a correction of the same pre-existing bug Atomfall hit
(`Docs/phase3/007`'s prior "wrapper PID accepted" note was never a
deliberate design decision; it was this same first-match defect, disclosed
honestly at the time rather than fixed). No Palworld-specific code exists
in the fix; the same generic `ENGINE_BUILD_SUFFIX_RE` rule that resolves
Atomfall resolves Palworld.

## 6 — Steam/GOG/Epic and remaining regression suites

Full regression run after the fix, no code changes to any provider
(`steam.ts`, `gog.ts`, `epic.ts`, `xbox.ts`, `match.ts`, `identity.ts`
unchanged — `git diff --name-only` confirms only `executable-role.ts`,
`process-watcher.ts`, `package.json`, and one new test file changed):

- `install-discovery` suite: **112/112 PASS** (unchanged from `Docs/phase3/008`).
- `trainer-catalog` suite: **204/204 PASS**.
- `live-memory` suite (session-binding, process-watcher, zero-input, etc.):
  **430 pass / 0 fail / 70 skipped** (skips are pre-existing, real-hardware-gated
  tests, unrelated to this change).
- New focused suite, `tests/live-memory/process-watch-role-tiebreak.test.ts`
  (8 tests): Xbox launcher+engine both alive, order-independence, launcher-only
  startup state, engine-appears-after-launcher (poll upgrade), engine-exits/
  launcher-remains (poll downgrade), multiple ambiguous candidates with no role
  evidence (falls back to earliest live match, unchanged from before), Palworld
  wrapper regression, Steam/GOG/Epic-style single-executable entries unaffected.
  **8/8 PASS.**
- Existing `tests/live-memory/process-watch-multi-match.test.ts` (D07
  regression coverage) and `tests/live-memory/process-watcher.test.ts`:
  **10/10 PASS**, unchanged behavior for every case in those files.

Typechecks: `tsc --noEmit -p tsconfig.json` (renderer) — **PASS, 0 errors**.
`tsc --noEmit -p tsconfig.electron.json` (electron) — **PASS, 0 errors**.

## 7 — Seven-title matrix (session-identity recomputed)

| Title | Provider | Install discovery | Canonical executable | Live process binding |
|---|---|---|---|---|
| Stardew Valley | Steam | PASS (structural — unchanged code path; single live executable, no launcher/engine ambiguity possible) | `Stardew Valley.exe` | PASS (carried forward, `Docs/phase3/007` live evidence; structurally reconfirmed by full regression suite) |
| Palworld | Steam | PASS (structural, unchanged) | `Palworld-Win64-Shipping.exe` | **PASS — re-verified live this pass (§5)**, now correctly binds the engine PID instead of the wrapper PID |
| DREDGE | Steam | PASS (structural) | `Dredge.exe` | PASS (carried forward, `Docs/phase3/007`; single-executable entry, structurally unaffected) |
| Starfield | Steam | PASS (structural) | `Starfield.exe` | PASS (carried forward, `Docs/phase3/007`; single-executable entry, structurally unaffected) |
| Baldur's Gate 3 | Steam | PASS (structural) | `bg3.exe` (curator-declared primary) | PASS (carried forward, `Docs/phase3/007`) |
| Crimson Desert Enhanced | Steam | PASS (structural) | `CrimsonDesertEnhanced.exe` | PASS (carried forward, `Docs/phase3/006`/`007`; single-executable entry, structurally unaffected) |
| Atomfall | Xbox/MS Store | **PASS — re-verified live this pass** | `Atomfall_dx12.exe` | **PASS — re-verified live this pass (§4), 3/3 restart-campaign** |

**7/7 PASS.** Two titles (Atomfall, Palworld) had genuine launcher/engine
concurrency and were re-verified live in this pass specifically because
this pass's fix could plausibly change their outcome. The other five have
no code path this fix touches (single live-matching executable at a time —
confirmed against the real production catalog rows in §2/§6) and are
carried forward from `Docs/phase3/006`/`007`'s prior live verification at
this lineage, consistent with the full regression suite (§6) showing zero
behavioral change for any of them.
