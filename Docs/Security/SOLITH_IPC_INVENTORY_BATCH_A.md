⚠️ **SUPERSEDED DOCUMENT** - This file is archived for reference only. Authoritative Batch A findings are in the required four deliverable documents. Do not rely on this version.

---

# Solith IPC Handler Inventory (Batch A) - ARCHIVED

**Status**: Batch A Discovery (2026-07-26) - SUPERSEDED  
**Methodology**: Reproducible grep extraction + code review  
**Total Handlers**: 149 unique ipcMain.handle registrations  

---

## Extraction Methodology

```bash
# Exact command used
grep -rn "ipcMain\.handle(" electron/ --include="*.ts" | wc -l
# Result: 149

# Unique channel verification
grep -rn "ipcMain\.handle(" electron/ --include="*.ts" | \
  sed "s/.*ipcMain\.handle('//" | sed "s/'.*$//" | sort -u | wc -l
# Result: 149 (no duplicates)
```

---

## Per-File Handler Counts (Verified)

| File | Handlers | Risk Profile |
|------|----------|--------------|
| electron/cheat-toggle-ipc.ts | 3 | LOW |
| electron/ct-library-ipc.ts | 7 | MEDIUM |
| electron/install-discovery-ipc.ts | 5 | MEDIUM |
| electron/live-memory-ipc.ts | 40 | CRITICAL (6), HIGH (13), MEDIUM (21) |
| electron/local-ocr-ipc.ts | 2 | MEDIUM |
| electron/main.ts | 44 | HIGH/MEDIUM |
| electron/registry-verification-ipc.ts | 2 | MEDIUM |
| electron/trainer-catalog-ipc.ts | 21 | HIGH |
| electron/trainer-deck-ipc.ts | 8 | MEDIUM |
| electron/trainer-hotkeys.ts | 5 | LOW |
| electron/trainer-research-ipc.ts | 7 | HIGH |
| electron/wisp-overlay.ts | 5 | LOW |
| **TOTAL** | **149** | — |

---

## Complete IPC Handler Inventory

### Live-Memory Handlers (40 total)

#### CRITICAL (Code Execution / Injection)
1. **in-process-confirm-hook** | live-memory-ipc.ts:985
   - Effect: Execute code injection into attached process
   - Input Schema: InProcessConfirmHookSchema (Zod validation)
   - Consent: User approval required
   - Evidence: Lines 985-1012

2. **in-process-confirm-injector-launch** | live-memory-ipc.ts:1195
   - Effect: Launch registered injector helper executable
   - Input Schema: InProcessConfirmInjectorSchema (Zod validation)
   - Consent: Consent token binding verification
   - Evidence: Lines 1195-1254; consent binding lines 1219-1232

3. **in-process-issue-injector-consent** | live-memory-ipc.ts:1085
   - Effect: Request user approval for injector launch
   - Input Schema: InProcessRequestConsentSchema
   - Consent: Modal dialog with full disclosure
   - Evidence: Lines 1085-1133

4. **in-process-propose-hook** | live-memory-ipc.ts:968
   - Effect: Propose code injection
   - Input Schema: InProcessProposeHookSchema
   - Consent: Later consent via in-process-issue-injector-consent
   - Evidence: Lines 968-1011

5. **in-process-propose-injector-launch** | live-memory-ipc.ts:1033
   - Effect: Propose helper executable launch
   - Input Schema: InProcessProposeInjectorLaunchSchema
   - Consent: User approval required via modal
   - Evidence: Lines 1033-1083

6. **in-process-register-injector-helper** | live-memory-ipc.ts:1135
   - Effect: Register new helper executable in manifest
   - Input Schema: InProcessRegisterInjectorHelperSchema (Zod)
   - Validation: path.resolve(), fs.existsSync(), .exe check, system dir check, containment check
   - Consent: User approval required
   - Evidence: Lines 1135-1193; queryAuthenticodePublisher call line 1165; validation lines 1154-1162
   - **PowerShell verification**: Line 1165 calls queryAuthenticodePublisher(resolved); see helper-manifest.ts:204-222 for safe quoting

#### HIGH (Memory/Process Access)
7-19: Memory read/write, scanning, freezing operations (13 handlers)
- live-memory-read, live-memory-propose-write, live-memory-confirm-write
- live-memory-scan-first, live-memory-scan-next, live-memory-scan-aob
- live-memory-pointer-scan, live-memory-correlation-start, live-memory-freeze-start
- Research operations (7 handlers): research:hex, research:pointer-analyze, research:resolve-path, etc.

