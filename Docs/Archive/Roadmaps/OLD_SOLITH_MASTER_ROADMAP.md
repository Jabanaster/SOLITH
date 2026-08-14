# SOLITH MASTER ROADMAP

## Excluding Security Work and Current Wisp Development

**Project:** `G:\ACTIVE_PROJECTS\SOLITH`
**Product:** Solith — local-first game trainer, save editor, discovery, compatibility, and trainer-authoring platform
**Current version:** `2.4.0-alpha.2`
**Target:** Stable, installable public alpha followed by a certified v1
**Last evidence review:** 2026-07-28
**Excluded from this roadmap:**

* Security hardening and security-policy work
* Current Wisp implementation
* Xbox Game Bar Wisp host work
* Wisp forms, customization, 3D animation, placement, and Advanced mode

Those remain separate workstreams and must not block the main Solith release unless explicitly brought back into scope.

---

# 1. Release Strategy

Solith should not be treated as one giant unfinished milestone.

The project should advance through these release gates:

| Gate   | Objective                                      | Exit condition                                                        |
| ------ | ---------------------------------------------- | --------------------------------------------------------------------- |
| **S1** | Complete offline product workflows             | All remaining offline blockers verified                               |
| **S2** | Complete UX and feature consistency            | Major pages usable, responsive, documented, and internally consistent |
| **S3** | Complete clean-build verification              | Fresh clone builds and all required test gates pass                   |
| **S4** | Resume and complete live-game certification    | Supported games tested against real installed copies                  |
| **S5** | Complete installer and private-alpha readiness | Signed installer and clean-machine acceptance pass                    |
| **S6** | Public-alpha readiness                         | Distribution, update, documentation, recovery, and support readiness  |
| **S7** | v1 certification                               | Minimum supported-game portfolio and feature matrix fully certified   |

---

# 2. Current Verified Progress

## Closed

### Offline Blocker 1 — Manual Game Metadata Persistence

**Status:** Closed

Verified:

* Real on-disk SQLite lifecycle
* Create and restart persistence
* Edit and restart persistence
* Stable identity
* No duplicate row creation
* UI add flow
* UI edit flow
* React refresh without intro replay
* Automated trainer-catalog coverage

### Offline Blocker 2 — CT ZIP Electron Bridge

**Status:** Closed

Verified:

* Native Electron file picker
* Opaque, expiring selection token
* No renderer-owned filesystem path
* Valid import
* Cancel handling
* Invalid ZIP handling
* Restart persistence
* No production `File.path` fallback
* Implementation commit:
  `14d9f11b3b43f918618e201ed4bd2de406fb2bd1`

## Implemented — Certification Pending

### Offline Blocker 3 — Page-Level Walkthrough Help

**Status:** Implementation committed; full manual route audit pending

Verified:

* Typed walkthrough content exists for every route in the required audit matrix.
* Activity Journal uses the registered `activity-journal` ID and TypeScript passes.
* The shared `WalkthroughOwner` is keyed by navigation and game context, so open help closes when the route or tool context changes.
* Walkthrough tests cover registry completeness, route ownership, accessible triggers, required targets, and page-specific safety copy.

Remaining closure evidence:

* Manual walkthrough audit across every listed route.

Implementation commit: `758b7af`.

### Shared Responsive Tool-Page Layout

**Status:** Closed on 2026-07-28

Verified:

* Shared page width behavior, header compression, and walkthrough placement fixed.
* All eight required pages passed isolated runtime width checks.
* Human `npm run dev` visual verification passed at normal, maximized, and narrowed window sizes.
* Repository TypeScript, trainer-catalog, frontend, Electron build, and Electron output verification gates pass.

Implementation commit:

* `758b7af` — responsive layout and walkthrough implementation.

### Offline Blockers 4 and 5 — Process Picker Filtering and Sorting

**Status:** Implemented; real Windows process-list certification pending

Verified:

