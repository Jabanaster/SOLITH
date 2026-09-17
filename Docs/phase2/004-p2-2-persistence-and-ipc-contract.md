# Phase 2 P2-2 — Persistence and IPC Contract

## Persistence (ROADMAP §8/§9)

Table: `pointer_maps`, added to the existing single schema module ([`src/core/database/index.ts`](../../src/core/database/index.ts)) rather than a new storage subsystem.

```sql
CREATE TABLE IF NOT EXISTS pointer_maps (
  mapId TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  schemaVersion INTEGER NOT NULL,
  gameId TEXT,
  executableIdentity TEXT,
  architecture TEXT,
  data TEXT NOT NULL,       -- full serialized PointerMap (nodes, offset chains, provenance) as JSON
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
)
```

[`src/core/live-memory/pointer-map-store.ts`](../../src/core/live-memory/pointer-map-store.ts):

| Function | Behavior |
|---|---|
| `savePointerMap(map, identity?)` | Upsert. Rejects (`{ ok: false, error: 'oversized' }`) rather than truncates when serialized size exceeds `MAX_SERIALIZED_MAP_BYTES` (2 MiB). |
| `loadPointerMap(mapId)` | Returns `not_found` / `unsupported_schema_version` / `corrupt` / success. On success, every node comes back forced to `unresolved` with `lastResolvedAddress: null` — a reloaded map is **never** trusted as live truth (mission §8's "INACTIVE / NEEDS_RESOLUTION until explicitly attached"). |
| `listSavedPointerMaps()` | Metadata only (id/name/nodeCount/gameId/timestamps) — does not deserialize every map's full node array just to list them. |
| `deleteSavedPointerMap(mapId)` | Row delete. |

**What is never persisted:** an OS handle, a live PID, or a resolved address treated as reusable authority. `PointerMap`/`PointerMapNode` are driver-independent by construction (Phase 1's `LivePointerPath` was already just `{ moduleName, moduleOffset, offsets }`) — nothing needs redacting on the way to disk; what needs enforcing is on the way *back out* (`loadPointerMap`'s forced-inactive behavior above).

**Corruption/version safety:** `isWellFormedPointerMap` structurally validates every field (`id`/`name` strings, `path.moduleOffset` a number, `path.offsets` all numbers) before trusting `JSON.parse`'s result — a malformed chain (e.g. a non-numeric offset) is rejected as `corrupt`, not silently coerced. `schemaVersion` is checked before parsing at all; a row from a future/older schema version is rejected outright rather than guessed at.

## IPC contract (mission §10/§11)

13 new `ipcMain.handle` endpoints in [`electron/live-memory-ipc.ts`](../../electron/live-memory-ipc.ts), each following the exact sequence every existing live-memory handler in this file uses: `requireTrustedSender` → `requireSession` → schema `.parse()` → `isFeatureEnabled()` → the actual operation, wrapped in try/catch with `sanitize()`.

| Channel | Maps to |
|---|---|
| `pointer-map-create` | `session.pointerMapCreate(name)` |
| `pointer-map-list` | `session.pointerMapList()` |
| `pointer-map-get` | `session.pointerMapGet(mapId)` |
| `pointer-map-rename` | `session.pointerMapRename(mapId, name)` |
| `pointer-map-delete` | `session.pointerMapDelete(mapId)` (live registry only) |
| `pointer-map-scan-target` | `session.pointerMapScanTarget(mapId, target, bounds)` — single-target convenience |
| `pointer-map-scan-targets` | `session.pointerMapScanTargets(mapId, targets[], bounds)` — the actual multi-target orchestration |
| `pointer-map-resolve` | `session.pointerMapResolve(mapId)` |
| `pointer-map-refresh` | `session.pointerMapRefresh(mapId)` (same operation, name mission §2 asks for) |
| `pointer-map-add-node` | `session.pointerMapAddNode(mapId, label, candidate, provenance?)` |
| `pointer-map-remove-node` | `session.pointerMapRemoveNode(mapId, nodeId)` |
| `pointer-map-save` | `session.pointerMapSave(mapId, identity?)` |
| `pointer-map-load` | `session.pointerMapLoad(mapId)` |
| `pointer-map-list-saved` | `listSavedPointerMaps()` (store-level, independent of any session's live registry) |
| `pointer-map-delete-saved` | `deleteSavedPointerMap` + clears the live registry entry |

Zod schemas in [`electron/ipc-validation.ts`](../../electron/ipc-validation.ts) (`PointerMapCreateSchema`, `PointerMapScanTargetsSchema`, etc.) bound every field: target/address strings must match `/^0x[0-9a-fA-F]+$/`, `targets` arrays are capped at 8 entries at the schema layer (matching `MAX_TARGETS_PER_SCAN`), names/labels are length-capped. No handler accepts a filesystem path or process id beyond the session's own already-authorized attach.

**No arbitrary process authority:** every handler operates through `requireSession(event)`, which resolves to the one `LiveMemorySession` already attached for that sender — there is no path from these endpoints to a different, unauthorized process.

## Preload / renderer contract (mission §11)

[`electron/preload.ts`](../../electron/preload.ts) exposes one method per channel above, matching the existing `liveMemoryPointerScan` convention exactly. [`src/types/global.d.ts`](../../src/types/global.d.ts) declares `PointerMapDto`/`PointerMapNodeDto`/`PointerMapScanResultDto`/`PointerMapCompletenessDto` — every address and every `atByte`/`skipped[].baseAddress`/`size` field is a string, never a bare `Number`, since a real 64-bit process's addresses can exceed `Number.MAX_SAFE_INTEGER`. This mirrors `serializeCompleteness`/`serializeSkippedRegions`, the exact helpers Phase 1 already established for this same reason on the byte-scan surface.

## Cancellation and resource limits (mission §12/§13)

`scanTargetsIntoMap` (`pointer-map-orchestration.ts`) checks `bounds.signal.aborted` **between** targets: a target reached after cancellation is recorded `termination: 'cancelled'` / `completeness: { state: 'cancelled' }` / `candidateCount: 0` / `nodesAdded: 0` — distinguishable in the response from a target that was actually scanned and legitimately found nothing. Mid-target cancellation is handled one level down by `scanForPointerPath` itself (Phase 1), which already reports `cancelled` truthfully.

Limits, all in `pointer-map-orchestration.ts`, all observable in the response rather than silent:

- `MAX_TARGETS_PER_SCAN = 8` — targets beyond this are never scanned; `targetsRequested` vs `targetsScanned` in the response makes the gap visible, and `resourceLimited: true` is set.
- `MAX_NODES_PER_TARGET = 10` — a target whose scan legitimately finds more real candidates than this still only contributes 10 nodes; `perTarget[i].candidateCount` (the true count) vs `perTarget[i].nodesAdded` (what was actually kept) exposes the gap.
- `MAX_NODES_PER_MAP = 200` — enforced across the whole map, cumulative over every scan that has ever populated it, not just the current call.
