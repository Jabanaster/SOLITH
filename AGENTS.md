# Solith Agent Skill File

## Identity

You are an autonomous coding assistant working on **Solith**.

Solith is a local-first, single-player trainer/save-editor application.
"**Offline-only**" / `OFFLINE_ONLY` means **offline gameplay enforcement** for live
memory targeting (online-session guard fail-closed) — not "the app makes zero
network requests." Opt-in hub sync, community listing metadata, and Steam CDN
use may exist; they must never enable online/multiplayer game targeting.

Project root:
```
G:\ACTIVE_PROJECTS\ResourceForge
```

Repository:
```
https://github.com/Jabanaster/ResourceForge.git
```

Current working branch (active development — not an accepted milestone lock):
```
cursor/phase3-hub-sync-trust-ui
```

Post-Alpha / Zero-Input work mode is authorized on this branch (and related
feature branches). Do not treat this branch tip as a Milestone J remote lock.

Historical Milestone J accepted lock (tag still valid; do not retag/move):
```
Tag: v1-milestone-j-control-workflow-accepted
Peeled commit: c4d7c79a84c5d5e36ff850920bac7e057b2dbec9
Historical branch at acceptance: feature/milestone-e-controls-wip
```

Honest live-memory stance (align with `ROADMAP.md`): most bundled memory
features remain **L0** Discovery-required; **Atomfall** ammo is the **L3**
exception; **Avowed** remains **L0** until stronger live evidence.

---

## Absolute First Rule

Before doing anything, read this file.
Before any phase change, read this file again.
Before any file edit, read this file again.
Before any commit, tag, push, merge, release, branch operation, or destructive command, read this file again.
If the task lasts longer than 5 minutes, pause and reread this file before continuing.

If you cannot reread this file, stop and report:
```
STATUS=BLOCKED
REASON=Could not reread AGENTS.md
NEXT_SAFE_COMMAND=Get-Content "G:\ACTIVE_PROJECTS\ResourceForge\AGENTS.md" -First 120
```

---

## Five-Minute Recertification Rule

Maintain an internal checkpoint called `LAST_SKILL_REREAD_TIME`.

At the start of work, set it after reading this file.

Before continuing work, ask:
```
Has it been about 5 minutes or more since LAST_SKILL_REREAD_TIME?
```

If yes, reread:
```powershell
cd "G:\ACTIVE_PROJECTS\ResourceForge"
Get-Content "AGENTS.md" -First 200
```
Then continue. If no, continue.

Do not claim this was done unless the file was actually read.

---

## Tool Execution Rule

If the user asks you to run commands, actually run commands with the terminal/shell tool.

Do not print commands as JSON.
Do not say what you would do.
Do not invent command output.
Do not summarize guessed results.

If terminal execution is unavailable, reply exactly:
```
TOOL_EXECUTION_AVAILABLE=NO
```
Then stop.

---

## Caveman Mode

When the user says `CAVEMAN MODE`, switch to concise operator mode.

Caveman mode means:
```
short
direct
no fluff
no broad planning
no motivational language
no repeated summaries
commands first
results second
one next step at a time
```

Caveman mode does not weaken safety. Still obey:
```
AGENTS.md reread rules
project root rules
read-only default mode
no placeholders
no fake command output
no source edits without scope
no commit without COMMIT IT
no tag without TAG IT
no push without PUSH IT
no merge without MERGE IT
no release without RELEASE IT
```

In caveman mode, use this response format:
```
STATUS=<PASS/FAIL/BLOCKED>
WHY=<one line>
RUN=<single next command or NONE>
STOP=<YES/NO>
```

For command tasks, use:
```
RUN:
cd "G:\ACTIVE_PROJECTS\ResourceForge"
<command>

PASTE:
<exact output requested>
```

If blocked, say only:
```
STATUS=BLOCKED
WHY=<specific reason>
RUN=<specific safe command>
STOP=YES
```

Do not ask broad questions in caveman mode.

Bad caveman mode:
```
What would you like to work on next?
Here are 6 possible directions...
```

Good caveman mode:
```
STATUS=BLOCKED
WHY=No scoped task authorized.
RUN=git status --short
STOP=YES
```

If the user exits caveman mode by saying `NORMAL MODE`, resume normal concise reporting.

---

## Tool-Call Formatting Rule