* Current, installed, likely-game, and unknown process grouping exists.
* Known system, shell, Solith, Electron, launcher-helper, and development processes are filtered or classified.
* Search, show-all, stable grouping, A–Z, Z–A, confidence, recent, and PID sorting exist.
* Deterministic tests cover filtering, exact-path matching, grouping, searching, sorting, PID reuse, and inaccessible metadata.

Remaining closure evidence:

* Real Windows process-list manual inspection.
* Confirmation that no dangerous or unrelated process is selected by default.

Implementation commit: `41926f7`.

---

# 3. Gate S1 — Offline Product Completion

## S1.1 Page-Level Walkthrough Help

### Required page audit

Audit every user-facing route:

#### Library

* Game Library
* Trainer Library

#### Recovery

* Backups
* Save Locations
* Activity Journal

#### Save Tools

* Save Editor
* Trainer Controls

#### Specialized

* Discovery Lab
* Trainer Research Lab
* CT Library
* Registry Explorer
* Data Editor
* Compatibility
* Recipes

#### Advanced

* Session Monitor
* Live Memory Trainer

### Required behavior

Every applicable page must have:

* visible **How this works** control,
* page-specific explanation,
* prerequisites,
* workflow,
* effects,
* non-effects,
* common failures,
* related pages where useful.

Walkthroughs must:

* close automatically when route or tool changes,
* never remain attached to the wrong page,
* avoid stacking,
* remain responsive,
* support close-button and keyboard behavior,
* reopen only when requested.

### Exit evidence

* Complete route-to-walkthrough matrix
* Rendered route-change tests
* Manual page audit
* TypeScript clean
* Implementation commit

---

## S1.2 Advanced Scan Process Picker Filtering

The process picker must not dump an unstructured operating-system process list on the user.

### Required behavior

* Prioritize probable game processes
* Separate likely games from background processes
* Hide or clearly classify system processes
* Provide search
* Show process name, executable, PID, architecture, and path where appropriate
* Preserve selected process across harmless refreshes
* Clearly indicate inaccessible processes
* Avoid automatically selecting dangerous or unrelated processes

### Recommended classification

* Detected game
* Likely game
* Launcher
* Background application
* System process
* Inaccessible
* Unsupported architecture

### Exit evidence

* Deterministic classification tests
* Real process-list manual inspection
* No system process selected by default
* Search and filtering verified

---

## S1.3 Advanced Scan Process Picker Sorting

### Required sorting

Default:

1. Verified or detected games
2. Likely games
3. Recently used targets
4. Launchers
5. Other applications
6. System and inaccessible processes

Within groups:

* alphabetical by default,
* optional sort by PID,
* optional sort by memory,
* optional sort by path,
* optional sort by confidence.

### Exit evidence

* Sort-control tests
* Stable ordering
* Real Windows process audit
* No flickering or arbitrary reorder during refresh

---

## S1.4 Responsive Layout Closure

**Status:** Closed on 2026-07-28

### Required manual pages

* Trainer Controls
* Discovery Lab
* Trainer Research Lab
* CT Library
* Registry Explorer
* Data Editor
* Compatibility
* Recipes

### Required window states

* Normal desktop window
* Maximized
* Narrow-but-supported
* High-DPI display where available

### Exit criteria

* Content grows with window
* Header copy remains readable
* No narrow left-column lock
* No clipped actions
* No oversized empty reserved walkthrough area
* No horizontal overflow
* Shared fix documented and committed

---

## S1 Exit Gate

S1 closes when:

* Blockers 1–5 are all independently verified
* All relevant tests pass
* Manual Electron checks pass
* No known offline workflow silently fails
* Evidence records and implementation commits exist

---

# 4. Gate S2 — Product UX and Feature Consistency

S2 is not about new major features. It is about making the existing product feel like one coherent application.

## S2.1 Navigation Audit

Verify every navigation item:

