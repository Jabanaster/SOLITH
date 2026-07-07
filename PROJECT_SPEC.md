# RESOURCEFORGE — MASTER PROJECT SPECIFICATION

You are the principal software architect, product designer, security engineer, and implementation agent for a Windows desktop application named ResourceForge.

This document is the authoritative project specification.

Before making changes:

1. Read this entire specification.
2. Inspect the existing repository.
3. Determine what is already implemented.
4. Preserve correct working code.
5. Create or update PROJECT_SPEC.md with this specification.
6. Create a milestone implementation plan.
7. Work through the project in coherent, testable milestones.
8. Do not claim functionality exists unless it is implemented and verified.

Do not repeatedly ask for product decisions already answered here.

If the repository is empty, create the project from scratch.

If the repository already contains ResourceForge code, continue from the current codebase without starting over or performing an unnecessary rewrite.

---

# 1. PRODUCT IDENTITY

Product name:

ResourceForge

Product category:

Local/offline game trainer, save editor, resource editor, and trainer-building platform.

Primary product vision:

ResourceForge should provide the polished trainer experience of applications such as Wand/WeMod while adding a major capability those products generally do not provide:

ResourceForge can inspect supported local games, discover editable values, explain those values, convert successful discoveries into reusable trainer controls, safely apply modifications, and restore original files.

ResourceForge is not merely a file browser or generic save editor.

It must feel like a premium game trainer.

The default user experience should be:

Choose a game
→ view trainer controls
→ set or enable an option
→ preview the change
→ safely apply it
→ continue playing
→ roll back whenever necessary

Advanced technical details should be available, but they must not dominate the default experience.

---

# 2. TARGET PLATFORM AND TECHNOLOGY

Build ResourceForge as a Windows desktop application.

Required stack:

- Electron
- React
- TypeScript
- SQLite
- Node.js filesystem APIs in the Electron main process
- Typed Electron preload bridge
- Local AI integration through Ollama and LM Studio
- Rule-based fallback when no local model is configured
- Electron Builder or an equivalent packaging system

Do not use:

- Cloud-required services
- Required online accounts
- Cloud telemetry
- OpenAI or Anthropic APIs in V1
- PyQt
- WPF
- Tauri
- Native C++ UI
- Browser-only storage as the primary database

The app must continue to function when no local AI system is installed.

---

# 3. NON-NEGOTIABLE PRODUCT BOUNDARIES

ResourceForge is for:

- Local games
- Offline games
- Single-player modes
- User-owned games or games the user has permission to modify
- Local applications the user has permission to modify
- File-backed trainer actions
- Save-file modifications
- Configuration modifications
- Structured data modifications
- User-approved modifications
- Reversible modifications

ResourceForge V1 must not implement:

- Online game cheating
- Multiplayer game modifications
- Anti-cheat bypass
- DRM bypass
- License bypass
- Entitlement modification
- Process injection
- DLL injection
- Code injection
- Kernel drivers
- Kernel-level memory access
- Stealth behavior
- Hiding from protection systems
- Executable patching
- Arbitrary binary patching
- Trainer overlays
- Runtime hotkey execution
- Packed archive modification
- Automatic modification of unknown binary files

Blocked files can be detected, cataloged, and shown, but they must not be modified.

Live trainer functions belong to later V2 research and must not be falsely represented as functional during V1.

### 3.1 Scoped exception — Live Memory Trainer (V2, decided 2026-07-05)

Live process memory modification is permitted starting in V2, but only under
all of the following constraints. These constraints are not optional or
per-feature — they are the boundary of the capability itself:

- Standard `ReadProcessMemory`/`WriteProcessMemory` only. No DLL injection,
  no code injection, no kernel drivers, no debugger attachment used to
  bypass protections.
- Every attach and every write requires a passing online-session guard
  check: the user must explicitly confirm the session is single-player/
  offline, AND automatic evidence (active non-loopback network connections
  owned by the target process) must show no sign of an online session.
  Evidence overrides user confirmation — if evidence is unavailable or
  contradicts the confirmation, the operation is blocked. See
  `src/core/live-memory/online-guard.ts`.
- The guard is rechecked immediately before every write and every rollback,
  not just at attach time, mirroring the "recheck containment immediately
  before modification" principle used for file targets (Section 13).
  A session that goes online mid-flow loses write capability immediately.
  No anti-cheat interaction, no anti-cheat detection/bypass, no stealth
  behavior, no hiding from protection systems.
- A request to remove the online-session guard, or to apply this capability
  "regardless of online/multiplayer state," was explicitly declined during
  the 2026-07-05 design discussion because it would let the tool modify a
  user's state while playing against real people online — that is a
  different, unacceptable capability, not a configuration option of this
  one.

This exception narrows the V1 prohibition above (V1 itself still ships with
no live memory capability at all — see Milestone ordering in Section 45/
Section 42). It does not relax any other V1 boundary: no anti-cheat bypass,
no DRM bypass, no online-game cheating, no multiplayer manipulation.

---

# 4. CORE PRODUCT PRINCIPLES

## 4.1 Proposal first

No modification may be applied immediately.

Every modification must follow:

Discovery or trainer selection
→ proposal
→ preview
→ dry run
→ explicit user approval
→ backup
→ atomic apply
→ validation
→ completion or automatic restoration

## 4.2 Deterministic execution

Local AI may:

- Explain values
- Suggest names
- Suggest trainer categories
- Explain risks
- Summarize differences
- Rank possible meanings
- Generate structured suggestions

Local AI must never:

- Directly write files
- Choose unrestricted file paths
- Execute shell commands
- Bypass validation
- Apply modifications
- Mark unsafe operations as approved
- Override blocked classifications

All file operations must be performed by deterministic, validated application code.

## 4.3 Reversible modifications

No edit may proceed unless ResourceForge can create a verified backup.

## 4.4 Transparent behavior

Every trainer item must clearly show:

- What it changes
- Where the value originates
- Whether the game should be closed
- Its risk level
- Its confidence level when discovered
- Whether a rescan is required
- Whether the feature belongs to V2

## 4.5 Trainer-first experience

The user should not need to understand JSON paths, XML nodes, file hashes, or parser internals to use standard trainer functions.

Those details belong in an advanced Workshop Mode.

---

# 5. PRODUCT MODES

ResourceForge must have two clearly separated experiences.

## 5.1 Trainer Mode

Trainer Mode is the default.

It provides a Wand/WeMod-style experience.

The user sees:

- Game library
- Game artwork or generated cover
- Play button
- Scan or rescan action
- Trainer categories
- Trainer controls
- Current values
- Target values
- Risk and source badges
- Apply controls
- Backup status
- Trainer status
- Explanation controls