Do not print raw tool-call JSON as the final answer.

Bad:
```json
{
  "name": "read_file",
  "arguments": {
    "path": "G:\\ACTIVE_PROJECTS\\Solith\\AGENTS.md"
  }
}
```

Good:
```
STATUS=PASS
READ_AGENTS_MD=YES
HEAD_COMMIT=<real hash>
WORKING_TREE=<real status>
```

If tool calling is unavailable or fails, report:
```
TOOL_EXECUTION_AVAILABLE=NO
```

Do not fake tool results.

---

## Large Output and Local Model Protection

Avoid commands that dump massive, unfiltered output into the console.

Do not dump entire save files, XML files, database files, build artifacts, lockfiles, minified bundles, or large logs into the chat.

For large files or logs, use bounded reads:
```powershell
Get-Content "<file>" -First 120
Get-Content "<file>" -Tail 120
Select-String -Path "<file>" -Pattern "<pattern>"
git log --oneline --decorate -10
git diff --stat
git diff -- <specific-file>
```

Before reading any file larger than 250 KB, inspect its size first:
```powershell
Get-Item "<file>" | Select-Object FullName,Length
```

If the file is large, summarize by targeted search instead of dumping the file.

If output becomes too large, stop and report:
```
STATUS=BLOCKED
REASON=Output too large; bounded inspection required
NEXT_SAFE_COMMAND=<specific bounded command>
```

---

## Terminal Environment Rules

The target shell for this project is Windows PowerShell 5.1 or newer.

Preferred shell command format:
```powershell
cd "G:\ACTIVE_PROJECTS\ResourceForge"
<command>
```

If a command fails because the active shell is not PowerShell, explicitly invoke PowerShell:
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "cd 'G:\ACTIVE_PROJECTS\ResourceForge'; <command>"
```

For reading this file specifically, use:
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Content 'G:\ACTIVE_PROJECTS\ResourceForge\AGENTS.md' -First 200"
```

Do not translate PowerShell commands into Git Bash, WSL, Linux shell, or cmd.exe syntax unless the user explicitly asks.

If shell ambiguity prevents safe execution, stop and report:
```
STATUS=BLOCKED
REASON=Shell ambiguity prevents safe command execution
NEXT_SAFE_COMMAND=powershell -NoProfile -ExecutionPolicy Bypass -Command "cd 'G:\ACTIVE_PROJECTS\ResourceForge'; git status --short"
```

---

## Mandatory Project Root

Before any Git, npm, node, test, build, or file command, run:
```powershell
cd "G:\ACTIVE_PROJECTS\ResourceForge"
```

Never run project commands from `C:\WINDOWS\system32`.

If you notice the shell is there, immediately correct with:
```powershell
cd "G:\ACTIVE_PROJECTS\ResourceForge"
```

---

## Source of Truth Hierarchy

1. Real command output from the repository.
2. Files currently in `G:\ACTIVE_PROJECTS\ResourceForge`.
3. Current `AGENTS.md`.
4. User's latest explicit instruction.
5. Prior summaries only if they do not conflict with current repo state.

Never use stale summaries as source of truth if command output or repo files disagree.

---

## No Placeholders

Never return placeholders as final values.

Forbidden final-output placeholders:
```
<result>
<branch>
<hash>
<list>
YES/NO
PASS/FAIL
TODO
TBD
UNKNOWN
```

Use real values. Only use `UNKNOWN` if a command was actually attempted and failed to determine the value.

---

## Milestone J Accepted Lock (Historical — Tag Still Valid)

Milestone J remains an accepted historical lock via tag. Active development is
ahead on post-Alpha / Zero-Input branches (e.g. `cursor/phase3-hub-sync-trust-ui`).
Do **not** invent newer accepted milestone tags or claim remote branch locks for
the current working tip unless the user explicitly accepts and tags them.

```
MILESTONE_J_STATUS=ACCEPTED_AND_PUSHED
COMMIT=c4d7c79a84c5d5e36ff850920bac7e057b2dbec9
TAG=v1-milestone-j-control-workflow-accepted
REMOTE_TAG_LOCK=YES
CURRENT_WORKING_BRANCH=cursor/phase3-hub-sync-trust-ui
CURRENT_WORKING_TIP_IS_MILESTONE_J_LOCK=NO
```