* opens the correct page,
* highlights correctly,
* preserves valid state,
* does not preserve stale modals,
* does not trigger unnecessary full reloads,
* does not replay the intro,
* does not break browser history or back behavior.

Remove or disable navigation entries that lead to placeholders with no useful workflow.

---

## S2.2 Page Header Standardization

Every major tool page should share:

* icon,
* title,
* short description,
* status or profile information,
* primary action,
* help affordance,
* consistent spacing.

Avoid one-off page headers unless the feature genuinely requires one.

---

## S2.3 Empty-State Audit

Every page with no data must explain:

* why it is empty,
* what the user should do next,
* which action starts the workflow,
* whether a game/profile/scan is required.

Bad empty state:

> No items.

Good empty state:

> No trainer items exist for this game. Open Discovery Lab or Save Editor to scan and create a verified recipe.

---

## S2.4 Error-State Audit

Replace silent failures and vague messages.

Every action should expose:

* what failed,
* why it failed when known,
* what the user can do,
* whether anything changed,
* where logs or evidence exist when appropriate.

Avoid:

* swallowed promise rejections,
* disappearing dialogs,
* generic “Something went wrong,”
* success UI before persistence completes.

---

## S2.5 Loading and Long-Running Operations

Add consistent states for:

* scanning,
* importing,
* indexing,
* validating,
* building recipes,
* testing compatibility,
* connecting to processes,
* reading saves.

Required:

* progress indication where measurable,
* cancellation where safe,
* single-flight protection,
* no duplicate submissions,
* clear completion state.

---

## S2.6 Activity Journal Completion

The Journal should become a useful operational record rather than a dead log page.

Minimum useful capabilities:

* chronological activity list,
* event type,
* result,
* related game/profile,
* timestamp,
* readable details,
* filtering if already supported,
* clear empty state,
* local-storage explanation.

Do not add extensive analytics unless separately authorized.

---

## S2.7 User Preference Consistency

Confirm persistence for:

* selected game,
* page display preferences,
* filters and sorting,
* window size and position if intended,
* recent games,
* page density where supported,
* tutorial/help dismissals where appropriate.

Preferences should survive restart without storing stale transient state.

---

# 5. Gate S3 — Engineering and Clean-Build Verification

Security work is excluded, but build correctness is not.

## S3.1 Repository Baseline

Before a release candidate:

* resolve or formally baseline existing TypeScript diagnostics,
* remove stale generated artifacts,
* resolve whitespace failures,
* classify unrelated dirty work,
* ensure intended changes are committed,
* confirm no important work exists only in detached worktrees.

Known cleanup:

* existing `GameLibrary.tsx` whitespace findings
* electron-builder has an intermittent Windows `EPERM` staging-directory rename race; extracted output and NSIS generation pass via the preserved `--prepackaged` output
* historical clean-clone directories
* untracked evidence and test artifacts requiring classification

---

## S3.2 Unified Verification Command

Create one canonical release verification entry point.

Recommended:

```powershell
cd "G:\ACTIVE_PROJECTS\SOLITH"
npm run verify:release
```

It should orchestrate:

* dependency validation,
* main TypeScript,
* Electron TypeScript or approved baseline comparison,
* unit tests,
* trainer-catalog tests,
* CT tests,
* output verifier,
* production frontend build,
* Electron build,
* fixture validation,
* forbidden fallback scans,
* package verification.

Do not require users to remember twelve separate commands.

---

## S3.3 Clean Clone

Verify from a neutral location outside the active repository.

Required:

1. Clone repository.
2. Install exact dependencies.
3. Run release verification.
4. Build Electron output.
5. Launch application.
6. Confirm database bootstrap.
7. Confirm no developer-machine absolute path is required.
8. Confirm fixtures and assets are included correctly.

---

## S3.4 Continuous Integration

CI should run on:

* pushes to active release branches,
* pull requests,
* release tags.

Minimum jobs:

