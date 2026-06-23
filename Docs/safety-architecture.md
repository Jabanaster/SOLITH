# ResourceForge Core Safety & Lifecycle Architecture

This document describes the core design and safety guarantees built into **ResourceForge** to prevent save file corruption, directory escapes, concurrent edits, and interrupted writes.

---

## 1. Safety Boundaries (Strict Constraints)
ResourceForge is built to be a safe, offline, and file-backed game trainer. It strictly enforces the following V1 security principles:
* **No Live Memory Editing / Process Injection**: Avoids process memory tampering, bypasses, or anti-cheat triggers. All edits are file-backed.
* **Offline Only**: Operates locally on files. It does not perform network writes or bypass online anti-cheat systems.
* **No Executable Modification**: Modifies only save and configuration files. Executables (`.exe`), dynamic link libraries (`.dll`), system files (`.sys`), and device drivers (`.drv`) are completely blocked.

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
Edits are never written directly to the target file. ResourceForge employs a sibling temporary file replacement strategy:
1. **Sibling Temp Creation**: Writes new contents to a temporary file (`.resourceforge-<uuid>.tmp`) residing in the **same directory** as the target file. This guarantees they reside on the same physical disk volume, enabling atomic renames.
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
If ResourceForge crashes, loses power, or is terminated mid-operation, the startup routine:
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
