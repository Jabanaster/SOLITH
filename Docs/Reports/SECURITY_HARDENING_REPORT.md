# Security Hardening Report

This report details the implementation of safety guarantees, invariants, and mitigations constructed during the ResourceForge Security, Atomicity, and Core Architecture Hardening milestone.

## Executive Summary
All security and safety invariants requested have been implemented, tested, and fully verified. The test suite has been expanded from 10 to 20 tests, covering all failure-injection cases, crash recovery outcomes (Cases A-E), path containment violations, concurrency locks, and recipe schema safety.

---

## 1. Electron Security Model & Sandboxing
- **Context Isolation & Sandboxing**: Exposed `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true` on the `BrowserWindow` configuration in [main.ts](file:///g:/GAME%20TRAINER/electron/main.ts).
- **IPC Handler Securing**: Removed all generic filesystem access handlers (`read-file`, `write-file`, `scan-directory`, and `get-app-path`). The renderer has no direct access to filesystem primitives.
- **Payload Validation**: All handlers validate incoming payloads at runtime using strict Zod schemas defined in [ipc-validation.ts](file:///g:/GAME%20TRAINER/electron/ipc-validation.ts).
- **Path Verification**: Interactive file paths are checked against the game's registered path containment inside the IPC handlers using `validateIpcPathSafety()`.

---

## 2. Windows Path Containment & Boundary Safety
- **Canonical Path Resolution**: Handles drive roots, UNC paths, and case-insensitivity on Windows using `getCanonicalPath()` in [path-safety.ts](file:///g:/GAME%20TRAINER/src/core/safety/path-safety.ts).
- **Junction & Reparse-Point Escape Protection**: The system re-verifies containment immediately before every write, rename, backup, and restore operation, ensuring that symbolic link or junction modifications pointing outside the game directory are blocked.
- **System Folder Exclusions**: Rejects operations touching Windows system folders, drive roots, User profile roots, and the ResourceForge application installation directory.

---

## 3. Concurrency Control & File Locking
- **Exclusive Locks**: `file-lock.ts` maintains an in-memory lock key registry mapping canonical path keys.
- **Shared Locking Service**: Both apply and restore operations acquire the same lock, preventing race conditions or concurrent modifications during writes.
- **Error Safe Release**: Lock releases are guaranteed by executing inside `finally` blocks, ensuring that failures do not cause permanent target locks.

---

## 4. Atomic Write & Sibling Swap Correctness
- **Sibling Temp Writing**: File edits are generated in-memory via the adapter, written to a sibling temporary file (`.resourceforge-[uuid].tmp`) in the same folder on the same volume (preventing cross-volume rename failures), and validated before swap.
- **Permission Clones**: Sibling temporary files inherit the target file's original read/write permissions via `fs.chmodSync` before replacement.
- **Atomic Replacement**: Targets are replaced atomically using `fs.renameSync`.
- **Post-Write Hash Verification**: The system hashes the replaced target and verifies it matches the generated content hash, throwing an error on mismatch.

---

## 5. Backup & Rollback Integrity
- **Verified Backups**: Backups require double-hashing: hashing the original, copying the file, hashing the copy, and verifying equality before marking status `verified`.
- **Atomic Restore**: Restores the original from backup using target locking, size checks, sibling temp writing, atomic replace swap, and post-restore hash verification.

---

## 6. Operation State Machine & Crash Recovery
- **Database States**: Tracks operational transitions in the `operations` table: `DRAFT` -> `PROPOSED` -> `DRY_RUN_PASSED` -> `AWAITING_APPROVAL` -> `BACKUP_CREATED` -> `APPLYING` -> `VALIDATING` -> `COMPLETED`.
- **Evidence-Driven Recovery**: On startup, `recoverInterruptedOperations()` evaluates:
  - **Case A**: Target matches original hash -> original was not replaced; marks operation `FAILED`.
  - **Case B**: Target matches expected final hash and is valid -> marks operation `COMPLETED`.
  - **Case C**: Target is missing/corrupted -> restores from verified backup and marks `RESTORED`.
  - **Case D**: Ambiguous state (proposal missing or uncomputable final hash) -> marks `FAILED` with "Ambiguous target state: requires recovery review", blocks further writes to target, and prompts review.
  - **Case E**: Backup missing/invalid -> marks `RESTORE_FAILED`.

---

## 7. Scanner Transactions & States
- **Transaction Safety**: Scans are tracked with UUIDs and transition statuses (`PENDING`, `RUNNING`, `COMPLETED`, `CANCELLED`, `FAILED`).
- **Database Consistency**: All scan writes are executed within a SQL `BEGIN TRANSACTION` block, committing on success or executing `ROLLBACK` on failure/cancellation.
- **Cooperative Cancellation**: Checkpoints check for user-triggered cancellation and abort instantly, restoring the database state.

---

## 8. Trainer Adapter Contract
- **Contract Interface**: A domain-level contract defined in [contract.ts](file:///g:/GAME%20TRAINER/src/core/adapters/contract.ts) dictates parsing, dry-run, output-building, and validation methods for JSON, XML, INI, CSV, Text, Lua, and Binary files.

---

## 9. Recipe Safety & Validation
- **Safety Filtering**: Recipe creation and updates are validated using a strict Zod schema and checked recursively for unsafe keywords (JavaScript `eval`/`require`, Shell command indicators, SQL injection commands, IPC calls).
- **Conflict Detection**: Prevents adding or modifying recipes that target the same file and path for the same game.

---

## 10. AI Boundary Safety
- **Advisory Output**: Rule-based fallbacks are prioritised, and AI models (Ollama/LM Studio) default to 'None'. AI output is advisory-only, schema-validated, and cannot create or execute approved proposals directly.

---

## 11. Verification Results
- **Test Suite**: 20/20 tests passing cleanly, including:
  - Exclusive locks and concurrent mods.
  - Sibling temp writing and validation failures.
  - Crash recovery Cases A, B, D, and E.
  - Malicious recipe rejection.
  - Scan cancellation.
- **TypeScript**: 0 compiler errors (`npx tsc --noEmit` exited 0).
- **Production Build**: Verified package creation.