Trainer Mode hides unnecessary technical details.

Example trainer controls:

Player:
- Set Maximum Health
- Set Stamina
- Set Mana or Spirit
- Set Player Level
- Set Experience
- Set Skill Points

Inventory:
- Set Gold
- Set Currency
- Set Item Quantity
- Set Crafting Materials
- Set Ammunition
- Set Inventory Stack Size

Stats:
- Set Strength
- Set Defense
- Set Movement Speed
- Set Attribute Points

Enemies:
- Set Enemy Health from supported data files
- Set Enemy Damage from supported data files
- Set Experience Rewards

Game:
- Set Time of Day from supported file-backed values
- Set Difficulty
- Set Game Configuration Values

Unlocks:
- Unlock Recipes
- Unlock Supported Items
- Unlock Supported File-Backed Flags

V2 preview items may include:

- Infinite Health
- Infinite Stamina
- God Mode
- Ignore Hits
- One-Hit Kill
- Freeze Time
- Runtime Game Speed
- Runtime No Cooldown
- Runtime Infinite Ammunition

V2 preview items must remain disabled and clearly marked as unavailable in V1.

## 5.2 Workshop Mode

Workshop Mode is the advanced environment.

It contains:

- Resource Browser
- Save Editor
- Data Editor
- Discovery Lab
- Trainer Builder
- Recipe Editor
- Proposal Inspector
- Backup Manager
- Rollback Manager
- Journal
- Diagnostic tools
- Parser and adapter details

Workshop Mode allows advanced users to discover and build trainer controls.

---

# 6. PRIMARY USER WORKFLOWS

## 6.1 Add and scan a game

1. User chooses Add Game.
2. User selects a local game folder.
3. ResourceForge canonicalizes and validates the path.
4. ResourceForge blocks system or unsafe locations.
5. ResourceForge records the game.
6. ResourceForge scans the folder.
7. ResourceForge detects the probable game engine.
8. ResourceForge classifies resources.
9. ResourceForge searches approved locations for saves.
10. ResourceForge creates a game fingerprint.
11. ResourceForge displays compatible trainer actions and suggestions.

## 6.2 Use an existing trainer action

1. User opens a game.
2. User selects a trainer option.
3. ResourceForge resolves the correct target.
4. ResourceForge reads the current value.
5. User enters or selects a new value.
6. ResourceForge creates a proposal.
7. User previews the exact modification.
8. ResourceForge performs a dry run.
9. User approves.
10. ResourceForge creates a backup.
11. ResourceForge applies the change atomically.
12. ResourceForge validates the result.
13. ResourceForge records the operation.
14. User can roll back later.

## 6.3 Discover a value

1. User opens Discovery Lab.
2. User selects Save or File A.
3. User changes a known value in the game.
4. User creates Save or File B.
5. User optionally tells ResourceForge what changed.
6. ResourceForge compares the files.
7. ResourceForge filters noisy changes.
8. ResourceForge ranks meaningful candidates.
9. User confirms a candidate.
10. ResourceForge creates a reusable trainer recipe.
11. The new control appears in Trainer Mode.

## 6.4 Roll back a modification

1. User opens Backups or operation history.
2. User selects a completed modification.
3. ResourceForge verifies the backup.
4. ResourceForge verifies the current target.
5. User confirms restoration.
6. ResourceForge restores atomically.
7. ResourceForge validates the restoration.
8. ResourceForge records the rollback.

---

# 7. APPLICATION LAYOUT

## 7.1 Main window

Use a premium dark desktop interface.

Primary layout:

- Left navigation and game library
- Main content area
- Optional contextual right panel on wide screens
- Persistent operation/status region where appropriate

## 7.2 Left sidebar

Include:

- ResourceForge logo
- Global search
- Favorites
- My Games
- Recently Scanned
- Demo Game
- Add Game button
- Dashboard
- Workshop Mode
- Backups
- Journal
- Settings
- About

Each game row should show:

- Game icon
- Game name
- Detected engine
- Status indicator
- Needs Rescan warning when applicable
- Favorite state

## 7.3 Game header

Display:

- Game artwork or generated visual
- Game icon
- Game name
- Detected engine
- Local/Offline badge
- Main executable status
- Last scan
- Latest save
- Recipe count
- Active warning count
- Fingerprint status

Primary actions:

- Play
- Scan
- Rescan
- Save Trainer Profile
- Create Backup
- Open Folder
- More menu

## 7.4 Game navigation

Tabs:

- Trainer
- Saves
- Data
- Discovery Lab
- Recipes
- Backups
- Journal

## 7.5 Trainer categories

Use:

- All
- Player
- Inventory
- Stats
- Enemies
- Game
- Unlocks
- Video
- Voice
- Discovery

Categories with no available actions should either be hidden or show a useful empty state.

---

# 8. VISUAL DESIGN SYSTEM

ResourceForge must be visually original.

Do not copy trademarks, logos, exact layouts, assets, or branded visuals from other trainer applications.

Desired visual character:

- Premium
- Futuristic but readable
- Dark
- Clean
- High contrast
- Subtle depth
- Minimal visual clutter
- Smooth state transitions
- Clear status hierarchy
- Professional, not childish
- Technical details available without overwhelming normal users

Use:

- Deep charcoal or near-black backgrounds
- Layered panels
- Subtle translucent surfaces
- Thin borders
- Soft shadows
- Controlled glow for active states
- Strong typography hierarchy
- Large readable controls
- Consistent spacing
- Accessible focus indicators
- Tooltips for technical badges

Avoid:

- Excessive gradients
- Neon overload
- Tiny text
- Dense developer-style tables in Trainer Mode
- Giant empty panels
- Unclear icon-only controls
- Fake functionality

Trainer cards should feel interactive and premium.

Each card should support:

- Title
- Description
- Category
- Source badge
- Risk badge
- Status badge
- Confidence score where relevant
- Current value
- Target control
- Preview
- Apply
- Explain
- Options menu
- Hotkey placeholder for V2

---

# 9. TRAINER CONTROL TYPES

Support these V1 control types:

- Numeric input
- Increment/decrement number control
- Boolean toggle for file-backed booleans
- Dropdown for validated values
- Slider where safe numeric boundaries are known
- One-time action button
- Preset selector

Every control must be driven by a validated trainer recipe.

V2 may later support:

- Runtime toggles
- Runtime hotkeys
- Freeze values
- Session-bound controls
- Overlay controls

Do not implement those in V1.

---

# 10. SOURCE, RISK, AND STATUS BADGES