* install,
* TypeScript,
* unit/integration tests,
* Electron build,
* output verification,
* artifact retention.

Windows is mandatory because the principal product target and several runtime paths are Windows-specific.

Mac and Linux checks may follow where supported.

---

## S3.5 Dependency and Runtime Lock

Document and enforce:

* Node version
* npm version where required
* Electron version
* native dependency rebuild requirements
* SQLite native-module compatibility
* Windows SDK or build-tool requirements
* packaging dependencies

The successful Node 22 gate should become part of the supported environment definition rather than an ad hoc shell override.

---

# 6. Gate S4 — Live-Game Testing and Certification

This is where live game testing resumes.

S4 starts after offline workflows are stable enough that UI and persistence bugs no longer contaminate certification results.

## Certification Levels

Use the existing honest L0–L4 system.

Suggested interpretation:

| Level  | Meaning                                                               |
| ------ | --------------------------------------------------------------------- |
| **L0** | Profile/discovery metadata only                                       |
| **L1** | Game/process identified                                               |
| **L2** | Read path verified live                                               |
| **L3** | Controlled write verified with restart stability                      |
| **L4** | Broader certification across versions/sessions with rollback evidence |

Do not upgrade a title based on fixture-only or simulated evidence.

---

## S4.1 Atomfall

Current known state:

* Ammo L3 evidence exists

Required next work:

* review existing evidence,
* confirm current game version compatibility,
* expand only if additional fields are already planned,
* avoid unnecessary recertification without a version change.

---

## S4.2 Avowed

Current known state:

* L0
* 12/28 AOB patterns reported restart-stable
* 16/28 no match

Required:

1. Verify current installed build.
2. Identify WinGDK-specific differences.
3. Repair AOB patterns.
4. Run repeated restarts.
5. Verify read paths.
6. Verify one controlled write only after prerequisites pass.
7. Confirm rollback or restoration.
8. Record exact game build and platform.

Avowed should be the first resumed live-test target.

---

## S4.3 Dredge

Required:

* connection baseline,
* process/module identification,
* profile compatibility,
* stable read test,
* one safe controlled certification target.

---

## S4.4 Crimson Desert

Treat availability realistically. If the game or appropriate build is unavailable, classify it as:

> Blocked by game availability

Do not leave it appearing like an engineering failure.

---

## S4.5 Additional Bundled Profiles

Audit all advertised or visible profiles.

Each profile must clearly show:

* certification level,
* game version,
* platform,
* last verified date,
* supported functions,
* unsupported functions,
* required runtime,
* known limitations.

Profiles that are only L0 must not appear equivalent to L3 profiles.

---

## S4.6 Live-Test Session Harness

Create a repeatable session workflow:

1. Record game version.
2. Record executable/module hashes where appropriate.
3. Start clean.
4. Attach.
5. Run baseline reads.
6. Run pattern validation.
7. Perform approved write if authorized.
8. Verify visible game effect.
9. Restart game.
10. Revalidate.
11. Restore state.
12. Record logs and evidence.

---

# 7. Gate S5 — Installer and Private Alpha

## S5.1 Installer Build

Required:

* clean package build,
* correct app name and version,
* correct icons,
* no development-only paths,
* no source logs bundled unnecessarily,
* expected assets included,
* first-run bootstrap works.

---

## S5.2 Code Signing

Required before trusted tester distribution:

* acquire certificate,
* sign executable,
* sign installer,
* verify signatures,
* record SHA-256,
* ensure update packages use the same trust chain where applicable.

---

## S5.3 Clean-Machine Installation Test

Test on a machine or VM without the repository.

Verify:

* install,
* launch,
* data-directory creation,
* database migration,
* Game Library manual add,
* CT ZIP import,
* walkthroughs,
* page layouts,
* uninstall,
* reinstall,
* preservation or removal of user data according to the selected option.

---

## S5.4 Upgrade Test

