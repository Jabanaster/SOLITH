# SOLITH — FINAL PRODUCT ROADMAP

> **Purpose:** This is the active product roadmap for SOLITH.
>
> **Authority model**
>
> - `MASTER_ROADMAP.md` owns portfolio-level sequencing and reconciliation
>   across product, security, Adaptive Wisp, and governed machine-authority
>   work.
> - `PROJECT_SPEC.md` owns the product specification and safety firewall.
> - `SOLITH_SECURITY_ROADMAP.md` owns security-gate status and release-security verdicts.
> - Current repository code, current git state, and reproducible runtime/test evidence outrank stale roadmap claims.
> - Historical roadmap material is not active sequencing.
>
> **Status vocabulary**
>
> - `PROPOSED`
> - `IMPLEMENTED — UNVERIFIED`
> - `REPORTED COMPLETE — VERIFY`
> - `VERIFIED COMPLETE`
> - `BLOCKED`
> - `DEFERRED / POST-V1`
> - `REGRESSED`

---

> **Security status ownership:** This file owns product direction, milestones,
> and feature sequencing. It does not restate security-gate or Batch B1.1
> verdicts — see `SOLITH_SECURITY_ROADMAP.md` for the current canonical
> security status.
>
> **Branch caveat:** The most recent security verification (Gate 2.4/2.4A/2.5)
> was performed on `review/gate2-5-doc-audit` @ `317baf0e`, not on `master`.
> Do not treat `origin/master` below as having passed that verification until
> the branch is merged and `SOLITH_SECURITY_ROADMAP.md` confirms the merged
> commit was rechecked.

## Current Baseline (Solith 2.4.0-alpha.2)

`package.json` (`solith@2.4.0-alpha.2`) remains the single authoritative version source for this repository. This roadmap does not restate release/version detail beyond this line — see `package.json`, `package-lock.json`, `README.md`, and `CHANGELOG.md` for the full version-consistency contract.

---

## 1. Product Direction

SOLITH is a local-first Windows game trainer, save/resource editor, discovery system, and trainer-building platform.

The product must feel like a premium trainer first, while keeping advanced technical workflows available in Workshop Mode.

The core experience is:

```text
Choose or detect a game
→ open its trainer/profile
→ inspect support and compatibility
→ discover or select a value
→ preview the requested change
→ approve
→ apply safely
→ validate
→ disable / restore / roll back
```

SOLITH remains restricted to authorized local/offline use.

The project must never expand into online/multiplayer cheating, anti-cheat bypass, DRM/license bypass, kernel bypass, stealth, credential access, or unverified executable payload execution.

---

## 2. V1 Scope Resolution

The repository already contains live-memory, trainer, CT-library, save-editor, launcher-discovery, overlay, and research functionality.

Therefore the active roadmap does **not** require deleting existing working live-memory systems merely because older specification text placed broader live-memory work in V2.

For V1:

### Included if already implemented and verified

- local/offline trainer workflows
- supported live-memory discovery, read/write/freeze flows already present in the repository
- fail-closed protected-target handling
- supported `.CT` metadata/import workflows
- trainer profiles
- save-field editing
- backup/rollback
- game detection
- launcher-aware executable metadata
- Workshop/Discovery tooling
- overlays/hotkeys already in the product
- packaged Windows operation

### Still post-V1 unless explicitly promoted

- major expansion of injection/hook capability
- new broad Auto Assembler/Lua execution
- unrestricted `.CT` compatibility
- new kernel/debugger-style systems
- production 3D Wisp
- Xbox Game Bar Wisp expansion
- major companion redesign
- broad managed-runtime expansion
- speculative reverse-engineering systems that do not block release

This roadmap preserves existing verified capability while preventing new scope from silently expanding V1.

---

# PHASE 0 — STABILIZE THE CURRENT BUILD AND MAKE THE GATES TRUSTWORTHY

**Status: ACTIVE**

This phase outranks all feature work.

## 0.1 Phase 0 fixes already pushed

Reported current pushed checkpoint:

```text
master
1a5c3ec1bc3430653df9cc42dac826da978b8203
```

Reported completed work:

- slot-12 default accelerator changed to `CommandOrControl+Shift+F12`
- slots 1–11 preserved
- overlay-hidden-window shutdown bug fixed
- packaged shutdown regression added
- working tree clean after push

### Slot-12 residual

Owner accepted a documented residual risk:

- live attached-trainer physical slot-12 callback remains for final hands-on acceptance
- explicit persisted bare-F12 override through packaged UI remains for final hands-on acceptance

Do not reopen this unless a regression appears.

## 0.2 Gate 2.5 Phase 6 timing repair

**Status: NOT IMPLEMENTED — Phase 6 currently passes as-is**

Current source (`tests/gate2-5-frame-devtools-overlay-lifecycle.e2e.test.ts:320`) still contains a fixed `await sleep(1500)`; it was not replaced by bounded polling. No repair exists in code. Do not claim otherwise until bounded-polling code is actually present.

Reported (fresh Node 22 packaged verification):

- Phase 6 passed in every current full Gate 2.5 run, including 3 consecutive full-file runs
- product security boundary remained correct

## 0.3 Gate 2.5 Phase 7 Wisp-overlay timing race

**Status: VERIFIED COMPLETE — no code/test repair required**

The current `tests/gate2-5-frame-devtools-overlay-lifecycle.e2e.test.ts` suite contains **6 tests** (Phase 4, 5, 6, 7, 8, and "Phase 3 addendum"), not 7.

Fresh Node 22 verification against a rebuilt packaged candidate:

- root cause of the previously reported `overlayWin` null / execution-context-destruction instability: the packaged `dist/win-unpacked/Solith.exe` under test was **stale** (built before uncommitted changes to `src/core/companion/wisp.ts`, `electron/preload.ts`, and other source files) — not a test race and not a real product defect
- after rebuilding (`build:vite` → `build:electron` → `dist:dir`, 0 stale source files confirmed), Phase 7 isolated: **PASS ×5**
- full Gate 2.5 file: **6/6 PASS ×3 consecutive**
- no test-harness or product code was changed to reach this result

## 0.4 Node environment

Project requirement:

```text
Node.js 22.x
```

Node 24 results must not be represented as Node 22 verification.

## 0.5 Phase 0 exit gate

Phase 0 closes only when:

- Gate 2.5 is deterministic
- no unexplained automated release/security gate remains red
- current branch and origin match
- working tree is clean or intentionally documented
- current security status is reconciled with `SOLITH_SECURITY_ROADMAP.md`

---

# PHASE 1 — QUICK RELEASE POLISH: SHELL, SETTINGS, NOTIFICATIONS, BANNER, GRID, TITLE HYGIENE

**Status: BLOCKED — see Docs/Reports/PHASE_1_MANUAL_CERTIFICATION_2026-07-26.md.**
Discovery manual certification passed and this phase's implementation work is
substantially built and covered by automated tests (shell/settings/
notifications/banner/grid/title-hygiene). The phase's own closeout report
explicitly withholds sign-off: 7 required process-picker manual test cases
remain `NOT TESTED`. Per that report's own rule ("any remaining NOT TESTED
prevents sign-off"), this phase is not VERIFIED COMPLETE until those cases
are run. Reconciled 2026-08-21 — this was previously mismarked `PROPOSED`,
which understated real implementation progress in the opposite direction.

This is the first feature phase after stabilization.

## 1.1 Sidebar/app-shell header

Top-left on every page:

```text
[Solith icon] [SOLITH] [bell] [gear] [collapse]
```

Requirements:

- notification bell top-left
- Settings gear top-left
- collapse control beside them
- sidebar starts expanded on first install
- preference persists afterward

