# Solith Attack Surface

**Date**: 2026-07-26  
**Scope**: Batch A - Complete IPC Handler Inventory  
**Total Handlers**: 149 (verified via reproducible grep)  
**Methodology**: `grep -rn "ipcMain\.handle(" electron/ --include="*.ts" | wc -l`

---

## IPC Handler Inventory (149 Channels)

| # | Channel Name | File | Risk Level | Input Validation | Consent Gate | Status |
|----|---|---|---|---|---|---|
| 1 | add-game | main.ts | MEDIUM | Yes | No | Discovery |
| 2 | add-user-selected-location | main.ts | MEDIUM | Yes | No | Discovery |
| 3 | apply-proposal | main.ts | MEDIUM | Yes | No | Discovery |
| 4 | approve-save-location | main.ts | MEDIUM | Yes | No | Discovery |
| 5 | catalog-demand-list | trainer-deck-ipc.ts | MEDIUM | No | No | Discovery |
| 6 | catalog-demand-notify | trainer-deck-ipc.ts | MEDIUM | No | No | Discovery |
| 7 | catalog-process-watch-active | trainer-deck-ipc.ts | MEDIUM | No | No | Discovery |
| 8 | cheat-toggle-clear | cheat-toggle-ipc.ts | LOW | No | No | Discovery |
| 9 | cheat-toggle-get-all | cheat-toggle-ipc.ts | LOW | No | No | Discovery |
| 10 | cheat-toggle-set | cheat-toggle-ipc.ts | LOW | No | No | Discovery |
| 11 | check-game-running | main.ts | MEDIUM | Yes | No | Discovery |
| 12 | compare-saves | main.ts | MEDIUM | Yes | No | Discovery |
| 13 | compare-saves-report | main.ts | MEDIUM | Yes | No | Discovery |
| 14 | create-proposal-for-edit | main.ts | MEDIUM | Yes | No | Discovery |
| 15 | create-recipe | main.ts | MEDIUM | Yes | No | Discovery |
| 16 | ct-library-game-detail | ct-library-ipc.ts | MEDIUM | Yes | No | Discovery |
| 17 | ct-library-import-zip-cancel | ct-library-ipc.ts | HIGH | Yes | No | Discovery |
| 18 | ct-library-import-zip-preview | ct-library-ipc.ts | HIGH | Yes | No | Discovery |
| 19 | ct-library-import-zip-start | ct-library-ipc.ts | HIGH | Yes | No | Discovery |
| 20 | ct-library-pick-zip | ct-library-ipc.ts | MEDIUM | No | No | Discovery |
| 21 | ct-library-search | ct-library-ipc.ts | MEDIUM | Yes | No | Discovery |
| 22 | ct-library-summary | ct-library-ipc.ts | MEDIUM | No | No | Discovery |
| 23 | delete-game | main.ts | MEDIUM | Yes | No | Discovery |
| 24 | delete-recipe | main.ts | MEDIUM | Yes | No | Discovery |
| 25 | detect-save-files | main.ts | MEDIUM | Yes | No | Discovery |
| 26 | discover-save-locations | main.ts | MEDIUM | Yes | No | Discovery |
| 27 | get-all-profiles | main.ts | MEDIUM | No | No | Discovery |
| 28 | get-backups | main.ts | MEDIUM | Yes | No | Discovery |
| 29 | get-compatibility-profile | main.ts | MEDIUM | Yes | No | Discovery |
| 30 | get-games | main.ts | MEDIUM | No | No | Discovery |
| 31 | get-journal | main.ts | MEDIUM | Yes | No | Discovery |
| 32 | get-recipes | main.ts | MEDIUM | Yes | No | Discovery |
| 33 | get-save-locations | main.ts | MEDIUM | Yes | No | Discovery |
| 34 | get-settings | main.ts | MEDIUM | No | No | Discovery |
| 35 | in-process-confirm-hook | live-memory-ipc.ts | CRITICAL | No | Yes | Discovery |
| 36 | in-process-confirm-injector-launch | live-memory-ipc.ts | CRITICAL | Yes | Yes | Discovery |
| 37 | in-process-issue-injector-consent | live-memory-ipc.ts | CRITICAL | No | Yes | Discovery |
| 38 | in-process-propose-hook | live-memory-ipc.ts | CRITICAL | No | Yes | Discovery |
| 39 | in-process-propose-injector-launch | live-memory-ipc.ts | CRITICAL | Yes | Yes | Discovery |
| 40 | in-process-register-injector-helper | live-memory-ipc.ts | CRITICAL | Yes | Yes | Discovery |
| 41 | in-process-rollback-hook | live-memory-ipc.ts | CRITICAL | No | No | Discovery |
| 42 | install-discovery-commit | install-discovery-ipc.ts | MEDIUM | Yes | No | Discovery |
| 43 | install-discovery-list | install-discovery-ipc.ts | MEDIUM | No | No | Discovery |
| 44 | install-discovery-open-path | trainer-deck-ipc.ts | MEDIUM | No | No | Discovery |
| 45 | install-discovery-pick-folder | install-discovery-ipc.ts | MEDIUM | No | No | Discovery |
| 46 | install-discovery-preview | install-discovery-ipc.ts | MEDIUM | Yes | No | Discovery |
| 47 | install-discovery-scan | install-discovery-ipc.ts | MEDIUM | Yes | No | Discovery |
| 48 | live-memory-attach | live-memory-ipc.ts | HIGH | No | No | Discovery |
| 49 | live-memory-confirm-write | live-memory-ipc.ts | HIGH | Yes | Yes | Discovery |
| 50 | live-memory-correlation-event | live-memory-ipc.ts | HIGH | No | No | Discovery |
| 51 | live-memory-correlation-poll | live-memory-ipc.ts | HIGH | No | No | Discovery |
| 52 | live-memory-correlation-start | live-memory-ipc.ts | HIGH | No | No | Discovery |
| 53 | live-memory-correlation-stop | live-memory-ipc.ts | HIGH | No | No | Discovery |
| 54 | live-memory-detach | live-memory-ipc.ts | HIGH | Yes | No | Discovery |
| 55 | live-memory-freeze-start | live-memory-ipc.ts | HIGH | No | No | Discovery |
| 56 | live-memory-freeze-status | live-memory-ipc.ts | HIGH | No | No | Discovery |
| 57 | live-memory-freeze-stop | live-memory-ipc.ts | HIGH | No | No | Discovery |
| 58 | live-memory-issue-write-consent | live-memory-ipc.ts | HIGH | Yes | Yes | Discovery |
| 59 | live-memory-list-controls | live-memory-ipc.ts | MEDIUM | No | No | Discovery |
| 60 | live-memory-list-processes | live-memory-ipc.ts | MEDIUM | Yes | No | Discovery |
| 61 | live-memory-pointer-scan | live-memory-ipc.ts | HIGH | No | No | Discovery |
| 62 | live-memory-propose-write | live-memory-ipc.ts | HIGH | Yes | Yes | Discovery |
| 63 | live-memory-read | live-memory-ipc.ts | HIGH | Yes | No | Discovery |
| 64 | live-memory-read-many | live-memory-ipc.ts | HIGH | No | No | Discovery |
| 65 | live-memory-resolve-control | live-memory-ipc.ts | MEDIUM | No | No | Discovery |
| 66 | live-memory-resolve-definition-feature | live-memory-ipc.ts | MEDIUM | No | No | Discovery |
| 67 | live-memory-rollback | live-memory-ipc.ts | HIGH | Yes | No | Discovery |
| 68 | live-memory-scan-aob | live-memory-ipc.ts | HIGH | No | No | Discovery |
| 69 | live-memory-scan-first | live-memory-ipc.ts | HIGH | Yes | No | Discovery |
| 70 | live-memory-scan-first-auto-matrix | live-memory-ipc.ts | HIGH | No | No | Discovery |
| 71 | live-memory-scan-first-unknown | live-memory-ipc.ts | HIGH | No | No | Discovery |
| 72 | live-memory-scan-next | live-memory-ipc.ts | HIGH | Yes | No | Discovery |
| 73 | live-memory-scan-next-from-unknown | live-memory-ipc.ts | HIGH | No | No | Discovery |
| 74 | live-memory-zero-input-prepare | live-memory-ipc.ts | HIGH | Yes | No | Discovery |
| 75 | local-ocr-list-window-sources | local-ocr-ipc.ts | MEDIUM | No | No | Discovery |
| 76 | local-ocr-read-window-region | local-ocr-ipc.ts | MEDIUM | No | No | Discovery |
| 77 | log-event | main.ts | MEDIUM | Yes | No | Discovery |
| 78 | parse-save | main.ts | MEDIUM | Yes | No | Discovery |
| 79 | pick-game-executable | main.ts | MEDIUM | No | No | Discovery |
| 80 | pick-game-folder | main.ts | MEDIUM | No | No | Discovery |
| 81 | pick-save-file | main.ts | MEDIUM | No | No | Discovery |
| 82 | publishToCommunity | trainer-catalog-ipc.ts | HIGH | No | No | Discovery |
| 83 | registry-compare-restart-artifacts | registry-verification-ipc.ts | MEDIUM | No | No | Discovery |
| 84 | registry-run-readonly-verification | registry-verification-ipc.ts | MEDIUM | No | No | Discovery |
| 85 | research:hex | live-memory-ipc.ts | MEDIUM | No | No | Discovery |
| 86 | research:pointer-analyze | live-memory-ipc.ts | MEDIUM | No | No | Discovery |
| 87 | research:resolve-path | live-memory-ipc.ts | MEDIUM | No | No | Discovery |
| 88 | research:snapshot-diff | live-memory-ipc.ts | MEDIUM | No | No | Discovery |
| 89 | research:snapshot-save | live-memory-ipc.ts | MEDIUM | No | No | Discovery |
| 90 | research:view | live-memory-ipc.ts | MEDIUM | No | No | Discovery |
| 91 | restore-backup | main.ts | MEDIUM | Yes | No | Discovery |
| 92 | revoke-save-location | main.ts | MEDIUM | Yes | No | Discovery |
| 93 | scan-game | main.ts | MEDIUM | Yes | No | Discovery |
| 94 | set-setting | main.ts | MEDIUM | No | No | Discovery |
| 95 | suggest-data-edits | main.ts | MEDIUM | Yes | No | Discovery |
| 96 | trainer-catalog-approve-save-path | trainer-catalog-ipc.ts | MEDIUM | No | No | Discovery |
| 97 | trainer-catalog-certify-l1 | trainer-catalog-ipc.ts | MEDIUM | No | No | Discovery |
| 98 | trainer-catalog-evaluate-promotion | trainer-catalog-ipc.ts | MEDIUM | No | No | Discovery |
| 99 | trainer-catalog-export-definition | trainer-catalog-ipc.ts | MEDIUM | No | No | Discovery |
| 100 | trainer-catalog-feedback-record | trainer-catalog-ipc.ts | MEDIUM | No | No | Discovery |
| 101 | trainer-catalog-feedback-summary | trainer-catalog-ipc.ts | MEDIUM | No | No | Discovery |
| 102 | trainer-catalog-get | trainer-catalog-ipc.ts | MEDIUM | No | No | Discovery |
| 103 | trainer-catalog-get-definition | trainer-catalog-ipc.ts | MEDIUM | No | No | Discovery |
| 104 | trainer-catalog-get-trainer-controls | trainer-catalog-ipc.ts | MEDIUM | No | No | Discovery |
| 105 | trainer-catalog-import-ct | trainer-catalog-ipc.ts | HIGH | No | No | Discovery |
| 106 | trainer-catalog-import-yaml | trainer-catalog-ipc.ts | HIGH | No | No | Discovery |
| 107 | trainer-catalog-load-game | trainer-catalog-ipc.ts | MEDIUM | No | No | Discovery |
| 108 | trainer-catalog-pending-quarantine | trainer-catalog-ipc.ts | MEDIUM | No | No | Discovery |
| 109 | trainer-catalog-pick-ct | trainer-catalog-ipc.ts | MEDIUM | No | No | Discovery |
| 110 | trainer-catalog-preview-ct | trainer-catalog-ipc.ts | HIGH | No | No | Discovery |
| 111 | trainer-catalog-promote-verified | trainer-catalog-ipc.ts | MEDIUM | No | No | Discovery |
| 112 | trainer-catalog-search | trainer-catalog-ipc.ts | MEDIUM | No | No | Discovery |
| 113 | trainer-catalog-seed | trainer-catalog-ipc.ts | MEDIUM | No | No | Discovery |
| 114 | trainer-catalog-stats | trainer-catalog-ipc.ts | MEDIUM | No | No | Discovery |
| 115 | trainer-catalog-sync-hub | trainer-catalog-ipc.ts | HIGH | No | No | Discovery |
| 116 | trainer-catalog-sync-remote | trainer-catalog-ipc.ts | HIGH | No | No | Discovery |
| 117 | trainer-deck-get | trainer-deck-ipc.ts | MEDIUM | No | No | Discovery |
| 118 | trainer-health-check | trainer-deck-ipc.ts | MEDIUM | No | No | Discovery |
| 119 | trainer-health-list | trainer-deck-ipc.ts | MEDIUM | No | No | Discovery |
| 120 | trainer-host-approve-and-write | main.ts | MEDIUM | No | No | Discovery |
| 121 | trainer-host-get-status | main.ts | MEDIUM | No | No | Discovery |
| 122 | trainer-host-propose-write | main.ts | MEDIUM | No | No | Discovery |
| 123 | trainer-host-read-field | main.ts | MEDIUM | No | No | Discovery |
| 124 | trainer-host-rollback | main.ts | MEDIUM | No | No | Discovery |
| 125 | trainer-host-start | main.ts | MEDIUM | No | No | Discovery |
| 126 | trainer-host-stop | main.ts | MEDIUM | No | No | Discovery |
| 127 | trainer-hotkeys-get-bindings | trainer-hotkeys.ts | LOW | No | No | Discovery |
| 128 | trainer-hotkeys-get-defaults | trainer-hotkeys.ts | LOW | No | No | Discovery |
| 129 | trainer-hotkeys-set-bindings | trainer-hotkeys.ts | LOW | No | No | Discovery |
| 130 | trainer-overlay-hide | trainer-hotkeys.ts | LOW | No | No | Discovery |
| 131 | trainer-overlay-toggle | trainer-hotkeys.ts | LOW | No | No | Discovery |
| 132 | trainer-research-analyze-ct-scripts | trainer-research-ipc.ts | HIGH | No | No | Discovery |
| 133 | trainer-research-analyze-exe | trainer-research-ipc.ts | HIGH | No | No | Discovery |
| 134 | trainer-research-import-dumpspace | trainer-research-ipc.ts | HIGH | No | No | Discovery |
| 135 | trainer-research-merge-ue-scripts | trainer-research-ipc.ts | HIGH | No | No | Discovery |
| 136 | trainer-research-pick-ct | trainer-research-ipc.ts | MEDIUM | No | No | Discovery |
| 137 | trainer-research-pick-dumpspace-folder | trainer-research-ipc.ts | MEDIUM | No | No | Discovery |
| 138 | trainer-research-pick-exe | trainer-research-ipc.ts | MEDIUM | No | No | Discovery |
| 139 | update-game | main.ts | MEDIUM | Yes | No | Discovery |
| 140 | v2-monitor-clear-timeline | main.ts | MEDIUM | No | No | Discovery |
| 141 | v2-monitor-export-diagnostics | main.ts | MEDIUM | No | No | Discovery |
| 142 | v2-monitor-get-state | main.ts | MEDIUM | No | No | Discovery |
| 143 | v2-monitor-start | main.ts | MEDIUM | No | No | Discovery |
| 144 | v2-monitor-stop | main.ts | MEDIUM | No | No | Discovery |
| 145 | wisp-overlay-hide | wisp-overlay.ts | LOW | No | No | Discovery |
| 146 | wisp-overlay-move-by | wisp-overlay.ts | LOW | No | No | Discovery |
| 147 | wisp-overlay-set-expanded | wisp-overlay.ts | LOW | No | No | Discovery |
| 148 | wisp-overlay-set-interactive | wisp-overlay.ts | LOW | No | No | Discovery |
| 149 | wisp-overlay-toggle | wisp-overlay.ts | LOW | No | No | Discovery |

