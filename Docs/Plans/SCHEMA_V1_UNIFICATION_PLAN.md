# Schema.v1 Unification Plan — Control Catalog Consolidation

**Status:** Phase 5 **complete** on `cursor/schema-v1-phase0-1-capabilities` (hard CI import bans + orphan drift)  

```
DONE: Phase 0–4
DONE: Phase 5 — verify-schema-v1-boundaries + orphan-check enforce execute-domain import bans; deleted catalogs stay deleted
UNIFICATION_TRACK=COMPLETE (pending commit/push of Phase 4+5)
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

Implemented in `catalogDefinitionCapabilities()` (`load-catalog-definition.ts`):

```ts
capabilities: {
  saveEdit: 'none' | 'metadata' | 'executable',
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
| **0** | Inventory ID maps + consumers (docs only) | **Done** — `SCHEMA_V1_PHASE0_CONSUMER_INVENTORY.md` |
| **1** | Additive capability derivation / badges | **Done** — `c29a9f7` |
| **2** | Dual-read: definition preferred, legacy fallback | **Done** — `cc3884c` |
| **3** | Authoring cutover; seed definition-first | **Done** — `c778528` |
| **4** | Remove authority from legacy catalogs | **Done** on branch |
| **5** | Hard IPC enforcement + CI orphan on legacy SoT imports | **Done** — `verify:schema-v1-boundaries` + updated `orphan-check` |

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

## 9. Phase 0→1 blueprint review checklist (IPC + data constraints)

Review these before approving implementation. Phase 1 is **additive only** (derive capability badges; no SoT deletion).

### Must not introduce (IPC)

| Risk | Mitigation in Phase 0→1 |
|------|-------------------------|
| New execute / write channels | **Forbidden** in Phase 1 — derive/read only |
| Widening `liveMemory*` or `trainerCatalog*` invoke surface with new execute verbs | Prefer extending existing **load/capability** responses |
| Returning executable controls for metadata-only seed games | Capabilities must default `none` / `scan-required`, never claim execute |
| Injection enablement via catalog IPC | Injection lane stays `forbidden` / `pilot-gated`; no new inject channels |
| Dual authority (UI trusts badges, IPC still executes via ALL_GAMES) | Phase 1 badges are advisory; Phase 2+ enforcement only after inventory |

### Must not drop (data constraints)

| Constraint | Preserve |
|------------|----------|
| Stardew Milestone J field paths (4 save controls) | Identical paths after any Stardew definition preference |
| `safetyStatus: requires_approval` on save writes | Unchanged |
| Online guard + offline confirm for live writes | Unchanged |
| Catalog seed 1000+ searchable metadata rows | Index remains; no mass delete |
| Certification levels / quarantine / promotion records | Preserve store tables and payload hashes |
| `inProcessScriptExecutionEnabled` default OFF + `CrimsonDesert.exe` only | Charter untouched |

### Phase 0 deliverable (docs only)

Consumer inventory: every import of `ALL_GAMES`, `live-control-catalog`, `loadGameProfile`, and every IPC handler that returns controls/capabilities — with ID map (`gameId` ↔ `catalogGameId` ↔ executable).

### Phase 1 deliverable (code, after sign-off)

Additive `catalogDefinitionCapabilities` (or sibling) + optional Library badges; behavior of write/execute paths unchanged; tests for Stardew (save), one memory title (scan-required), one metadata-only seed game.

---

## 10. Stop gate

```
PHASE_0_THROUGH_5=DONE on branch cursor/schema-v1-phase0-1-capabilities
CI: npm run verify:schema-v1-boundaries && npm run orphan-check && npm test
NOTE: ALL_GAMES retained for MultiGame/Overlay presentation + seed materialization only
```