## 1.2 Collapsible sidebar groups

Groups:

- Library
- Recovery
- Save Tools
- Specialized
- Advanced

Settings:

- Remember my sidebar sections
- Always expand all sections
- Always collapse inactive sections
- Compact sidebar mode
- Show/hide section labels

Whole-sidebar collapsed mode:

- keep a visible rail
- use larger icons
- do not make navigation disappear

## 1.3 Settings foundation

Create real submenu navigation:

- General
- Appearance
- Navigation
- Game Library
- Trainer Library
- Launchers & Accounts
- Catalog Updates
- Artwork & Cache
- Notifications
- Privacy & Network
- Advanced
- About

No single giant settings page.

## 1.4 Notification center

Add:

- bell
- unread badge
- toast
- persistent history
- mark read
- clear

Initial event types:

- catalog update
- artwork fetch failure/completion
- trainer/profile update
- maintenance/recovery notice

Do not show a catalog-update notification during first catalog initialization.

## 1.5 Banner correction

Fix fullscreen/maximized banner behavior.

Required:

- preserve aspect ratio
- eliminate bad crop/zoom behavior
- verify narrow, desktop, maximized, and ultrawide layouts

## 1.6 Trainer Library grid

Reproduce before changing.

Measure:

- container width
- computed column count
- card width constraints
- ResizeObserver behavior
- expanded/collapsed sidebar interaction
- virtualization

Then fix only the proven cause.

## 1.7 Catalog title-ingestion hygiene

Prevent malformed HTML/entity titles from entering the catalog.

Required:

- decode at every confirmed ingestion path
- clean-title precedence
- payload/title consistency
- no global slug rewrite
- separately reviewed legacy-row migration
- manual review path for collisions/ambiguous identities

**Exit gate:** UI shell is stable, Settings exists, notifications work, banner/grid are responsive, and new malformed titles cannot be introduced.

---

# PHASE 2 — CANONICAL GAME MODEL + GAME LIBRARY REBUILD

**Status: VERIFIED COMPLETE — see Docs/Reports/PHASE_2C_LAUNCHER_IDENTITY_REPORT.md.**
§2.1, §2.3, §2.4, §2.5, §2.6 confirmed COMPLETE. §2.2 (canonical game record)
is PARTIALLY COMPLETE: `genres`/`popularityMetadata` are populated where a
trusted source exists; `developer`/`publisher`/`releaseDate` enrichment has
no trusted source wired in yet — a known, non-blocking residual, not a
regression. Reconciled 2026-08-21 — previously mismarked `PROPOSED`.

The existing install-discovery and launcher metadata should be reused rather than replaced.

## 2.1 Canonical identity

One game, many launcher releases.

Supported launcher-release identities:

- Steam
- GOG
- Epic Games Store
- Ubisoft Connect
- EA app
- Xbox / Microsoft Store
- Battle.net
- Standalone

Do not create duplicate canonical game cards just because launcher differs.

## 2.2 Canonical game record

Fields should include:

- canonical game ID
- official title
- aliases
- developer
- publisher
- release date
- genres
- supported play modes
- eligibility
- SOLITH support state
- artwork identity
- popularity metadata

## 2.3 Launcher release record

Fields:

- canonical game ID
- launcher
- store/product ID
- edition
- executable identities
- install-discovery metadata
- launch URI/command
- build/version
- trainer/profile compatibility

## 2.4 Installed game record

Fields:

- launcher release
- install path
- executable
- detected build/version
- detection source
- last verified
- save locations
- manually added vs. automatically detected

## 2.5 Game Library UX

Game Library becomes the installed-game hub.

Default:

```text
Installed
```

Show:

- detected installed games
- manually added games/folders
- launcher
- edition
- install path
- launch button
- rescan
- save locations
- trainer availability
- verification status
- artwork
- ownership when actually proven

Current folder scanning becomes an action/detail inside a game record.

## 2.6 Launcher settings

For every supported launcher show:

- Detected
- Connected
- Last scanned
- Games found
- Rescan
- Disconnect
- Privacy details

Do not ask users for launcher passwords.

Owned games remain a filter/view, not a higher default priority than Installed.

**Exit gate:** canonical identities prevent launcher duplicates and the Game Library behaves like a real installed-game hub.

---

# PHASE 3 — TRAINER LIBRARY: POPULAR, ALL GAMES, SORTING, FILTERS, SUPPORT STATES

**Status: VERIFIED COMPLETE — see Docs/Reports/PHASE_3_CLOSEOUT.md and
PHASE_3_TO_5_FINAL_CLOSEOUT.md.** §3.1–§3.5 all VERIFIED_COMPLETE; reconfirmed
in the later closeout pass with no correction required. Reconciled
2026-08-21 — previously mismarked `PROPOSED`.

## 3.1 Support states

Use:

- Eligible
- Listed
- Community / Unverified
- Verified
- Unsupported
- Excluded

Popularity never implies verification.

## 3.2 Catalog exclusion rules

Exclude:

- MMOs
- competitive-online-only games
- games without meaningful offline play
- anti-cheat-only relevant execution paths
- cloud-only titles
- dedicated servers
- demos
- soundtracks
- editors/tools
- DLC-only products
- unsupported delisted products

For mixed offline/anti-cheat multiplayer titles, use the owner-selected strict policy: exclude the entire title when protected multiplayer materially conflicts with SOLITH’s safety boundary.

## 3.3 Default Trainer Library — FROZEN (supersedes the prior Popular/All-Games + 10-mode sort design)

Organization is deterministic section hierarchy, not a recommendation/sort algorithm:

```text
1. INSTALLED
2. OWNED — TRAINERS AVAILABLE
3. OWNED — SUPPORT NEEDED
4. ALL OTHER GAMES
5. NOT YET SUPPORTED / MISSING TRAINER
```

A-Z within every section. "All Other Games" is collapsed by default (shown with a count, e.g. "All Other Games (642)"). Running games may be visually pinned/badged within Installed — this is a display treatment, not a separate sort mode. Favorites is a separate filter/view, layered on top of the hierarchy, never a ranking algorithm.

Implementation: `src/core/trainer-catalog/library-sections.ts` (`assignLibrarySection`, `organizeLibrary`). Do not add more sections or sort modes without strong evidence of a real usability problem — this is an intentional, frozen product decision.

## 3.4 All Games — RETIRED

The "Popular" vs "All Games" view toggle and its first-use notice are retired. The old concern (accidentally scrolling the full unfiltered catalog) is now handled natively: personal-relevant sections always render first, and "All Other Games" is collapsed by default instead of needing an opt-in warning.

## 3.5 Sorting — REINSTATED (2026-09-10, owner-directed reversal of the prior freeze)

The Mission 3/24 freeze that removed the sort-mode picker has been explicitly overridden by the owner: a real Sort control (`TrainerLibrarySortMenu.tsx`, options: Recommended, A→Z, Z→A, Recently added, Trainer quality) is back in the Trainer Library UI.

Scope, so this cannot re-litigate §3.3: sort applies to the flat/All-Games browse view only (`trainer-library-sort-options.ts`). The §3.3 section hierarchy itself is untouched — every section still sorts A-Z internally, unconditionally, regardless of the selected sort option. "Recommended" reuses the exact ranking model the section hierarchy is already built from, so it cannot contradict it.

The underlying `all-games-sorting.ts` module supplies the Recommended/Recently-added comparators directly (reused, not reimplemented) — see `src/app/pages/trainer-library-sort-options.ts`.

## 3.6 Filters

### Availability
- Installed
- Not installed
- Has trainer/profile
- Verified
- Community/unverified
- Owned