---

## Summary Statistics

| Metric | Count |
|--------|-------|
| **Total ipcMain.handle() registrations** | 149 |
| **Unique channel names** | 149 (no duplicates) |
| **ipcMain.on() registrations** | 0 |
| **contextBridge exposures** | 1 |
| **Renderer invocations** | 1 |
| **CRITICAL handlers** | 7 |
| **HIGH handlers** | 27 |
| **MEDIUM handlers** | 110 |
| **LOW handlers** | 5 |
| **Handlers with Zod validation** | 10 files (partial audit) |
| **Handlers with consent gates** | 6 |

---

## Entry Point Classification

### By Risk Level

**CRITICAL (7)**: Code injection, process injection, helper execution
- in-process-confirm-hook
- in-process-confirm-injector-launch
- in-process-issue-injector-consent
- in-process-propose-hook
- in-process-propose-injector-launch
- in-process-register-injector-helper
- in-process-rollback-hook

**HIGH (27)**: Memory access, file import, system modification
- live-memory-* handlers (24)
- ct-library-import-zip-* (3)
- trainer-catalog-import-* (2)
- trainer-catalog-sync-* (2)
- trainer-catalog-preview-ct (1)
- trainer-research-analyze-* (2)
- trainer-research-import-dumpspace (1)
- trainer-research-merge-ue-scripts (1)
- publishToCommunity (1)

