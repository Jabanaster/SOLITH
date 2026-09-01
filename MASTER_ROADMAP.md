# SOLITH — MASTER ROADMAP

> **Revised 2026-09-01.** This roadmap replaces the prior security/authority-track
> roadmap, preserved verbatim at
> `Docs/ROADMAP_ARCHIVE_SECURITY_TRACK_2026-09-01.md`. SOL-N now refers to the
> phases defined below — they do **not** map onto the old SOL-0/SOL-1 numbering.
> `CERTIFIED` still means reproducible build/test/runtime evidence exists for
> the stated scope; it is never inferred from a phase document existing.

## 1. Product definition

**SOLITH is a local-first AI gaming intelligence, assistance, enhancement, modification, automation, and game-control platform.**

SOLITH exists to understand and interact with **games**. Its responsibilities include:

- Game discovery and identification
- Live game/process observation
- Game-state understanding
- Wisp adaptive assistance
- AI gaming companions/assistants
- Game-specific automation
- Single-player/offline trainer and cheat functionality
- Game modification and experimentation
- Save-game tooling
- Gaming telemetry and analytics
- Game troubleshooting
- Performance optimization
- Accessibility assistance
- Game knowledge/research
- Overlay and gaming UI
- Controller/input assistance
- Mod management/integration
- Eventually deeper game-specific intelligence and autonomous gameplay

### Explicitly outside SOLITH

General-purpose:

- desktop automation
- PC administration
- autonomous software engineering
- repository management
- arbitrary browser automation
- general file management
- OS maintenance
- software installation
- general computer-use agents

Those belong primarily to **CodeWorkshop**. SOLITH may use underlying
capabilities when required to accomplish a gaming task, but they are
implementation mechanisms — not SOLITH's product mission.

## 2. Correct architectural flow

The previous direction put too much emphasis on machine authority. The new
hierarchy:

```text
                        PLAYER
                           |
                           v
                   +---------------+
                   |    SOLITH     |
                   | Gaming Intent |
                   +-------+-------+
                           |
                           v
                +---------------------+
                | GAME ORCHESTRATOR   |
                | What game?          |
                | What does user want?|
                | What is happening?  |
                +----------+----------+
                           |
            +--------------+--------------+
            v              v              v
       GAME IDENTITY   GAME STATE     GAME KNOWLEDGE
            |              |              |
            +--------------+--------------+
                           v
                   GAMING INTELLIGENCE
                           |
      +--------------------+---------------------+
      v                    v                     v
    WISP               ASSISTANCE            TRAINER /
                                              MODIFICATION
      |                    |                     |
      +--------------+-----+------+--------------+
      v              v            v              v
   INPUT          OVERLAY      AUTOMATION      GAME STATE
   CONTROL                                      CONTROL
      |              |            |              |
      +--------------+-----+------+--------------+
                           v
                    GAME INTERACTION
                           |
                           v
                          GAME
                           |
                           v
                    OBSERVE RESULT
                           |
                           v
                     ADAPT / VERIFY
```

**Gaming intent sits at the top.** Machine-control systems become
subordinate infrastructure.

## 3. Common SOLITH execution rule

Keep the governance discipline:

> **AUDIT -> RECONCILE -> IMPLEMENT -> VERIFY -> CERTIFY -> DOCUMENT -> INTEGRATE**

And retain:

> **CERTIFIED means reproducible build/test/runtime evidence exists.**

No feature gets called certified because the code exists.

## Pending reconciliation (2026-09-01)