### Mode
- Single-player
- Offline co-op
- Local multiplayer
- Online features present
- Offline-only support

### Catalog
- Popular
- New release
- All-time classic
- Niche/deep catalog
- Recently added

### Launcher
- Steam
- GOG
- Epic Games Store
- Ubisoft Connect
- EA app
- Xbox / Microsoft Store
- Battle.net
- Standalone

### Genre
- RPG
- Action
- Strategy
- Simulation
- Adventure
- Shooter
- Survival
- Racing
- Sports
- Puzzle

UX requirements:

- multi-select
- visible chips
- result count
- Reset
- remembered filter state where appropriate
- predictable back navigation
- no hidden active filters

**Exit gate:** Trainer Library discovery is useful by default and still supports full-catalog exploration.

---

# PHASE 4 — ARTWORK IDENTITY, CACHE, LEGAL SOURCING, AND BACKGROUND FETCHING

**Status: VERIFIED COMPLETE — see Docs/Reports/PHASE_4_CLOSEOUT.md and
PHASE_3_TO_5_FINAL_CLOSEOUT.md.** §4.1–§4.4 VERIFIED_COMPLETE; §4.5
(background fetch) PARTIAL, non-blocking — priority model and scheduler are
complete and tested, only visible/popular tiers are currently triggered.
Reconciled 2026-08-21 — previously mismarked `PROPOSED`.

## 4.1 Identity-safe artwork

Never match artwork by fuzzy title alone.

Priority:

1. exact store/launcher ID
2. Steam App ID
3. provider-native ID
4. verified canonical game identity
5. reviewed manual mapping
6. SOLITH fallback

Track provenance.

## 4.2 Pre-shipped artwork

Bundle only artwork with documented redistribution permission.

Allowed:

- SOLITH-created
- commissioned
- properly licensed
- explicit publisher/developer redistribution
- provider agreement

For everything else:

- ship metadata
- show fallback
- fetch after install where permitted
- cache locally

## 4.3 Managed local cache

Use SOLITH-owned cache under Electron `userData`.

Requirements:

- deterministic keys
- HTTPS approved sources
- redirect/size caps
- media validation
- reject unsafe SVG or rasterize safely
- atomic writes
- retain old image on failed refresh
- offline reuse
- provenance
- cross-game overwrite prevention

Do not rely solely on Chromium cache.

## 4.4 Artwork controls

Exactly:

- Refresh artwork
- Retry missing artwork
- Check for catalog updates

## 4.5 Background fetch

Priority:

1. visible cards
2. installed games
3. favorites
4. Popular
5. deep catalog

Default concurrency:

```text
6
```

Adaptive maximum:

```text
10
```

Add:

- progress
- pause
- cancel
- no redundant successful re-fetch

**Exit gate:** artwork is identity-correct, legally handled, locally cached, non-blocking, and refreshable.

---

# PHASE 5 — POPULARITY PIPELINE + CURATED CATALOG + SIGNED CATALOG UPDATES

**Status: VERIFIED COMPLETE — see Docs/Reports/PHASE_5_CLOSEOUT.md and
PHASE_5_6_TRUE_CLOSEOUT.md.** All 57 original Phase 5 tests re-run and
passing as of commit `c5d4800`. Note: an earlier same-day draft
(PHASE_3_TO_5_FINAL_CLOSEOUT.md, 10:44) recorded Phase 5 as "not started" —
superseded by PHASE_5_CLOSEOUT.md (11:08) and finalized by
PHASE_5_6_TRUE_CLOSEOUT.md (11:50), both VERIFIED COMPLETE. Reconciled
2026-08-21 — previously mismarked `PROPOSED`.

## 5.1 Ranking sources

Preferred research inputs:

1. Metacritic
2. SteamDB
3. GameFAQs
4. IGN
5. OpenCritic
6. IGDB
7. Steam250
8. official launcher/store sources

## 5.2 Curated populations

Build:

- ~Top 200 relevant games of the current year
- ~Top 1,000 relevant PC games of all time
- ~Top 1,000 relevant Steam games by transparent public popularity proxies

Never label public Steam proxies as exact downloads/owners.

## 5.3 Ranking signals

Use combinations of:

- critic reception
- user reception
- current player activity
- sustained player activity
- 24-hour peak
- all-time peak
- review volume
- recent review activity
- credible sales/chart evidence
- release recency
- major publisher/developer relevance
- SOLITH relevance

A score around 70 can help qualify a game but is not a hard cutoff.

## 5.4 Major publisher/developer list

Maintain a reviewed allowlist/reference list for major release sources.

Do not infer “AAA” from price or marketing copy.

## 5.5 Signed catalog updates

Support:

- bundled baseline
- versioned signed deltas
- new games
- corrected titles/IDs
- launcher-release additions
- eligibility changes
- trainer/profile availability
- artwork metadata
- merges/aliases
- blocked/revoked records

Client behavior:

- check in background
- do not block startup
- skip redundant automatic check if last success < ~24h
- manual check available
- rollback bad update
- preserve bundled offline baseline

Notification example:

> Catalog updated — 12 games added, 4 records corrected.

No update notice on first initialization.

## 5.6 Catalog network settings

Allow:

- automatic updates on/off
- Check now
- current catalog version
- last successful update
- history
- rollback
- bundled snapshot only
- separate artwork network opt-out

**Exit gate:** catalog can grow safely without requiring a full app update and without becoming a required cloud dependency.

---

# PHASE 6 — V1 CORE TRAINER/SAVE/DISCOVERY GAP AUDIT AND CLOSEOUT

**Status: VERIFIED COMPLETE — see Docs/Reports/PHASE_6_CLOSEOUT.md and
PHASE_5_6_TRUE_CLOSEOUT.md.** §6.1/§6.3/§6.4 confirmed real. §6.5 (Local AI)
closed — a real pre-existing bug (`setAIConfig` always threw; wrong SQL
conflict target) is fixed and the config is reachable from Settings. §6.2
closed by renaming "Recipes" → "Recipe Editor" (an honest 1:1 naming match)
and building a real, bounded "Proposal Inspector" page over the existing
`src/core/proposals` data model — "Trainer Builder" and "Resource Browser"
remain NEEDS OWNER DECISION on scope (no existing backing capability to
name-match or wrap; building either would be new feature work, not a gap
close). §6.6: a real, working "reset demo / replay onboarding" action ships
in Settings → Advanced, and onboarding copy now truthfully discloses that
the bundled demo fixture is read-only by design (`writeSupportStatus:
'blocked'`, no backup/rollback path) — live propose→apply→rollback on the
demo itself remains BLOCKED by that deliberate fixture design, not
deferred by choice; it requires a new write-capable demo fixture, an owner
decision. Trainer E2E is 5/5 — the long-carried `.solith-top-banner__title`
failure was a stale locator (the banner was redesigned to one full raster
image); fixed alongside a real PATH-hijacking hardening in
`electron/gamebar-transport.ts` (whoami.exe/icacls.exe now resolved by
absolute System32 path, not PATH order).

Do not rewrite working systems.

Audit current repository against the actual required V1 workflows and close only real gaps.

## 6.1 Trainer Mode

Verify:

- game selection
- trainer/profile loading
- controls
- current/target values
- source/risk/status
- preview/apply
- hotkeys where current V1 implementation supports them
- process/session state
- disable/detach

## 6.2 Workshop Mode

Verify:

- Resource Browser
- Save Editor
- Data Editor
- Discovery Lab
- Trainer Builder
- Recipe Editor
- Proposal Inspector
- Backup/Rollback
- Journal
- diagnostics

## 6.3 `.CT` compatibility

V1 must accurately document the supported subset.