## 10.1 Source badges

Use:

- SAVE
- DATA
- CONFIG
- SCRIPT
- DISCOVERED
- RECIPE
- LIVE-V2
- BLOCKED

## 10.2 Risk levels

Use:

- Safe
- Caution
- Risky
- Blocked

Risk is not determined by keywords alone.

Risk must consider:

- File type
- Structural role
- Target path
- Detected semantic meaning
- Validation capability
- Game fingerprint compatibility
- Previous discovery evidence
- Whether the operation changes references
- Whether the value is signed or checksummed
- Whether rollback can be verified

## 10.3 Status values

Use:

- Ready
- Needs Discovery
- Needs Rescan
- Stale Recipe
- Broken Recipe
- Game Must Be Closed
- File Locked
- Unsupported
- V2 Live Mode
- Blocked

---

# 11. REQUIRED PROJECT ARCHITECTURE

Use strict separation between UI, privileged operations, domain logic, adapters, persistence, and AI.

Suggested structure:

ResourceForge/
  package.json
  tsconfig.json
  electron-builder.yml
  README.md
  PROJECT_SPEC.md

  electron/
    main/
      main.ts
      window-manager.ts
      ipc/
        ipc-registry.ts
        game-ipc.ts
        scan-ipc.ts
        trainer-ipc.ts
        proposal-ipc.ts
        backup-ipc.ts
        ai-ipc.ts
        settings-ipc.ts
      services/
      security/
    preload/
      preload.ts
      api-types.ts

  src/
    app/
      App.tsx
      routes/
      layouts/
      pages/
        Dashboard/
        Game/
        Saves/
        DataEditor/
        DiscoveryLab/
        RecipeBuilder/
        Backups/
        Journal/
        Settings/
        About/
      components/
        shell/
        games/
        trainer/
        discovery/
        proposals/
        backups/
        common/
      hooks/
      state/
      styles/

    core/
      games/
      scanning/
      fingerprints/
      classification/
      saves/
      discovery/
      confidence/
      trainers/
      recipes/
      proposals/
      operations/
      adapters/
      backups/
      rollback/
      validation/
      safety/
      ai/
      journal/
      database/
      settings/

    shared/
      types/
      schemas/
      constants/
      errors/
      utilities/

  tests/
    unit/
    integration/
    workflow/
    security/
    fixtures/

  demo-game/
    original/
    workspace-template/

  Docs/
    USER_GUIDE.md
    SAFETY_POLICY.md
    TROUBLESHOOTING.md
    ARCHITECTURE.md
    RECIPE_SCHEMA.md
    QA/
    V2/

Directory names may be adjusted to fit the existing repository, but architectural boundaries must remain clear.

---

# 12. ELECTRON SECURITY REQUIREMENTS

These are mandatory.

- nodeIntegration must be false.
- contextIsolation must be true.
- Enable renderer sandboxing where compatible.
- React renderer code must not import filesystem modules.
- React renderer code must not access SQLite directly.
- React renderer code must not access child_process.
- All privileged work must occur in the Electron main process.
- Expose only narrow typed APIs through preload.
- Use an allowlisted IPC registry.
- Validate every IPC request using runtime schemas.
- Validate every IPC response.
- Never accept arbitrary shell commands.
- Never expose unrestricted readFile or writeFile APIs.
- Never expose arbitrary delete operations.
- Never expose unrestricted shell.openPath or shell execution.
- Do not load remote web content in privileged windows.
- Use a restrictive Content Security Policy.
- Prevent untrusted navigation.
- Prevent unexpected new-window creation.
- Sanitize errors before sending them to the renderer.
- Never include complete save contents in normal logs.

Create security tests for the Electron boundary.

---

# 13. FILESYSTEM SAFETY

All filesystem targets must be canonicalized.

Required protections:

- Resolve absolute canonical paths.
- Normalize Windows path casing.
- Reject path traversal.
- Reject unsafe drive roots.
- Reject Windows system folders.
- Reject user-profile root selection.
- Detect symbolic links.
- Detect junctions.
- Detect Windows reparse points.
- Do not follow links that escape approved roots.
- Recheck containment immediately before modification.
- Validate recipe targets every time they are resolved.
- Never trust previously stored relative paths without revalidation.
- Restrict modifications to explicitly approved game, save, or backup roots.

Blocked root examples include:

- Windows directory
- System32
- ProgramData root
- Program Files root
- Drive roots
- User profile root
- ResourceForge application installation directory unless used for bundled read-only assets

External save locations require explicit user approval.

---

# 14. SAFE ATOMIC WRITE SYSTEM

Never modify an original file in place.

Required apply sequence:

1. Acquire per-file operation lock.
2. Resolve and validate target path.
3. Verify file is not blocked.
4. Verify expected hash or expected old value.
5. Create and verify backup.
6. Generate modified output in memory or controlled staging.
7. Write to a temporary sibling file on the same volume.
8. Flush the temporary file.
9. Parse and validate the temporary file.
10. Atomically replace the target where supported.
11. Verify resulting file hash.
12. Persist operation completion.
13. Release lock.

Requirements:

- Preserve relevant permissions.
- Do not leave a partially written original.
- If temporary validation fails, delete the temporary file and keep the original.
- If replacement fails, keep the original.
- Detect and clean abandoned ResourceForge temporary files safely.
- Do not remove unrelated temporary files.
- Prevent simultaneous modifications to the same target.
- Support crash recovery.

---

# 15. OPERATION STATE MACHINE

Persist modification operations.

Use states similar to:

- DRAFT
- PROPOSED
- DRY_RUN_PASSED
- AWAITING_APPROVAL
- BACKUP_CREATED
- APPLYING
- VALIDATING
- COMPLETED
- FAILED
- RESTORING
- RESTORED
- RESTORE_FAILED
- CANCELLED

Rules:

- State transitions must be validated.
- Restarting the app must not lose unfinished operation context.
- Startup recovery must detect interrupted operations.
- An interrupted APPLYING operation must be inspected safely.
- The app must never assume a write completed without verification.
- Journal events should correspond to important transitions.

---

# 16. TRAINER ADAPTER ARCHITECTURE

Adapter architecture belongs in V1.

Define a common trainer adapter contract.

Conceptual interface:

TrainerAdapter:
- adapterId
- adapterVersion
- supports(resource)
- discoverTargets(context)
- listCapabilities(context)
- readCurrentValue(target)
- createProposal(request)
- dryRun(proposal)
- apply(proposal)
- validate(result)
- rollback(manifest)

Initial V1 adapters:

