# Phase 2 P2-8 — Memory Map + Watchlists: Certification

Worktree `G:\ACTIVE_PROJECTS\solith-phase2-p2-6-through-p2-9`, branch `feature/solith-phase2-p2-6-through-p2-9`. Per the real ROADMAP checkpoint matrix (`Docs/phase2/031`), P2-8 = "Memory map + watchlists" — not SOLITH.MD's own guessed "transactional memory interaction" (that content lives entirely in P2-9, per ROADMAP line 315: "Freeze/write/revert + address-validation/hotkey verification").

## Memory map

- Extended `MemoryModule`/`MemoryRegion` (`types.ts`) additively with real fields already available from memoryjs but not previously surfaced: `path` (module, real on-disk `szExePath`), `readable`/`executable`/`guarded`/`rawProtect`/`regionType` (region, decoded from the real Win32 `Protect`/`Type` VirtualQuery fields — `native-memory-driver.ts`). All fields optional, so every existing construction/consumption site (pointer-scanner, structure-discovery, research/) is untouched.
- Reused, not rebuilt: `research/memory-viewer.ts`'s existing `MemoryViewer.listRegions` (Phase 9) already did bounded committed-region enumeration; extended its `MemoryRegionSummary` with the new fields plus real module-association (never guessed — only when a region's base genuinely falls inside a known module's span) and added the missing `listModules`. This is the gap P2-8 actually closed: the engine existed, IPC/session wiring to expose it did not.
- `LiveMemorySession.listMemoryRegions/listMemoryModules`, `memory-map:list-regions`/`memory-map:list-modules` IPC (bounded to 256 each, schemas in `ipc-validation.ts`), preload, `MemoryMapPanel.tsx` (mounted in `LiveMemoryTrainerPage.tsx`).
- Scope decision: the existing `getRegions()` filter (committed + non-guarded only) is unchanged — reserved/free regions are not surfaced, matching every other production feature that already depends on that filter's guarantee (pointer classification, structure discovery, typed view). "State" is therefore always `committed` by construction; protection/type/module-association are real and vary.

## Watchlists

- `watchlist-model.ts` — `WatchItem`/`WatchAddressSource` (discriminated union: `absolute` / `module_relative` / `pointer_map_node` / `structure_field` — provenance preserved, never collapsed to a bare address, spec §15), `WatchResolveState` (`live`/`rebound`/`stale`/`unresolved`/`process_exited`), `WatchChangeState` (`never_read`/`unchanged`/`changed`/`became_readable`/`became_unreadable`). Reuses P2-6's `TypedMemoryView` for the typed current/previous value — no new decode path.
- `LiveMemorySession.watchAdd/watchList/watchGet/watchRemove/watchSetLabel/watchRefresh/watchRefreshAll` — `watchAdd` performs the first read immediately (never left in a fabricated "unread but live" state); `watchRefresh` re-resolves the address every time (module rebase-aware — a `module_relative` watch whose resolved address changes between refreshes is reported `rebound`, not silently `live`) and re-reads, deriving a truthful `changeState` from the actual byte comparison. Labels are exclusively user-supplied (`label?: string | null` on add/set), never auto-assigned.
- `MAX_WATCH_ITEMS_PER_SESSION` (200, oldest-evicted), matching the `MAX_DISCOVERED_STRUCTURES_PER_SESSION` precedent (spec §36).
- `watchlist:add/list/get/remove/refresh/refresh-all/set-label` IPC, preload, `WatchlistPanel.tsx`.
- Refresh cadence (`refreshIntervalMs`, bounded 200ms–60s) is a stored preference the caller/UI schedules its own polling around — no main-process timer loop was added, avoiding another interval-leak surface; this mirrors how the rest of this app's "live" panels already poll from the renderer.

## Focused tests

| Suite | Result |
|---|---|
| `live-memory-session-memory-map.test.ts` | 4/4 |
| `live-memory-session-watchlist.test.ts` | 7/7 (attach-required, absolute/module-relative/structure-field resolution, unresolved sources, list/get/remove/label round-trip, refreshAll, resource-limit eviction, unreadable-address truthfulness) |

## Real fixture (`memory-map-watchlist-real-process.test.ts`)

Real spawned `solith-scanner-fixture.exe`, real IPC boundary (nothing below it mocked):

- Memory map: the real `STRUCT_REGION` VirtualAlloc appears as its own committed region at its exact real base, correctly `writable:true`, with a real (not fabricated) `rawProtect` value; the real fixture module appears with its real on-disk path.
- Watchlist: an absolute watch on `STRUCT_MUTABLE_I32` observes the real fixture default (`42`), then a real `writestruct` mutation is detected on refresh (`changeState: 'changed'`, exact new value `777`). A module-relative watch at the fixture module's own offset `0x0` resolves to the exact real module base and observes the real PE DOS-header magic `"MZ"`. A structure-field watch resolves through a real `structure:discover` call. List/label/refresh-all/remove all round-trip against the real session. Failure injection: an unmapped absolute address is a truthful `readState:'failed'`, never a fabricated value; an unknown module name is a truthful `resolveState:'unresolved'`.

**Independent full-file certification: 3/3, all clean.**

## Real-game proof

Godlike Burger, PID 25920, production attach path, read-only:

- `listMemoryRegions`: 20/1246 real committed regions (bounded, truncated=true, honestly reported), with real protection/type detail for each.
- `listMemoryModules`: 20/92 real loaded modules; the main module's real on-disk path recorded.
- A module-relative watch (`Godlike Burger.exe` + offset `0x0`) resolved to the real module base and observed the real PE DOS-header magic `"MZ"` (`0x5A4D` = `23117` decimal) — exact match against independently-known ground truth. Refresh re-observed the same immutable bytes, correctly `changeState:'unchanged'`.

## Regression

Renderer and electron typechecks PASS after every wiring step. Full `test:live-memory` re-run deferred to the combined P2-6–P2-9 final regression pass (see the closing certification doc).