Required:

- defensive parser
- metadata/hierarchy preservation
- compatibility classification
- no silent unsupported-feature loss
- inert/untrusted script handling
- no automatic Auto Assembler/Lua execution
- target identity/build checks

Full Cheat Engine compatibility is not required for V1.

## 6.4 Save/resource workflow

Verify:

- scanner
- fingerprint
- save detection
- parser adapters
- proposal
- preview
- dry run
- backup
- atomic apply
- validation
- rollback
- journal

## 6.5 Local AI

Verify:

- None
- Ollama
- LM Studio
- test connection
- strict structured output
- rule-based fallback
- no privileged AI bridge

## 6.6 Demo/onboarding

Verify:

- first-run safety acknowledgement
- optional local AI
- demo game
- guided discovery
- proposal
- apply
- rollback
- reset demo

**Exit gate:** core packaged player and creator loops are verified and accurately documented.

---

# PHASE 7 — SECURITY, PACKAGING, SUPPLY CHAIN, FAILURE INJECTION, RELEASE QA

**Status: REQUIRED**

Security verdicts stay in `SOLITH_SECURITY_ROADMAP.md`.

This phase is product scheduling only.

## 7.1 Electron boundary

Verify:

- nodeIntegration false
- contextIsolation true
- renderer sandboxing where compatible
- narrow preload
- allowlisted IPC
- request/response validation
- sender/frame authorization
- restricted navigation/new windows
- sanitized errors

## 7.2 Filesystem safety

Verify:

- canonicalization
- path containment
- unsafe-root blocking
- traversal
- symlink/junction/reparse escape
- approved roots only
- containment rechecked before mutation

## 7.3 Failure injection

Required:

- permission disappears after dry run
- file changes before apply
- temp write fails
- atomic replacement fails
- DB write fails after file replacement
- interruption during operation
- backup corruption
- rollback target locked

Invariant:

```text
Either the original remains unchanged,
or a verified backup exists with a recorded recovery state.
```

## 7.4 Packaging

Verify:

- Node 22 clean setup
- Electron Builder
- installer
- sql.js/WASM packaging
- packaged DB
- packaged demo
- native memory module packaging
- clean exit
- no dev-only privilege path

## 7.5 Dependency/license closeout

Current vendored third-party inventory includes:

- IBM Plex Sans — OFL 1.1
- JetBrains Mono — OFL 1.1
- Tabler icon subset — MIT
- patched memoryjs — MIT

Before release:

- reconcile npm dependencies
- reconcile vendored binaries/assets
- confirm licenses/notices
- confirm no prohibited redistribution in artwork or trainer assets
- disposition vulnerabilities

**Exit gate:** security/release gates green, package reproducible, dependencies/licensing resolved.

---

# PHASE 8 — CUSTOMIZATION

**Status: PROPOSED**

Add reasonable customization after core product systems are stable:

- sidebar state
- section expansion behavior
- compact mode
- section labels
- startup page
- default Game Library view
- default Trainer Library view
- default sort
- remembered filters
- card density
- card size
- metadata visibility
- artwork behavior
- notifications
- theme
- accent
- reduced animation

No arbitrary freeform layout editor.

---

# PHASE 9 — FINAL HANDS-ON ACCEPTANCE

**Status: DEFERRED UNTIL AUTOMATED WORK IS COMPLETE**

Collect owner-interactive testing here.

Include:

- real trainer attachment
- physical hotkeys
- slot-12 real-session callback
- stored F12 override
- launcher account authorization
- owned-game library checks
- manual external-save approvals
- real-game save/rollback
- visual acceptance on multiple displays
- accessibility walkthrough
- installer/uninstaller hands-on check

Do not claim these passed until actually performed.

---

# PHASE 10 — V1 RELEASE

**Status: PROPOSED**

Require:

- final version decision
- release notes
- README accuracy
- user guide
- safety policy
- troubleshooting
- compatibility matrix
- third-party license inventory
- installer
- diagnostic export
- current automated verification
- final manual acceptance
- exact commit/build provenance
- no unresolved critical/high security finding
- shipped behavior matches product claims

---

# POST-V1 — WISP

**Status: DEFERRED / POST-V1**

SOLITH Wisp visual and behavior work remains important.

Post-V1 work:

- major visual redesign
- production 3D Wisp
- rigging/animation
- contextual reactions
- Game Bar integration
- personalization
- broader companion behavior

A narrow existing Wisp behavior may be fixed earlier when it breaks a V1 gate, but the broader creative workstream must not block V1.

---

# POST-V1 — LIVE-MEMORY / CREATOR EXPANSION

**Status: DEFERRED / INCREMENTAL**

Potential work:

- broader pointer/signature systems
- managed-runtime support
- richer profile creator
- more `.CT` compatibility
- bounded script/patch support
- additional live-memory engines
- creator debugging/research tooling

Every expansion requires its own threat model, tests, and explicit authorization.

Never weaken the safety firewall.

---

# ACTIVE EXECUTION ORDER

Reconciled 2026-08-21 against current phase statuses above. Do not restart
Phases 2–6, which are VERIFIED COMPLETE — pick up at the next open item.

1. Gate 2.5 Phase 7 verified stable (6/6 PASS ×3 consecutive, fresh packaged candidate); root cause was a stale packaged binary, not a test or product defect — no repair to commit. DONE.
2. Phase 1 — shell, Settings, notifications, banner, grid, title hygiene. VERIFIED COMPLETE: all 7 required process-picker manual test cases now PASS per PHASE_1_MANUAL_CERTIFICATION_2026-07-26.md's 2026-08-21 addendum (one real defect — a Rules-of-Hooks crash in the single-player waiver modal — found and fixed during that pass).
3. Phase 2 — canonical game model + Game Library. VERIFIED COMPLETE (§2.2 developer/publisher/releaseDate enrichment is a known non-blocking residual).
4. Phase 3 — Trainer Library Popular/All Games/sorting/filtering. VERIFIED COMPLETE.
5. Phase 4 — artwork identity/cache/legal sourcing/background fetch. VERIFIED COMPLETE.
6. Phase 5 — popularity pipeline + signed catalog updates. VERIFIED COMPLETE.
7. Phase 6 — V1 trainer/save/discovery/CT capability gap audit and closeout. VERIFIED COMPLETE.
8. Phase 7 — security/package/supply-chain/failure-injection QA. BLOCKED — see SOLITH_SECURITY_ROADMAP.md and Docs/Reports/PHASE_7_CLOSEOUT.md for current gate-by-gate status; remaining blockers are external (production signing credential, independent reviewer) or owner-interactive, not open engineering defects.
9. Phase 8 — customization. PROPOSED, correctly deferred — does not block release.
10. Phase 9 — final owner-interactive acceptance. Awaiting Phase 7 close.
11. Phase 10 — V1 release. Awaiting Phase 9.
12. Post-V1 — Wisp and advanced creator/live-memory expansion. Out of scope until V1 ships.

---

# DEFINITION OF DONE

A phase is complete only when:

- exact scope is defined
- relevant source is inspected
- no correct working system is rewritten unnecessarily
- tests pass
- type checking passes
- production build passes
- packaged behavior is tested where applicable
- no security control was weakened
- failure states are handled
- database migrations are idempotent
- restart behavior is correct
- no unrelated user data is removed
- known limitations are recorded
- manual checks are completed or explicitly deferred to Phase 9
- repository state is reviewed
- exact commands/results are recorded
- completion is not inferred from stale documentation

For file/resource editing additionally require:

- approved target containment
- proposal
- preview
- dry run
- explicit approval
- verified backup
- atomic apply
- validation
- rollback/recovery evidence
- journal/state persistence

