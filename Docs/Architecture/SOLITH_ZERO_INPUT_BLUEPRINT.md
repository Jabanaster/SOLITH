# Solith Zero-Input Architectural Blueprint

**Status:** Authorized — `OFFLINE_ONLY` + `CHARTER_THEN_PRODUCT`  
**Product UI:** Solith · **Package / repo:** Solith  
**Charter:** `AGENTS.md` → Solith Zero-Input Offline Framework  
**Safety:** `Docs/safety-architecture.md` · `Docs/IN_PROCESS_PILOT_SAFETY_CHARTER.md`

---

## 1. Architectural charter (hard constraints)

| Constraint | Rule |
|---|---|
| **OFFLINE_ONLY** | **Offline gameplay enforcement** for live memory: online-session guard is fail-closed. Remote connections above the reviewed per-game baseline → safe abort. No online/multiplayer **game** targeting. This does **not** mean the Solith app makes zero network requests (opt-in hub sync / community listing metadata / Steam CDN may exist as non-gameplay network use). |
| **User-mode only** | Memory ops via `ReadProcessMemory` / `WriteProcessMemory` / `VirtualProtectEx` only. **No kernel drivers.** |
| **No malware paths** | No remote trainer binary download/exec. No unverified code injection on the mainstream path. |
| **Transparency** | Every live memory read/write is append-logged locally. Crashes write `crash_report.txt` locally — never phone home. |
| **Save protection** | Real save writes require a verified automatic backup + restore path. No silent overwrite. |

**Out of scope:** packet capture, kernel drivers, auto-install third-party trainer `.exe`s, expanding the Crimson Desert in-process pilot without new authorization.

---

## 2. Stack reality

Solith implements the trainer core in **Electron + TypeScript**, not a greenfield C++/C# framework.

| Layer | Location |
|---|---|
| Native RPM/WPM seam | `src/core/live-memory/native-memory-driver.ts` (`MemoryDriver`) |
| Session / propose-confirm-rollback | `src/core/live-memory/live-memory-session.ts` |
| Definitions (profiles) | `src/core/definitions/schema.v1.ts` (`SolithDefinitionV1`) |
| Catalog process poll (name only) | `electron/catalog-process-watch.ts` |
| IPC | `electron/live-memory-ipc.ts` |
| Save backup (file path) | `src/core/backups/` + `src/core/safety/operations.ts` |

Zero-Input modules map the “Process Watcher / Signature Engine / Memory Manager” roles onto TypeScript facades that orchestrate the existing pieces.

---

## 3. Target folder structure

```
src/core/live-memory/
  process-watcher.ts       # detect → fingerprint → attach orchestration
  signature-engine.ts      # exact AOB + bounded fuzzy match
  memory-manager.ts        # safe-write facade over LiveMemorySession
  audit-log.ts             # local append-only memory audit
  aob-resolver.ts          # exact AOB (exists)
  pointer-resolver.ts      # pointer chains (exists)
  feature-resolver.ts      # resolve order + SessionAddressCache (exists)
  online-guard.ts          # OFFLINE_ONLY (exists)
  native-memory-driver.ts  # RPM/WPM (exists)
  live-memory-session.ts   # attach / write / freeze (exists)

src/core/crash/
  local-crash-reporter.ts  # telemetry-free crash_report.txt

src/core/definitions/
  schema.v1.ts             # profiles: signature, pointerChain, hash prefixes
  fingerprint-verify.ts    # exe hash drift (exists)
```

---

## 4. Primary modules

### 4.1 ProcessWatcher

**Role:** Identify the game, validate executable hash, load the matching profile, prepare resolution.

**Inputs:** Catalog / definition `target.executables`, optional `executableHashPrefixes` / `targetSHA256`, user offline confirmation.

**Pipeline:**

1. Observe running processes (reuses catalog process enumeration).
2. Match executable name against definition targets.
3. `verifyDefinitionFingerprint` — mismatch without drift ack → do not apply profile.
4. Evaluate `evaluateOnlineGuard` (fail-closed).
5. `loadCatalogDefinition` → `SolithDefinitionV1`.
6. Hand features to SignatureEngine / `resolveMemoryFeatureAddress`.