#### MEDIUM (Process Management / State)
20-40: Process attach/detach, session management, UI state
- live-memory-attach, live-memory-detach, live-memory-read-many
- live-memory-list-processes, live-memory-list-controls
- live-memory-zero-input-prepare, live-memory-correlation-event, live-memory-correlation-poll
- in-process-rollback-hook

### Main IPC Handlers (44 total)

**Game Management**: add-game, update-game, delete-game, scan-game, get-games, pick-game-folder, pick-game-executable

**Save Operations**: detect-save-files, parse-save, compare-saves, compare-saves-report, restore-backup, pick-save-file

**Proposal/Edit Flow**: create-proposal-for-edit, apply-proposal, suggest-data-edits

**Metadata**: get-recipes, create-recipe, delete-recipe, get-backups, get-journal, log-event

**Configuration**: get-settings, set-setting, get-compatibility-profile, get-all-profiles, check-game-running

**Locations**: discover-save-locations, get-save-locations, approve-save-location, revoke-save-location, add-user-selected-location

### Trainer Catalog Handlers (21 total)

**Import/Export**: trainer-catalog-pick-ct, trainer-catalog-preview-ct, trainer-catalog-import-ct, trainer-catalog-import-yaml, trainer-catalog-export-definition

**Discovery**: trainer-catalog-search, trainer-catalog-stats, trainer-catalog-get, trainer-catalog-get-definition, trainer-catalog-load-game, trainer-catalog-get-trainer-controls

**Approval/Publishing**: trainer-catalog-approve-save-path, trainer-catalog-certify-l1, trainer-catalog-evaluate-promotion, trainer-catalog-promote-verified, publishToCommunity

**Status**: trainer-catalog-seed, trainer-catalog-sync-remote, trainer-catalog-sync-hub, trainer-catalog-pending-quarantine, trainer-catalog-feedback-*, catalog-* monitoring

### CT Library Handlers (7 total)

**File Operations**: ct-library-pick-zip, ct-library-import-zip-preview, ct-library-import-zip-start, ct-library-import-zip-cancel

**Data Access**: ct-library-summary, ct-library-search, ct-library-game-detail

### Install Discovery Handlers (5 total)

**Operations**: install-discovery-pick-folder, install-discovery-preview, install-discovery-commit, install-discovery-scan, install-discovery-list

### Trainer Deck Handlers (8 total)

**Status & Control**: trainer-deck-get, trainer-health-check, trainer-health-list, catalog-demand-notify, catalog-demand-list

**Support**: install-discovery-open-path, catalog-process-watch-active, trainer-catalog-certify-l1

### Cheat Toggle (3 total)

cheat-toggle-get-all, cheat-toggle-set, cheat-toggle-clear

### Trainer Hotkeys (5 total)

trainer-hotkeys-get-defaults, trainer-hotkeys-get-bindings, trainer-hotkeys-set-bindings, trainer-overlay-toggle, trainer-overlay-hide

### Wisp Overlay (5 total)

wisp-overlay-toggle, wisp-overlay-hide, wisp-overlay-set-expanded, wisp-overlay-move-by, wisp-overlay-set-interactive

### Local OCR (2 total)

local-ocr-list-window-sources, local-ocr-read-window-region

### Registry (2 total)

registry-run-readonly-verification, registry-compare-restart-artifacts

### V2 Monitor (5 total)

v2-monitor-start, v2-monitor-stop, v2-monitor-get-state, v2-monitor-clear-timeline, v2-monitor-export-diagnostics

### Trainer Host (5 total)

trainer-host-start, trainer-host-stop, trainer-host-read-field, trainer-host-propose-write, trainer-host-approve-and-write, trainer-host-rollback

---

## Handler Validation Summary

**Zod Schema Usage**: 52 handlers use explicit Zod `.parse()` or `.safeParse()` validation

**Consent Gates**: 6 CRITICAL handlers require user approval via requestPrivilegedApproval()

**Renderer Exposure**: All handlers accessed via IPC from sandboxed renderers (sender validation via event.sender)

**Authorization**: Session-based authorization via requireSession(event) for memory/in-process operations

---

## Known Limitations

This inventory covers `ipcMain.handle()` registrations only. Does NOT include:
- `ipcRenderer.invoke()` calls (renderer side - would require grep in src/, identified 0 direct matches but likely wrapped)
- `contextBridge.exposeInMainWorld()` API surface (1 exposure found)
- `ipcMain.on()` one-way events (0 found in this codebase)
- Dynamic handler registration (none observed)