- JsonFileAdapter
- IniFileAdapter
- XmlFileAdapter
- CsvFileAdapter
- TsvFileAdapter
- TextKeyValueAdapter
- LuaTableReadOnlyOrControlledAdapter
- BinaryComparisonReadOnlyAdapter

Future adapters:

- UnitySaveAdapter
- UnrealSaveAdapter
- GodotSaveAdapter
- EngineSpecificDataAdapter
- LiveReadOnlyAdapter
- LiveTrainerAdapter

The UI must communicate with trainer services, not parser internals.

Do not tightly couple trainer cards to JSON or filesystem code.

---

# 17. GAME SCANNING

The scanner must be efficient and cancellable.

Required features:

- Recursive scanning
- Bounded concurrency
- Worker threads where appropriate
- Cancellation
- Pause/resume if practical
- Batched SQLite writes
- Incremental scans
- Progress updates
- File-size limits
- Hash caching
- Folder-loop protection
- Reparse-point protection
- Ignore rules
- Current-phase reporting

Default ignored locations:

- .git
- node_modules
- cache
- caches
- temp
- tmp
- logs
- crash dumps
- .resourceforge
- ResourceForge backup folders

Progress should report:

- Current phase
- Files visited
- Files classified
- Bytes processed
- Files skipped
- Warnings
- Current path in a privacy-conscious abbreviated form

Unchanged files should not be rehashed when size, modification time, and other cache conditions remain valid.

---

# 18. GAME FINGERPRINTING

Each game needs a fingerprint.

Store:

- Game ID
- Root path
- Display name
- Main executable name when detected
- Detected engine
- File count
- Total size
- Important resource hashes
- Scan timestamp
- Probable version markers
- Save locations
- Fingerprint version

Use the fingerprint to:

- Detect game updates
- Mark recipes stale
- Determine compatibility
- Trigger rescans
- Prevent silent application to changed targets

Do not rely on one hash of the entire game folder.

Use a stable fingerprint strategy based on selected key files and metadata.

---

# 19. ENGINE DETECTION

Detect probable engines using evidence.

Support detection for:

Unreal Engine:
- .pak
- .ucas
- .utoc
- .uasset
- Engine/Binaries
- Unreal-style folder structures

Unity:
- *_Data
- globalgamemanagers
- resources.assets
- Assembly-CSharp.dll
- UnityPlayer.dll

Godot:
- .pck
- project.binary
- .godot
- Godot executable evidence

RPG Maker:
- www/data
- js/plugins
- System.json
- MapXXX.json

Ren'Py:
- game directory
- .rpa
- .rpy
- .rpyc

Generic:
- fallback when evidence is insufficient

Engine detection in V1 is for classification and guidance.

Do not unpack or modify packed archives in V1.

---

# 20. RESOURCE CLASSIFICATION

Classify files as:

- Save
- Config
- Data
- Script
- Texture
- Audio
- Archive
- Executable
- Library
- Unknown

Use:

- Extension
- Magic bytes
- Location
- File naming
- Engine evidence
- Parse results
- Readability
- Size
- Known blocked signatures

Risk guidelines:

Low:
- Validated JSON
- Validated INI
- Validated CFG
- Validated XML
- Validated CSV or TSV
- Controlled text key/value files

Medium:
- Scripts
- Custom readable files
- Lua-like tables
- Unknown structured text
- Read-only binary comparison candidates

High:
- Packed archives
- Unknown binary files
- Signed or checksummed structured data
- Files with unclear dependencies

Blocked:
- EXE
- DLL
- SYS
- Anti-cheat files
- DRM-related files
- License files
- Entitlement data
- Known protected service files
- Binary executable content

---

# 21. SAVE DETECTION

Search for saves in:

- Selected game folder
- Approved external folders
- Documents
- Documents/My Games
- Saved Games
- AppData/Local
- AppData/LocalLow
- AppData/Roaming
- Related Steam userdata folders

Do not scan the entire user profile automatically.

External location scanning requires user approval.

Likely save directory names:

- save
- saves
- saved
- savegame
- savegames
- profiles
- profile
- slots
- autosave
- checkpoints
- persistent
- savedata
- user
- players

Likely extensions:

- .sav
- .save
- .dat
- .json
- .xml
- .ini
- .cfg
- .txt
- .profile
- .slot
- .player
- .bin

Show:

- Most likely save location
- Latest save
- Modification time
- Format
- Parser support
- Lock state
- Backup state

---

# 22. PARSER SUPPORT

V1 parsers:

- JSON
- Safe JSON-with-comments support
- INI
- CFG
- XML
- CSV
- TSV
- Plain text key/value
- Simple Lua-like data tables without execution

Never execute game scripts.

Each parser should return a shared structured representation:

- Path or key
- Type
- Value
- Display label
- Parent structure
- Source location
- Editability
- Risk evidence
- Validation rules

Unknown binary saves remain read-only.

Allowed binary analysis:

- Hashing
- Backup
- String extraction
- Changed-byte summary
- Before/after comparison
- Read-only candidate detection
- Offset display for advanced users
- Manual confirmation workflow

Not allowed:

- Blind writes
- Guess-based binary editing
- Checksum bypass
- Signature bypass
- Encrypted save modification
- Executable patching

---

# 23. DISCOVERY LAB

Discovery Lab is a central differentiating feature.

Wizard steps:

1. Choose a game.
2. Choose File or Save A.
3. Record optional known value before.
4. Make a change in the game.
5. Choose File or Save B.
6. Record optional known value after.
7. Compare.
8. Review ranked candidates.
9. Explain candidate.
10. Confirm candidate meaning.
11. Build trainer recipe.

Candidate table fields:

- Suggested trainer name
- Source file
- Path or key
- Previous value
- New value
- Type
- Confidence
- Risk
- Suggested category
- Explanation
- Noise classification
- Create Trainer action

Suppress or reduce confidence for:

- Timestamps
- Session IDs
- Save counters
- Autosave metadata
- Statistics-only fields
- Histories
- Checksums
- Hashes
- Signatures
- Random identifiers

Group related changes.

Example:

player.gold:
100 → 250
High confidence
Inventory
Suggested trainer: Set Gold

stats.total_gold_earned:
1000 → 1150
Medium confidence
Historical statistic
Do not treat as current gold without confirmation

checksum:
changed
Blocked
Never suggest as trainer target

---

# 24. CONFIDENCE SCORING

Confidence must be evidence-based.

Signals may include:

- User-provided old and new values
- Exact value match
- Semantic path name
- Structural location
- File format reliability
- Player or inventory context
- Repeated comparisons
- Value type
- Recipe history
- Successful validation history
- Game fingerprint match
- Known noisy path
- Risky structural role
- Hash/checksum evidence

