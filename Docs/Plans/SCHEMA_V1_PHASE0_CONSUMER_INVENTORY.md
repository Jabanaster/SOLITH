# Schema.v1 Phase 0 — Consumer Inventory

**Branch:** `cursor/schema-v1-phase0-1-capabilities`  
**Base:** green `master` @ `dd6225a` (or later)  
**Scope:** documentation only for consumers; Phase 1 adds advisory capability lanes (no execute IPC changes).

---

## 1. ID map (canonical vs parallel)

| Layer | ID shape | Notes |
|-------|----------|--------|
| Trainer catalog / definition | `catalogGameId` (e.g. `stardew-valley`, `palworld`, `crimson-desert`) | schema.v1 `definition.id` |
| Cheat system | `GameId` string on `GameConfig` | Seeded into definitions via `bundled-definition-seed.ts` from `ALL_GAMES` |
| Game profiles | profile file / `gameId` (Stardew) | Milestone H/J save paths — still authoritative for TrainerControlPanel default path |
| Live control catalog | process / control ids (Atomfall ammo) | Parallel verified pointer list — **Phase 2** dual-read target |
| Executables | `.exe` names on definitions | Injection pilot: `CrimsonDesert.exe` only (charter) |

**Known dual-sourced titles:** Stardew (definition `saveEditor` + `game-profiles/stardew-valley.json`), Atomfall (definition L0 vs `live-control-catalog`).

---

## 2. Authority consumers (do not remove in Phase 1)

| System | Key paths | Who consumes |
|--------|-----------|--------------|
| **ALL_GAMES** | `src/core/cheat-system/games.ts`, `index.ts` | MultiGame / Deck / Overlay session UX; seed for bundled definitions |
| **live-control-catalog** | `src/core/live-memory/live-control-catalog.ts` | `liveMemoryListControls` / resolve via live-memory IPC |
| **game-profiles** | `src/core/game-profiles/*`, `trainer-control-panel-build.ts` | TrainerControlPanel Stardew controls |
| **schema.v1 definitions** | `load-catalog-definition.ts`, store payloads | Catalog load/search capabilities (Phase 1); save controls via `solithDefinitionToTrainerControls` |
| **ModPack / GameConfig** | `mod-pack-loader.ts`, trainer-catalog load | Deck launch still returns GameConfig when present |

---

## 3. UI surfaces

| Surface | Current capability source | Phase 1 change |
|---------|---------------------------|----------------|
| `TrainerLibraryPage` | catalog search entries | **Badges** from `entry.capabilities` (save / live / injection lanes) |
| `CatalogTrainerControlsPage` | definition → TrainerControls | **Advisory lane note** from `capabilities` |
| `TrainerControlPanel` / Stardew build | game-profiles | Unchanged |
| MultiGame / Overlay / Deck | cheat-system GameConfig | Unchanged |
| Discovery Lab / L0 | scan_unknown features | Reflects as `liveMemory: scan-required` when definition present |

---

## 4. IPC handlers that return controls / capabilities

| Channel | File | Phase 1 |
|---------|------|---------|
| `trainer-catalog-search` | `electron/trainer-catalog-ipc.ts` | Attach `capabilities` per entry (read-only derivation) |
| `trainer-catalog-load-game` | same | Already returned counts; now full lane object |
| `trainer-catalog-get-trainer-controls` | same | Attach lanes alongside controls |
| `trainer-deck-*` | `electron/trainer-deck-ipc.ts` | Controls from definition when present; **no capability badge work required** |
| `live-memory-list-controls` / write / scan | `electron/live-memory-ipc.ts` | **Untouched** (Phase 2) |
| TrainerHost write path | host IPC | **Untouched** (Phase 2) |

---

## 5. Phase 1 stop / Phase 2 gate

- Phase 1 badges are **advisory** — UI must not claim execute rights that IPC does not enforce yet.
- Phase 2 requires separate approval: dual-read preference for definition over `live-control-catalog` / `ALL_GAMES` / profiles on list+execute paths.
- Injection badges must never enable `inProcessScriptExecutionEnabled`.