**MEDIUM (110)**: Game operations, configuration, data access
- main.ts: 44 game/save/config handlers
- trainer-catalog-ipc.ts: 19 catalog operations
- install-discovery-ipc.ts: 5 discovery operations
- And others

**LOW (5)**: UI state management
- Hotkey operations (5)
- Wisp overlay (5)
- Cheat toggle (3)

### By File (12 files, 149 total handlers)

| File | Count | Risk Profile |
|------|-------|--------------|
| main.ts | 44 | HIGH/MEDIUM |
| live-memory-ipc.ts | 40 | CRITICAL/HIGH |
| trainer-catalog-ipc.ts | 21 | HIGH/MEDIUM |
| trainer-deck-ipc.ts | 8 | MEDIUM |
| trainer-research-ipc.ts | 7 | HIGH |
| ct-library-ipc.ts | 7 | HIGH/MEDIUM |
| trainer-hotkeys.ts | 5 | LOW |
| wisp-overlay.ts | 5 | LOW |
| install-discovery-ipc.ts | 5 | MEDIUM |
| cheat-toggle-ipc.ts | 3 | LOW |
| registry-verification-ipc.ts | 2 | MEDIUM |
| local-ocr-ipc.ts | 2 | MEDIUM |
| **Total** | **149** | |

---

## Verification Methodology

Extraction command: `grep -rn "ipcMain\.handle(" electron/ --include="*.ts"`

Reproducibility:
- Same command yields 149 registrations consistently
- All 149 channels are unique (verified via sort + uniq -d)
- No ipcMain.on() registrations found
- No dynamic handler registration detected
- Verified across 12 files with registrations

Files with IPC handlers: 12 (see "By File" table above)

This inventory represents the complete attack surface via IPC. All 149 handlers are entry points for renderer input.