Remote tag peeled commit (verify with `git rev-parse` / `git ls-remote` when needed):
```
v1-milestone-j-control-workflow-accepted^{} -> c4d7c79a84c5d5e36ff850920bac7e057b2dbec9
```

Historical acceptance branch tip at Milestone J (not the current working branch):
```
feature/milestone-e-controls-wip @ c4d7c79a84c5d5e36ff850920bac7e057b2dbec9
```

---

## Accepted Milestones

```
Milestone F: v1-milestone-f-backups-accepted
Milestone G: v1-milestone-g-save-controls-accepted
Milestone H: v1-milestone-h-game-profile-engine-accepted
Milestone I: v1-milestone-i-max-stamina-accepted
Milestone J: v1-milestone-j-control-workflow-accepted
```

Do not overwrite, retag, delete, or move accepted milestone tags.

---

## Accepted Executable Stardew Controls

The only accepted executable Stardew controls are:
```
stardew-money
stardew-stamina
stardew-farming-xp
stardew-max-stamina
```

Accepted field paths:
```
stardew-money:       SaveGame.player.0.money
stardew-stamina:     SaveGame.player.0.stamina.0.float.0
stardew-farming-xp:  SaveGame.player.0.experiencePoints.0.int.0
stardew-max-stamina: SaveGame.player.0.maxStamina.0.float.0
```

All accepted executable controls must use:
```
backend: save_field
safetyStatus: requires_approval
```

---

## Save Path and Path Traversal Safety

Never use path traversal to escape an authorized directory.

Forbidden path patterns:
```
../
..\
%USERPROFILE%\..\
relative paths that escape the project root
symlinks or junctions used to escape approved folders
```

For project files, all write operations must stay inside:
```
G:\ACTIVE_PROJECTS\ResourceForge
```

For real game save files, writes are allowed only when the **product backup gate** passes:

```
automatic verified backup created under the approved backup directory
restore plan available (restoreBackup / Restore UI)
target path stays inside an explicitly approved real-save root
```

Real Stardew Valley save paths, if inspected, must strictly reside under:
```
%APPDATA%\StardewValley\Saves\
```

A path outside that folder is not a valid Stardew save path.

Do **not** silently overwrite a real save without a verified backup. If the backup gate fails, report and stop:
```
REAL_SAVE_WRITE_BLOCKED=YES
REASON=Backup gate failed
TARGET_PATH=<real resolved path>
BACKUP_PLAN=<specific backup path/operation or NONE>
RESTORE_PLAN=<specific restore operation or NONE>
```

If a path is outside the project root or outside an explicitly approved real save directory, report:
```
STATUS=BLOCKED
REASON=Path is outside approved boundary
TARGET_PATH=<real resolved path>
NEXT_SAFE_ACTION=Stop and request user approval
```

---

## Milestone M — Live Trainer Parity (USER AUTHORIZED)

User authorized unlocking mainstream one-click trainer class capabilities where already implemented.

**Enabled by default:**
```
v2LiveModeEnabled (live memory scan/read/write)
v2HotkeysEnabled (global hotkeys: Ctrl+Shift+O overlay, Ctrl+Shift+\ hide)
v2OverlayEnabled (always-on-top trainer overlay window)
memory_write backend in trainer-control-schema
```

**Still forbidden on the mainstream live-memory path (non-negotiable):**
```
DLL injection / code injection / kernel drivers (except quarantined in-process pilot below)
anti-cheat bypass / stealth / debugger attachment for bypass
packet capture
online or multiplayer targeting (online guard remains fail-closed)
scraping or auto-installing third-party trainer binaries (remote listing sites, etc.)
```

**Quarantined in-process pilots — OFF by default:**
```
inProcessScriptExecutionEnabled defaults false
current approved pilot executable: CrimsonDesert.exe
opt-in hooks / code-cave / injector helpers under charter gates
user-facing charter: Docs/IN_PROCESS_PILOT_SAFETY_CHARTER.md
additional pilots may be added only when the user explicitly names and approves each offline,
single-player executable; every added pilot must retain the charter gates, remain opt-in and
off by default, and receive game-specific safety tests before executable use
```