Keyword matching alone is insufficient.

Confidence bands:

- 90–100: Very High
- 75–89: High
- 50–74: Medium
- 25–49: Low
- 0–24: Very Low

Low-confidence discoveries must require additional confirmation.

Blocked discoveries cannot become editable recipes.

---

# 25. TRAINER BUILDER

Trainer Builder converts a confirmed value into a trainer item.

Fields:

- Trainer name
- Description
- Category
- Source type
- Adapter
- Target strategy
- File pattern
- Structured path or key
- Value type
- Input control type
- Default value
- Minimum
- Maximum
- Allowed values
- Risk
- Confidence
- Preconditions
- Validation rules
- Backup requirement
- Restart/game-closed requirement

Show:

- Visual trainer-card preview
- Recipe JSON preview in advanced mode
- Compatibility warning
- Conflict warning
- Save action

After creation, the trainer control should appear immediately in Trainer Mode.

---

# 26. VERSIONED RECIPE SYSTEM

Recipes require a versioned schema.

Example conceptual structure:

{
  "schemaVersion": 1,
  "recipeId": "set-gold",
  "name": "Set Gold",
  "category": "Inventory",
  "adapterId": "json-file",
  "adapterVersion": "1.0",
  "gameIdentity": {
    "fingerprintVersion": 1,
    "executableName": "ExampleGame.exe",
    "supportedVersions": [],
    "requiredEvidence": []
  },
  "targetSelector": {
    "strategy": "latest-save",
    "filePattern": "*.json"
  },
  "operation": {
    "type": "set-value",
    "path": "$.player.inventory.gold",
    "valueType": "number"
  },
  "preconditions": [],
  "validation": {},
  "rollbackPolicy": {
    "required": true
  },
  "risk": "safe"
}

Requirements:

- Validate recipes with runtime schemas.
- Reject malformed recipes.
- Support schema migration.
- Record adapter version.
- Record compatibility status.
- Mark stale recipes.
- Mark broken recipes.
- Support enable and disable.
- Support import and export later.
- Do not execute arbitrary code from recipes.
- Do not allow recipes to specify shell commands.
- Do not allow unrestricted filesystem paths.

---

# 27. RECIPE CONFLICT DETECTION

Detect when recipes modify:

- The same file
- The same structured path
- Parent and child paths
- Mutually dependent values
- A file changed by another pending proposal

Show:

- Conflicting recipes
- Target overlap
- Proposed order
- Expected result

When applying multiple recipes:

- Grouped transactions where safely possible
- Resolve target state in order
- Re-run dry run after earlier changes
- Support grouped transactions where safely possible
- Stop on failure
- Roll back the group when guaranteed safe
- Never silently overwrite another recipe’s result

---

# 28. PROPOSAL ENGINE

Every edit must create a proposal containing:

- Proposal ID
- Game ID
- Trainer item ID
- Recipe ID
- Adapter ID
- Target file
- Canonical target path
- Operation type
- Current value
- Requested value
- Expected old hash
- Expected old value
- Risk
- Confidence
- Preconditions
- Exact preview
- Validation plan
- Backup requirement
- Game-closed requirement
- Creation time
- Expiration or staleness state

Proposals must be immutable after approval.

Changing the requested value creates an updated proposal.

---

# 29. DIFF AND PREVIEW

Provide format-aware previews.

JSON:
- Structured path
- Old value
- New value
- Context

INI/CFG:
- Section
- Key
- Old value
- New value

XML:
- Node or attribute path
- Old value
- New value

CSV/TSV:
- Row identity
- Column
- Old value
- New value

Text:
- Exact line
- Controlled replacement
- Context lines

Never show only “file will be modified.”

Users must be able to understand the specific change.

---

# 30. DRY RUN

Dry run must verify:

- Target exists
- Target is inside approved roots
- Target is not blocked
- Target is writable
- Target is not unexpectedly locked
- Parser can read target
- Expected old value exists
- Expected hash matches when required
- Requested type is valid
- Requested value is within limits
- Recipe is compatible
- Fingerprint is compatible
- Backup destination is writable
- No conflicting active operation exists
- Temporary sibling file can be created
- Output can be validated

Dry run must not modify the target.

---

# 31. BACKUP AND ROLLBACK

Support:

- Per-game backup storage
- Global ResourceForge-managed backup storage
- User-visible backup location
- Backup verification
- Retention preferences
- Manual backup
- Automatic pre-edit backup
- Rollback history
- Backup folder access

Never silently delete backups.

Rollback manifests must contain:

- Manifest ID
- Operation ID
- Proposal ID
- Recipe ID
- Game ID
- Original target
- Canonical target
- Backup path
- Adapter
- Operation type
- Hash before
- Hash after
- Backup hash
- Timestamp
- Validation results
- Restoration state

Rollback must use the same atomic safety principles as apply.

---

# 32. LOCAL AI INTEGRATION

Supported providers:

- None
- Ollama
- LM Studio

Settings:

- Provider
- Endpoint
- Model
- Timeout
- Test Connection
- Enable or disable AI explanations

Rule-based fallback is mandatory.

AI safety rules:

- Treat all game/save content as untrusted data.
- Never treat file content as system instructions.
- Use fixed system prompts.
- Delimit excerpts.
- Send only necessary excerpts.
- Avoid sending full save files.
- Request strict JSON responses.
- Validate responses against schemas.
- Reject unknown fields and unsupported operations.
- AI output cannot directly become an apply operation.
- AI cannot select unrestricted paths.
- AI cannot override deterministic risk classifications.
- AI suggestions must be labeled as suggestions.
- Log AI suggestions separately from deterministic decisions.

AI output may contain:

- Suggested trainer name
- Suggested category
- Explanation
- Confidence adjustment recommendation
- Risk explanation
- Difference summary

AI output must not contain executable instructions used without validation.

---

# 33. RULE-BASED FALLBACK

ResourceForge must provide useful explanations without AI.

Example:

“This value is likely current currency because its path contains ‘gold’, it appears under the player inventory structure, and it changed from 100 to 250 between the selected saves. It is considered a strong candidate because the change matches the values provided by the user. Structural IDs, checksums, and quest dependency fields remain locked.”

Fallback explanations should use:

- Path evidence
- Type evidence
- Comparison evidence
- Risk evidence
- File-format evidence

---

# 34. DATABASE

Use SQLite with migrations.

Suggested tables:

