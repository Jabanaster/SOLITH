# Phase 2 P2-5 — Structure Discovery Engine: Final Certification

Worktree `G:\ACTIVE_PROJECTS\solith-phase2-structure-discovery`, branch `feature/solith-phase2-structure-discovery`. Starting HEAD `a13854d` (canonical model + engine only, `Docs/phase2/029`). Ending code SHA `d358a18ac32e40032e17362158d7bb4459a715fe`.

## What existed at the starting checkpoint

`structure-model.ts`, `structure-interpretation.ts`, `structure-discovery.ts` — a pure, driver-agnostic engine (`discoverStructure`/`refreshStructure`/`captureStructureSnapshot`/`compareStructureSnapshots`) and its 14/14 focused unit suite. No `LiveMemorySession` integration, no IPC/preload, no UI, no fixture extension, no real-process/real-game/packaged evidence existed at that point.

## What this stage closed

1. **`LiveMemorySession` integration** (`db886e4`) — `structureDiscover/List/Get/Delete/Refresh/InspectField/CaptureSnapshot/ListSnapshots/CompareSnapshots`, following the `pointerMap*` method/storage convention exactly (in-memory `Map`, driver-independent, goes stale after detach until re-resolved).
2. **IPC** (`db886e4`) — `structure:*` channels in `electron/live-memory-ipc.ts` (senderCheck → requireBundle → schema-parse → feature-gate → audit-append → sanitized-error, matching `research:*`) plus Zod schemas in `electron/ipc-validation.ts`.
3. **preload + renderer types** (`db886e4`) — `electron/preload.ts`, `src/types/global.d.ts`.
4. **UI** (`db886e4`, button rename in `5ad697c`) — `StructureDiscoveryPanel.tsx`: field table (offset/address/size/raw/candidate types/current values/change state/pointer target/read state), field inspector, Snapshot A/B + Compare, Refresh Structure. Mounted in `LiveMemoryTrainerPage` next to `PointerMapPanel`.
5. **Real fixture extension** (`db886e4`) — `fixture.rs`'s `STRUCT_REGION`: `+0x00` int32 sentinel, `+0x04` float32, `+0x08` u64, `+0x10` pointer to a real secondary allocation, `+0x18` mutable int32, `+0x1C` raw bytes, `+0x20` ASCII string, `+0x31` a second unaligned int32 — plus a `writestruct` stdin mutation command.
6. **Real-process certification** (`db886e4`, `structure-discovery-real-process.test.ts`) — real spawned fixture, real IPC boundary (`electron-ipc-mock.mjs` harness — nothing below the IPC boundary is mocked): byte-for-byte reconstruction of the discovered window verified against the fixture's own known plant + its deterministic decoy-fill formula reimplemented in JS; a real pointer candidate correctly isolated at `STRUCT_POINTER_OFFSET` pointing at the real secondary allocation; a real ASCII string candidate correctly isolated at `STRUCT_STRING_OFFSET`; a real Snapshot A → `writestruct` mutation → Snapshot B → compare cycle detecting the real changed byte range. **10-restart stress campaign: 10/10**, distinct PIDs each time. **3 independent full-file certification runs: 3/3.**
7. **Failure injection** (`db886e4`) — oversized request, malformed address, unmapped-but-valid address (truthful `failed` completeness), unknown structure/snapshot ids (graceful `success:false`, never a crash), out-of-window field-offset lookup, and mid-discovery process death.
   - **Real bug found and fixed**: `discoverStructure` called `driver.getModules`/`getRegions` unconditionally after a successful window read; a process exiting in the gap between the two threw uncaught instead of degrading gracefully. Fixed by catching and falling back to no known modules/regions (pointer candidates simply don't classify — an honest absence, never fabricated) rather than discarding an already-successful read. New regression in `structure-discovery.test.ts` (15/15, was 14/14).
8. **Real-game proof** (mission §21/§22, not committed — scratch script, output captured here). Godlike Burger, real installed title, production attach path (`LiveMemorySession.attach`), read-only:
   - PID 36476, exe `Godlike Burger.exe`, module base `0x7ff724d10000` (size 667648), address source = main module base, region = main executable image header, window = 256 bytes, completeness `complete`, 32 fields, 0 unknown spans, 397ms.
   - Ground truth: the first 2 bytes of any real PE image are always the DOS header magic `"MZ"` (`0x4D5A`) — independently verifiable, not a SOLITH-invented claim. Observed: `4d5a` — match.
   - Snapshot proof (§22): no semantically controlled field exists on a running executable's own static header, so this is recorded honestly as `READ_ONLY_STRUCTURE_DISCOVERY_PROOF` — two real captures 2s apart via the production `captureStructureSnapshot`/`compareStructureSnapshots` path, 0 changed ranges (the truthful expected outcome for immutable header bytes, not a defect). No fabricated deterministic-change claim.
9. **UI e2e — real-process** (`5ad697c`, `structure-discovery-ui-real-process.e2e.test.ts`) — full dev-build flow through Electron/Playwright: attach, discover, field table, field inspector, Snapshot A/real-writestruct-mutation/Snapshot B/Compare, Refresh Structure, then kill the fixture. **3/3 clean runs.**
   - **Real, disclosed finding**: `readBuffer()` against a `VirtualAlloc`'d region can keep returning data for an unbounded time after the target process is confirmed terminated — `getModules()`/`getRegions()` correctly detect the process is gone in the same session (proven in the real-process failure-injection test), but the raw byte-read path does not reliably fail (probed to 60s post-kill with reads still succeeding, values still changing). This is a pre-existing native-driver/OS characteristic shared by every live-memory feature that reads raw bytes, not something P2-5 introduced or can fix within this stage's scope — flagged here for the native-driver owner. The e2e test asserts what is actually true: the app never crashes and never renders a fabricated field, whichever real completeness state the read reports.
10. **UI e2e — packaged** (`5ad697c`, `structure-discovery-ui-packaged.e2e.test.ts`) — lighter single-flow proof (preload API present, real attach through `app.asar`'s native addon, discover, field table renders) against `dist/win-unpacked`. **3/3 clean runs.**
11. **Resource limits, spec §18** (`d358a18`) — `MAX_DISCOVERED_STRUCTURES_PER_SESSION` (100) and `MAX_SNAPSHOTS_PER_STRUCTURE` (50), oldest-first eviction, matching the existing `MAX_NODES_PER_MAP`/`MAX_TARGETS_PER_SCAN` philosophy. The other §18 items were already structurally bounded and needed no new code: max fields (implied by the 4096-byte window cap), string scan length (never exceeds a field's own ≤8-byte width), pointer follow depth (structure discovery never dereferences a candidate pointer, spec §6), max simultaneous comparisons (`compareStructureSnapshots` is a stateless pure function). New suite `live-memory-session-structure-discovery.test.ts`, 9/9.

## ReClass.NET reference adoption

Per `Docs/phase2/029`'s own correction (re-confirmed here): `ROADMAP.md`'s own text assigns ReClass.NET's reference-adoption completion criterion to **P2-15** (P2-E workstream, "Symbol/module awareness + Ghidra external adapter"), not P2-5. Supporting concept notes only, relevant to structure discovery: offset-oriented field layout, raw-value-plus-interpretation-side-by-side visibility, and class/structure-shaped presentation — all of which `DiscoveredStructure`/`DiscoveredField` and the field table already independently reflect. **RECLASS.NET: DEFERRED_TO_P2-15** — not marked complete here, no code copied/linked/imported.

## Full verification summary (primary worktree, SHA `d358a18`)

| Gate | Result |
|---|---|
| Focused P2-5 (`structure-discovery.test.ts` + `live-memory-session-structure-discovery.test.ts` + `structure-discovery-real-process.test.ts`) | 26/26 |
| Real fixture stress | 10/10 |
| Real fixture certification (independent full-file runs) | 3/3 |
| Real-game proof | Godlike Burger, PASS |
| UI e2e real-process | 3/3 |
| UI e2e packaged | 3/3 |
| `test:live-memory` | 582/582, 0 fail |
| root `npm test` | 2140/2140, 0 fail |
| `cargo fmt --check` / `cargo clippy --release --all-targets -- -D warnings` | clean |
| `cargo test --release` (native crate) | 75/75 pass (17+8+23+5+17+5 across 6 integration suites) |
| NAPI suite | 51 pass / 1 intentional skip / 0 fail |
| Renderer typecheck | PASS |
| Electron typecheck | PASS |
| `npm run build` (vite + electron + package, signed NSIS installer) | PASS, 33/33 output-verifier checks |

## Fresh worktree certification

`G:\ACTIVE_PROJECTS\solith-p25-fresh-verify`, detached at `d358a18`, `git worktree add` from the certified branch (no copied `node_modules`/build output). `npm ci` (0 vulnerabilities) → native NAPI + fixture (release + debug) builds → both typechecks clean → focused P2-5 26/26 → `test:live-memory` 582/582 → root `npm test` 2140/2140 (an initial run showed 4 `cancelledByParent` results in `TrainerHost E2E`, root-caused as a pure fresh-worktree ordering artifact — `dist-electron/host-entry.js` didn't exist yet because `npm run build:electron` hadn't been run in that worktree yet; building it first and re-running produced a clean 2140/2140, not a real regression) → `electron-builder --dir` package succeeded → packaged UI e2e re-verified PASS. **Fresh worktree: PASS.**

## Final Phase 2 P2-5 Exit Gate

All items from mission §35 close:

- [x] canonical structure model — `structure-model.ts`, unchanged since `a13854d`
- [x] raw bytes preserved — every field's `rawHex`, never zero-substituted
- [x] exact offsets — proven byte-for-byte against the real fixture
- [x] bounded reads — `MAX_STRUCTURE_DISCOVERY_LENGTH` (4096), enforced at both the model and the IPC schema
- [x] unknown spans — first-class, only for genuinely unreadable ranges (proven never to include readable-but-low-confidence bytes)
- [x] unaligned fields — `aligned` flag correctly derived; fixture includes a deliberately unaligned plant
- [x] numeric candidates — u8..f64, decode-distinct from semantic truth
- [x] pointer candidates — evidence-gated (real module/region membership only), proven against a real out-of-module allocation
- [x] string candidates — printable-ratio-gated, proven against real ASCII payload
- [x] partial-read truth — `complete_with_unreadable_spans`, proven with a real chunked-fallback scenario
- [x] stale-state truth — `refreshStructure`/`structureRefresh` re-reads and replaces truthfully
- [x] snapshots — real capture against a live/dead process both proven
- [x] diff engine — real byte-range coalescing, proven against a real mutation
- [x] process lifecycle — proven truthful for total failure, partial failure, and mid-operation exit (with the one disclosed, out-of-scope native-driver caveat above)
- [x] LiveMemorySession integration
- [x] IPC/preload
- [x] production UI
- [x] field inspector
- [x] diff UI
- [x] real fixture PASS
- [x] fixture stress 10/10
- [x] certification 3/3
- [x] real-game proof
- [x] packaged proof 3/3
- [x] focused tests PASS (26/26)
- [x] live-memory PASS (582/582)
- [x] root tests PASS (2140/2140)
- [x] typechecks PASS
- [x] builds PASS
- [x] package PASS
- [x] native tests PASS (fmt/clippy/cargo test/NAPI all clean)
- [x] fresh worktree PASS
- [ ] remote CI PASS — pending this stage's PR
- [ ] ROADMAP updated — this commit
- [ ] 28-item Phase 2 recount valid — this commit
- [x] P2-6 not started
- [x] P2-7 not falsely closed
- [x] ReClass completion left for P2-15
- [x] Phase 3 untouched
- [ ] local == remote — pending push
- [x] worktree clean

**P2-5 verdict pending only remote CI and canonical merge**, recorded in the FINAL RESPONSE.