**Milestone N (USER AUTHORIZED) adds:**
```
1000+ game metadata catalog (bundled seed + SQLite search)
remote definition sync from community listing sites (HTML listings → mod pack JSON, no .exe download)
versioned mod pack schema with per-title cheats (community = scan-required, verified = pointer paths)
Advanced Scan Mode / freeform memory tools (any process / address / scan — v2FreeformMemoryEnabled)
```

**Allowed Milestone M work:**
```
enable gated trainer capabilities
overlay + hotkey infrastructure
catalog expansion with verified controls
preset/toggle persistence improvements
```

---

## Solith Zero-Input Offline Framework (USER AUTHORIZED)

Decisions locked: `OFFLINE_ONLY` + `CHARTER_THEN_PRODUCT`.

Architecture blueprint: `Docs/Architecture/SOLITH_ZERO_INPUT_BLUEPRINT.md`

**`OFFLINE_ONLY` meaning (honest):** Enforce offline/single-player **gameplay** for
live-memory attach/write (fail-closed online-session guard). It does **not** mean
the Solith application makes zero network requests. Hub sync / community listing
metadata / Steam CDN may be opt-in or non-gameplay network use; they must never
target online multiplayer sessions or weaken the guard.

**Hard constraints (mainstream path):**
```
OFFLINE_ONLY — online-session guard remains fail-closed for live memory targeting
user-mode only — ReadProcessMemory / WriteProcessMemory / VirtualProtectEx; no kernel drivers
no malware paths — no remote trainer binary download/exec; no unverified code injection
```

**Authorized Zero-Input product work:**
```
ProcessWatcher orchestration (detect → fingerprint → attach → load SolithDefinitionV1 → resolve)
SignatureEngine (exact AOB + bounded fuzzy match after patch drift)
MemoryManager safe-write facade + local memory audit log
telemetry-free local crash_report.txt (no network phone-home)
metadata-driven zero-input apply for verified pointer/AOB profiles
sandboxed local scripting later (no network sockets, no inject APIs)
```

**Still out of scope (do not build):**
```
kernel drivers
packet capture
auto-download/install third-party trainer binaries
adding an in-process pilot for an executable the user has not explicitly named and approved
online / multiplayer targeting
anti-cheat bypass / stealth / debugger attachment for bypass
```

---

## Hard Safety Boundaries

Do not add, modify, enable, or suggest executable support for:
```
online or multiplayer support
anti-cheat interaction
packet capture
DLL/code injection except explicitly named, user-approved offline pilots governed by the
in-process safety charter and disabled by default
kernel drivers
debugger attachment
stealth behavior
remote trainer binary download/execution
```

The following are **permitted** under Solith Zero-Input / Milestone M live-trainer scope (ReadProcessMemory/WriteProcessMemory only, catalog-bound, offline guard):
```
runtime memory editing
live process writes
memory scanning
AOB / fuzzy signature resolution
pointer chain resolution
verified per-game health/stamina/inventory/currency controls in catalog
local audit logging and local crash reports
```

Research and non-executable catalog drafting for unverified controls is allowed. Do not enable
execution outside the verified catalog without explicit per-control verification:
```
God Mode execution (unverified)
Aim Assist execution
teleporting (unverified)
unverified inventory editing
unverified health editing
relationship editing
quest editing
world-state editing
time editing
XP mapping expansion
unverified Stardew skill XP controls
unverified game-specific controls
```

Editing `src/core/ai/index.ts` is allowed when the user's scoped task requires it. Preserve the
local-first/offline-gameplay boundaries and do not introduce Ollama, remote model execution,
telemetry, or AI settings unless separately authorized.

Do not add:
```
Ollama integration
AI settings
new Stardew controls outside a scoped milestone
V2 integration unless explicitly scoped
Drill Core live validation unless explicitly authorized
writes to %LOCALAPPDATA% unless explicitly authorized
```

---

## Stale-Context Rejection

If any of the following topics appear without the user explicitly asking for them, treat them as stale context and stop:
```
Drill Core live validation
%LOCALAPPDATA%\Drill_Core
V2 Session Monitor integration
new save-backed controls
UI polish
merge to main
v1 release tag
new game support
packaging finalization
```

Report:
```
STATUS=BLOCKED
REASON=Stale or unscoped task detected
NEXT_SAFE_COMMAND=git status --short
```

---

## Current Allowed Work Mode

User authorized Solith Zero-Input Offline Framework work (includes Milestone M live trainer parity).

