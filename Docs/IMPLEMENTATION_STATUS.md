# Implementation Status

This document tracks the implementation and verification status of ResourceForge core modules and security hardening requirements.

## Core Feature Areas

| Feature Area | Status | Notes |
| ------------ | ------ | ----- |
| Multi-format Save Parsers | **VERIFIED** | Supports JSON, XML, INI, CSV, TXT, Lua. Validated in unit tests. |
| In-Memory Database (sql.js) | **VERIFIED** | Persisted to `data/resourceforge.db` on disk. |
| Save File Comparison | **VERIFIED** | Discovery lab comparison and confidence scoring. |
| Recipe CRUD & Validations | **VERIFIED** | Strict Zod schema validation, safety filters checking for arbitrary JS/SQL/shell/IPC, conflict detection. |
| Proposals Engine | **VERIFIED** | pending, approved, rejected state transitions. |
| Backups & Rollbacks | **VERIFIED** | Double hash verification and storage in SQLite database. |
| Offline AI Explanations | **VERIFIED** | Connects to Ollama/LM Studio with deterministic fallback. |

## Build System

| Item | Status | Notes |
| ---- | ------ | ----- |
| tsup bundling | **COMPLETE** | main.ts + preload.ts → dist-electron/main.js + preload.js |
| Output verification | **COMPLETE** | scripts/verify-electron-output.mjs — 18 checks, runs after every build |
| fix-esm-imports removed from build | **COMPLETE** | No longer in any script; kept for historical reference |
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
| Electron smoke test | **WRITTEN** | tests/electron.smoke.test.ts — requires `npm install && npx playwright install` |
| Playwright config | **WRITTEN** | playwright.config.ts |

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