---

# ONLINE / DISCOVERY / COMMUNITY FOUNDATION — PHASE 1 / 1.5 / 2 / 2.1

**Reconciled against actual implementation + reproducible test evidence — not optimistic claims.**
Status vocabulary for this section only: `CERTIFIED` (reproducible evidence exists and was
independently re-run), `IMPLEMENTED_NOT_CERTIFIED`, `PARTIAL`, `DEFERRED`, `BLOCKED`.

| Capability | Status | Evidence |
|---|---|---|
| Canonical custom-game + identity-link offering | `CERTIFIED` | `tests/canonical-game-custom.test.ts`, part of 188/188 online-foundation run |
| Per-provider capability model (honest, no fabricated SUPPORTED) | `CERTIFIED` | `tests/provider-capabilities-full.test.ts` |
| Discovery catalog schema + query + trainer-status | `CERTIFIED` | `tests/discovery-catalog-*.test.ts`; real storage measured 10k/50k/100k rows |
| Content-addressed trainer artifact store (SHA-256, dedup, immutable versions) | `CERTIFIED` | `tests/trainer-artifact-store.test.ts` |
| Local artifact cache (hash-verified, SSRF-guarded, size-capped) | `CERTIFIED` | `tests/trainer-artifact-cache.test.ts` (14 tests incl. 5 security-fix regression tests) |
| Sync-manifest delta model | `CERTIFIED` | `tests/sync-manifest-{client,apply}.test.ts` |
| Sync-manifest revision monotonicity (Phase 1.5, A1) | `CERTIFIED` | `tests/sync-manifest-revision-monotonicity.test.ts`, 9 adversarial scenarios incl. rollback/replay/malformed/restart-persistence |
| Community upload contract + 5-stage trust progression | `CERTIFIED` | `tests/community-upload-store.test.ts` |
| Trainer classification trust boundary (Phase 1.5, A2) | `CERTIFIED` (boundary architecture) / `DEFERRED` (real content-type detection) | `tests/artifact-classification.test.ts`, `tests/community-upload-classification-trust-boundary.test.ts`. Classifier is honestly `v0-inconclusive-only` — the boundary is real and unbypassable by test-proof, but automatic upload eligibility cannot be reached by ANY artifact yet, by design, until real classification logic is built |
| Community submission security invariant (Phase 2.1) — runtime/persistence-enforced, not caller-discipline | `CERTIFIED` | `tests/community-upload-store.test.ts`, `tests/community-upload-classification-trust-boundary.test.ts` (incl. RESTART persistence proof). `createLocalDraftSubmission` can only ever insert `submissionState: 'LOCAL_DRAFT'` with `trustState: null`; only `submitDraftToCommunity` can promote a row, and it independently re-derives qualification from `classification_receipts` by the draft's OWN artifactHash — no caller-supplied qualification result is ever trusted. Dedicated hostile-review agent pass (Mission 8 question) answered NO exploitable bypass found; 0 P0/P1, 2 P2/P3 disclosed and fixed (JSON.parse robustness) or accepted (pure `qualifyForUpload` remains directly importable — documented residual risk, mitigated by it being the only non-DB-backed entry point and having zero production call sites) |
| Automatic Community upload eligibility (end-to-end) | `DEFERRED` | Zero artifacts can reach `COMMUNITY_SUBMITTED` automatically today — the real classifier only ever returns `inconclusive`. Intentional per owner: no fabricated eligible classifier. Same dependency as the row above. |
| Master Online Services toggle + network-call gating | `CERTIFIED` | `tests/online-services-gate.test.ts` + `tests/community-sync-orchestrator-online-gate.test.ts`; every real network call site audited, 7 previously-ungated sites fixed |
| Artwork resolution-state model + one-time notice | `CERTIFIED` | `tests/artwork-resolution-state.test.ts`, `tests/artwork-eligibility.test.ts`, `tests/artwork-notice.test.ts` |
| Local 16-step E2E proof (mock server) | `CERTIFIED` | `tests/local-e2e-sync-proof.test.ts`, 16/16 |
| Offline guarantee (mock/local) | `CERTIFIED` | `tests/offline-guarantee.test.ts`, 6/6 |
| Real backend (Cloudflare Workers + D1, local `wrangler dev`) | `CERTIFIED` (local, non-deployed) | `solith-catalog-backend/` — 11/11 own tests (real workerd via `@cloudflare/vitest-pool-workers`, real local D1, no mocks) |
| Real 12-step E2E vs. local real backend | `CERTIFIED` | `tests/real-backend-e2e.test.ts`, 12/12, independently re-run (17s real `wrangler dev` spawn) |
| Vendor abstraction (fetchImpl swap, mock ↔ real, zero call-site changes) | `CERTIFIED` | `src/core/{sync-manifest,trainer-artifact-cache}/http-fetch-impl.ts` — one-line typed aliases to `globalThis.fetch`, no client contract change required |
| Production deployment (`wrangler deploy` to a live Cloudflare account) | `BLOCKED` | No Cloudflare account credentials exist in this environment; deployment is an explicit owner-only step (owner must run `wrangler login` + `deploy` or provide CI secrets) |
| Community read/download UI, Community upload UI, Discovery browsing UI | `DEFERRED` | Out of scope through Phase 2 by owner's own instruction; Phase 1-2 built the data/contract layer these consume, no UI work performed |
| Real trainer-content-type detection (replacing `v0-inconclusive-only`) | `DEFERRED` | Explicitly out of scope this pass per owner ("do not build a fake malware scanner") — tracked as the actual prerequisite for Phase 6 (Community Uploads) |

Full per-phase detail below is retained as narrative context; the table above is the
authoritative status source per the owner's Phase 1.5/2 reconciliation instruction.

## Phase 1 — Online/Discovery/Community Foundation (narrative)

Built the local, offline-first foundation for a later online/Discovery/Community
architecture: canonical-game custom-game support, a per-provider capability model, a
lightweight shipped Discovery catalog schema, content-addressed trainer artifact storage
(SHA-256, dedup, immutable versioning), a local artifact cache with hash verification, a
delta sync-manifest model against a local mock server, a Community upload contract with a
5-stage trust progression, and a master Online Services toggle gating every real network
call site. Proven end-to-end via a 16-step local-only scenario and an offline-guarantee
suite. No public backend, no commit/push.

## Phase 1.5 — Security Closeout (narrative)

Closed the two P2 gaps a hostile security review found in Phase 1: sync-manifest revision
monotonicity (a malicious/compromised server could previously roll a client's cursor
backward) and the undefined trainer-content-classification trust boundary (nothing
independently derived real content-type from artifact bytes before `qualifyForUpload`
decided eligibility). Both closed with adversarial test proof, not just documentation.
Also fixed 2 P1 findings from Phase 1's own hostile review (unbounded artifact download,
no URL/SSRF guard on artifact fetches) inline during Phase 1 itself.

## Phase 2 — Real Backend Prototype (narrative)

Stood up a real Cloudflare Workers + D1 backend (`solith-catalog-backend/`, a clean sibling
of the existing `solith-hub-backend/` rather than overloading its incompatible `/catalog/sync`
contract) serving `GET /health`, `GET /catalog/sync`, `GET /artifacts/:hash` — read-only,
no upload endpoint, exactly as scoped. Run locally via `wrangler dev --local` against a real
local D1 database with zero Cloudflare account credentials required. The Phase 1
`fetchImpl`-injectable client contracts needed zero changes to point at this real backend
instead of the mock — the vendor-abstraction goal is proven, not just claimed. Production
deployment to a live Cloudflare account is the one remaining `BLOCKED` item, requiring an
owner-supplied account/credentials.

