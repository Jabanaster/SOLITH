# Phase 2 P2-2 — Architecture Note

Per mission §3, written before implementation began. Records the existing pointer production path as audited, and where P2-2's new pieces attach to it.

## Existing production path (before P2-2), traced

```
renderer (LiveMemoryTrainerPage.tsx)
  -> preload.ts: liveMemoryPointerScan(payload)
    -> IPC: 'live-memory-pointer-scan' (electron/live-memory-ipc.ts)
      -> requireTrustedSender -> requireSession -> LiveMemoryPointerScanSchema.parse -> isFeatureEnabled
      -> session.pointerScan(address, bounds)   [live-memory-session.ts]
        -> scanForPointerPath(driver, handle, address, bounds)   [pointer-scanner.ts]
      <- PointerScanResult (candidates, termination, completeness, isAuthoritativeAbsence, ...)
    <- serialized result (moduleOffset as "0x..." hex string, everything else BigInt-free already)
  <- renderer renders a flat candidate list, one-shot, not persisted
```

Audit findings (mission §3):

- **Current IPC handlers:** `live-memory-pointer-scan` (single target, single call) and `research:pointer-analyze` (research-panel variant of the same scan, different serialization). Neither persists anything or accepts more than one target.
- **Target/session ownership:** `LiveMemorySession` owns `this.driver`/`this.handle` per attach; every read-only operation (`pointerScan`, `resolveControl`, `scanAobSignature`, ...) is a method on this same session object. This is the existing "production backend/service seam" — P2-2 adds pointer-map methods here rather than inventing a second stateful owner.
- **Cancellation:** `PointerScanBounds.signal` (`{ aborted: boolean }`), checked between frontier items and between regions inside `scanForPointerPath` (Phase 1). Reused as-is for P2-2's per-target scans; P2-2 adds its own between-*target* check on top.
- **Result/resource limits:** `scanForPointerPath` already has `maxResults`, `maxCandidatesPerLevel`, `maxTotalScans`, `maxRegionBytes`, `maxBytesPerScan`. None of these bound *how many targets* a caller can request in one call, or how many *nodes a map may accumulate over multiple calls* — that is new in P2-2 (`MAX_TARGETS_PER_SCAN`, `MAX_NODES_PER_TARGET`, `MAX_NODES_PER_MAP`).
- **Completeness:** `PointerScanResult.completeness` already uses the shared `CanonicalCompleteness` vocabulary (`complete`, `complete_with_skipped_regions`, `cancelled`, `process_exited`, `resource_limit`, `failed`) — the same one `scanner-backend.ts` uses for byte scans. P2-2 reuses this directly for both per-target and aggregate reporting rather than inventing a parallel enum (mission §6 explicitly asks not to).
- **Process-exit handling:** `scanForPointerPath` catches a dead process at the module-enumeration boundary (`getModules` throws — the Phase 1 finding that a dead-but-open handle fails enumeration rather than returning nothing) and reports `process_exited`. `resolvePointerPath` did **not** have this distinction before P2-1/P2-2; P2-1 added it to `resolvePointerMap` via the same `isProcessGoneError` helper.
- **Serialization / BigInt:** every address that crosses the IPC boundary is already a `"0x..."` hex string in the existing handler (`moduleOffset: \`0x${c.moduleOffset.toString(16)}\``), never a bare `Number`. P2-2's schemas and serializers follow the identical convention.
- **Bypass check:** no caller reaches `scanForPointerPath`/`resolvePointerPath` except through `LiveMemorySession` — Phase 1 (doc 126) already closed the last direct-legacy-bypass on this surface. P2-2 does not introduce a new one: `pointer-map-orchestration.ts` and `pointer-map.ts` are pure functions taking an explicit `driver`/`handle`, and the only stateful caller is `LiveMemorySession` itself.

## What P2-2 adds, and where

```
pointer-map.ts                 (P2-1, pure)      — immutable map/node model, single-node resolve
pointer-map-orchestration.ts   (P2-2, pure)      — scanTargetsIntoMap: multi-target scan into one map,
                                                    per-target + aggregate CanonicalCompleteness,
                                                    resource limits, between-target cancellation
pointer-map-store.ts           (P2-2, pure-ish)  — SQLite persistence (versioned, corruption-checked),
                                                    "reload = inactive until re-resolved"
live-memory-session.ts         (P2-2, stateful)  — the production service seam: pointerMapCreate/List/
                                                    Get/Rename/Delete/ScanTarget(s)/Resolve/Refresh/
                                                    AddNode/RemoveNode/Save/Load/ListSaved/DeleteSaved,
                                                    backed by a per-session `Map<mapId, PointerMap>`
                                                    (mirrors freeze-concurrency-registry.ts's module-level
                                                    registry pattern, scoped to the session instance
                                                    instead of the whole process since a map holds no
                                                    OS handle and needs no cross-session visibility)
live-memory-ipc.ts              (P2-2)           — 13 new ipcMain.handle endpoints, same
                                                    trusted-sender/session/schema/feature-flag sequence
                                                    as every existing handler in this file
preload.ts / global.d.ts        (P2-2)           — typed renderer surface, hex-string addresses only
database/index.ts               (P2-2)           — one new table, `pointer_maps`, added to the existing
                                                    single-file schema module (matches how every other
                                                    feature table in this codebase is registered)
```

No new storage subsystem was invented — persistence goes through the existing `db.prepare()`/sql.js layer (`../database/index.js`), the same one `artwork-cache/store.ts` uses, per mission §8's instruction to follow existing conventions rather than build a parallel one.
