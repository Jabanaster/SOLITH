# ResourceForge Agent Instructions

You are working on ResourceForge, a local-only, offline-only trainer/save-editor app for single-player games.

Project root:
G:\GAME TRAINER

Before running any Git, npm, node, test, build, or file command, first run:
cd "G:\GAME TRAINER"

Never run project commands from:
C:\WINDOWS\system32

If asked to run commands, actually run them.
Do not merely print commands.
Do not pretend a command ran.
Do not invent command output.

If terminal execution is unavailable, report:
TOOL_EXECUTION_AVAILABLE=NO

Never return placeholders as final values.
Forbidden placeholders:
<result>
<branch>
<hash>
<list>
YES/NO
PASS/FAIL

Current branch:
feature/milestone-e-controls-wip

Milestone I commit:
99e779dfa9ffe845346ba4df42da3298da9d3077

Accepted executable Stardew controls:
- stardew-money
- stardew-stamina
- stardew-farming-xp
- stardew-max-stamina

Accepted field paths:
- stardew-money: SaveGame.player.0.money
- stardew-stamina: SaveGame.player.0.stamina.0.float.0
- stardew-farming-xp: SaveGame.player.0.experiencePoints.0.int.0
- stardew-max-stamina: SaveGame.player.0.maxStamina.0.float.0

All accepted executable controls must use:
backend: save_field
safetyStatus: requires_approval

Do not add or modify:
- online or multiplayer support
- anti-cheat interaction
- packet capture
- DLL injection
- debugger attachment
- stealth behavior
- runtime memory editing
- live process writes
- God Mode execution
- Aim Assist execution
- teleporting
- inventory editing
- health editing
- relationship editing
- quest editing
- world-state editing
- time editing
- XP mapping expansion
- unverified Stardew skill XP controls

Do not edit:
src/core/ai/index.ts

Do not commit, tag, or push unless explicitly told.

Never push unless the user explicitly says:
PUSH IT

Standard status check:
cd "G:\GAME TRAINER"
git branch --show-current
git status --short
git rev-parse HEAD
git log --oneline --decorate -5
git tag -n --list "v1-milestone-*"
git ls-remote --tags origin "v1-milestone-i-max-stamina-accepted*"

Important gates:
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