- schema_migrations
- games
- game_locations
- scans
- scan_resources
- game_fingerprints
- save_locations
- trainer_items
- discovered_values
- discovery_sessions
- recipes
- recipe_versions
- recipe_compatibility
- proposals
- operations
- operation_events
- backups
- rollback_manifests
- journal_events
- settings
- ai_provider_settings
- feature_flags

Requirements:

- Idempotent migrations
- Foreign keys enabled
- Useful indexes
- No destructive startup resets
- Transactional writes
- Batched scan inserts
- Persisted operation states
- Timestamps
- Versioned schemas

Store the production database under Electron’s userData directory.

Do not store production state inside the source repository.

---

# 35. JOURNAL

Create a readable timeline.

Event types:

- Game added
- Game removed
- Scan started
- Scan completed
- Scan cancelled
- Engine detected
- Save location approved
- Latest save detected
- Discovery started
- Discovery completed
- Candidate confirmed
- Recipe created
- Recipe marked stale
- Proposal created
- Dry run passed
- Dry run failed
- Backup created
- Apply started
- Apply completed
- Validation passed
- Validation failed
- Auto-restore started
- Auto-restore completed
- Rollback completed
- AI explanation generated
- Error recorded

Journal entries should be readable by normal users while providing expandable technical details.

---

# 36. ERROR HANDLING

Do not show raw system errors as the primary message.

Bad:

EACCES

Good:

“ResourceForge could not read this file. The file may be locked by the game or require additional permission. Close the game and try again.”

Handle:

- Permission denied
- File locked
- Missing target
- Parse failure
- Validation failure
- Backup failure
- Hash mismatch
- Stale recipe
- Broken recipe
- Game fingerprint change
- Unsupported file
- Blocked file
- Database failure
- AI connection failure
- Scan cancellation
- Atomic replacement failure
- Rollback failure

Provide:

- Friendly explanation
- Recommended next action
- Expandable technical details
- Diagnostic export when useful

---

# 37. FIRST-RUN ONBOARDING

Steps:

1. Welcome
2. Local/offline product explanation
3. Safety acknowledgement
4. Backup storage preference
5. Optional local AI setup
6. Add Demo Game or Add Local Game
7. Enter dashboard

Required acknowledgement:

“I will only use ResourceForge with local/offline games or applications that I own or have permission to modify.”

AI setup must be skippable.

---

# 38. DEMO GAME

Include a safe demo environment.

Structure:

demo-game/
  original/
    saves/
      slot_a.json
      slot_b.json
    data/
      items.json
      weapons.csv
      player_stats.ini
  workspace-template/

Demo values should support:

- Gold changes from 100 to 250
- Health values
- Inventory quantity
- Weapon damage
- Item prices
- Unlock flag

Guided demo:

1. Load demo game.
2. Scan.
3. Detect latest save.
4. Compare slot A and slot B.
5. Discover gold.
6. Explain the candidate.
7. Create Set Gold recipe.
8. Set gold to 9999.
9. Preview.
10. Dry run.
11. Back up.
12. Apply.
13. Validate.
14. Roll back.
15. Verify original value.

Include Reset Demo Game.

Do not modify the immutable original fixture.

Create a working copy under application data.

---

# 39. PERFORMANCE REQUIREMENTS

- UI remains responsive during scans.
- Scans can be cancelled.
- Long work runs outside the renderer thread.
- Database inserts are batched.
- Incremental scans reuse unchanged metadata.
- Large files are skipped or sampled according to settings.
- AI requests have timeouts.
- File comparisons have configurable limits.
- Progress is visible.
- Loading states are clear.
- The app does not freeze while hashing.

Do not promise universal performance without testing.

---

# 40. ACCESSIBILITY AND USABILITY

Required:

- Keyboard navigation
- Visible focus states
- Accessible labels
- Sufficient contrast
- Tooltips for badges
- Clear disabled-state explanations
- Scalable text
- Sensible tab order
- No critical icon-only buttons
- Responsive layout
- Scrollable trainer sections
- Useful empty states
- Confirmation for risky operations

---

# 41. V1 SCOPE

ResourceForge V1 includes:

- Premium trainer-style UI
- Trainer Mode
- Workshop Mode
- Game library
- Game scanning
- Game fingerprinting
- Engine detection
- Resource classification
- Save detection
- Latest-save detection
- JSON editing
- INI/CFG editing
- XML editing
- CSV/TSV editing
- Controlled text editing
- Read-only unknown binary comparison
- Discovery Lab
- Evidence-based confidence scoring
- Trainer Builder
- Versioned recipes
- Recipe compatibility
- Conflict detection
- Proposal engine
- Format-aware preview
- Dry run
- Backup
- Atomic apply
- Validation
- Auto-restore
- Rollback
- Local AI explanations
- Rule-based explanations
- Journal
- Demo game
- First-run onboarding
- Windows packaging
- Documentation
- Test suite

---

# 42. V2 ROADMAP

V2 may investigate:

- Local/offline live trainer sessions
- Read-only runtime value inspection
- Session lifecycle management
- Runtime trainer adapters
- Trainer hotkeys
- Freeze-value operations
- Runtime toggles
- Runtime game speed controls
- Trainer overlay
- Engine-specific adapters
- Supported archive workflows
- Texture and audio replacement
- Community recipe packages

V2 must retain:

- Local/offline-only policy
- No anti-cheat bypass
- No DRM bypass
- No stealth
- No kernel drivers
- No unsupported online or multiplayer use

V2 features require separate architecture, safety, and testing milestones.

Do not implement live trainer behavior while completing V1.

### 42.1 Live Memory Trainer foundation — status (2026-07-05)

First scoped bite landed (logic layer only; see Section 3.1 for the safety
contract):

- `src/core/live-memory/online-guard.ts` — fail-closed evaluator combining
  user offline confirmation with remote-connection evidence.
- `src/core/live-memory/remote-connection-observer.ts` — read-only
  `netstat`-based observer counting ESTABLISHED non-loopback connections
  owned by the target PID (Windows only so far).
- `src/core/live-memory/native-memory-driver.ts` — lazy-loaded wrapper over
  the `memoryjs` native addon (ReadProcessMemory/WriteProcessMemory only).
- `src/core/live-memory/live-memory-session.ts` — attach → propose → confirm
  (guard rechecked immediately before write) → rollback → detach, mirroring
  the file-based proposal/dry-run/apply/rollback philosophy in Section 4.1.
- 14/14 unit tests passing against a fake driver
  (`tests/fixtures/fake-memory-driver.ts`); `npx tsc --noEmit` clean; full
  suite 450/450.