The prior security/authority track (archived at
`Docs/ROADMAP_ARCHIVE_SECURITY_TRACK_2026-09-01.md`) had reached: baseline
authority audit certified, SOL0-P0-1 packaged-consent gate fixed and merged
to `master`, and a partial `AuthorityService` capability evaluator
implemented (`src/core/authority/`, evidence at
`Docs/authority/SOL1_GOVERNED_COMPUTER_CONTROL.md` and
`Docs/authority/SOL0_ACTION_AUTHORITY_MATRIX.md`). None of that code has
been deleted. Under this roadmap it is **unclassified** pending the SOL-0
audit below (§"SOL-0 — Gaming Scope & Architecture Reconciliation",
"Specifically inspect: ComputerControlService, authority system, consent
system"). Do not assume it is PRESERVE, ADAPT, MOVE/EXTRACT, or REMOVE
until that audit runs — this line exists so the work isn't silently lost
or silently kept.

---

# SOL-0 — Gaming Scope & Architecture Reconciliation

**Status:** TODO / NOT CERTIFIED

### Objective

Correct the repository to the gaming-only mission before adding more capabilities.

### Audit

Inventory every existing SOLITH subsystem and classify it:

**PRESERVE** — already directly supports gaming.

**ADAPT** — useful infrastructure but currently too general-purpose.

**MOVE/EXTRACT** — belongs in CodeWorkshop rather than SOLITH.

**REMOVE** — obsolete/redundant.

**DEFER** — potentially useful but premature.

### Specifically inspect

- ComputerControlService
- authority system
- consent system
- Wisp
- process observation
- input systems
- browser/research
- memory
- skills
- agents
- automation
- telemetry
- security
- overlays
- Electron UI
- game registry
- game identification
- process identity

### Deliverable

A clean architectural boundary:

```text
SOLITH = GAMING
CODEWORKSHOP = GENERAL COMPUTER/ENGINEERING
```

This should happen **first**.

---

# SOL-1 — Game Identity & Game Registry

**Status:** TODO / NOT CERTIFIED

SOLITH needs to know exactly what game it's dealing with before doing anything intelligent.

Build a canonical:

## GameIdentity

Potential identity signals:

- executable
- installation directory
- launcher
- Steam App ID
- Epic identifier
- GOG identifier
- Microsoft/Xbox identity
- executable hash
- version
- build
- DLC
- platform
- process metadata

Create:

## GameRegistry

Each supported game receives a structured profile.

```text
GameProfile
 |-- identity
 |-- executable
 |-- versions
 |-- process rules
 |-- capabilities
 |-- adapters
 |-- telemetry
 |-- Wisp support
 |-- trainer support
 |-- save locations
 |-- mods
 `-- known compatibility
```

This becomes one of SOLITH's foundational databases.

---

# SOL-2 — Game Session Runtime

**Status:** TODO / NOT CERTIFIED

Turn the existing process/session work into a proper **GameSession** abstraction.

SOLITH should understand:

```text
NOT_RUNNING
  |
DISCOVERED
  |
LAUNCHING
  |
ATTACHED
  |
ACTIVE
  |
PAUSED
  |
DETACHED
  |
TERMINATED
```

Track:

- PID
- executable identity
- game version
- session generation
- process restarts
- game switches
- foreground state
- child processes
- launcher handoff

This is where the existing Atomfall certification work becomes highly valuable.

---

# SOL-3 — Gaming Observation Engine

**Status:** TODO / NOT CERTIFIED

Now SOLITH learns to **observe games**. Use multiple observation providers
rather than relying on one technique.

Potential providers:

### Process observation

Basic process state and lifecycle.

### Screen observation

Frames/screenshots and visual understanding.

### UI observation

Menus, HUDs, inventories, maps, dialogue, etc.

### Game telemetry

Official APIs where available.

### Log observation

Game-generated logs.

### Local state

Configuration and game-generated files.

### Supported game integration

Plugins/mod APIs where available.

Eventually SOLITH creates a normalized:

## GameState

```text
GameState
 |-- session
 |-- player
 |-- world
 |-- UI
 |-- inventory
 |-- objectives
 |-- combat
 |-- environment
 |-- performance
 `-- confidence
```

Not every game will expose every field. That's fine.

---

# SOL-4 — Wisp 2.0

**Status:** TODO / NOT CERTIFIED

Wisp should become a flagship SOLITH capability. Rather than being a generic assistant:

> **Wisp is an adaptive AI gaming companion connected to the active game session.**

Wisp should understand:

- current game
- current situation
- player behavior
- objectives
- recent events
- failures
- preferences
- difficulty
- available assistance

Then provide context-aware assistance. Examples:

> "You're underleveled for this area."

> "You've died to this attack four times. Want me to explain the timing?"

> "You already have the item needed for this quest."

> "There's a better weapon in your inventory."

And eventually:

> "Want me to handle this section?"

That transitions into automation.

---

# SOL-5 — Game Knowledge Engine

**Status:** TODO / NOT CERTIFIED

SOLITH needs gaming-specific research and knowledge.

Sources can include appropriately licensed/accessible:

- game manuals
- official documentation
- wikis
- patch notes
- guides
- local game data
- player-provided information
- SOLITH observations

Knowledge should be version-aware. That's critical. A guide for game
version 1.2 may be wrong under 1.8.

Model:

```text
GAME
 |
VERSION
 |
CONTENT
 |
MECHANICS
 |
PLAYER STATE
 |
CURRENT SITUATION
```

Wisp queries this system.

---

# SOL-6 — Gaming Input & Action Engine

**Status:** TODO / NOT CERTIFIED

SOLITH needs reliable game interaction.

Providers may include:

- keyboard
- mouse
- controller
- virtual controller
- game APIs
- mod APIs

Create semantic actions rather than exposing only raw keys.

Instead of:

```text
press W 812ms
```

higher layers request:

```text
MOVE_FORWARD
OPEN_INVENTORY
USE_ITEM
INTERACT
PAUSE
OPEN_MAP
```

Game adapters translate semantic actions into actual controls. That
dramatically improves portability.

---

# SOL-7 — Adaptive Assistance

**Status:** TODO / NOT CERTIFIED

Now combine: **GameState + Knowledge + Wisp + Input**

SOLITH can provide different assistance levels.

### Level 0 — Observe

No intervention.

### Level 1 — Inform

Tips and contextual information.

### Level 2 — Recommend

Recommend actions.

### Level 3 — Assist

Perform limited actions after authorization.

### Level 4 — Automate

Execute defined gameplay tasks.

### Level 5 — Agent

Operate substantial gameplay sequences autonomously where appropriate.

The player controls the level.

---

# SOL-8 — Trainer & Game Modification Framework

**Status:** TODO / NOT CERTIFIED

This should be a **first-class SOLITH subsystem**, not an awkward hidden
feature. For supported single-player/offline contexts, build a structured
trainer system.

Potential capabilities include:

- runtime state inspection
- controlled value modification
- health/resource modification
- inventory experimentation
- movement/gameplay modifiers
- time/speed controls
- debug-style functionality
- configurable trainer profiles
- reversible modifications where technically possible

Game-specific implementations should be versioned and validated.

```text
TrainerProfile
 |-- game
 |-- version
 |-- capabilities
 |-- compatibility
 |-- modification method
 |-- restore behavior
 |-- verification
 `-- risk metadata
```

This should integrate directly with Wisp. For example:

> "Give me unlimited crafting materials."

SOLITH determines whether the current game/profile supports that
capability and applies the supported local modification.

Online competitive anti-cheat bypass/evasion remains outside the
implementation scope.

---

# SOL-9 — Save Lab

**Status:** TODO / NOT CERTIFIED

This could become one of SOLITH's best utilities. Create a proper
save-game management and experimentation environment.

Capabilities:

- discover saves
- backup
- restore
- version
- compare
- inspect
- validate
- migrate where feasible
- edit supported save structures
- maintain snapshots

Before modifications:

```text
ORIGINAL SAVE
     |
SNAPSHOT
     |
MODIFICATION
     |
VALIDATION
     |
NEW SAVE
```

Never blindly modify the only copy.

---

# SOL-10 — Mod Intelligence & Management

**Status:** TODO / NOT CERTIFIED

SOLITH should understand installed mods. Eventually:

- discover mods
- identify versions
- detect conflicts
- analyze load order
- track dependencies
- detect outdated mods
- identify likely crash sources
- maintain profiles
- enable/disable profiles
- explain conflicts

Wisp can then answer:

> "Why did my game start crashing?"

using actual installed-game/mod state.

---

# SOL-11 — Gaming Performance & Troubleshooting

**Status:** TODO / NOT CERTIFIED

This is where PC telemetry belongs in SOLITH. Not:

> Monitor my computer generally.

Instead:

> **Understand machine behavior as it affects gaming.**

Monitor relevant:

- FPS
- frametime
- CPU
- GPU
- VRAM
- RAM
- temperatures
- storage
- shader compilation
- game crashes
- driver-related symptoms

SOLITH should eventually answer:

> "Why is this game stuttering?"

using evidence from the actual gaming session. That's legitimate SOLITH territory.

---

# SOL-12 — Gaming Automation

**Status:** TODO / NOT CERTIFIED

Build gaming-specific workflows. Examples:

```text
Launch game
-> apply preferred settings
-> activate mod profile
-> start telemetry
-> attach Wisp
-> load trainer profile
-> enter gaming mode
```

Or:

```text
Game exits
-> capture session telemetry
-> preserve relevant logs
-> save Wisp session
-> detect crash
-> diagnose if necessary
```

This is **gaming automation**, not arbitrary desktop automation.

---

# SOL-13 — Accessibility Engine

**Status:** TODO / NOT CERTIFIED

Potentially a major feature. Examples:

- input remapping
- input simplification
- repeated-input automation
- timing assistance
- visual assistance
- contextual descriptions
- menu navigation assistance
- difficulty adaptation
- configurable gameplay assistance

Wisp could dynamically adjust assistance according to player preference.

---

# SOL-14 — Autonomous Gameplay Agents

**Status:** TODO / NOT CERTIFIED

Only after the observation/action infrastructure is mature.

Create agents capable of:

```text
OBSERVE
  |
UNDERSTAND
  |
PLAN
  |
ACT
  |
OBSERVE RESULT
  |
ADAPT
```

Potential applications:

- grinding
- farming
- navigation
- repetitive tasks
- testing
- practice
- experimentation
- game QA
- AI companion behavior

This could become one of SOLITH's technically hardest systems.

---

# SOL-15 — Gaming Overlay / Command Center

**Status:** TODO / NOT CERTIFIED

The player needs one coherent interface.

Potential UI:

```text
+----------------------------------------------+
| SOLITH                         ATOMFALL       |
+----------------------------------------------+
| WISP                                          |
|                                                |
| "You're entering a high-radiation area."      |
+-------------+-------------+--------------------+
| GAME STATE  | TRAINER     | PERFORMANCE        |
| HP 82%      | God Mode o  | FPS 117             |
| Ammo 24     | Ammo     o  | GPU 91%             |
| Quest ...   | Speed    o  | VRAM 8.4 GB         |
+-------------+-------------+--------------------+
| Mods | Saves | Guides | Automation | Wisp       |
+----------------------------------------------+
```

Desktop application plus optional in-game overlay where technically appropriate.

---

# SOL-16 — Game Adapter SDK

**Status:** TODO / NOT CERTIFIED

SOLITH cannot hard-code everything. Create a formal adapter system.

```text
SOLITH CORE
    |
    |-- Game Adapter
    |      |-- identity
    |      |-- observation
    |      |-- actions
    |      |-- trainer
    |      |-- saves
    |      |-- mods
    |      `-- telemetry
    |
    |-- Game Adapter
    |
    `-- Game Adapter
```

Adding another supported game should eventually mean implementing an
adapter rather than modifying SOLITH Core. This is essential for scaling.

---

# SOL-17 — Gaming Capability Registry

**Status:** TODO / NOT CERTIFIED

Every capability should be machine-readable. Example:

```text
GAME: Atomfall

Observation
  process                 CERTIFIED
  screen                  CERTIFIED
  inventory               VERIFIED

Wisp
  contextual assistance   CERTIFIED
  adaptive hints          VERIFIED

Trainer
  health modification     SUPPORTED
  inventory modification  UNSUPPORTED

Automation
  navigation              EXPERIMENTAL

Saves
  backup                   CERTIFIED
  structured editing      UNSUPPORTED
```

This prevents SOLITH from pretending every game supports everything.

---

# SOL-18 — Safety, Integrity & Recovery

**Status:** TODO / NOT CERTIFIED

Keep security — but make it gaming-specific.

Protect against:

- wrong-process attachment
- stale PID reuse
- wrong game version
- corrupted saves
- incompatible mods
- invalid trainer profiles
- uncontrolled input
- runaway automation
- unexpected game state
- conflicting modifications

Maintain the existing emergency-stop concept. One command/button should
immediately stop SOLITH gameplay control.

---

# SOL-19 — Test & Certification Platform

**Status:** TODO / NOT CERTIFIED

This needs to become unusually strong because live-game interaction is
difficult to reproduce.

Build:

- simulated games
- fixture processes
- fake telemetry
- recorded sessions
- deterministic game-state streams
- input/action verification
- save fixtures
- trainer fixtures
- adapter conformance tests

Then use actual games for final runtime certification.

The maturity ladder remains:

```text
PROPOSED
  |
IMPLEMENTED
  |
TESTED
  |
INTEGRATED
  |
VERIFIED
  |
CERTIFIED
```

---

# SOL-20 — SOLITH 1.0 Certification

**Status:** TODO / NOT CERTIFIED

Do **not** define 1.0 as "supports every game." That would never finish.

Define SOLITH 1.0 by proving the architecture across a small set of
representative games. Target roughly **3-5 games** with substantially
different architectures. Each should demonstrate different SOLITH
capabilities.

Atomfall can remain one of the certification titles because real-process
evidence is already established there.

SOLITH 1.0 needs to prove:

**discover -> identify -> attach -> observe -> understand -> assist -> interact -> modify where supported -> automate -> detach -> recover**

with reproducible evidence.

---

# SOL-21 — Game Coverage Expansion

**Status:** TODO / NOT CERTIFIED

Only after 1.0. Then start expanding the adapter library.

Prioritize games based on:

**popularity x technical feasibility x capability coverage x Wisp usefulness x trainer/mod ecosystem**

rather than simply adding games randomly.

---

# SOL-22 — Advanced Gaming Intelligence

**Status:** TODO / NOT CERTIFIED

Longer-term research:

- learned player models
- personalized coaching
- adaptive difficulty assistance
- gameplay strategy modeling
- multimodal game understanding
- long-horizon gameplay planning
- persistent AI companions
- cross-session learning
- procedural strategy generation
- automatic game-mechanic discovery
- game-state prediction

This is where SOLITH moves from a sophisticated trainer/assistant into
genuine **gaming intelligence**.

---

# The resulting SOLITH stack

```text
                   +--------------------+
                   |       PLAYER       |
                   +---------+----------+
                             |
                   +---------v----------+
                   |       WISP         |
                   | Gaming Companion   |
                   +---------+----------+
                             |
             +---------------v----------------+
             |      GAMING INTELLIGENCE       |
             | Reasoning / Planning / Memory  |
             +---------------+----------------+
                             |
      +----------------------+----------------------+
      v                      v                      v
 KNOWLEDGE              GAME STATE             AUTOMATION
      |                      |                      |
      +--------------+-------+--------+-------------+
      v              v                v             v
   TRAINER          SAVES            MODS        ASSISTANCE
      |              |                |             |
      +--------------+--------+-------+-------------+
                              v
                    GAME ADAPTER LAYER
                              |
             +----------------+----------------+
             v                v                v
        OBSERVATION          INPUT         TELEMETRY
             |                |                |
             +----------------+----------------+
                              v
                           GAME
```
