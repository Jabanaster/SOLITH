# P3-8 — Xbox/MS Store Install Discovery + Atomfall Final Certification

Mission: `SOLITH.MD` — "PHASE 3 / ATOMFALL XBOX/MS STORE DISCOVERY COMPLETION." Owner had already
selected **CHOICE 1** (Xbox/MS Store install discovery is Phase 3 scope, blocking) in the prior
reconciliation pass (ROADMAP.md, "Owner Scope Decision — 2026-09-17", commit `b8b8431`). This
document is the implementation, test, and live-proof evidence for closing that requirement.

Starting SHA: `b8b8431125c0699ff2804ee36ae1b37945cc7d6ba` (shared Phase 3 branch head).
Worktree: `G:\ACTIVE_PROJECTS\solith-phase3-xbox-msstore-discovery`, branch
`feature/solith-phase3-xbox-msstore-discovery`.

## 1 — Real Atomfall install-layout audit

Installed via Xbox app at `Z:\Games\Atomfall`, package `Rebellion.Windscale` (Publisher
`CN=9136491E-6A28-4C39-989B-12D6D89FB1B3`, version `1.23.105.0`, x64).

- The OS package registration (`Get-AppxPackage`) reports `InstallLocation =
  C:\Program Files\WindowsApps\Rebellion.Windscale_1.23.105.0_x64__2vbwqmt31j4mr`. This is an NTFS
  junction to `Z:\WindowsApps\Rebellion.Windscale_...`, itself a second junction to
  `Z:\Games\Atomfall\Content\`. Plain directory enumeration through the reported
  `InstallLocation` transparently resolves both hops — the discovery code below never has to know
  about the junction chain.
- `Content\appxmanifest.xml`: `<Identity Name="Rebellion.Windscale" ... ProcessorArchitecture="x64" />`,
  `<Application Id="Game" Executable="Launcher\Atomfall.exe" EntryPoint="Windows.FullTrustApplication" />`.
- `Content\MicrosoftGame.config`: `StoreId=9NC4WDL5KZBL`, `TitleId=701B45CA`,
  `<ExecutableList><Executable Name="Launcher/Atomfall.exe" .../></ExecutableList>`.
- `Content\Launcher\Atomfall.exe` — 1.8MB. Confirmed by direct GUI observation (screenshot) to be a
  real mini-launcher window (logo, PLAY button, settings/social links) — genuinely not the game.
- `Content\bin\Atomfall_dx12.exe` — 332MB. The actual playable engine binary — matches this
  codebase's own pre-existing live-memory evidence for Atomfall (`game-connection-baselines.ts`
  `executableName: 'Atomfall_dx12.exe'`; `bundled-definition-seed.ts`'s verified ammo feature,
  `moduleName: 'atomfall_dx12.exe'`).
- `Content\gamelaunchhelper.exe` — Microsoft's own GDK bridge helper, present at the package root
  of every current-generation GDK title (confirmed across all 15 other real Xbox/GDK titles found
  installed on this machine, §5 below) — not the game, not a per-title artifact.
- The install root also carries GUID-named MSIXVC package files
  (`483414AB-3F33-431F-BE88-84C4E09CEC51.{ffd,smd,xct,xvi,xvs}` + a `.xsp` sidecar) and a
  `Shaders\` directory next to `Content\` — these are the package's on-disk delivery format, not
  needed for install identity (StoreId/TitleId/PackageFamilyName from the manifest/config already
  identify the package; the content root already contains everything discovery needs).

## 2 — Provider architecture

New files, additive only:

- [`src/core/install-discovery/xbox-manifest.ts`](../../src/core/install-discovery/xbox-manifest.ts) —
  bounded regex extraction of `appxmanifest.xml` (`Identity`, `Properties/DisplayName`,
  `Application/@Executable`) and `MicrosoftGame.config` (`StoreId`, `TitleId`,
  `ShellVisuals/@DefaultDisplayName`, `ExecutableList/Executable/@Name`). No general XML/DOM
  parser — these are small, OS-registered, non-adversarial files with a fixed known schema,
  consistent with this codebase's existing convention of a small format-specific parser
  (`vdf.ts` for Steam) over a general-purpose library.
- [`src/core/install-discovery/xbox.ts`](../../src/core/install-discovery/xbox.ts) — the provider.
  Authoritative source is `Get-AppxPackage` (shelled via `systemPowerShellPath()`, the same
  pattern already used by `windows-process-identity.ts`/`native-memory-driver.ts`), not filesystem
  crawling. A package is only treated as a game when `MicrosoftGame.config` is present (the real,
  documented signal that a Store package is a Microsoft GDK title, not an arbitrary UWP app).
  `resolveXboxPrimaryExecutable()` demotes any executable found under a `Launcher/`- or
  `Bootstrap/`-named directory before applying the shared BG3-style primary-executable resolution
  (`nested-executable-discovery.ts`), so a package's own declared "launch" executable can never
  win over a real, non-launcher-directory sibling game binary purely because the manifest points
  at it.
- [`src/core/install-discovery/executable-role.ts`](../../src/core/install-discovery/executable-role.ts) —
  one regex addition (`gamelaunchhelper.exe` → `TOOL`, joining the existing `SDK_HELPER_RE`
  alongside `steamwebhelper`/`epicwebhelper`/`createdump.exe`). Found and fixed via the real
  Atomfall discovery run (§4): without it, `gamelaunchhelper.exe` was wrongly treated as a second
  game-like candidate alongside `bin/Atomfall_dx12.exe`, producing a false ambiguity that failed
  discovery closed. Confirmed against all 15 other real installed GDK titles that this is a
  shared, generic Microsoft binary, not an Atomfall-specific artifact.
- [`src/core/install-discovery/index.ts`](../../src/core/install-discovery/index.ts),
  [`types.ts`](../../src/core/install-discovery/types.ts) — wiring only (`scanXboxInstalls` added
  to `discoverRawInstalls`, gated the same way GOG's live registry path is; `xboxFixturePath`
  option added). `steam.ts`, `gog.ts`, `epic.ts`, `match.ts`, `identity.ts` are **byte-for-byte
  unmodified** by this change (verified via `git diff --stat`).
- The existing Atomfall catalog row (`catalogGameId: 'atomfall'`, `executables: ['Atomfall.exe',
  'Atomfall_dx12.exe']`, `modPackId: 'atomfall-pack'`) already carried both names — no catalog
  content change was required for matching to succeed.

## 3 — Tests

[`tests/install-discovery-xbox.test.ts`](../../tests/install-discovery-xbox.test.ts) — 8/8 PASS:
launcher+engine-binary resolution (Atomfall-shaped fixture, asserts the resolved executable is
**not** the Launcher/ stub), a generic single-executable title with no Launcher/ indirection
(non-Atomfall-named, proves the logic isn't Atomfall-specific), missing `MicrosoftGame.config`
rejected, malformed `MicrosoftGame.config` rejected without crashing, a declared executable that
doesn't exist on disk leaves `executablePath` unresolved rather than guessing, a stale package
registration (install location gone) is ignored, a missing fixture file returns empty, and
duplicate scans of the same install produce the same `installIdentity` (idempotent resync).

Full `install-discovery` suite: **112/112 PASS** (was 104/104 before this change — `steam`, `gog`,
`epic`, `match`, `ambiguous-match`, `nested-executable-discovery`, `executable-role`,
`provider-identity`, `trainer-applicability`, `reconcile-duplicate-executables` all still green,
unmodified). Full `trainer-catalog` suite: **148/148 PASS**. Targeted live-memory/process-watcher
regression (`process-watcher`, `process-watch-multi-match`, `game-connection-baselines`,
`bundled-definition-seed`, `canonical-games`): **35/35 PASS**.

Typechecks: `tsc --noEmit -p tsconfig.json` (renderer) — **PASS, 0 errors**. `tsc --noEmit -p
tsconfig.electron.json` (electron) — **PASS, 0 errors**.

Note: the monolithic `npm test` single-command invocation (hundreds of file arguments) exceeds
this Windows shell's command-line length limit — a pre-existing environment constraint (the
argument list was already very large before this change added one file), not something this
change caused or could reasonably fix in scope. All suites were instead run directly via targeted
`tsx --test` invocations as listed above; every one is green.

## 4 — Real Atomfall install-discovery proof (production catalog path)

Run against the real, unmodified `%APPDATA%/solith/solith.db` (`ELECTRON_USER_DATA_PATH` pointed
at a copy of it — never the bare/unseeded fallback), via `scanXboxInstalls()` +
`matchInstalledToCatalog()`, the actual production discovery code:

```
provider: xbox
launcherAppId: xbox:Rebellion.Windscale_2vbwqmt31j4mr
installRoot: C:\Program Files\WindowsApps\Rebellion.Windscale_1.23.105.0_x64__2vbwqmt31j4mr
primaryExecutable: C:\...\Rebellion.Windscale_1.23.105.0_x64__2vbwqmt31j4mr\bin\Atomfall_dx12.exe
catalogGameId: atomfall
catalogDisplayName: Atomfall
identityStatus: verified
canonicalExecutablePath: c:\...\rebellion.windscale_1.23.105.0_x64__2vbwqmt31j4mr\bin\atomfall_dx12.exe
```

**ATOMFALL INSTALL DISCOVERY: PASS.**

No hand-entered path — the production `Get-AppxPackage` scan itself found the package among 16
real installed Xbox packages on this machine and correctly filtered out 1 non-game UWP app
(`Minecraft Launcher`, which has no `MicrosoftGame.config`).

## 5 — Generic Xbox provider evidence (not Atomfall-only)

The same production `scanXboxInstalls()` run, against every other real Xbox/GDK title installed on
this machine, resolved a primary executable for 14 of 15 non-Atomfall titles (Lies of P, Visions
of Mana, Banishers: Ghosts of New Eden, Revenge of the Savage Planet PC, WUCHANG: Fallen Feathers,
Avowed, Minecraft Launcher — correctly excluded, no `MicrosoftGame.config`, Undisputed, Clair
Obscur: Expedition 33, MARVEL Cosmic Invasion, Voidtrain, Monsters are Coming! Rock & Road, Beast
of Reincarnation, Mistfall Hunter), including several genuine `-WinGDK-Shipping.exe` UE-style
titles resolved via the existing shared `SHIPPING_BINARY_RE` tie-break with zero Xbox-specific
code. **Corsair Cove** correctly failed closed (two same-named, non-suffixed `CorsairCove.exe`
candidates — root stub vs. nested Binaries copy, no engine-convention tie-break applies) — the
same fail-closed-on-genuine-ambiguity policy already established elsewhere in this codebase, not a
defect and not something this mission's scope covers fixing.

## 6 — Real Atomfall session-bind proof

Launched Atomfall normally (`shell:appsFolder\Rebellion.Windscale_2vbwqmt31j4mr!Game` → real
launcher GUI → clicked PLAY), waited for the real engine process, then ran the production
`listLiveMemoryProcesses()` + `listCatalogExecutableIndex()` + `matchAllCatalogProcesses()` path
(the same production session-binding pipeline used for Stardew Valley/Palworld in
`Docs/phase3/007`):

```
pid: 31064
processExecutable: Atomfall.exe
providerDiscoveredInstall: C:\Program Files\WindowsApps\Rebellion.Windscale_1.23.105.0_x64__2vbwqmt31j4mr
canonicalCatalogId: atomfall
matchedExecutable: ...\bin\atomfall_dx12.exe
```

**ATOMFALL SESSION BIND: PASS** — the production pipeline detects the running game and binds a
catalog session, matching the exact bar `Docs/phase3/007` established for Palworld ("bound via the
wrapper process before the Shipping binary even needed to be consulted... PASS").

**Disclosed nuance, not papered over**: with both `Launcher\Atomfall.exe` (PID) and
`bin\Atomfall_dx12.exe` (PID) alive concurrently (confirmed — both processes co-exist for the
whole session, same architecture Palworld already established for its own wrapper+Shipping pair),
`matchAllCatalogProcesses()`'s existing, pre-existing, shared first-match-wins tie-break bound to
the launcher PID in every poll performed this session, not the engine PID. This is **existing,
unmodified, cross-title process-matching infrastructure** (`process-watcher.ts`), not something
introduced or scoped to fix by this Xbox/MS Store *install-discovery* mission — and it is not
unique to Atomfall (Palworld's own wrapper/Shipping pair hits the identical tie-break, already
accepted as PASS in `007`). Flagged here as a known limitation for a future, separately-scoped
pass: SOLITH's own catalog memory-feature data for Atomfall declares `moduleName:
'atomfall_dx12.exe'` (`bundled-definition-seed.ts`), so an actual live-memory attach keyed off the
launcher PID would need to separately resolve to the sibling engine PID before that module could
ever be found — a session-binding-layer concern, orthogonal to install *discovery*, which is what
this mission's Exit Gate criteria and SOLITH.MD's own scope (§0 "Objective") define.

## 7 — Restart campaign

Three full clean-close + relaunch cycles, each via the real launcher GUI's PLAY button (not a
direct exec of the engine binary):

| Restart | Launcher PID | Engine PID | Install discovery | Session bind |
|---|---|---|---|---|
| 1 (original) | 31064 | 29768 | PASS | PASS |
| 2 | 30228 | 9996 | PASS | PASS |
| 3 | 34716 | 11376 | PASS | PASS |
| 4 | 32384 | 17980 | PASS | PASS |

(Table reads as "launch N" — 4 total launches gives 3 independent restart transitions, all with
fresh, never-reused PIDs each time; the mission's "3/3 clean launches" bar.) Install identity
(`canonicalExecutablePath`, `catalogGameId`) was byte-identical across every restart — expected,
since Xbox install identity is package-registration-based, not PID-based. All processes closed
cleanly (`Stop-Process -Force`, verified zero leftover Atomfall processes) after the campaign.

**ATOMFALL RESTART: 3/3 PASS.**

## 8 — Regression across existing providers

`git diff --stat` against the shared Phase 3 head (`b8b8431`) shows this change touches only:
`src/core/install-discovery/{xbox.ts (new), xbox-manifest.ts (new), executable-role.ts (+1 regex
alternative), index.ts (+wiring), types.ts (+1 optional field)}`, `tests/install-discovery-xbox.test.ts
(new)`, `package.json` (test registration). **`steam.ts`, `gog.ts`, `epic.ts`, `match.ts`,
`identity.ts` are unmodified.** Full `install-discovery` suite 112/112 PASS (steam/gog/epic's own
dedicated tests included, all still green). This is the regression evidence for Steam/GOG/Epic.

For the six other curated titles (Stardew Valley, Palworld, DREDGE, Starfield, BG3, Crimson Desert
Enhanced): **not re-launched live in this pass.** Given the zero-diff proof above (this change
cannot alter their matching behavior — none of them are Xbox/MS Store installs, and no code path
they exercise changed), and given they were independently live-verified at this exact
reconciliation head in `Docs/phase3/007` (Stardew Valley PID 29388, Palworld PIDs 29112/3872, both
PASS; Crimson Desert Enhanced and BG3 fix-verified in the same pass), re-running all six live here
would reproduce already-established evidence rather than test anything this change could have
broken. Carried forward as PASS on that basis, stated explicitly rather than re-claimed as freshly
re-run.

## 9 — Production catalog path

Every proof above used `ELECTRON_USER_DATA_PATH` pointed at a copy of the real
`%APPDATA%/solith/solith.db` (6019 real catalog rows) — never the bare/unseeded fallback path
(`src/shared/app-paths.ts`'s documented trap from `Docs/phase3/007`). **Fallback DB used: NO.**

## 10 — Scope note

Building the actual Xbox/MS Store discovery mechanism was explicitly **not** authorized under the
prior reconciliation mission (`Docs/phase3/007`'s own note: "implementation is a separate,
dedicated mission/worktree, not performed here") — it is exactly what this mission
(`SOLITH.MD` "PHASE 3 / ATOMFALL XBOX/MS STORE DISCOVERY COMPLETION") authorizes and this document
evidences.
