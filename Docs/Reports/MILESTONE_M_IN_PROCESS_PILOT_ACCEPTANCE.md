# Milestone M — In-Process Pilot Acceptance

**Milestone ID:** `milestone-m-in-process-pilot`  
**Status:** Accepted locally (commit on `master`; tag with `TAG IT` when ready)  
**Date:** 2026-07-13  
**Prior research lock:** Milestone L — `v1-milestone-l-research-lab-accepted` @ `cdd8c513853a7ac6f5b6b278c5614e422f8865d4`

---

## Purpose

Milestone M packages the **explicitly gated In-Process Script Execution pilot** that was deferred from Milestone L, plus supporting Trainer Deck / install-discovery workspace surfaces used to reach and operate Crimson Desert workflows.

This milestone is a **pilot**, not a general AA→hooks compiler and not a multi-game injector platform.

---

## Accepted Scope

### 1. In-process script core (`src/core/in-process-script/`)

| Capability | Module | Notes |
|------------|--------|-------|
| Charter + gates | `charter.ts`, `guards.ts` | Flag + offline + approval + `CrimsonDesert.exe` only |
| AA hook planner | `aa-hook-planner.ts` | Maps researched scripts → preset / plan-only |
| Hook engine | `hook-engine.ts` | Propose → confirm → rollback |
| Code cave | `code-cave.ts`, `native-bridge.ts` | Absolute jump patch + VirtualAllocEx cave |
| Friendship preset | `presets/crimson-fast-friendship.ts` | Only executable preset under M |
| Trainer spawn | `injector-launcher.ts` | Detached `.exe` spawn after propose/confirm (not DLL inject API) |

### 2. Feature flag (default OFF)

```
inProcessScriptExecutionEnabled = false
```

Also requires live-memory capability (`v2LiveModeEnabled`) at IPC.

### 3. IPC + Research Lab UI

| IPC | Behavior |
|-----|----------|
| `in-process-propose-hook` / `confirm` / `rollback-hook` | Staged install into attached **game** process |
| `in-process-propose-injector-launch` / `confirm` | Spawn user-supplied trainer `.exe` after approval |

UI: Trainer Research Lab → **In-Process Script Execution (Crimson Desert pilot)** panel.

### 4. Trainer Deck + install discovery (workspace package)

Included so the pilot has operable library UX:

- `src/core/trainer-deck/`, `electron/trainer-deck-ipc.ts`, `TrainerDeckPage`
- `src/core/install-discovery/`, `electron/install-discovery-ipc.ts`
- Related health / demand / branding nav updates that land with this package

---

## Safety Charter (Milestone M)

**Allowed (pilot)**

- Flag-gated hook install for Crimson Desert friendship preset only
- Offline confirm + per-action approval
- Online guard recheck before hook install
- Rollback restoring original bytes
- Detached launch of a user-picked trainer `.exe` (user owns what it does)

**Forbidden under M**

- Kernel drivers / anti-cheat bypass / stealth
- Multiplayer or online-session use
- Arbitrary auto-compile of all AssemblerScript to hooks
- Expanding pilot executables beyond `CrimsonDesert.exe` without a new milestone

---

## Verification Gates

```powershell
cd "G:\ACTIVE_PROJECTS\ResourceForge"
npx tsx --test tests/in-process-script.test.ts
npx tsx --test tests/install-discovery-steam.test.ts tests/install-discovery-match.test.ts
npx tsx --test tests/trainer-deck-rows.test.ts tests/trainer-health.test.ts tests/catalog-demand.test.ts
```

---

## Explicit Non-Scope

- Milestone L research tools remain the L2 foundation (PE / diff / script analyzer / Dumpspace)
- Accepted Stardew save-field controls remain limited to the four production-accepted controls
- No merge to `main`, tag, or push unless user says `MERGE IT` / `TAG IT` / `PUSH IT`

---

## Suggested Tag

```
v1-milestone-m-in-process-pilot-accepted
```
