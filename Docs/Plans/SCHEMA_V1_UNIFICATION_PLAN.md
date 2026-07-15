# Schema.v1 Unification Plan — Control Catalog Consolidation

**Status:** Draft for review (analysis only — no consolidation code)  
**Scope:** Consolidate competing control catalogs so `schema.v1` is the single authoritative capability contract  
**Mode:** Phased migration — no big-bang cutover  

```
STOP: await user approval before writing consolidation code
```

---

## 1. Problem

ResourceForge currently has **five parallel “what can this game do?” sources**. UI and IPC already partially route through `schema.v1`, but several surfaces still treat other catalogs as authoritative. That produces duplicate cheat lists, divergent verification flags, and unclear Save Edit vs Live Memory vs Injection boundaries.

---

## 2. Current systems (paths + role)

| System | Paths | Current role |
|--------|--------|----------------|
| **1. Cheat system (`ALL_GAMES`)** | `src/core/cheat-system/games.ts`, `types.ts`, `game-registry.ts`, `index.ts` | Hand-authored multi-game cheat registry (7 titles). Presentation + session UX for MultiGame / Overlay / Deck. Seeded into definitions via `bundled-definition-seed.ts`. |
| **2. Trainer catalog** | `src/core/trainer-catalog/` (`store.ts`, `seed.ts`, `types.ts`, `bundled-definition-seed.ts`, `mod-pack-loader.ts`, sync/) | SQLite index of 1000+ games + mod-pack / definition payloads. Discovery, search, remote sync (definitions only), quarantine/promotion. Persistence for compiled `schema.v1` JSON. |
| **3. Definitions (`schema.v1`)** | `src/core/definitions/schema.v1.ts`, `compile-yaml.v1.ts`, `export-*.ts`, `mod-pack-adapter.ts`, `definition-to-trainer-controls.ts`, `load-catalog-definition.ts` | Unified contract: `memoryFeatures` + `saveEditor`. Compile/validate YAML→JSON; adapt ModPack↔definition; map save fields → TrainerHost `save_field` controls. **Intended** SoT, not yet sole SoT. |
| **4. Live control catalog** | `src/core/live-memory/live-control-catalog.ts` | Tiny hardcoded verified pointer catalog (Atomfall ammo). Parallel to definitions; used by `liveMemoryListControls` / `liveMemoryResolveControl`. |
| **5. Game profiles** | `src/core/game-profiles/` (`profiles/stardew-valley.json`, `catalog.ts`, `types.ts`, `transform.ts`, `loader.ts`) | Milestone H save-edit profiles → TrainerHost controls. Stardew executable save controls live here; partially duplicated in bundled `STARDEW_DEFINITION.saveEditor`. |

**Still dual-sourced today:** UI cheat menus ← `cheat-system`; TrainerControlPanel ← `game-profiles`; Live “list controls” ← `live-control-catalog`; Library search ← trainer-catalog metadata.

---

## 3. Target architecture

**Authoritative:** `SolithDefinitionV1` (`schema.v1`)  
**Stored as:** compiled JSON in trainer-catalog SQLite  
**Authored as:** YAML / promoted imports

### Capability lanes (schema dictates)

| Capability | Meaning | Executable? |
|------------|---------|-------------|
| **Save Edit** | `saveEditor.saveFields` → TrainerHost | Yes when verified + gates |
| **Live Memory** | `memoryFeatures` RPM/WPM | Yes when resolvable + gates; L0 `scan_unknown` = discovery required |
| **Injection** | Code-cave / AA / injector | Declared / pilot-gated only — never mainstream silent enable (`in-process-script` charter) |

Conceptual shape (do not implement until approved):

```ts
capabilities: {
  saveEdit: 'none' | 'metadata' | 'executable';
  liveMemory: 'none' | 'scan-required' | 'executable',
  injection: 'forbidden' | 'reference-only' | 'pilot-gated',
}
```

### Presentation vs authority

| Layer | Role after consolidation |
|-------|---------------------------|
| Authoritative | schema.v1 features, safety, certification, resolution |
| Presentation | Catalog art, genres, searchableText |
| Session UX | Toggles, hotkeys, overlay (not capability authorship) |
| Legacy views | GameConfig / ModPack / TrainerControl **projected from** definition |

---

## 4. Cascade to UI and IPC

> UI never invents executability. IPC never resolves controls from a second catalog when a definition exists.

- Catalog APIs stay as **index**; capabilities always from definition loader  
- Save controls: definition → `solithDefinitionToTrainerControls` only  
- Live list/resolve: migrate off `live-control-catalog` onto definition `memoryFeatures`  
- MultiGame / Overlay: view-model from definition (+ presentation overlays)  
- TrainerControlPanel: Stardew via definition `saveEditor` (same field paths as Milestone J)

---

## 5. Phased migration

| Phase | Work | Gate |
|-------|------|------|
| **0** | Inventory ID maps + consumers (docs only) | Plan approval |
| **1** | Additive capability derivation / badges | Tests green; behavior unchanged |
| **2** | Dual-read: definition preferred, legacy fallback | Fallback metrics + tests |
| **3** | Authoring cutover; seed definition-first | New cheats only via schema.v1 |
| **4** | Remove authority from legacy catalogs | Explicit delete approval |
| **5** | Hard IPC enforcement + CI orphan on legacy SoT imports | Release gate |

Each phase ends with **user approval** before the next.

---

## 6. Suggested ownership after consolidation

| Concern | Owner |
|---------|-------|
| Schema + capability enums | `src/core/definitions/schema.v1.ts` |
| Load API | `src/core/definitions/load-catalog-definition.ts` |
| Index + persistence | `src/core/trainer-catalog/store.ts` |
| Live execute (not authorship) | `src/core/live-memory/*` |
| Save execute | `src/core/trainer-host/*` |
| Injection pilot | `src/core/in-process-script/*` + charter |
| Presentation UX | reduced `cheat-system/*` |

---

## 7. Risks / non-goals

**Risks:** ID slug mismatch; Stardew dual-path drift; accidental Injection enablement; seed metadata claiming executable.

**Non-goals:** Big-bang deletes; anti-cheat bypass; expanding unverified god-mode; merge/tag/release as part of this plan; generalizing Injection beyond Crimson Desert charter.

---

## 8. Success criteria

1. For any definition-backed `catalogGameId`, Save / Live / Injection executability comes only from schema.v1 (+ safety).  
2. IPC/UI capability decisions do not consult `live-control-catalog` or `ALL_GAMES`.  
3. Stardew’s four accepted save controls appear once with identical field paths.  
4. Metadata-only seed entries never claim false executability.  
5. Injection stays non-executable on the mainstream path.

---

## 9. Stop gate

```
STOP: await user approval before writing consolidation code
```

Approve Phase 0→1 (or a named subset) explicitly before any implementation PR.