Test upgrade from previous alpha where practical.

Verify:

* database migration,
* user library persistence,
* profile persistence,
* settings persistence,
* no duplicate records,
* no lost CT imports,
* no reset to intro loops.

---

## S5.5 Private Tester Package

Include:

* signed installer,
* version and build hash,
* short release notes,
* supported feature list,
* unsupported feature list,
* known issues,
* bug-report procedure,
* log collection instructions.

---

# 8. Gate S6 — Public Alpha Readiness

## S6.1 Distribution Channel

Choose one canonical channel:

* GitHub Releases
* itch.io
* direct project site
* another approved channel

Do not maintain several inconsistent public binaries.

---

## S6.2 Update System

Required before broad public alpha:

* update metadata,
* version comparison,
* signed update packages,
* release notes,
* failed-update recovery,
* user-controlled update behavior.

Avoid silent mandatory updates unless specifically justified.

---

## S6.3 Documentation

Minimum public documentation:

* installation guide,
* first-run guide,
* supported games,
* certification levels,
* Game Library guide,
* Save Editor guide,
* Trainer Controls guide,
* Discovery Lab guide,
* CT Library guide,
* backup and recovery guide,
* troubleshooting,
* uninstall and data-removal guide.

The in-app walkthrough and external documentation should agree.

---

## S6.4 Release Honesty Matrix

Publish a matrix showing:

* game,
* platform,
* version,
* certification level,
* read support,
* write support,
* save editing,
* live memory,
* known limitations.

This is one of Solith’s strongest differentiators and should remain explicit.

---

## S6.5 Feedback and Defect Intake

Define:

* issue template,
* log bundle,
* exact version capture,
* game/platform/build capture,
* steps to reproduce,
* expected vs actual,
* whether a backup exists.

---

# 9. Gate S7 — v1 Completion

Solith v1 should not mean “every possible game and every possible trainer feature.”

A realistic v1 means:

* core offline workflows are stable,
* clean installation works,
* update path exists,
* documentation is complete,
* a defined minimum game portfolio is certified,
* unverified profiles are clearly labeled,
* save editing and trainer workflows are coherent,
* users can recover from failed operations,
* no major page is a placeholder.

## Recommended Minimum v1 Portfolio

Choose a limited certified set, for example:

* 1–2 L3 save-backed games
* 1–2 L3 live-memory games
* several honest L0/L1 discovery-only profiles
* at least one complete CT Library workflow
* at least one complete user-created trainer workflow

Do not delay v1 indefinitely to certify dozens of games.

---

# 10. Feature-Area Completion Matrix

## Game Library

Required:

* manual add
* edit
* remove
* restart persistence
* folder scan
* source metadata
* clear errors
* page help
* responsive layout

Current state: substantially working.

---

## Trainer Library

Required:

* catalog browsing
* source and certification labels
* metadata persistence
* filtering and sorting
* page help
* responsive layout
* trainer launch/navigation consistency

---

## Backups

Required:

* backup listing
* game/profile association
* restore workflow
* visible result
* failure handling
* retention behavior
* page help

---

## Save Locations

Required:

* discovered locations
* manual locations
* validation
* deduplication
* edit/remove
* page help

---

## Activity Journal

Required:

* accurate local activity display
* readable event details
* empty state
* page help
* route-safe walkthrough behavior

---

## Save Editor

Required:

* supported format detection
* field loading
* validation
* proposal/approval flow
* backup
* write
* reopen verification
* clear unsupported state
* page help
* responsive layout

---

## Trainer Controls

Required:

* active profile
* field/action display
* host lifecycle
* input validation
* state labels
* page help
* full-width responsive layout
* live/save backend distinction

---

## Discovery Lab

Required:

* process or save discovery
* scan results
* candidate classification
* evidence capture
* promotion path
* page help
* responsive layout

---

## Trainer Research Lab

Required:

