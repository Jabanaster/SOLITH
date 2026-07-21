# Solith Core Safety & Lifecycle Architecture

This document describes the core design and safety guarantees built into **Solith** to prevent save file corruption, directory escapes, concurrent edits, and interrupted writes.

**Related (Zero-Input live trainer):** See [`Docs/Architecture/SOLITH_ZERO_INPUT_BLUEPRINT.md`](Architecture/SOLITH_ZERO_INPUT_BLUEPRINT.md) for the Solith OFFLINE_ONLY ProcessWatcher / SignatureEngine / MemoryManager architecture, local memory audit logging, and telemetry-free `crash_report.txt` resilience layer. That blueprint does not weaken the constraints below.

---

## 1. Safety Boundaries (Strict Constraints)
Solith's default and primary edit path is safe, offline, file-backed save/config editing. It strictly enforces the following security principles:
* **File-Backed Editing Is the Safer, Default Path**: Save and configuration file editing (Sections 2–6 below) covers the large majority of Solith's supported use cases and carries the lowest risk. Prefer it whenever a game's data is file-backed.
* **Live Memory Access Is Gated, Not Blanket-Permitted**: Solith also ships a scoped live-memory subsystem (see Section 1a). This is not a general RAM-editing capability — it operates only against the explicit, catalogued controls for supported games, behind an off-by-default feature flag, a single-player / private-play waiver, and WritePolicyGate. Unsupported games and unsupported controls remain blocked.
* **Offline / private-play consent (not "zero network")**: Live-memory targeting requires the operator to accept the single-player / private-play waiver (Trust Shift). Connection counts may be observed as advisory (see KI-017) and do not automatically block writes after consent. This does **not** claim the Solith application makes zero network requests (opt-in hub sync / community listing metadata may exist). File-backed editing remains local. Solith does not bypass online anti-cheat systems.
* **No Executable Modification**: Modifies only save/configuration files and, within the gated live-memory subsystem, in-memory values of a running game's own process — never the executable, libraries, or system files on disk. `.exe`, `.dll`, `.sys`, and `.drv` file modification is completely blocked.
* **No Anti-Cheat Bypass, No Multiplayer/Commercial-Trainer Claim**: Neither the file-backed path nor the live-memory subsystem is designed to defeat, evade, or interact with anti-cheat systems, and neither is scoped for multiplayer or general commercial-game live-trainer use. Support is limited to catalogued, single-player, offline use of games/saves the user owns.

---

## 1a. Live-Memory Subsystem — Gated & Scoped

Solith's live-memory subsystem (`src/core/live-memory/`, `electron/live-memory-ipc.ts`,
`electron/cheat-toggle-ipc.ts`) exists and is verified by test, but it is not an open RAM-editing
feature. It is constrained on every axis below; removing any one of these constraints would be a
scope change requiring separate, explicit safety-scope authorization — it is not implied by this
document.

* **Off by default**: Gated behind the `v2LiveModeEnabled` setting. The UI (`MultiGameTrainerPage`)
  shows a feature-gate banner and requires an explicit opt-in before any scan/read/write is possible.
* **Explicit per-session waiver**: A single-player / private-play acknowledgement must be accepted
  before attach / writes / freeze (sticky locally per game scope after Trust Shift). This is consent,
  not network proof — Solith does not claim multiplayer safety.
* **Advisory connection observe**: `evaluateOnlineGuard` / connection baselines remain available for
  transparency UIs. They no longer hard-block write or freeze paths (see KI-017 Trust Shift). A
  multiplayer session can still be active when the operator accepts the waiver — residual risk.
* **Catalog-bound, not freeform**: Only pre-declared controls in the per-game catalog
  (`src/core/cheat-system/games.ts`, `src/core/live-memory/live-control-catalog.ts`) are reachable
  on the trainer deck path. Advanced Scan Mode is a separate, feature-flagged research surface.* **Schema-validated IPC boundary**: Every live-memory and cheat-toggle IPC call is validated by Zod
  schemas (`electron/ipc-validation.ts`) before it reaches process-memory or persistence code.
* **Persistence does not grant execution authority**: Cheat toggle persistence
  (`src/core/cheat-system/cheat-toggle-store.ts`, `cheat_toggle_state` table) remembers which toggles
  were enabled and their last confirmed address so they can be re-armed after a Solith
  restart. It does not itself perform a write, and a remembered address is not trusted blindly — it
  must be re-verified against the live process before reuse. The active UI for manual discovery is
  `LiveWatchPanel` (`src/app/components/LiveWatchPanel.tsx`); the earlier `LiveTrainer` /
  `PalworldCheatMenu` / `PalworldTrainerPage` / `useFreezeValue` / `useLiveTrainerWorkflow`
  implementation was removed and must not be restored.
