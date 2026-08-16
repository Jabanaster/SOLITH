# SOLITH — FINAL PRODUCT ROADMAP

> **Purpose:** This is the active product roadmap for SOLITH.
>
> **Authority model**
>
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

**Status: PROPOSED**

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

**Status: PROPOSED / EXTEND EXISTING SYSTEMS**

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

**Status: PROPOSED**

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

## 3.3 Default Trainer Library

Default:

```text
Popular
```

Initial curated list:

```text
500 games
```

Ranking priority:

1. Installed
2. Verified SOLITH support
3. Popular now
4. Recently released
5. Enduring favorites
6. Other eligible catalog

## 3.4 All Games

All Games exposes the full eligible catalog, including niche/deep-catalog titles.

First-use notice:

> All Games includes SOLITH’s full eligible catalog, including niche and less widely played titles. Use filters or search to narrow the list.

## 3.5 Sorting

- Recommended
- Popular now
- All-time popular
- Newest release
- Recently added to SOLITH
- Recently updated
- A–Z
- Installed first
- Verified first
- Most trainer options

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

**Status: PROPOSED**

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

**Status: PROPOSED**

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

**Status: REPORTED COMPLETE — VERIFY CAPABILITY BY CAPABILITY**

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

1. Gate 2.5 Phase 7 verified stable (6/6 PASS ×3 consecutive, fresh packaged candidate); root cause was a stale packaged binary, not a test or product defect — no repair to commit.
2. Phase 1 — shell, Settings, notifications, banner, grid, title hygiene.
3. Phase 2 — canonical game model + Game Library.
4. Phase 3 — Trainer Library Popular/All Games/sorting/filtering.
5. Phase 4 — artwork identity/cache/legal sourcing/background fetch.
6. Phase 5 — popularity pipeline + signed catalog updates.
7. Phase 6 — V1 trainer/save/discovery/CT capability gap audit and closeout.
8. Phase 7 — security/package/supply-chain/failure-injection QA.
9. Phase 8 — customization.
10. Phase 9 — final owner-interactive acceptance.
11. Phase 10 — V1 release.
12. Post-V1 — Wisp and advanced creator/live-memory expansion.

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

# ROADMAP MAINTENANCE

After every significant implementation or verification cycle:

1. update only the statuses actually affected
2. use current repository evidence
3. remove stale active test counts/baseline claims
4. keep historical claims in git history or an archive, not active sequencing
5. do not duplicate security verdicts from `SOLITH_SECURITY_ROADMAP.md`
6. preserve explicit owner decisions
7. recalculate the single highest-priority next action