Update (2026-07-05, same day): `memoryjs` now builds cleanly (two upstream
bugs patched durably via `patch-package`, see `Docs/KNOWN_ISSUES.md` KI-015)
and a real `ReadProcessMemory`/`WriteProcessMemory` round trip has been
verified against a genuine separate live process via
`scripts/live-memory-verify.mts` (not a mock — confirmed twice, including
after a full reinstall/rebuild).

Update (2026-07-06): IPC channels, typed preload API, and a Trainer-mode UI
(`LiveMemoryTrainerPage.tsx`) landed — process picker, explicit offline
confirmation, manual address/dataType read/write through the propose/confirm
flow. Also verified attach mechanics against a real, running commercial game
(Stardew Valley.exe): process enumeration found it, and
`nativeMemoryDriver.openProcess()`/`closeProcess()` succeeded cleanly (no
anti-tamper blocking). This testing caught and fixed a real bug in the
remote-connection observer (see `Docs/KNOWN_ISSUES.md` KI-017) and surfaced
an unresolved design question about the guard blocking most Steam-integrated
single-player games due to platform background networking — documented, not
silently changed.

Update (2026-07-06, same day): added a Cheat-Engine-style memory scanner
(`src/core/live-memory/memory-scanner.ts` — first scan on an exact value
across writable/committed regions, next scan narrowing an existing candidate
set by exact/changed/unchanged/increased/decreased, all bounded by
region-size/total-bytes/match-count caps so a scan cannot hang the main
process) and a WeMod/Wand-style freeze-value loop on `LiveMemorySession`
(continuously re-writes a value on an interval, rechecking the
online-session guard every tick, stopping outright on the first guard
failure rather than retrying silently). Both are wired through IPC/preload
and into the Trainer-mode UI (scan workflow + freeze toggle). 34 new unit
tests (13 scanner + 8 freeze + 10 observer + 3 misc), full suite 481/481,
`tsc --noEmit` clean, `build:vite` and `build:electron` (19/19) both clean.

Update (2026-07-06, continued): memory scanner verified read-only against
real Stardew Valley (found the exact on-screen gold value; caught and fixed
a real default-budget bug in the process). Added a reverse pointer scanner
(`pointer-scanner.ts`) and pointer-path resolver (`pointer-resolver.ts`) to
turn a session-specific scanned address into a restart-stable module+offset
chain — necessary because a raw scanned address is only valid for the
current process instance. Real-world testing found this technique does
**not** work against Stardew Valley (a managed .NET/MonoGame game — its
static roots live in CLR-internal structures, not fixed module offsets; see
KI-018), but **does** work against Atomfall (a native C++ engine): found 20
candidate static pointers, and — critically — verified by fully closing and
relaunching the game (new PID, new ASLR base, new heap layout) that exactly
1 of those 20 still resolved correctly, while the other 19 resolved to
garbage. That one path is now a real, named, reusable control
(`live-control-catalog.ts`: `atomfall-current-weapon-ammo`), deliberately
kept in its own catalog rather than added to `GameProfile.controls[]`,
whose `validateGameProfile()` explicitly rejects `memory_write`/
`memory_observation` backends as executable — a deliberate V1 boundary this
work does not touch. Also added a per-game connection-baseline exception to
the online guard (`acceptedConnectionBaseline`, default 0/strict for any
unreviewed game) so genuinely offline single-player sessions of specific,
manually-reviewed games aren't blocked by their platform's own background
networking (Steamworks/Xbox Live) — Stardew Valley (baseline 5) and Atomfall
(baseline 2) are the two reviewed entries; every other game still gets
today's strict "any remote connection blocks" behavior. Full pipeline
(attach with guard+baseline, catalog lookup, pointer resolution, live read)
verified end-to-end through the real `LiveMemorySession` class against the
live Atomfall process. `npm test` 508/508, `tsc --noEmit` clean,
`build:vite`/`build:electron` (19/19) both clean.

Not yet done: no per-game trainer controls exist for Palworld (the
originally-requested game) or any game besides Atomfall. No value has ever
been WRITTEN to a real game process — every real-game verification in this
work was deliberately read-only (scan, resolve, read), since a write to a
live save carries real risk of corrupting the user's actual progress; the
freeze-value loop and confirmWrite/rollback paths remain verified only
against a fake driver, not yet against any real game. Non-Windows
remote-connection observation remains unimplemented. The online-guard
policy question from KI-017 (should the default ever be looser than 0 for
unreviewed games) remains open and undecided.

---

# 43. TESTING STRATEGY

Create:

- Unit tests
- Integration tests
- Workflow tests
- Security tests
- Parser fixtures
- Failure-injection tests
- Packaging smoke tests

Required test areas:

Electron:
- Node integration disabled
- Typed preload only
- IPC payload validation
- Unauthorized channels rejected

Filesystem:
- System paths blocked
- Traversal blocked
- Junction escape blocked
- Reparse-point escape blocked
- Containment rechecked

Scanner:
- Ignore rules
- Cancellation
- Incremental scan
- Fingerprinting
- Engine detection

Parsers:
- JSON
- JSON with comments
- INI/CFG
- XML
- CSV/TSV
- Text key/value
- Lua-like controlled parsing

Discovery:
- Exact value changes
- Noise suppression
- Confidence scoring
- Blocked checksum candidate
- Candidate grouping

Recipes:
- Schema validation
- Migration
- Stale detection
- Broken target detection
- Conflict detection
- Compatibility evaluation

Apply:
- Dry-run success
- Dry-run failure
- Backup required
- Atomic write success
- Original unchanged on failure
- Validation failure
- Automatic restoration
- Concurrent target lock

Rollback:
- Verified restore
- Corrupted backup rejection
- Locked target handling
- Hash verification

AI:
- Provider unavailable
- Invalid JSON response
- Prompt-like content inside save data
- Schema rejection
- Rule-based fallback

Workflow:
- Clean first run
- Demo scan
- Discovery
- Recipe creation
- Proposal
- Apply
- Rollback
- Demo reset

Failure injection:

- Permission disappears after dry run
- File changes between dry run and apply
- Temporary write fails
- Atomic replacement fails
- Database write fails after file replacement
- App interruption during operation
- Backup corruption
- Rollback target locked

Core invariant:

At every failure point, either:

A. The original target remains unchanged,

or:

B. A verified backup exists and the recovery state is clearly recorded.

---

# 44. COMPATIBILITY CLAIMS

Do not claim ResourceForge can modify every game.

Use accurate product language:

“ResourceForge discovers and safely modifies supported local game resources. Unsupported, encrypted, signed, packed, protected, or custom formats are identified and left unchanged.”

Maintain a compatibility matrix.