* **Test-covered**: `test:live-memory` (72 tests), `test:trainer-host` (80 tests), and
  `test:cheat-toggle` (27 tests) cover the online guard, pointer resolution, freeze lifecycle, and
  toggle persistence/scoping. Current full-suite gate is 535/535.
* **Still strictly blocked, unchanged by this subsystem's existence**: process injection, DLL
  injection, kernel drivers, anti-cheat bypass or stealth behavior, DRM bypass, executable/library/
  driver patching, online/multiplayer support, and any control outside the declared per-game catalog.
  Broad commercial-game live-trainer support and Palworld-specific live-cheat support in particular
  remain unauthorized claims — the catalog covering Palworld cheats does not itself constitute that
  authorization; see `README.md` → "Trainer UI Migration" for the current scope statement.

---

## 2. Path Safety & Containment Model
To prevent path traversal, directory escapes, and malicious manipulation of system paths, the path safety model implements:
* **Canonical Path Resolution**: Uses absolute paths resolved via `fs.realpathSync` to bypass symbolic link and junction tricks.
* **Containment Verification**: Ensures all target file operations reside within the game's registered directory. It prevents prefix-escape attacks (e.g., ensuring a game folder named `C:\game` cannot access a folder named `C:\gamebackup` by checking path delimiters strictly).
* **System Roots & Folder Blocking**: Rejects drive roots (e.g., `C:\`, `D:\`) and critical system folders (`C:\Windows`, `C:\Program Files`, User Profile root) to prevent accidental OS file modifications.
* **Symlink and Junction Detection**: Rejects operations if the target file itself is detected to be a symbolic link or junction.

---

## 3. Concurrency Locking
To prevent race conditions and concurrent write conflicts on the same save file:
* Exposes an in-memory central file locking registry.
* Acquires exclusive locks on target file canonical paths before starting any edit or restore operation.
* Rejects edits if another operation is actively processing or holding a lock on the target file.

---

## 4. Atomic Write Sequence
Edits are never written directly to the target file. Solith employs a sibling temporary file replacement strategy:
1. **Sibling Temp Creation**: Writes new contents to a temporary file (`.solith-<uuid>.tmp`) residing in the **same directory** as the target file. This guarantees they reside on the same physical disk volume, enabling atomic renames.
2. **Pre-commit Validation**: Parses and validates the temporary file using the file format adapter (e.g. JSON/XML/INI validation) to confirm it is not malformed before committing it.
3. **Metadata & Permission Preservation**: Copies target file file permissions (chmod modes) to the temp file.
4. **Atomic Swap**: Invokes `fs.renameSync` to overwrite the target file in a single atomic OS-level operation.
5. **Post-swap Hash Check**: Computes the SHA-256 hash of the written file and verifies it matches the generated content hash.

---

## 5. Operation State Machine & Crash Recovery
Every data modification is managed through a database-backed transaction lifecycle.

### State Transition Diagram
```
       [ DRAFT ]
           │
       [ PROPOSED ] ──(Dry Run Fail)──> [ FAILED ]
           │
    [ DRY_RUN_PASSED ] ──(Cancel)─────> [ CANCELLED ]
           │
   [ AWAITING_APPROVAL ] ──(Cancel)───> [ CANCELLED ]
           │
   [ BACKUP_CREATED ] ──(Backup Fail)─> [ FAILED ]
           │
      [ APPLYING ] ────(Write Fail)───> [ FAILED ] ──> [ RESTORING ] ──> [ RESTORED ] / [ RESTORE_FAILED ]
           │
     [ VALIDATING ] ───(Hash Fail)────> [ FAILED ] ──> [ RESTORING ] ──> [ RESTORED ] / [ RESTORE_FAILED ]
           │
     [ COMPLETED ]
```

### Crash Recovery Routine
If Solith crashes, loses power, or is terminated mid-operation, the startup routine:
1. Queries the SQLite database for operations stuck in critical transitional states: `APPLYING`, `VALIDATING`, or `RESTORING`.
2. Checks the target file hash against the verified backup file hash.
3. If the target file was modified or corrupted, automatically restores the original file content from the backup using the atomic restore workflow.
4. Marks the operation as `RESTORED` or `RESTORE_FAILED` accordingly.

---

## 6. IPC Boundary Validation
The Electron main process validates all renderer payloads at the IPC boundary:
* **Zod Schemas**: Strict shape, type, and format validation for all parameters.
* **Path Containment Enforcement**: The IPC receiver calls path containment checks to ensure file paths supplied by the renderer are fully safe and authorized.

---

## 7. Safety System Limitations
* **Binary File Editing**: While parsing and metadata safety checks are run, direct bitwise editing of binary save files does not perform structure validations (limited to data files).
* **Concurrent External Editors**: If an external text editor or the game itself writes to the file concurrently *during* the short window of the rename step, the dry run stale value check will catch it before the write, but OS-level file locking must be respected by external software.
