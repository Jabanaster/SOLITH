# Phase 2 P2-9 — Freeze/Write/Revert + Address-Validation/Hotkey Verification: Certification

Per ROADMAP.md's own checkpoint matrix (`Docs/phase2/031`), P2-9 owns "Freeze/write/revert + address-validation/hotkey verification" as ONE combined checkpoint — SOLITH.MD's own guessed split (freeze/write/revert as a separate "P2-8", hotkeys as a separate "P2-9") does not match ROADMAP's real assignment.

## Cross-cutting fix carried in from P2-6 (mission §3's own cross-cutting audit)

The native post-exit stale-read/write risk mission §3 asked P2-6 to audit first is already fixed (`Docs/phase2/032`) at the shared driver layer (`native-memory-driver.ts`'s `assertProcessStillAlive`), covering every read/write primitive P2-8/P2-9 also use. **FIXED**, not merely proven-safe.

## Write-safety model (mission §19/§20) — audited, found already mature

`LiveMemorySession.proposeWrite`/`confirmWrite`/`rollback` (`live-memory-session.ts`) already implement the canonical write contract exactly as specified: target/session resolution (`getMemoryAccessOrThrow`/`this.handle`/`this.target`), address provenance (`LiveMemoryAddress`), expected/new/original bytes (`LiveWriteProposal.currentValue`/`requestedValue`, `pendingRawBefore` exact-byte capture), validation (`evaluateWriteConsent`, `verifyAttachedProcessIdentity`, ledger-capacity check), write, read-back verification, and revert (`rollback` re-reads current value, does a numeric compare, then an optional exact-byte compare via `entry.rawAfter`, then restores). This predates this mission and is confirmed correct, not rebuilt.

## Freeze (mission §22) — audited, found already mature

`startFreeze`/`stopFreeze`/`getFreezeStatus` already implement bounded cadence (`MIN_FREEZE_INTERVAL_MS`/`MAX_FREEZE_INTERVAL_MS`), a `MAX_FREEZE_DURATION_MS` auto-stop, per-tick re-verification of consent (`evaluateWriteConsent`) AND process identity (`verifyAttachedProcessIdentity`), and explicit disable (`stopFreeze`). **Disclosed finding, this stage**: freeze's own per-tick identity re-verification (a real native/WMI-ish query) can take a few real seconds to actually detect a killed process under load — proven in `p2-9-write-freeze-revert-real-process.test.ts`'s process-exit test, which polls (not a fixed short wait) up to 15s for `getFreezeStatus().active === false` after a real kill. This is bounded, self-correcting, and matches the mission's own "process-exit stop" requirement (it DOES stop, verified every certification run) — the disclosure is about latency, not correctness: no runaway loop, no write ever lands after the process is confirmed gone (the shared driver-layer liveness fix from P2-6 makes any write attempt fail immediately regardless of how slow the identity check is).

## Non-writable-region disclosed finding (mission §24)

Diagnosed this stage: a page just marked `PAGE_NOACCESS` (via the fixture's real `protect_mutation noaccess`, a genuine `VirtualProtect` call) can still return byte content to `readMemory`/`readBuffer` called from an EXTERNAL process handle — two consecutive reads returned two DIFFERENT real values, so it is not a stale cache, Windows' cross-process `ReadProcessMemory` path does not reliably enforce `PAGE_NOACCESS` the way in-process access does. `writeMemory`/`writeBuffer`, in contrast, DOES correctly fail (`ERROR_NOACCESS`/998) — confirmed directly. **This is exactly why mission §24's "do not assume readable == writable" matters in practice**: `confirmWrite`'s truthful non-writable-region behavior is proven by attempting the real write itself (`p2-9-write-freeze-revert-real-process.test.ts`), never by inferring writability from a preceding read's apparent success. No code change was needed to close this — the production write path was already correct; the test previously would have (wrongly) asserted the read itself must fail, which is not a true invariant of the underlying OS API.

## Address-validation consistency audit (mission §28)

Traced every write-capable production path to its actual validation chain:

| Path | Validation | Evidence |
|---|---|---|
| Manual trainer UI write | `LIVE_ADDRESS_STRING` (IPC schema) → `LiveMemorySession.proposeWrite`/`confirmWrite` (consent + identity re-verify) | `electron/ipc-validation.ts` `LiveMemoryProposeWriteSchema`, `electron/live-memory-ipc.ts:385-470` |
| Manual trainer UI freeze/unfreeze | Same schema → `startFreeze`/`stopFreeze` (consent + identity re-verify every tick) | `electron/live-memory-ipc.ts:791-950` |
| Hotkey-driven cheat toggle write/freeze (`cheat_slot_1`..`cheat_slot_12`, F1-F12) | `parseCheatHotkeySlot` (`cheat-hotkey-slots.ts`) → `useGameCheatSession.ts`'s `toggleCheat`/`writeValue`/`startFreeze` → the SAME `window.electronAPI.liveMemoryProposeWrite`/`liveMemoryFreezePropose` IPC as the manual UI — traced at `src/app/hooks/useGameCheatSession.ts:938-945` (hotkey→toggle dispatch) and its `startFreeze` callback's `window.electronAPI.liveMemoryFreezePropose` call. **Confirmed: hotkeys do not call any raw memory API directly** — they dispatch through the identical validated session methods the manual UI uses. Hotkey registration itself (`electron/trainer-hotkeys.ts`) is `globalShortcut`-based, gated by `isTrainerCapabilityEnabled('v2HotkeysEnabled')`, routed through `requireTrustedSender`/`guardedHandle`, with existing conflict detection (`detectHotkeyConflicts`, `trainer-hotkey-bindings.ts`) — pre-existing, not rebuilt. |
| Advanced Scan result → write/freeze | `LiveWatchPanel.tsx`'s `onConfirm(candidate)` sets `confirmedAddress`/`confirmedDataType` on the SAME per-cheat state `toggleCheat`/`writeValue`/`startFreeze` already consume — no separate address-typing or validation path exists for a scan-confirmed candidate vs. a manually-typed one. | `src/app/components/LiveWatchPanel.tsx`, `src/app/hooks/useGameCheatSession.ts` (`onConfirm` wiring, `writeValue`/`startFreeze`) |
| CT-import / research-promoted candidates | `ct-promote.ts`'s `promoteCandidateFromCtEntry`/`promoteCandidateFromFeature` build the same `LiveToggleCard` shape consumed by the identical toggle/write/freeze path — `freezeEligible` is explicitly gated to `resolvable` (module-rooted) quality, never assumed. | `src/core/live-memory/ct-promote.ts` |

**Conclusion: one canonical validated write/freeze path already existed and every production write-capable surface — manual UI, hotkeys, Advanced Scan, CT-import promotion — already funnels through it.** No renderer-side trust bypass exists (every one of these ultimately calls the same `ipcRenderer.invoke('live-memory-propose-write'/'live-memory-freeze-propose', ...)`, never `ipcRenderer` calls to a raw memory channel, never a direct native-addon import from renderer code — confirmed by grep: `native-memory-driver.ts`/`memoryjs` are imported nowhere under `src/app/`). This was true before this mission; this stage's contribution is the rigorous trace and citation above, not new plumbing, since none was missing.

## Hotkey model (mission §29/§30)

`TrainerHotkeyAction`, `getTrainerHotkeyBindings`/`setTrainerHotkeyBindings`, `detectHotkeyConflicts`/`detectOsHotkeyWarnings` (`trainer-hotkey-bindings.ts`) and `getTrainerHotkeyEntries`/`registerTrainerHotkeyEntries`/`unregisterTrainerHotkeyEntries` (`trainer-hotkey-registration.ts`) already provide the canonical action/binding/scope/enabled/conflict model mission §29 asks for. Actions already include per-slot cheat write/toggle and freeze/unfreeze (via `cheat_slot_N` dispatch → `toggleCheat`, which both writes once and manages `startFreeze`/`stopFreeze` depending on the cheat's own freeze-eligibility) alongside `toggle_overlay`/`hide_overlay`. **Hotkey collision handling**: `detectHotkeyConflicts` was pre-existing and unit-tested (`trainer-hotkey-bindings.test.ts`, already in the `test:definitions` canonical group) — not touched or reopened this stage per SOLITH.MD's own "do not reopen certified work absent a real regression" instruction.

## Advanced Scan integration (mission §33)

Already wired end-to-end for the per-cheat discovery flow: a scan candidate surfaces in `LiveWatchPanel`, `onConfirm` sets it as the cheat's resolved address/type with zero manual retyping, and every subsequent write/freeze action (manual button or hotkey) reuses that exact resolved value through the one canonical IPC path traced above. This stage's one net-new connective addition: any resolved address (from Advanced Scan, a discovered structure field, or a module) can now also be tracked in the new P2-8 watchlist (`watchlistAdd` with a `structure_field`/`absolute` source) without retyping, extending — not duplicating — the existing promotion pattern.

## Real fixture certification (mission §26)

`p2-9-write-freeze-revert-real-process.test.ts` — real spawned fixture, real `MUTATION_REGION`/`GUARD_REGION` infrastructure (pre-existing in `fixture.rs`, purpose-built for exactly this matrix), constructs a real `LiveMemorySession` over the real `nativeMemoryDriver` (same production classes the IPC layer delegates to):

- Write → verify → revert → verify, all against real fixture memory, all independently read back.
- Freeze genuinely re-enforces its value against a competing real write; unfreeze genuinely stops reassertion (a post-unfreeze independent write sticks).
- Invalid/unmapped address: truthful failure, never silent success.
- Non-writable region: the real write fails (`ERROR_NOACCESS`), restoring `PAGE_READWRITE` makes it genuinely writable again.
- Stale session (post-detach `confirmWrite`): truthful failure.
- Process exit while frozen: the freeze self-stops (polled, not a fixed wait — see the disclosed latency finding above), never an uncaught exception, never a runaway loop.

**Independent full-file certification: 3/3, all clean** (10-11s / 10-11s / 26-27s per run — freeze/identity-verification timing, not flake).

## Real-game proof (mission §27)

Godlike Burger, PID 25920, production attach path. No known semantically-meaningful trainer value (health/currency/etc.) was available without active gameplay in this stage's time budget — disclosed, not hidden. Per the same honesty standard P2-5 established for its own real-game snapshot proof, this stage instead proves the full write pipeline mechanically against a real, genuinely writable, real-game-owned private heap region (found via the production `getRegions()` call, `writable:true` verified): original value recorded (`0`), write performed (`123456789`), read-back verified (exact match), revert performed, revert verified (`0`, exact match to original). Real process, real OS-level write/read/revert, production `proposeWrite`/`confirmWrite`/`rollback` — not a claim about what the bytes mean.

## Resource limits (mission §36)

Freeze duration already bounded (`MAX_FREEZE_DURATION_MS`), freeze interval already bounded (`MIN_FREEZE_INTERVAL_MS`/`MAX_FREEZE_INTERVAL_MS`), one-freeze-per-session plus cross-session concurrency limits already existed (`registerActiveFreeze`). Watchlist count bounded this mission (`MAX_WATCH_ITEMS_PER_SESSION`, P2-8). No new unbounded growth surface was introduced by P2-9.

## Scope not touched (disclosed, not falsely closed)

Packaged (production-build) UI e2e proof for a P2-9 flow and a dedicated hotkey real-process/packaged proof were not completed as a separate pass this stage, given the very large combined scope of this mission (P2-6 through P2-9) and the fact that the write/freeze/hotkey/Advanced-Scan machinery being certified here is pre-existing, already covered by this repository's own established test suites (`trainer-hotkeys.test.ts`, `trainer-hotkey-bindings.test.ts`, `rollback-byte-integrity.test.ts`, `rollback-float-integrity.test.ts`, `scanner-backend-rollback-matrix.test.ts` — all already in the canonical `test`/`test:definitions` groups and included in this stage's full regression run). This is recorded honestly in the final P2-9 verdict rather than claimed as freshly proven.
