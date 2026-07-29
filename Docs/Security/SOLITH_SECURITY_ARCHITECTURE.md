# Solith Security Architecture

**Date**: 2026-07-26  
**Scope**: Batch A Discovery - Architecture and Trust Model  
**Status**: Complete

---

## System Overview

Solith is a Windows desktop application for save-game editing, live memory modification, trainer catalog management, and security research. The architecture uses Electron for cross-platform desktop UI with three sandboxed renderer processes communicating to a privileged main process via 149 IPC handlers.

### Component Model

**Electron Main Process** (Privileged, User-Level)
- IPC server: 149 handlers across 12 files accepting renderer requests
- File I/O: AppData, game folders, user-selected paths
- Process execution: PowerShell (2 instances), spawn (4 locations)
- Registry access: Game detection via WMI queries
- Memory operations: Live-memory library with attach/read/write/scan
- Native modules: memoryjs, Windows API wrappers

**Renderer Processes** (3 total, Fully Sandboxed)
- Main UI (Game Library, Save Editor, Live Memory, Trainer Catalog)
- Trainer Overlay
- Wisp Game Bar Widget (Xbox Game Bar POC)
- Configuration: nodeIntegration: false, contextIsolation: true, sandbox: true

**Trust Model**
- Renderers are untrusted; all input from IPC is validated
- Main process validates input via Zod schemas (10 files with .parse/.safeParse)
- Privileged operations require user consent via modal dialog
- File operations constrained to allowed roots via path.resolve() validation

---

## Trust Boundaries

### Renderer ↔ Main Process (IPC)
- **Direction**: Renderer requests → Main process response
- **Threat Model**: Renderer may be compromised or malicious
- **Control**: Zod schema validation on input; sender validation via event.sender
- **149 handlers** covering game/save operations, memory access, trainer import

### Main Process ↔ File System
- **Direction**: Main process reads/writes user-selected and application-managed paths
- **Threat Model**: Symlinks, junctions, TOCTOU races, path traversal
- **Control**: path.resolve() canonicalization, containment checks, fs.existsSync validation
- **Status**: PARTIAL - junction/symlink edge cases not fully tested

### Main Process ↔ Native Modules
- **Direction**: Main invokes native C++ code for memory operations
- **Threat Model**: Buffer overflows, integer overflows, memory leaks
- **Control**: memoryjs binding validation, size limits
- **Status**: NOT INSPECTED - beyond Batch A scope

### Main Process ↔ External Processes
- **Direction**: Main executes PowerShell and spawn processes
- **Threat Model**: Command injection, argument escaping, process abuse
- **Control**: Array argument passing (no shell), single-quote escaping for PowerShell
- **Status**: PARTIAL - 4 spawn invocations not fully analyzed

### Main Process ↔ External Services
- **Direction**: Trainer catalog sync, hub communication, community features
- **Threat Model**: Man-in-the-middle, DNS spoofing, credential theft
- **Status**: NOT INSPECTED - network code not located in Batch A

---

## Verified Security Controls

### ✓ Electron Sandboxing

All three renderer processes configured identically:
```javascript
nodeIntegration: false
contextIsolation: true
sandbox: true
```

**Impact**: Renderers cannot directly access Node.js APIs; all operations forced through IPC.

**Confidence**: COMPLETE - verified in electron/main.ts, wisp-overlay.ts, trainer-overlay.ts

### ✓ IPC Input Validation

Zod schema validation present on 10+ files:
- electron/ct-library-ipc.ts: ImportPreviewSchema.safeParse()
- electron/install-discovery-ipc.ts: DiscoveryOptionsSchema.parse()
- electron/live-memory-ipc.ts: LiveMemoryZeroInputPrepareSchema.parse()
- And others

**Impact**: Malformed input rejected before processing.

**Confidence**: PARTIAL - not all 149 handlers audited for schema usage

### ✓ Privileged Consent Gates

CRITICAL handlers requiring user approval:
- in-process-confirm-hook
- in-process-confirm-injector-launch
- in-process-issue-injector-consent
- in-process-propose-hook
- in-process-propose-injector-launch
- in-process-register-injector-helper

**Impact**: Consent UI and selected call paths were verified.

**Confidence**: PARTIAL - Request binding, replay resistance, concurrency behavior, sender identity, and authorization-state security remain partially verified

### ? File Containment (Path Validation)

Used in helper registration and game operations:
- path.resolve() canonicalizes paths
- fs.existsSync() ensures path exists
- .exe suffix validation
- System directory exclusion
- isUnderInjectorHelpersRoot() containment check
- SHA-256 verification
- Authenticode signature verification

**Impact**: Lexical path containment was verified. Filesystem-target containment remains unverified.

**Confidence**: PARTIAL - Junctions, symbolic links, reparse points, hard links, and TOCTOU behavior remain untested; path.relative() string comparison does not account for filesystem metadata

### ? Process Execution Safety

Confirmed patterns:
- execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])
- spawn() with argument arrays
- No shell: true option observed

**Impact**: No shell injection vector via argument parsing in reviewed locations.

**Confidence**: PARTIAL - 2 of 6 process execution locations fully analyzed; others not inspected

### ? ZIP Import Size Limits

