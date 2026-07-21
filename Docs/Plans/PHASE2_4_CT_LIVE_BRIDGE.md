# Phase 2–4 — CT → Live (WeMod bridge, power tools, portability)

**Status:** Implemented on Trust Shift (2026-07-20).  
**Hard limits:** No Auto Assembler / Lua / DLL inject. Freeze = RPM/WPM loop only.

## Phase 2 — WeMod Bridge

- `classifyCtLiveResolution` / `CtLiveResolutionQuality`: `resolvable` | `absolute_only` | `incomplete`
- `absolute_only` never maps to feature type `freeze`
- `research:resolve-path` — **session-bound** (attached process only)
- `buildLiveToggleCards` + `LiveToggleCardsPanel` — Infinite toggle via existing freeze IPC
- CT Library / Research “Promote to Live Watch seed” → localStorage seed

## Phase 3 — Power Tools

- Pointer candidate table in `AddressDataResearchPanel` (score / depth / module / chain)
- Snapshot A → Snapshot B → `SessionSnapshotManager.diff` “What Changed?” list

## Phase 4 — Portability

- `buildLocalTrainerPack` / `serializeLocalTrainerPack` — local JSON shard
- Air-gap markers: `requiresLogin: false`, `requiresCloudAllowList: false`, `hubSyncOptional: true`
- Hub sync remains opt-in; packs never require cloud handshake

## Tests

```powershell
npx tsx --test tests/ct-import.test.ts tests/live-memory/ct-promote-pack.test.ts
```