* structured research workflow
* recipe generation
* test results
* version tracking
* evidence state
* page help
* responsive layout

---

## CT Library

Required:

* native ZIP selection
* preview
* import
* malformed archive handling
* persistence
* listing
* details
* page help
* responsive layout

Current bridge: closed and verified.

---

## Registry Explorer

Required:

* registry data inspection
* clear read/write state
* profile linkage
* page help
* responsive layout

---

## Data Editor

Required:

* structured editing
* validation
* preview
* backup/restore integration
* page help
* responsive layout

---

## Compatibility

Required:

* profile/game compatibility results
* clear evidence labels
* no false certification
* actionable unsupported state
* page help
* responsive layout

---

## Recipes

Required:

* recipe list
* certification status
* detail view
* test history
* enable/disable state
* page help
* responsive layout

---

## Session Monitor

Required:

* active session visibility
* connection state
* logs/events
* clean disconnect
* page help
* stable refresh behavior

---

## Live Memory Trainer

Required:

* process selection
* connection
* module detection
* read verification
* approved write path
* restart stability
* certification evidence
* page help
* clear unsupported states

---

# 11. Deferred Main-Product Work

These items should remain deferred unless the current gate requires them:

* Managed .NET/Mono runtime support
* Broad Terraria binary `.plr` write support
* Large new game-profile expansion
* Universal engine detection
* Automatic support claims generated from heuristics
* Remote execution
* Multiplayer support
* Broad plugin ecosystem
* Cloud synchronization
* Mobile companion application

---

# 12. Stop-Doing Rules

Until public alpha:

* Do not add new major tool pages.
* Do not add another game merely because it is interesting.
* Do not reopen closed blockers without evidence of regression.
* Do not mix Wisp work into the main release gate.
* Do not call fixture tests live certification.
* Do not use file existence as proof of implementation.
* Do not leave successful code uncommitted for extended periods.
* Do not allow unrelated dirty-tree work into scoped commits.
* Do not make public release depend on completing every roadmap idea.

---

# 13. Immediate Execution Order

## Now

1. Close Blocker 3:

   * complete the remaining manual walkthrough audit,
   * record the focused implementation commit.

2. Close responsive-layout work:

   * no implementation work remains; retain regression checks in later gates.

3. Close Blocker 4:

   * manually certify process-picker filtering against a real Windows process list,
   * record the focused implementation commit.

4. Close Blocker 5:

   * manually certify stable process-picker sorting and refresh behavior,
   * record the focused implementation commit.

## Then

5. Establish the clean-build and CI gate.
6. Resume live-game testing with Avowed.
7. Continue Dredge and other available profiles.
8. Build signed private alpha.
9. Run clean-machine acceptance.
10. Prepare public-alpha documentation and distribution.

---

# 14. Master Completion Checklist

```text
SOLITH MAIN PRODUCT ROADMAP
Security work excluded: YES
Current Wisp work excluded: YES

S1 — Offline product completion
Blocker 1 metadata persistence: CLOSED
Blocker 2 CT ZIP bridge: CLOSED
Blocker 3 walkthrough help: IMPLEMENTED — MANUAL AUDIT PENDING
Blocker 4 process filtering: IMPLEMENTED — MANUAL CERTIFICATION PENDING
Blocker 5 process sorting: IMPLEMENTED — MANUAL CERTIFICATION PENDING
Responsive layout closure: CLOSED

S2 — UX consistency: PARTIALLY STARTED
S3 — Clean build and CI: IN PROGRESS
S4 — Live-game certification: PAUSED
S5 — Signed private alpha: NOT STARTED
S6 — Public alpha readiness: NOT STARTED
S7 — v1 certification: NOT STARTED

Next active task:
Offline Blocker 3 — complete and record the manual walkthrough route audit
```

## Hard release rule

Solith can return to live-game testing after **S1 closes**. It does not need to wait for signing, installation, public distribution, or Wisp completion.
