# Implementation Status

> **ARCHIVED supplement** — See `ROADMAP.md` and `Docs/Plans/SOLITH_PINNACLE_MASTER_PLAN.md` for current status.

This document tracks the implementation and verification status of Solith core modules and security hardening requirements.

## V1 Trainer UX + Compatibility Pilot — Current Status

**Overall: VERIFIED — Electron Runtime, Build Pipeline & Complete Workflow Verification Passed**

- **tsup bundler**: Compiled and verified (19/19 checks passed).
- **E2E Workflow**: 4/4 runs passed (repeatability confirmed).
- **Packaged Smoke**: 22/22 tests passed against setup executable.
- **Rollback Journal**: Fixed to log rollback events upon restore.

| Outcome | Description | Status |
|---------|-------------|--------|
| A | Polished Trainer Mode UI | COMPLETE |
| B | Workshop Mode toggle | COMPLETE |
| C | Real-world save compatibility | VERIFIED (Drill Core sandbox & Stardew workflow passed E2E) |
| D | Compatibility Framework | COMPLETE |

### Drill Core `master_volume` writable sandbox pilot (2026-06-25)

- Narrow byte-preserving adapter `drill-core-settings@1.0.0` added and registered.
- Master Volume slider recipe (Audio, 0–100, step 1, reset 100).
- Two independent sandbox runs passed: proposal → approval → verified backup →
  atomic byte-preserving apply (`100.0 → 75.0`) → validation → exact SHA-256 restore.
- Live original verified byte-for-byte unchanged.
- 24 new adapter tests; full suite 132/132; tsc clean; Electron build 18/18;
  all e2e suites (smoke, e2e, ipc, trainer-states, trainer-e2e, browser-fallback,
  performance, accessibility) and packaged-smoke (22/22) pass.
- Reports: `Docs/Reports/DRILL_CORE_MASTER_VOLUME_SANDBOX_PILOT.md`,
  `Docs/Reports/DRILL_CORE_MASTER_VOLUME_EVIDENCE.md`.

Branch: `feature/v1-trainer-ux-pilot`  
Last verified commit: see `Docs/CONTEXT_HANDOFF.md` for latest commit  
Non-user-data closeout: **COMPLETE (post-change verified)** — see `Docs/Reports/V1_NON_USER_DATA_CLOSEOUT.md`

---

## Live Memory Trainer (V2 scoped foundation, 2026-07-05 / extended 2026-07-06)

