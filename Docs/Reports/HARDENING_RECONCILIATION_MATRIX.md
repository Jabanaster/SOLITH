# Hardening Reconciliation Matrix

This document reconciles all security hardening specifications against their verified implementation and validation state.

| Requirement | Status | Evidence | Tests | Remaining Work |
| ----------- | ------ | -------- | ----- | -------------- |
| **SQLite UUID Keys** | **VERIFIED** | Centralized `generateId` generates crypto UUIDs for all database inserts, ensuring no ID duplication. | DB unit tests | None |
| **Demo Seed Behavior** | **VERIFIED** | Cooperatively checks db settings, seeds `DEMO_GAME_ID` and scans local demo directory without crashing. | `core.test.ts` / E2E | None |
| **Electron Security Model** | **VERIFIED** | `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` enabled on BrowserWindow. Narrowpreload API exposed. Removed generic filesystem handlers. | Preload & main process audit | None |
| **IPC Input Validation** | **VERIFIED** | Zod schemas parse and validate incoming payloads at main process entry. Channel inventory documented. | `failure-injection.test.ts` | None |
| **Canonical Path Containment** | **VERIFIED** | Resolves real paths, case-insensitive comparison, checks startsWith, blocks system directories and drive roots. | `safety-integration.test.ts` | None |
| **Exclusive Write Lock** | **VERIFIED** | In-memory lock registry for canonical paths prevents race conditions between apply and restore. | `safety-integration.test.ts` | None |
| **Atomic Apply** | **VERIFIED** | Writes to unique sibling temporary file, validates content with adapter, preserves permissions, atomically replaces, and double-checks hash. | `safety-integration.test.ts` | None |
| **Backup Integrity** | **VERIFIED** | Hash equality verification between source and backup, file size logging, and double-hash checks. | `safety-integration.test.ts` | None |
| **Atomic Restore** | **VERIFIED** | Restores from backup using sibling temp writing, atomic replace swap, lock checking, and post-restore hash verification. | `safety-integration.test.ts` | None |
| **Operation State Machine** | **VERIFIED** | Strict status transition constraints (`DRAFT` -> `PROPOSED` -> `DRY_RUN_PASSED` -> `AWAITING_APPROVAL` -> `BACKUP_CREATED` -> `APPLYING` -> `VALIDATING` -> `COMPLETED`). | State machine test suite | None |
| **Startup Crash Recovery** | **VERIFIED** | Evidence-driven asynchronous crash recovery evaluates expected original vs expected final vs current target hashes and temporary-file presence (Cases A-E). | `failure-injection.test.ts` | None |
| **Scanner Transactions** | **VERIFIED** | Scans get UUIDs, scan states are tracked (`PENDING`, `RUNNING`, `COMPLETED`, `CANCELLED`, `FAILED`), and database updates are transactional with `COMMIT`/`ROLLBACK`. | `failure-injection.test.ts` | None |
| **Trainer Adapter Contract** | **VERIFIED** | Decoupled domain adapters (JSON, INI, XML, CSV, Lua, Text, Binary) implement the `TrainerAdapter` contract. | `core.test.ts` | None |
| **Recipe Schema Validation** | **VERIFIED** | Zod schema validation, safety filters checking for arbitrary JS/Shell/SQL/IPC syntax, and conflict detection for recipes targeting the same path. | `failure-injection.test.ts` | None |
| **AI Boundary Safety** | **VERIFIED** | AI config is rule-backed, provider settings default to 'None', and AI recommendations are advisory-only and cannot directly apply edits. | Schema audit | None |
| **UI Safety** | **VERIFIED** | Confirmations before delete/restore, loading states, and double-submit protections verified. | UI components audit | None |
| **End-to-End Demo Workflow** | **VERIFIED** | Automated E2E verification of save discovery, dry-run, backup creation, atomic apply, validation, and rollback. | `failure-injection.test.ts` | None |
| **Failure-Injection Tests** | **VERIFIED** | 20 robust unit & integration tests covering stale values, concurrent mods, write failures, all recovery cases, and malicious recipe rejections. | `npm run test` | None |