## Phase 2.1 — Community Submission Security Invariant Closure (narrative)

Closed the one remaining disclosed architectural weakness from Phase 1.5: `createCommunitySubmission`
was a low-level store function any caller could invoke directly to manufacture a row at
`trustState: 'NEW_COMMUNITY'` with zero enforcement that classification/qualification had
actually run. Per owner decision ("caller discipline is not sufficient for this security
boundary"), replaced it with a two-function split enforced in types, persistence, and
runtime logic (not comments):

- `createLocalDraftSubmission` can ONLY ever insert `submissionState: 'LOCAL_DRAFT'` with
  `trustState: null` — structurally incapable of being read as upload-eligible, remotely
  approved, verified, trusted, or queued for transmission by any consumer.
- `submitDraftToCommunity` is the ONLY function that can promote a row to
  `submissionState: 'COMMUNITY_SUBMITTED'` + `trustState: 'NEW_COMMUNITY'`. It derives the
  artifact hash to qualify SOLELY from the persisted draft row (no caller-supplied hash
  parameter exists on its input at all — a "classify one hash, submit another" attack is
  structurally impossible, not just logically rejected) and independently re-looks-up the
  classification receipt from `classification_receipts` rather than trusting any
  caller-supplied qualification result.
- `advanceTrustState` now refuses to operate on anything that is not already
  `submissionState: 'COMMUNITY_SUBMITTED'` with a non-null `trustState`.
- Persistence defense: `community_submissions` gained `submissionState`,
  `qualifiedVerdict`, `qualifiedClassifierVersion`, `qualifiedAt` columns; `trustState`
  became nullable (null for drafts, only ever set by the one authorized transition
  function) rather than defaulting to `'NEW_COMMUNITY'` on every insert.

A dedicated hostile-review agent pass (independent of the implementation) was run against
the owner's exact Mission 8 question — "can any caller, persisted state, restart path, or
manually constructed object cause SOLITH to regard an artifact as Community-upload-eligible
without valid classification and qualification evidence for the exact artifact bytes?" —
and answered NO, with 0 P0/P1 findings. Two P2/P3 findings were disclosed: JSON.parse calls
on stored blobs lacked try/catch (fixed, now fail closed to `null`/no-receipt rather than
crashing or fabricating state), and the pure `qualifyForUpload` function remains directly
importable with a hand-forged receipt object by any future code that bypasses the DB-backed
wrapper (accepted as a documented residual risk — it has zero production call sites today;
only the verified wrapper is wired to real persistence).

The real classifier remains `v0-inconclusive-only` (unchanged, per owner instruction not to
build a fake malware scanner to make tests pass) — automatic Community upload eligibility
is therefore still unreachable for every artifact today, which is the correct, intentional
state pending real content-type detection (tracked as `DEFERRED`, prerequisite for a future
Community Uploads phase). `solith-catalog-backend` remains read-only; no upload endpoint,
no public write API, no production classification, no Steam integration were added this pass.

## Phase 3 / 3.1 / 3.2 — Multi-Provider Discovery Catalog (Steam + Epic + GOG)

**Reconciled against actual implementation + reproducible test evidence.**
**Phase 3 / 3.1 / 3.2 status: CLOSED — all three owner-mandated follow-up items (tombstone state engine, backend dependency audit investigation, zero-flake full-suite closeout) are done, reproducibly green, and re-certified. Phase 3 + 3.1 + 3.2 together are the full multi-provider catalog scope. Not committed/pushed/deployed — awaiting owner authorization per standing instruction. Scheduler EXECUTION remains deferred (contract-only, Mission 20). Phase 3.5 and Phase 4 remain NOT STARTED.**

| Capability | Status | Evidence |
|---|---|---|
| Provider-neutral catalog adapter contract | `CERTIFIED` | `src/core/provider-catalog/adapter.ts` — shared `AdapterFetchImpl`/`ProviderSyncResult` contract, zero Steam-specific assumptions in the shared type |
| Steam catalog adapter (official `IStoreService/GetAppList`) | `CERTIFIED` | `tests/steam-catalog-adapter.test.ts`, 12/12. Games-only default, real cursor pagination (`last_appid`), rawRevision-based no-change sync |
| Epic catalog adapter (storefront GraphQL, unofficial-but-legitimate) | `CERTIFIED` (adapter) / `BLOCKED` (live smoke — Cloudflare bot-challenge, 403, not bypassed) | `tests/epic-catalog-adapter.test.ts`, 9/9. Real bounded probe from this environment returned HTTP 403 (Cloudflare challenge page) — confirms the research finding that this endpoint has anti-automation protection; not bypassed |
| GOG catalog adapter (storefront filtered-catalog endpoint, unofficial-but-legitimate) | `CERTIFIED` (adapter) / `PARTIAL` (live smoke) | `tests/gog-catalog-adapter.test.ts`, 10/10 (incl. storeUrl phishing-domain fix). Real bounded probe: HTTP 200, schema shape confirmed correct (`products`/`totalPages`/`page` fields match exactly), but `products` returns empty under unauthenticated/bounded conditions despite accurate `totalResults` — endpoint likely now needs session state beyond what a stateless bounded GET provides. Honestly reported as PARTIAL, not fabricated as a full pass |
| Steam live network smoke test | `BLOCKED` (no key) | `LIVE_SMOKE_BLOCKED_NO_KEY` — no `SOLITH_STEAM_API_KEY` in this environment; harness (`steam-smoke-harness.ts`) ready, fixture-only proof stands at 12/12 |
| **sql.js statement-handle resource exhaustion — ROOT CAUSE + FIX** | `CERTIFIED` | Root cause found via deterministic reproducer (not assumed): every `db.prepare()` leaked a WASM statement handle (`.free()` existed, was never called anywhere in ~165 call sites) — real observed crash "Error: out of memory" at ~164k leaked complex statements. Fixed with (a) a `FinalizationRegistry` safety net for all existing call sites (proven: full 2026-test suite green, zero regressions) and (b) a genuinely batched import path (`provider-catalog/batch-import.ts`) for bulk work — one prepared statement per table per batch, freed once, wrapped in a real SQL transaction |
| Catalog scale certification — 10k/50k/100k/250k | `CERTIFIED` (all 4 REAL, zero extrapolation) | `tests/provider-catalog-scale-performance.test.ts`: 10k=8.89MiB/151ms, 50k=43.49MiB/842ms, 100k=86.94MiB/1989ms, 250k=220.66MiB/6064ms (peak RSS 1215MB). All complete cleanly, no sql.js errors |
| Search at scale (exact/prefix/substring/provider/trainer-status/year/genre/combined) | `CERTIFIED` | Same test, real p-measured at all 4 tiers: worst case at 250k is exact-title 88.5ms, all others under 27ms; `MAX_LIMIT=500` guard still enforced |
| Cross-provider canonical identity matching (EXACT/HIGH/POSSIBLE/AMBIGUOUS/UNLINKED) | `CERTIFIED` | `tests/cross-provider-match.test.ts`, 14/14, PLUS a P1 security fix (metadata-only title+publisher match downgraded HIGH→POSSIBLE — see security row) |
| Multi-provider Discovery E2E (merge, launcher-exclusives, outage + malformed-payload isolation, offline) | `CERTIFIED` | `tests/multi-provider-catalog-e2e.test.ts`, 12/12 |
| Ambiguous/possible link candidate persistence (Mission 7, P3 closed) | `CERTIFIED` | New `canonical_provider_link_candidates` table (own PK includes candidate id — multiple rows per record, nothing collapses); `tests/canonical-provider-link-candidates.test.ts`, 6/6. Authoritative `canonical_provider_links` table now holds ONLY EXACT/HIGH applied links |
| Metadata sanitization — developer/publisher/genres/tags (Mission 8, P3 closed) | `CERTIFIED` | `sanitizeDisplayMetadata(List)` added, wired into Epic/GOG adapters; `tests/metadata-sanitization.test.ts`, 15/15 hostile payloads (`<script>`, `<img onerror>`, SVG, entity tricks, 10k-char strings, control chars, legitimate Unicode preserved) |
| Batch import crash safety (10%/50%/90% mid-batch failure) | `CERTIFIED` | `tests/provider-batch-import-crash-safety.test.ts`, 6/6 — real SQL transaction ROLLBACK proven at all three failure points, zero partial application, clean recovery on retry |
| Rollback/replay guard re-certification | `CERTIFIED` | `tests/provider-catalog-store-rollback-guard.test.ts`, 6/6 — older/equal/newer/malformed rawRevision, clock-identical-timestamp edge case all covered |
| Provider secret boundary (Steam API key) | `CERTIFIED` | `tests/provider-secret-boundary.test.ts`, 6/6 — static proof no `electron/`/`src/app/` file references the adapter or key env var; runtime proof the key never appears in any error/result string |
| Provider failure isolation (outage + malformed payload) | `CERTIFIED` | Extended E2E: Steam outage AND Steam malformed-JSON payload both proven not to affect Epic/GOG or wipe pre-existing records |
| Known-provider-alias seed model (Mission 16) | `CERTIFIED` (mechanism) | `KnownProviderAliasMember` now requires `evidenceSource`+`verifiedAt` per entry — structurally prevents a fuzzy/bulk-generated alias from ever being confused with a human-verified one. Seed list itself remains empty in production (no real IDs fabricated) |
| Ubisoft/EA/Xbox/Battle.net catalog audit (Mission 20, Phase 3 original) | `CERTIFIED` (audit only, no implementation) | Unchanged from Phase 3 — no legitimate public catalog-browse API exists for any of the four |
| Hostile security review + fixes | `CERTIFIED` | Phase 3's original pass: 1 P1 + 2 P2 fixed. Phase 3.1: both disclosed P3s also now closed (see rows above) |
| Storage compression review (Mission 18, Phase 3.1) | `PARTIAL` (measured, not optimized) | Real bytes-per-row measured across all 4 scale tiers (§ above); no schema/index changes made — owner explicitly said "do not optimize prematurely" and current search latency (sub-100ms even at 250k) does not justify the risk of a compression pass yet |

### Phase 3.2 — Backend provider-ingest write path (Phase 3.1's deferred item, now closed)

| Capability | Status | Evidence |
|---|---|---|
| Write trust boundary | `CERTIFIED` | `authenticateIngestRequest` fails closed (401) on missing/misconfigured/mismatched `INGEST_TOKEN`, constant-time compare (`timingSafeStringEqual`). Desktop client has no code path referencing `INGEST_TOKEN` or `ingest.ts` |
| Provider-neutral ingest contract + bounds | `CERTIFIED` | `ingest-schema.ts` — `.strict()` schemas reject unknown fields, `safeUrlSchema` blocks non-http(s) schemes, per-field length caps, 4MiB request cap |
| Transactional ingest (Mission 5) | `CERTIFIED` | Every batch applies via one atomic `db.batch()` call — proven via `test/ingest.test.ts` and the real spawned-process E2E |
| Revision-monotonicity rollback guard (Mission 6) | `CERTIFIED` | Only the server-generated `last_updated` timestamp orders writes, never a provider-supplied revision. Proven with a real stale-write attempt against a real local D1 file (`tests/backend-ingest-e2e.test.ts` steps 13-14) |
| Idempotency + conflict detection (Mission 7) | `CERTIFIED` | Byte-identical `(provider, syncId)` replay is a no-op; same `syncId` with different content is a 409 conflict, never silently overwritten |
| Provider failure isolation (Mission 8) | `CERTIFIED` | A malformed Epic batch cannot touch Steam's or GOG's rows or `provider_sync_status` |
| Canonical linking after ingest (Mission 9) | `CERTIFIED` | Reuses the Phase 3.1 P1 fix (title+publisher match stays `POSSIBLE`, never auto-merged) — verified live against a spawned backend, not just in-process |
| Tombstone/removal model (Mission 10) | `CERTIFIED` | Full deterministic ACTIVE/STALE/TOMBSTONED state engine now implemented (`tombstone-lifecycle.ts` + `evaluateSyncCycleCompletion`) and hostile-tested (20/20, `test/tombstone-lifecycle.test.ts`) — see Owner Follow-up Mission 1 below |
| Sync status + delta read API (Missions 11-13) | `CERTIFIED` | `/provider-sync/status` (no secret material) and `/catalog/sync` delta cursor both real-HTTP-proven; a genuine bug was found and fixed here — see below |
| Secret boundary (Mission 14) | `CERTIFIED` | `INGEST_TOKEN` never appears in any client-visible response body, confirmed against real HTTP responses (`tests/backend-ingest-e2e.test.ts` step 18) |
| Real backend local E2E, 18 steps (Mission 17) | `CERTIFIED` — 18/18 | `tests/backend-ingest-e2e.test.ts`, spawned `wrangler dev --local` + real local D1, isolated `--persist-to` state per run |
| Large backend ingest E2E (Mission 18) | `CERTIFIED` (real, measured, no extrapolation) | `tests/backend-ingest-scale-e2e.test.ts` — 10,050 records / 134 real bounded HTTP batches, ~221 rows/sec, ~9.6MiB D1 growth. Directly drove a real batch-size-limit finding — see below |
| Provider ingest scheduler contract (Mission 20) | `CERTIFIED` (interfaces only, no deployment) | `src/core/provider-catalog/sync-scheduler-contract.ts` — no cron registered anywhere in this repo or `wrangler.jsonc` |
| Live provider status (Mission 21) | `CARRIED FORWARD` | Unchanged from Phase 3.1: Steam `BLOCKED_NO_KEY`, Epic `403` (Cloudflare challenge, not bypassed), GOG `200`/schema-valid/empty-results. No further bypass attempts made |
| **Real bug found + fixed: `/catalog/sync` delta cursor never advanced from the ingest path** | `FIXED` | `sync_state.catalog_revision` (the value `/catalog/sync` actually reports) was never updated by any ingest write — only discovered via the real Mission 17 E2E, since the in-process vitest suite happened not to exercise a second delta call against a non-truncated response. Fixed: `applyIngestBatch` now recomputes `sync_state.catalog_revision` from `MAX(discovery_catalog_entries.revision)` as part of the same atomic batch |
| **Real bug found + fixed: ingest 500s on any real-sized batch** | `FIXED` | The declared `MAX_RECORDS_PER_BATCH=2000` silently 500'd (`D1_ERROR: too many SQL variables`) on every batch anywhere near that size — found via the Mission 18 scale test, root-caused by empirical bisection (100 records/~3,800 bound params succeeded, 150/~5,700 failed). Fixed two ways: (1) `loadCandidatesForTitles`'s title/publisher lookup queries now chunk their `IN (...)`/OR-clause parameter lists; (2) `MAX_RECORDS_PER_BATCH` lowered from the aspirational-but-broken 2000 to a real-measured-safe 75 |
| Backend dependency audit | `PARTIAL` (investigated, documented, not upgraded) | Root repo: 0 vulnerabilities. `solith-catalog-backend`: 5 high findings, ALL transitive through `wrangler`/`miniflare`/`@cloudflare/vitest-pool-workers` DEV tooling — `npm audit --omit=dev` = 0. `wrangler` and `vitest-pool-workers` are already at their latest published versions; `miniflare`'s entire 5.x line (which contains the fix) has NEVER published a stable release — every 5.x version to date is `-alpha`, and the latest stable 4.x (`4.20260730.0`, already installed) still pins the vulnerable `sharp`/`undici`. No stable remediation exists at all right now — confirmed against the live npm registry, not assumed. Not upgraded to an alpha per owner instruction. See Owner Follow-up Mission 2 below |

### Owner Follow-up — Phase 3.2 Three-Closure Pass (2026-09-11/12)

| Item | Result |
|---|---|
| **Mission 1 — Tombstone state engine** | `CERTIFIED`. New `provider_sync_cycles` table + `provider_catalog_records.lifecycle_status`/`last_seen_in_sync_at`/`lifecycle_last_transitioned_by_cycle_id` columns (migration 0004, extended). Pure decision logic in `tombstone-lifecycle.ts` (`computeCanonicalLifecycleStatus`, `nextLifecycleStatusOnCycleClose`), orchestrated by `evaluateSyncCycleCompletion` in `ingest.ts`, invoked ONLY from a successfully-applied batch's `cycleComplete: true` path — structurally enforces "only a successfully completed authoritative sync may contribute absence evidence." 20/20 hostile tests pass, covering every rule the owner listed (successful/repeated omission, provider failure, malformed response, reappearance, multi-provider safety, launcher-exclusive, idempotent re-evaluation). **Two real bugs found and fixed while building this**: (a) a reappearing record with no publisher/releaseDate could only ever re-match its own prior discovery entry via weak title-only evidence (POSSIBLE), never reactivating its canonical-level status — fixed by reusing an already-authoritative `canonical_provider_links` row directly instead of re-running the fuzzy matcher on every re-observation; (b) re-evaluating the SAME completed cycle twice (a legitimate retry scenario) double-degraded STALE rows straight to TOMBSTONED — fixed by recording which cycle caused each STALE transition and only allowing TOMBSTONE when the existing STALE came from a genuinely different, earlier cycle |
| **Mission 2 — Backend audit findings** | Investigated individually, not blindly upgraded. Full per-advisory breakdown in the final report. Verdict: 5 high findings, 100% dev-tooling-only, 0 in the deployed Worker artifact, no stable fix available at all today (not just "alpha vs stable" — miniflare 5.x has literally never shipped a stable tag). Documented and accepted, not upgraded |
| **Mission 3 — Zero-flake closeout** | `CERTIFIED`. Root-caused `tests/process.test.ts`'s flake: `tasklist /V /FO CSV` measured ~8s on real hardware under ordinary load — already past the previous 5000ms timeout with NO test concurrency or contention involved. This was a genuine PRODUCTION correctness bug (category E, not a test-harness artifact) — any real caller of `isGameRunning` could get a false "not running" under ordinary system load. Fixed by raising the timeout to 15000ms in `src/core/process/index.ts`. Verified deterministic: 3/3 consecutive isolated runs green, then two full consecutive `npm test` runs at 2036/2036 pass, 0 failed/cancelled/skipped, both times |
| **Mission 4 — Recertification** | All green: root `tsc --noEmit`, `test:online-foundation` (200/200), `test:visual-library-closure` (312/312), `test:phase3-catalog` (107/107), `npm test` x2 (2036/2036 both), `test:real-backend-e2e` (12/12), `test:backend-ingest-e2e`/Mission 17 (18/18), `test:backend-ingest-scale-e2e`/Mission 18 (10,050 records), catalog backend typecheck + tests (54/54) + `npm audit`/`npm audit --omit=dev`, hub backend typecheck + tests (6/6) |
| **Mission 5 — Roadmap** | Phase 3 / 3.1 / 3.2 marked CLOSED below. Scheduler execution remains deferred (contract only). Phase 3.5: NOT STARTED. Phase 4: NOT STARTED |

## Phase 3.5 — Ubisoft + EA + Xbox + Battle.net Catalog Integrations

Deferred pending a genuine, legitimate public catalog source appearing for any of these four
providers. Mission 20's fresh research found none today. Revisit if Microsoft, Ubisoft, EA,
or Blizzard ever publish an official bulk catalog-browse API; do not attempt scraping or
credential-based workarounds as a substitute.

## Phase 4 — Account/Library Ownership Sync (Steam + Epic + GOG)

Implement `ownedLibrarySync` (currently `REQUIRES_AUTH`/unimplemented for all three in
`provider-capabilities.ts`) via each provider's legitimate account-authorized mechanism only
— Steam Web API `GetOwnedGames` + user-supplied API key/SteamID64, Epic/GOG per their own
authenticated flows once researched. No token/credential extraction, no scraping. Report
unavailable honestly when privacy/API limitations prevent a field. Explicitly NOT started
this phase per the owner's hard stop.

## Phase 5 — Community Read/Download

Wire the Phase 1 `community_submissions`/`trainer_artifacts` tables to a real backend for
read-only Community browsing and download (search/popular/recently-updated/needs-update).
No upload path yet — this phase only proves the download half of the sync-manifest model
against real user-facing UI.

## Phase 6 — Community Uploads

Wire the Phase 1/2.1 `qualifyForUploadWithVerifiedClassification`/`submitDraftToCommunity`
pipeline to a real upload endpoint, respecting the existing `OFF/ASK_ME/ON` sharing
preference gate exactly as modeled. Requires real trainer-content-type detection first
(the current `v0-inconclusive-only` classifier makes zero artifacts eligible by design —
see Phase 2.1), plus Phase 2's real backend and Phase 5's read path.

## Phase 7 — Moderation / Trust / Reputation

Build the human/automated review surface that actually advances a submission through
`NEW_COMMUNITY → AUTOMATED_CHECKS_PASSED → COMMUNITY_CONFIRMED → COMMUNITY_VERIFIED →
LOCALLY_VERIFIED` (the state machine already exists in
`src/core/community-upload/store.ts#advanceTrustState`; this phase builds who/what is
allowed to call it and under what evidence).

## Phase 8 — Additional Providers

Superseded in part by Phase 3 (Steam/Epic/GOG `catalogDiscovery` now real) and Phase 3.5
(Ubisoft/EA/Xbox/Battle.net `catalogDiscovery` researched and found unavailable). Remaining
scope: `artwork`/`storeMetadata`/`ratings`/`popularity` implementations for Epic and GOG
(Steam's already has `artwork: SUPPORTED` via its CDN), following whatever each provider's
actual supported public surface allows — do not claim `SUPPORTED` for anything not actually
implemented.

## Phase 9 — Community UI

Build the actual COMMUNITY primary-navigation surface (SEARCH/POPULAR/RECENTLY
UPDATED/NEEDS UPDATE) against the by-then-real Phase 5/6/7 backend. No new architecture —
Phase 1-7 already define every contract this UI consumes.

## Phase 10 — Discovery Full UI Integration

Wire `src/core/discovery-catalog/query.ts` into an actual Discovery browsing page (filters:
provider, trainer status, popularity, rating, recent release/update, genre/year — the query
function already supports the local subset of these). Wire `createCustomGame`/
`offerIdentityLink` into a real "Create Custom Game" UI flow.

---

# ROADMAP MAINTENANCE

After every significant implementation or verification cycle:

1. update only the statuses actually affected
2. use current repository evidence
3. remove stale active test counts/baseline claims
4. keep historical claims in git history or an archive, not active sequencing
5. do not duplicate security verdicts from `SOLITH_SECURITY_ROADMAP.md`
6. preserve explicit owner decisions
7. recalculate the single highest-priority next action