| Item | Status | Notes |
| ---- | ------ | ----- |
| Online-session guard | **Trust Shift (2026-07-20)** | Write/freeze/attach consent uses `evaluateWriteConsent` (waiver). `evaluateOnlineGuard` remains advisory/diagnostic. Unit tests cover both. See KI-017. |
| Per-game connection baselines | **VERIFIED (real games)** | `game-connection-baselines.ts` — evidence-based, reviewed exception list (default 0/strict for any unlisted game): Stardew Valley.exe (5, Steamworks background activity) and Atomfall_dx12.exe (2, Xbox Live background activity), both measured live against real running processes. 4/4 unit tests. |
| Remote-connection observer | **VERIFIED (real game), Windows only** | Rewritten from full `netstat -ano` parsing to a PID-scoped `Get-NetTCPConnection -OwningProcess <pid> -State Established` query after real-machine testing showed the netstat approach exceeded the shared 32KB command-output cap and made the guard fail closed on `output_size_exceeded` regardless of actual state (KI-017). 10/10 unit tests. Not yet implemented for macOS/Linux. |
| LiveMemorySession orchestration | **VERIFIED (unit, fake driver + real games)** | attach/propose/confirm/rollback/detach; guard rechecked immediately before every write. 8/8 tests, plus real end-to-end attach verified against both Stardew Valley.exe and Atomfall_dx12.exe. |
| Native memory driver (`memoryjs`) | **VERIFIED (real process)** | Two upstream bugs patched durably via `patch-package`. Real `ReadProcessMemory`/`WriteProcessMemory` round trip confirmed against a synthetic child process (`scripts/live-memory-verify.mts`) — see KI-015. `openProcess()`/`getModules()`/`getRegions()`/`readBuffer()` all confirmed against real, unmodified Stardew Valley.exe and Atomfall_dx12.exe (including the Xbox/Microsoft Store build — no AppContainer/UWP sandboxing blocked the handle, contrary to an initial assumption that turned out to be wrong when actually tested). |
| Memory scanner (`memory-scanner.ts`) | **VERIFIED (unit + 2 real games)** | Cheat-Engine-style first-scan and next-scan (exact/changed/unchanged/increased/decreased). 13/13 unit tests. Real verification: found Stardew Valley's exact on-screen gold value (99999999) as a single candidate across ~957 MiB; found Atomfall's ammo value (99 → 5000+ matches, capped) and correctly narrowed to exactly 1 candidate via a next-scan after the value changed (99 → 98). Default `maxTotalBytes` raised from 512 MiB to 2 GiB after the Stardew Valley test showed the original default was too small and silently missed the value (truncated, 0 matches) — a real bug this testing caught, not a hypothetical one. |
| Reverse pointer scanner (`pointer-scanner.ts`) | **VERIFIED (unit + real game)** | Finds restart-stable module+offset pointer chains to a dynamic address via range-based (not exact-match) backward search, recursing up to a depth/branching/total-scan-count budget. 7/7 unit tests with real multi-level fake chains, including a case simulating an ASLR-style module base change. Real-world finding: found **zero** candidates against Stardew Valley (a managed .NET/MonoGame game — see KI-018, this is a real technique/target mismatch, not a bug) but found **20 real candidates** against Atomfall (a native C++ engine, Rebellion's Asura) at depth 1, of which restart-testing (see below) confirmed exactly 1 was a genuine static pointer. |
| Pointer-path resolver (`pointer-resolver.ts`) | **VERIFIED (unit + real game across a real restart)** | Resolves module+offset chains through repeated dereferences. 7/7 unit tests. Real-world proof: of Atomfall's 20 candidate paths, re-resolving all 20 against a freshly relaunched process (new PID, new ASLR base, new heap layout) showed 19 resolved to garbage (near-null pointers, a repeated poison value, or plain zero) and exactly 1 resolved to the correct, live, on-screen-confirmed ammo value — the definitive real-restart proof this technique produces genuinely stable paths, not session-local coincidences. |
| Live control catalog (`live-control-catalog.ts`) | **VERIFIED (real game)** | Named, reusable pointer-path-backed controls, deliberately kept separate from the file-based `GameProfile.controls[]` system (whose `validateGameProfile()` explicitly rejects `memory_write`/`memory_observation` backends as executable — a deliberate V1 boundary this feature does not touch or route around). One real entry: `atomfall-current-weapon-ammo`, backed by the restart-verified path above. 6/6 unit tests. |
| Freeze-value loop | **VERIFIED (unit, fake scheduler)** | Advanced Scan Mode "Infinite X" style toggle: re-writes a value on an interval, rechecking the online-session guard every tick; the first guard failure stops the freeze outright (does not silently retry). 8/8 tests. Not yet exercised against a real game with a real write (see Known Limitations). |
| IPC / preload / UI | **IMPLEMENTED, feature-flagged off** | `electron/live-memory-ipc.ts` (Zod-validated, per-sender session ownership, gated on `v2LiveModeEnabled`, default false; all bounds server-side capped regardless of client-requested values), typed preload API, `LiveMemoryTrainerPage.tsx` with process picker, offline confirmation, a "Saved Controls" section (lists/resolves catalog entries), manual address/dataType read/write, scan-first/scan-next workflow, and freeze start/stop with live status. `tsc` clean, `npm test` 508/508, Electron build 19/19, `build:vite` clean. |
| Per-game live controls (e.g. Atomfall, Palworld) | **ONE REAL CONTROL VERIFIED (Atomfall ammo); none for Palworld** | The originally-requested target (Palworld) has no live-memory control — none was investigated this round. Atomfall's "Set Current Weapon Ammo" is the first real, restart-verified, end-to-end control, discovered through actual live gameplay testing rather than guessed offsets. No value has ever been WRITTEN to a real game process in any of this testing — every verification was read-only (scan, resolve, read) by deliberate choice, since writing to a live save carries real risk of corrupting the user's actual progress. |

See `PROJECT_SPEC.md` Section 3.1 / 42.1 for the safety contract this feature must not violate, and `Docs/KNOWN_ISSUES.md` KI-017 for the real-world finding that the guard currently blocks most Steam-integrated single-player games due to platform background networking (Steamworks cloud saves/presence), not just genuine online sessions — no policy change has been made in response to that finding.

## Core Feature Areas

| Feature Area | Status | Notes |
| ------------ | ------ | ----- |
| Multi-format Save Parsers | **VERIFIED** | Supports JSON, XML, INI, CSV, TXT, Lua. Validated in unit tests. |
| In-Memory Database (sql.js) | **VERIFIED** | Persisted to `data/solith.db` on disk. |
| Save File Comparison | **VERIFIED** | Discovery lab comparison and confidence scoring. |
| Recipe CRUD & Validations | **VERIFIED** | Strict Zod schema validation, safety filters checking for arbitrary JS/SQL/shell/IPC, conflict detection, and validated slider/dropdown control configuration. |
| Proposals Engine | **VERIFIED** | pending, approved, rejected state transitions. |
| Backups & Rollbacks | **VERIFIED** | Double hash verification and storage in SQLite database. |
| Offline AI Explanations | **VERIFIED** | Connects to Ollama/LM Studio with deterministic fallback. |
| Trainer Mode UI | **VERIFIED** | TrainerPage, TrainerCard, ApplyDialog, ContextPanel — Trainer E2E 5/5 |
| Workshop Mode toggle | **VERIFIED** | AppMode + localStorage + aria-pressed; Trainer E2E 28-point coverage |
| Compatibility Framework | **VERIFIED** | CompatibilityDashboard, 3 new IPC channels, Zod schemas |
| Rollback Journal Logging | **VERIFIED** | Logs `rollback` type event to SQLite journal upon successful restore. |

## Build System

| Item | Status | Notes |
| ---- | ------ | ----- |
| tsup bundling | **COMPLETE** | main.ts + preload.ts → dist-electron/main.js + preload.js |
| Output verification | **COMPLETE** | scripts/verify-electron-output.mjs — 18 checks, runs after every build |
| fix-esm-imports removed from build | **COMPLETE** | No longer in any script; historical helper files deleted from repo root |
| Unified dev command | **COMPLETE** | `npm run dev` starts Vite + tsup watch + Electron |

## Electron Runtime

| Item | Status | Notes |
| ---- | ------ | ----- |
| Single-instance lock | **COMPLETE** | `app.requestSingleInstanceLock()` with second-instance focus handler |
| Preload bridge | **COMPLETE** | `contextBridge.exposeInMainWorld('electronAPI', {...})` |
| IPC validation | **COMPLETE** | All handlers validate via Zod schemas in ipc-validation.ts |
| Packaged paths | **COMPLETE** | `app.getPath('userData')` used for all mutable data in production |
| Security settings | **COMPLETE** | nodeIntegration:false, contextIsolation:true, sandbox:true |

## Font & CSP

| Item | Status | Notes |
| ---- | ------ | ----- |
| Remote fonts removed | **COMPLETE** | No googleapis.com, gstatic.com, or CDN references anywhere |
| Local font stacks | **COMPLETE** | Inter/Segoe UI/system-ui stack; Cascadia Code/JetBrains Mono/Consolas for mono |
| CSP local-only | **COMPLETE** | Blocks remote scripts, styles, fonts, images, frames, objects, eval |
| Reduced-motion support | **COMPLETE** | `@media (prefers-reduced-motion: reduce)` in index.css |

## Test Architecture

| Item | Status | Notes |
| ---- | ------ | ----- |
| Core module tests | **PASSING** | 30 tests in core.test.ts, parsers.test.ts, etc. |
| Discovery test isolation | **FIXED** | Uses `resetForTesting()` with unique temp DB per run |
| Consecutive-run regression | **ADDED** | Second describe block in discovery.test.ts proves isolation |
| Trainer unit tests | **PASSING** | tests/trainer-ui.test.ts — 33 tests |
| Pilot intake unit tests | **PASSING** | tests/pilot-intake.test.ts — 10 dry-run tests (invented fixture) |
| Gate 10 bundled smoke | **PASSING** | tests/electron.smoke.test.ts — 6/6 |
| Gate 13 Electron E2E | **PASSING** | tests/electron.e2e.test.ts — 4/4, repeatability CONFIRMED |
| Trainer E2E | **PASSING** | tests/trainer.e2e.test.ts — 5/5, 28 assertion points |
| Gate 18 packaged smoke | **PASSING** | tests/packaged-smoke.test.ts — 20/20 |
| IPC channel E2E | **PASSING** | tests/ipc-channels.e2e.test.ts — 13/13 (4 edge-case tests added) |
| Trainer states E2E | **PASSING** | tests/trainer-states-controls.e2e.test.ts — 15/15; all active states plus slider/dropdown controls have Electron evidence |
| Browser fallback E2E | **PASSING** | tests/browser-fallback.e2e.test.ts — 7/7 |
| Accessibility E2E (new) | **PASSING** | tests/accessibility.e2e.test.ts — 7/7 DOM-level checks |
| Performance E2E (new) | **PASSING** | tests/performance.e2e.test.ts — 12/12 (startup 479ms, IPC 1-4ms, nav 314ms, apply 17ms, restore 7ms) |
| Gate 18 packaged smoke | **PASSING** | tests/packaged-smoke.test.ts — 22/22 (expanded from 20) |
| Total (npm test) | **346/346** | All unit/integration suites pass cleanly |

## TypeScript

`npx tsc --noEmit` → **0 errors**

Pre-existing errors in Backups.tsx, DiscoveryLab.tsx, Journal.tsx, Recipes.tsx, SaveEditor.tsx, SaveLocations.tsx were fixed in commit `8c92dcd`.

## Security Hardening Requirements

| Security Requirement | Status | Notes |
| -------------------- | ------ | ----- |
| Zod IPC runtime validation | **VERIFIED** | Input shape checks at Electron boundary with Zod. |
| Path safety & Traversal | **VERIFIED** | Absolute canonical paths, case-insensitive comparison, system directory blocking, traversal prevention. |
| Symbolic link & Junction safety | **VERIFIED** | Symlinks checked. Canonical paths checked on each filesystem write. |
| Concurrency file locks | **VERIFIED** | In-memory exclusive target lock registry blocks race conditions. |
| Atomic sibling write | **VERIFIED** | Sibling `.tmp` creation, swap rename, permission clone, and final hash checks. |
| Persists operation states | **VERIFIED** | Lifecycle states tracked in `operations` table. |
| Startup crash recovery | **VERIFIED** | Evidence-driven async crash recovery checking Case A, B, C, D, and E. |
| Sandbox & Context isolation | **VERIFIED** | Electron context isolation and sandboxing enabled. Generic filesystem APIs deleted. |
| Scanner Transactions | **VERIFIED** | Transactional scans (BEGIN, COMMIT, ROLLBACK) with scan status tracking. |
| Trainer Adapter Contract | **VERIFIED** | Common `TrainerAdapter` domain contract implemented. |
| Failure-Injection suite | **VERIFIED** | 20 passing safety tests cover concurrent mods, locks, crashes, write failures, and cancellation. |
| No-injection pilot constraint | **VERIFIED** | Game-running detection is read-only tasklist/ps; no memory write outside approved paths. |