**Not a new OS enumerator** — orchestration over `catalog-process-watch` + attach IPC + fingerprint verify.

### 4.2 SignatureEngine

**Role:** Locate code/data patterns without manual CE scanning.

| Mode | Behavior |
|---|---|
| Exact | `parseAobSignature` + `scanAobInProcess` (`?` wildcards) |
| Fuzzy | Closest match within max Hamming distance and search window after patch drift |
| Pointer | Fallback via `resolvePointerPath` / `feature-resolver` static base + chain |

Results feed `SessionAddressCache` so activation does not re-scan every toggle.

### 4.3 MemoryManager

**Role:** Safe-write wrapper + audit.

1. Recheck online guard immediately before write.
2. Pre-read current value (state validation).
3. Write via `LiveMemorySession.proposeWrite` → `confirmWrite`.
4. Verify readback when applicable.
5. Append audit record: timestamp, featureId, address, valueType, before/after, reason.
6. Support in-session rollback via existing session manifest.

**Save-editor path** remains separate: `src/core/backups` + Restore UI. Do not conflate file backups with live-memory audit logs.

### 4.4 Update Resilience Layer (local crash reporter)

On `uncaughtException` / `unhandledRejection` (Electron main):

- Write `crash_report.txt` under Solith userData logs directory.
- Include: ISO timestamp, error message + stack, last attached PID/exe if known, last N audit lines.
- **Never** upload or open a network socket.

---

## 5. Zero-Input workflow (launch → cheats active)

```
Game process starts
  → ProcessWatcher matches executable
  → Hash prefixes validated (or drift acknowledged)
  → User offline confirm + OnlineGuard pass
  → Load SolithDefinitionV1 (AOBs + pointer chains)
  → SignatureEngine resolves each feature (exact → fuzzy → static pointer)
  → Addresses cached in SessionAddressCache
  → MemoryManager applies toggles/freezes/writes with validation + audit
  → On crash → local crash_report.txt only
```

**User scanning is not required** for verified metadata-driven features (`signature` and/or `baseOffset` + `pointerChain`).  
`scan_first` / `scan_unknown` features still use Discovery Lab / freeform tools.

---

## 6. Exists vs gaps

| Capability | Status |
|---|---|
| Offline guard + connection baselines | Exists |
| Exact AOB + pointer resolve | Exists |
| Attach-time fingerprint | Exists (manual attach) |
| Catalog name watch / toast | Exists (no auto-attach) |
| Propose/confirm/rollback session writes | Exists (not journaled) |
| Save file backup + restore | Exists |
| Fuzzy AOB | SignatureEngine |
| ProcessWatcher orchestration | process-watcher.ts |
| Live memory audit file | audit-log.ts + MemoryManager |
| Local crash_report.txt | local-crash-reporter.ts |
| Sandboxed Lua/Python trainer scripts | Later slice (no sockets, no inject) |

---

## 7. Definition contract (metadata-driven loading)

Profiles use `SolithDefinitionV1`:

- `executableHashPrefixes` / `targetSHA256` — drift detection
- `memoryFeatures[].resolution.signature` — AOB
- `memoryFeatures[].resolution.moduleName` + `baseOffset` + `pointerChain`
- `safety.requiresOfflineConfirm` / `requiresApproval`
- `certificationLevel` L0–L4 — L3+ for bundled verified cheats

Community packs remain scan-required until promoted; verified packs ship pointer/AOB metadata for zero-input apply.

---

## 8. Implementation order

1. Charter (`AGENTS.md`) — done for this milestone.
2. This blueprint + safety-architecture pointer.
3. Product gaps: SignatureEngine (fuzzy), ProcessWatcher, MemoryManager + audit-log, local crash reporter.
4. Later: sandboxed local scripting engine (no network, no inject APIs).

---

## 9. Acceptance

- Mainstream path remains OFFLINE_ONLY, user-mode RPM/WPM, no remote binary exec.
- Blueprint documents ProcessWatcher, SignatureEngine, MemoryManager, crash reporter, and launch→active flow.
- Phase 2 modules land under `src/core/live-memory/` and `src/core/crash/` with unit tests under `tests/live-memory/`.
