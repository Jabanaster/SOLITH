# Known Issues

This document records the current known bugs, design limitations, and trade-offs.

## Open Issues

### KI-018: Generic reverse pointer scanner cannot find a static root for managed-runtime (.NET/Mono) games like Stardew Valley

Verified live (read-only) against the real, running Stardew Valley process:
using the exact on-screen gold value (99999999), `scanFirst` reliably finds
the single real address holding it (`0x21489f62ce0`, reproduced across two
separate runs minutes apart — the object hadn't moved). Running
`scanForPointerPath` against that address, with generous bounds (4 GiB
value-scan budget, 2 GiB pointer-scan-per-level budget, offset window up to
64 KiB, depth up to 4), found **zero** candidate static pointers anywhere in
the process's committed memory.

This is not a bug in the scanner — `pointer-scanner.ts`/`pointer-resolver.ts`
are proven correct against fake multi-level pointer chains (7/7 tests,
including a chain that resolves correctly after simulating an ASLR-style
module base change). It's a real mismatch between the technique and the
target: Stardew Valley runs on MonoGame over .NET/Mono, where the GC-managed
heap's static roots live inside the runtime's own internal structures (GC
handle tables, thread-stack roots at safepoints, etc.), not as plain
pointers sitting at a fixed offset inside the game's PE module image the way
they do in native C/C++ games (which is what this generic "any module +
offset" scan technique is built for, and is exactly how classic memory-scanner
pointer tables work for most Unreal/native-engine titles).

Practical takeaway: this pointer-scanning approach should work well against
native-engine games (Unreal Engine and similar C++-compiled titles are the
common case), but reaching a genuinely stable root in a managed-runtime game
needs a different, runtime-aware technique (e.g. locating the CLR's own GC
handle/root tables, or a Mono-specific approach) that has not been built.
Do not represent pointer-path discovery as working for managed-runtime
games until that gap is actually closed.

**Update 2026-07-06 (confirmed on a native-engine game):** the same
technique was then run against Atomfall (Rebellion's native C++ "Asura"
engine) and found 20 candidate static pointers at depth 1 on the first
attempt (after correctly sizing `maxRegionBytes`/`maxBytesPerScan` to the
game's real ~9 GiB committed footprint — the original bounds, sized for
Stardew Valley's ~1 GiB, silently found nothing for a much larger game
too). Restart-testing (fully closing and relaunching Atomfall, giving it a
new PID, new ASLR base, and new heap layout) confirmed exactly 1 of the 20
candidates still resolved correctly; the other 19 resolved to near-null
pointers, a repeated poison value, or plain zero, confirming they were
session-local numeric coincidences rather than real pointers. This is now
a real, restart-verified control (`live-control-catalog.ts`:
`atomfall-current-weapon-ammo`) — the technique works as designed for
native-engine games; the managed-runtime gap above remains open.

### KI-017: Online-session guard / Trust Shift (connection-count policy)

**Historical finding:** Verified live against Stardew Valley (solo/offline farm): even with no
multiplayer session active, the game process held ~5 ESTABLISHED non-loopback TCP connections
(platform Steamworks / CDN chatter). The original `evaluateOnlineGuard()` blocked attach/writes
per "any remote connection blocks" design — making live writes rare for platform-integrated SP games.

**Policy decision (Trust Shift, 2026-07-20):** Automated connection-count enforcement was **removed
from write / freeze / attach consent paths**. Those paths use `evaluateWriteConsent` (single-player /
private-play waiver). `evaluateOnlineGuard` remains for advisory diagnostics and baseline history.

**Reviewed baselines** (`acceptedConnectionBaseline` / `connectionBaseline`) remain useful as
**advisory / documentation** of measured platform overhead (Stardew, Atomfall, Avowed WinGDK, etc.).

**Residual risk (do not overclaim):**
The waiver is **manual responsibility**, not network proof. Endpoint identity is not validated.
A multiplayer session can still be active when the operator accepts the waiver. Solith does not
claim multiplayer safety.

**Pending / weak baseline coverage (advisory only):**
`Dredge.exe`, `CrimsonDesert.exe` — still undocumented until measured.
Avowed WinGDK baseline = 3 with evidence limitations — see
`Docs/Baselines/AVOWED_CONNECTION_BASELINE_2026-07-20.md`.

### KI-016: Gate 13 electron-e2e "Full Demo Workflow" fails in this build environment (pre-existing, not caused by Live Memory Trainer work)

`npm run test:electron-e2e` fails deterministically (2 runs, same result) at
`parseSave returned null before apply` for the demo workspace fixture, in
both "run 1" and "run 2" of the full UI→preload→IPC→DB→backup→apply→restore→
journal workflow, cascading into the cross-run hash-comparison test.

Isolated the cause: reproduced with the Live Memory Trainer IPC registration
(`registerLiveMemoryIpc()` in `electron/main.ts`) temporarily disabled and the
bundle rebuilt — the failure persisted identically, proving it is
environmental to this build machine/sandbox, not caused by this feature. Not
investigated further since it predates and is unrelated to this work; flag
for separate investigation before next release-gate sign-off. `test:electron-smoke`
(6/6) passes cleanly in the same environment, so basic Electron/IPC/renderer
wiring is sound — this is specific to the heavier backup/apply/restore
workflow test.

### KI-014: Accessibility E2E worker can transiently crash on Windows
On some runs the Electron worker for `test:accessibility` has crashed
(`code=3221226505`, a Windows access-violation in the GPU/worker process) before
`a11y-01`. Investigation: this is an environment-level Electron/Chromium worker
crash on Windows, not a code regression — it does not reproduce deterministically,
the renderer/main assertions pass on a clean run, and no app code is on the crash
path. During the Drill Core `master_volume` pilot the suite passed 7/7 with no
crash. Mitigation if it recurs: ensure no other Electron instance holds the
single-instance lock and re-run; do not mask it by looping until green.

### KI-006 (RESOLVED 2026-07-11): Apply dialog focus trap
`ApplyDialog.tsx` traps Tab focus within the modal, cycles from last→first focusable control, restores focus on close, and closes on Escape when not busy.

### KI-007 (RESOLVED 2026-07-11): Card state badges lack screen-reader context
`TrainerCard.tsx` state badges now use `aria-describedby` pointing to a visible or screen-reader-only state description.

### KI-008 (RESOLVED 2026-07-11): Slider control label linkage
The slider input in `TrainerCard.tsx` is wrapped in a `<label htmlFor=...>` linked to the range control.

### KI-009 (RESOLVED 2026-07-11): Disabled controls lack aria-disabled
Trainer card controls set `aria-disabled` alongside the native `disabled` attribute and link blocking reasons via `aria-describedby` when present.

### KI-010 (PARTIAL): Reduced-motion in Trainer UI
Global CSS in `index.css` honors `prefers-reduced-motion: reduce` for transitions/animations app-wide. Trainer-specific JS animations are not used.

### KI-011: No pagination on trainer cards
The trainer cards list in `TrainerPage.tsx` renders all recipes without pagination or virtual scrolling. This is acceptable for small recipe sets (< 50 items) but will degrade for games with 100+ recipes.

### KI-015 (RESOLVED 2026-07-05): Live-memory native driver — build + verification

`memoryjs@3.5.1`'s own install script and its native source both had bugs
that block a clean install on this toolchain (Node v24.15.0 / MSVC v143):

1. `scripts/install.js` calls `spawn('npm.cmd', ...)` without `shell: true`,
   which throws `spawn EINVAL` on current Node (Windows now requires
   `shell: true` to spawn `.cmd`/`.bat` files directly).
2. `lib/memoryjs.cc` assigns C string literals to non-`const char*` in several
   places, which current MSVC rejects by default (`/Zc:strictStrings`).

Both were originally fixed via `patches/memoryjs+3.5.1.patch` (applied by
`patch-package` in `postinstall`). That worked for `npm install` on top of an
*already-installed* `node_modules/memoryjs`, but a genuinely clean `npm ci`
from an empty `node_modules` still failed: `memoryjs`'s own install-time build
script runs as part of installing `memoryjs` itself, before the root
project's `postinstall` (where `patch-package` runs) ever gets a chance to
fix it. The patch was always applied one step too late to help a true fresh
clone. Discovered and root-caused during fresh-clone release verification on
2026-07-09 (three independent reproductions: tool-driven clone, second clean
clone, and a manual PowerShell clone all failed identically).

Fixed durably by vendoring a pre-patched copy of `memoryjs@3.5.1` at
`vendor/memoryjs-3.5.1-patched/` (both fixes — `shell: true` in
`scripts/install.js`, `/Zc:strictStrings-` in `binding.gyp` — baked directly
into the vendored source; see `vendor/memoryjs-3.5.1-patched/NOTES.md`) and
pointing the root `package.json` at it via `"memoryjs":
"file:vendor/memoryjs-3.5.1-patched"`. `patches/memoryjs+3.5.1.patch` has been
removed — the fix no longer depends on a postinstall patching step running in
time. With this, `npm ci` builds the native addon cleanly on the very first
install, given Visual Studio Build Tools ("Desktop development with C++") +
Python installed.

Verified with real evidence, not just unit tests: `scripts/live-memory-verify.mts`
spawns a genuine separate Node process holding a known value in a dedicated
Buffer, uses `nativeMemoryDriver` (the actual product wrapper, not a mock) to
locate it via a byte-pattern scan, and performs a real
`ReadProcessMemory` → `WriteProcessMemory` → `ReadProcessMemory` round trip
against that live process — confirmed passing twice, including after a full
`npm install`/rebuild cycle. Orchestration logic remains additionally
unit-tested against a fake driver (14/14, `tests/fixtures/fake-memory-driver.ts`)
for fast, deterministic CI coverage.

Update 2026-07-06: also verified against a real, running commercial game
(Stardew Valley.exe) — `listLiveMemoryProcesses()` found the real process,
and `nativeMemoryDriver.openProcess()`/`closeProcess()` succeeded cleanly
against it (no anti-tamper blocking the handle). No memory was read or
written against the real game; only attach/detach mechanics were confirmed.
See KI-017 for what this real-game test surfaced about the online-session
guard, plus a real bug it caught: the original `netstat -ano`-based
`observeRemoteConnections()` parsed the full system-wide connection table
client-side and exceeded the shared 32KB command-output cap on this real
machine, making the guard fail closed on `output_size_exceeded` regardless
of the target's actual state. Fixed by switching to a
`Get-NetTCPConnection -OwningProcess <pid> -State Established` query scoped
server-side to one PID (`src/core/live-memory/remote-connection-observer.ts`),
which keeps output bounded no matter how busy the rest of the machine is.
Covered by `tests/live-memory/remote-connection-observer.test.ts` (10 tests).

Remaining gap: no per-game memory offsets exist yet (this milestone is attach
mechanics + safety guard only, not a working trainer control for any
specific game). Non-Windows remote-connection observation is still
unimplemented (online-session guard fails closed on non-Windows regardless).

### KI-014: Atomfall Xbox save format is read-only

Atomfall 1.23.105.0 uses an extensionless, fixed-size, sparse proprietary binary container
with possible integrity metadata. Real-world sandbox copying and source-hash preservation are
verified, but no parser, serializer, checksum rules, or format-version validator exists.
Compatibility is locked to `READ_ONLY`; blind offsets, trailer manipulation, checksum guessing,
repacking, apply, and restore are prohibited.

## Resolved

| Issue | Resolution |
|-------|-----------|
| KI-001: Playwright local dependency gate | Resolved in Phase 8/9 release-gate evidence: `npm ci` restored local project dependencies, `@playwright/test@1.61.0` and nested `playwright@1.61.0` were installed locally, and `npm run test:milestone-e` passed 15/15 without global installs |
| Node ESM bare imports crashing at runtime | Replaced tsc + fix-esm-imports with tsup bundling |
| Shared database singleton causing test failures across runs | Added `resetForTesting()` with unique temp DB per suite |
| Remote Google Fonts CDN reference in index.html | Removed; local system font stacks only |
| Missing `prefers-reduced-motion` support | Added at end of index.css |
| No single-instance lock | Implemented in electron/main.ts |
| No unified dev command | `npm run dev` via scripts/dev.mjs |
| KI-004: Page UIs are scaffold-level | TrainerPage, CompatibilityDashboard fully implemented; others functional |
| KI-002: Installer not verified end-to-end | Gate 18 packaged smoke 20/20 — exe verified with Playwright |
| TypeScript errors in 6 legacy page files | Fixed in commit `8c92dcd` |
| KI-012: BROKEN state unreachable through IPC | `recipeToTrainerItem()` now preserves `status='Broken'`; Electron IPC and renderer assertions pass |
| KI-003: dead `fix-esm-imports` scripts in repo root | Deleted `fix-esm-imports.mjs` and `fix-esm-imports.ps1`; build, dist, and packaged smoke pass without them |
| KI-013: slider/dropdown unreachable via IPC | Added validated recipe control fields to IPC/domain/DB mapping; `test:trainer-states` now covers slider and dropdown as reachable controls |

## Architectural Limitations

1. **Binary Files**: Safe structures are verified but bitwise parsing and validations for unknown binary file types are not supported in V1.
2. **Offline AI Connection**: If local AI services (Ollama/LM Studio) are not running, rule-based fallback explanations are used.
3. **Reparse Points/Junction Escapes**: Symbolic links and junctions at the target path are actively detected and rejected, but testing of complex Windows volume mount points depends on native OS permissions.
4. **Real-World Compatibility**: Atomfall has `REAL_WORLD_SANDBOX` read-only evidence. No writable real-game pilot has passed; fixture evidence remains the only apply/restore evidence.

## Transitional Technical Debt
- **tsup configuration for CJS preload**: While the main process compiles as native ES module (`main.js`), the Electron preload script compiles to CommonJS (`preload.cjs`) to align with Electron context isolation guidelines. All preload references inside `main.ts` map to `preload.cjs` accordingly.
- **Better-SQLite3 packaging**: Because of binary linkage, `better-sqlite3` and `sql.js` are configured under `asarUnpack` in the `build` parameters in `package.json`.