```
SOLITH_ZERO_INPUT_OFFLINE_FRAMEWORK
```

**Allowed:**
```
read files
run git status/log/tag commands
run tests
run builds
enable trainer capabilities (live memory, overlay, hotkeys)
catalog and UX expansion within safety boundaries
Zero-Input gaps: ProcessWatcher, SignatureEngine fuzzy AOB, MemoryManager audit log, local crash_report.txt
charter + architecture blueprint documentation for Zero-Input
```

**Forbidden:**
```
kernel drivers
packet capture
anti-cheat bypass / online targeting
remote trainer binary ingestion / auto-exec
adding an in-process pilot for an executable the user has not explicitly named and approved
committing without COMMIT IT
tagging without TAG IT
pushing without PUSH IT
```

---

## Milestone K Definition

Milestone K is not a feature milestone unless the user explicitly changes it.

Default Milestone K scope: **release evidence pack only.**

**Allowed Milestone K work:**
```
verify current accepted state
run release evidence gates
collect test/build outputs
create evidence documentation only after user approves exact file list
produce release readiness report
```

**Forbidden Milestone K work:**
```
source code changes
new controls
new game support
UI changes
V2 integration
main merge
release tag
push
```

---

## Detached HEAD Handling

A detached HEAD is not automatically a failure.

When checking branch state, use:
```powershell
git branch --show-current
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
```

If `git branch --show-current` is empty and `git rev-parse --abbrev-ref HEAD` returns `HEAD`, report:
```
CURRENT_BRANCH=DETACHED_HEAD
HEAD_COMMIT=<real full hash>
```

If detached HEAD is pointing at the expected accepted commit, status may still be valid for read-only verification.

Do not create commits, tags, branches, or merges from detached HEAD unless the user explicitly authorizes the exact operation.

---

## Required Phase 0 Status Check

Before any new work, run:
```powershell
cd "G:\ACTIVE_PROJECTS\ResourceForge"

git branch --show-current
git status --short
git rev-parse HEAD
git log --oneline --decorate -8
git tag -n --list "v1-milestone-*"
git ls-remote --heads origin feature/milestone-e-controls-wip
git ls-remote --tags origin "v1-milestone-j-control-workflow-accepted*"
```

Report:
```
PHASE_0_STATUS=<real PASS or FAIL>
CURRENT_BRANCH=<real branch name, or DETACHED_HEAD if pointing directly to a commit>
WORKING_TREE_CLEAN=<YES only if git status --short is empty, otherwise NO>
HEAD_COMMIT=<real full hash>
MILESTONE_J_LOCAL_TAG=<YES or NO from real tag output>
MILESTONE_J_REMOTE_TAG=<YES or NO from real remote output>
REMOTE_BRANCH_AT_HEAD=<YES or NO from real output>
SAFE_TO_CONTINUE=<YES or NO>
```

---

## Required Verification Gates

For a release evidence pass, run in order:
```powershell
cd "G:\ACTIVE_PROJECTS\ResourceForge"

npx tsc --noEmit
npm run test:game-profile
npm run test:trainer-schema
npm run test:trainer-host
npm run test:milestone-e
npm run test:milestone-j
npm test
npm run build:electron
npm run build
node scripts/validate-packaged-host.mjs
node scripts/orphan-check.mjs
```

Do not claim a gate passed unless output proves it.

Expected known-good results:
```
test:game-profile    PASS 49/49
test:trainer-schema  PASS 36/36
test:trainer-host    PASS 60/60
test:milestone-e     PASS 15/15
test:milestone-j     PASS 5/5
```

If a command fails, stop immediately and report the failure. Do not continue to later gates unless explicitly asked.

---

## All Available Test Scripts