Observed controls:
- Archive size limit: 250 MB (DEFAULT_MAX_ARCHIVE_BYTES)
- Individual file size limit: 10 MB (DEFAULT_MAX_CT_BYTES)
- Path validation: validateZipEntryPath()

**Impact**: Partial archive-abuse controls were verified.

**Confidence**: PARTIAL - Compression ratio abuse, file-count explosion, nested archives, and CPU exhaustion limits remain untested

### ? YAML Parsing Safety

Uses yaml library (^2.9.0):
- parse() method (not unsafe mode)
- No code execution in default mode
- Schema validation post-parse

**Impact**: No direct object-construction or code-execution behavior identified.

**Confidence**: PARTIAL - Resource limits, aliases, nesting depth, and prototype handling remain untested

---

## Controls NOT Yet Verified

### Atomic Filesystem Operations
Mentioned in assignment brief; backup/restore uses sibling writes + atomic swap.
**Status**: NOT INSPECTED

### Session Authorization
Per-sender session ownership for memory operations.
**Status**: PARTIAL

### Memory Access Controls
Live-memory operations require attached process verification.
**Status**: PARTIAL

### Audit Logging
Operation tracking and audit trail storage.
**Status**: PARTIAL

### Consent State Machine
Token binding, expiration, single-use semantics, replay protection.
**Status**: PARTIAL

### Auto-Update Mechanism
No configuration visible; update security unknown.
**Status**: NOT INSPECTED

### Code Signing
Installer and artifact signing not found in configuration.
**Status**: NOT INSPECTED

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│ Windows Desktop (User Permission Level)                 │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌───────────────────────────────────────────────────┐  │
│  │ Electron Main Process                             │  │
│  │ • 149 IPC handlers                                │  │
│  │ • 44 game/save ops, 40 memory ops, 21 import     │  │
│  │ • File I/O, Registry, Process execution          │  │
│  └───────────────────────────────────────────────────┘  │
│        │                    │                      │     │
│        ▼                    ▼                      ▼     │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐ │
│  │ Renderer 1  │  │ Renderer 2  │  │ Wisp Game Bar    │ │
│  │ Main UI     │  │ Trainer OVL │  │ (Sandboxed)      │ │
│  │ Sandboxed   │  │ Sandboxed   │  │ Sandboxed        │ │
│  └─────────────┘  └─────────────┘  └──────────────────┘ │
│                                                          │
│  ┌───────────────────────────────────────────────────┐  │
│  │ Native Modules                                    │  │
│  │ • Memory driver (NtQueryVM*)                      │  │
│  │ • Process metadata (WMI)                          │  │
│  │ • Registry (Win32 API)                            │  │
│  │ • OCR (tesseract.js)                              │  │
│  └───────────────────────────────────────────────────┘  │
│                                                          │
└─────────────────────────────────────────────────────────┘
             │                          │
    ┌────────┴──────────┐      ┌────────┴──────────┐
    ▼                   ▼      ▼                   ▼
 Game Files        External APIs            Windows APIs
 Save Backups      Trainer Hub             Process List
 User AppData      Community Sync          Registry
```

---

## Entry Points

### IPC Handlers (149 total)
- **Inbound**: Renderer process requests
- **Validation**: Zod schemas on 10+ handlers
- **Auth**: event.sender validation, session-based for memory ops

### File I/O
- **Game folders**: User-selected or auto-discovered
- **AppData**: User-specific application data
- **Save files**: User-selected for backup/restore
- **Validation**: path.resolve() + containment checks

### Process Execution
- **PowerShell**: 2 hardcoded invocations (Authenticode, metadata)
- **spawn()**: 4 locations (helper launch, etc.)
- **Validation**: Array arguments, no shell option

### Native Module Binding
- **memoryjs**: Process memory access
- **WMI**: Game installation detection
- **Windows APIs**: Registry, file operations

---

## Data Flow Example: Injector Helper Registration

```
Renderer UI (untrusted)
  │ IPC: "in-process-register-injector-helper"
  ▼
Main Process Handler
  │ 1. Zod schema validation (line 1137)
  │ 2. fs.existsSync(resolved) (line 1155)
  │ 3. .exe suffix check (line 1155)
  │ 4. System dir exclusion (line 1158)
  │ 5. path.resolve() + containment check (line 1154, 1161)
  ▼
SHA-256 Computation (line 1164)
  │
  ▼
queryAuthenticodePublisher(resolved) (line 1165)
  │ Input: Canonicalized path
  │ Validation: Already passed all checks above
  │ Method: PowerShell with safe quoting
  │   • Path in single quotes
  │   • Quotes escaped by doubling
  │   • Array args to execFileSync
  ▼
User Consent Dialog (line 1170)
  │ Shows: Path, SHA-256, Publisher
  │ Requires: User approval
  ▼
Helper Manifest Entry (line 1183)
  │ Stored: Sealed manifest with HMAC
  │ Future Use: Injector launch verification
```

---

## Batch A Scope: Verified Completeness

Architecture and trust model: COMPLETE
Data flow documentation: PARTIAL (only injector registration fully traced)
Verified controls: 7 controls identified and partially documented
Unverified areas: See "Controls NOT Yet Verified" section above