Track:

- Format
- Fixture coverage
- Real-game validation
- Read support
- Write support
- Validation support
- Rollback support
- Known limitations

---

# 45. IMPLEMENTATION MILESTONES

Execute in this order.

## Milestone 0 — Repository audit and project foundation

- Inspect repository
- Map implemented features
- Create PROJECT_SPEC.md
- Establish project structure
- Configure TypeScript
- Configure Electron security
- Configure React shell
- Configure SQLite migrations
- Create test foundation
- Create implementation status document

## Milestone 1 — Premium trainer UI foundation

- Main shell
- Sidebar
- Game header
- Trainer Mode
- Workshop Mode navigation
- Trainer cards
- Categories
- Empty states
- Demo visual data
- Settings shell
- No fake functional claims

## Milestone 2 — Game library, scanner, and fingerprinting

- Add Game
- Safe folder picker
- Path containment
- Scanner
- Classification
- Engine detection
- Fingerprinting
- Progress and cancellation
- SQLite persistence

## Milestone 3 — Security, adapters, atomicity, and operations

- Typed IPC
- Runtime validation
- Adapter interfaces
- Operation state machine
- Per-file locks
- Atomic write utility
- Crash recovery
- Path and reparse-point tests
- Recipe schema foundation

This milestone must be complete before production file editing.

## Milestone 4 — Save detection and parser adapters

- External save location approval
- Latest-save detection
- JSON adapter
- INI/CFG adapter
- XML adapter
- CSV/TSV adapter
- Text key/value adapter
- Read-only binary analysis

## Milestone 5 — Discovery Lab and confidence engine

- Comparison sessions
- Noise suppression
- Candidate ranking
- Confidence evidence
- Rule explanations
- Optional AI explanations
- Candidate confirmation

## Milestone 6 — Trainer Builder and recipe system

- Versioned recipes
- Trainer Builder
- Compatibility
- Staleness
- Broken-recipe detection
- Conflict detection
- Trainer card generation

## Milestone 7 — Proposal, preview, dry run, and apply

- Proposal engine
- Format-aware preview
- Dry run
- Backup
- Atomic apply
- Validation
- Automatic restoration
- Operation journal

## Milestone 8 — Rollback and recovery

- Backup browser
- Restore verification
- Crash recovery
- Interrupted-operation recovery
- Failure-injection tests

## Milestone 9 — Local AI integration

- Ollama
- LM Studio
- Settings
- Connection test
- Structured output
- AI safety
- Rule fallback
- Explanation UI

## Milestone 10 — Demo workflow and UX polish

- Guided demo
- Reset demo
- Loading states
- Toasts
- Error states
- Accessibility
- Trainer-focused polish
- Workshop-focused polish

## Milestone 11 — Packaging infrastructure

- userData paths
- better-sqlite3 or SQLite packaging verification
- Electron Builder
- Windows installer
- Portable build where practical
- Packaged demo support
- Packaged database smoke test

## Milestone 12 — Release candidate QA

- Complete workflow verification
- Regression tests
- Failure injection
- Compatibility matrix
- QA checklist
- Packaged-mode testing

## Milestone 13 — V1 release

- Version
- Release notes
- User guide
- Safety policy
- Troubleshooting
- Installer
- Diagnostic export
- Final verification

## Milestone 14 — V2 architecture planning

Planning and scaffolding only:

- Feature flags
- Session contracts
- Future live adapter contracts
- Safety-gate model
- Hotkey data model
- Read-only research plan
- V1 regression protection

---

# 46. WORKING RULES FOR IMPLEMENTATION

For every milestone:

1. Inspect existing implementation.
2. State what already exists.
3. State what is missing.
4. Create a focused plan.
5. Implement the smallest coherent set of changes.
6. Add or update tests.
7. Run type checking.
8. Run tests.
9. Run production build.
10. Review the diff.
11. Report exact results.

Do not:

- Start over unnecessarily
- Rewrite working modules without evidence
- Mix unrelated milestones
- Create fake UI handlers
- Mark placeholders as complete
- Leave silent TODOs in completed workflows
- Claim tests passed when they were not run
- Claim packaging succeeded when it was not tested
- Hide failures
- Delete user data
- Weaken safety checks to make tests pass

If a milestone is too large:

Complete the highest-priority coherent subset, test it fully, and report the remaining work.

Do not scatter shallow placeholders across the entire milestone.

---

# 47. DEFINITION OF DONE FOR EVERY MILESTONE

A milestone is complete only when:

- No relevant TypeScript errors remain.
- Production build passes.
- Existing tests remain green.
- New milestone tests pass.
- No direct renderer filesystem access exists.
- No edit bypasses proposal, approval, backup, and validation.
- No placeholder is represented as functional.
- New database migrations are idempotent.
- Error states are handled.
- The implementation works after restarting the app.
- Unrelated files were not changed unnecessarily.
- Documentation is updated where behavior changed.
- Known limitations are reported.
- Failed checks are disclosed honestly.

For editing milestones, also require:

- Original file remains safe during failure.
- Backup is verified.
- Atomic apply is used.
- Rollback is verified.
- Journal records are created.

---

# 48. FINAL REPORT FORMAT

At the end of every milestone, report:

## Milestone

Name and status.

## Existing functionality confirmed

What was already present and verified.

## Work completed

Clear list of implemented behavior.

## Files created

Exact paths.

## Files modified

Exact paths.

## Database changes

Migrations and schema changes.

## Commands run

Exact commands.

## Test results

Exact passed, failed, and skipped counts.

## Build results

Development, production, and package results.

## Manual workflows verified

List each verified workflow.

## Safety checks verified

IPC, path, backup, atomicity, and blocked-target status.

## Known limitations

Anything incomplete or unsupported.

## Recommended next milestone

One clear next step.

Do not claim the entire project is complete after completing only one milestone.

---

# 49. IMMEDIATE STARTING INSTRUCTION

Begin now.

First:

1. Inspect the repository.
2. Determine whether ResourceForge already exists.
3. Map the current codebase against this specification.
4. Create or update:
   - PROJECT_SPEC.md
   - Docs/ARCHITECTURE.md
   - Docs/IMPLEMENTATION_STATUS.md
5. Produce a concise gap analysis.
6. Start Milestone 0.
7. Do not begin production game-file modifications until Electron security, path containment, adapter contracts, operation states, backup verification, and atomic-write infrastructure are in place.

ResourceForge’s central promise is:

A premium trainer experience backed by transparent discovery, deterministic safety, verified backups, atomic changes, and reliable rollback.

Build toward that promise without shortcuts.