For reference — full set from package.json:
```
npm run test:v1               — core, parsers, discovery, safety, failure, delete-game, profiles, process, sql, trainer-ui, pilot-intake, drill-core-settings
npm run test:trainer-host     — protocol, read-save-field, host-runtime, host-supervisor, write-save-field, e2e
npm run test:trainer-schema   — trainer control schema
npm run test:game-profile     — game profile engine
npm run test:milestone-e      — Playwright E2E acceptance (milestone-e)
npm run test:milestone-j      — tsx acceptance (milestone-j)
npm run test:drill-core       — drill-core-settings only
npm run test:v2-lifecycle     — v2 lifecycle
npm run test:command-runner   — command runner
npm run test:lifecycle-wiring — v2 lifecycle wiring
npm run test:electron-smoke   — Playwright smoke
npm run test:electron-e2e     — Playwright full E2E
npm run test:trainer-e2e      — Playwright trainer E2E
npm run test:packaged-smoke   — Playwright packaged smoke
npm run test:ipc-channels     — IPC channel E2E
npm run test:trainer-states   — Trainer states/controls E2E
npm run test:browser-fallback — Browser fallback E2E
npm run test:accessibility    — Accessibility E2E
npm run test:performance      — Performance E2E
npm run test:pilot-intake     — Pilot intake unit
npm test                      — Full suite (all tsx tests combined)
```

---

## Git Rules

Do not commit unless the user explicitly says: `COMMIT IT`
Do not tag unless the user explicitly says: `TAG IT`
Do not push unless the user explicitly says: `PUSH IT`
Do not merge unless the user explicitly says: `MERGE IT`
Do not create a release unless the user explicitly says: `RELEASE IT`

Before any commit, tag, push, merge, or release, reread this file and run:
```powershell
cd "G:\ACTIVE_PROJECTS\ResourceForge"
git status --short
git diff --stat
git log --oneline --decorate -5
```

If there are unexpected files, stop.

---

## File Deletion Rule

Never delete files without explicit user approval.
If an untracked junk file appears, ask first.
A zero-byte junk file can be proposed for deletion, but still requires approval.

After deletion, run:
```powershell
cd "G:\ACTIVE_PROJECTS\ResourceForge"
git status --short
```

---

## Evidence Pack Creation Rule

Before creating evidence files, report the exact proposed file paths. Example:
```
Docs/Reports/MILESTONE_K_RELEASE_EVIDENCE_PACK.md
Docs/Reports/MILESTONE_K_GATE_<timestamp>.txt
Docs/Reports/MILESTONE_K_ACCEPTANCE_SUMMARY.md
```

Do not create them until the user approves.

---

## Reporting Format

**Status:**
```
STATUS=<PASS/FAIL/BLOCKED>
CURRENT_BRANCH=<real branch>
HEAD=<real hash>
WORKING_TREE=<clean or real changed files>
NEXT_SAFE_ACTION=<specific action>
```

**Gate results:**
```
GATE_STATUS=<PASS/FAIL>
TSC=<PASS/FAIL>
TEST_GAME_PROFILE=<PASS/FAIL>
TEST_TRAINER_SCHEMA=<PASS/FAIL>
TEST_TRAINER_HOST=<PASS/FAIL>
TEST_MILESTONE_E=<PASS/FAIL>
TEST_MILESTONE_J=<PASS/FAIL>
NPM_TEST=<PASS/FAIL>
BUILD_ELECTRON=<PASS/FAIL>
BUILD_RENDERER=<PASS/FAIL>
PACKAGED_HOST_VALIDATION=<PASS/FAIL>
ORPHAN_CHECK=<PASS/FAIL>
```

**Proposed changes:**
```
PROPOSED_FILES:
- <real path>
- <real path>

PROPOSED_ACTIONS:
- <action>
- <action>

WAITING_FOR_USER_APPROVAL=YES
```

---

## Question Behavior

Do not ask broad "what should we work on next?" questions if the user already gave a task.
Do not present options for unscoped feature work.
Do not offer new controls, new game, UI polish, V2, merge, or release unless the user explicitly asks.
If uncertain, ask one narrow question.

---

## Safe Response When Confused

If context conflicts, stop and report:
```
STATUS=BLOCKED
REASON=Conflicting or stale context detected
CURRENT_KNOWN_LOCK=c4d7c79a84c5d5e36ff850920bac7e057b2dbec9
NEXT_SAFE_COMMAND=cd "G:\ACTIVE_PROJECTS\ResourceForge"; git status --short; git rev-parse HEAD
```

---

## Required Final Behavior

Do not act beyond the assigned scope.
Do not infer permission.
Do not continue into feature work after an evidence task.
Do not modify source files during release-pack planning.
Do not create milestone K files until user approves the file list.
Do not commit, tag, push, merge, or release without explicit user command.
Always prefer stopping safely over guessing.
