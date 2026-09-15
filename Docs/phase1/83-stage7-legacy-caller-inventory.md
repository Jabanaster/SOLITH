# Phase 1 / Stage 7 — Legacy Caller Inventory

## §7.22 — session migration boundary

No mid-session backend swap is possible or attempted: `LiveMemorySession`'s `backendRouter` is created lazily, once, per attach, and torn down in `detach()`. `setScannerRoutingMode()` changes which backend the NEXT routed call uses, but never converts an in-progress legacy scan (`memory-scanner.ts`'s functions are synchronous and atomic — there is no "in-progress" state to convert) into a native one. A new scan session (a fresh `attach()`) picks up whatever mode was last set; an existing session's non-routed operations (range scan, unknown-value scan, pointer scan) always finish under legacy, unconditionally, since they are not routed through the contract at all this stage.

## §7.23 — direct callers of the three legacy scan modules, fully inventoried

### `memory-scanner.ts` (`scanFirst`, `scanFirstRange`, `scanFirstAutoMatrix`, `scanNext`, `scanFirstUnknown`, `scanNextFromSnapshotMultiType`, `scanFirstByComparison`)

| Caller | Classification | Note |
|---|---|---|
| `src/core/live-memory/live-memory-session.ts` | **STILL_REQUIRED** (for `scanFirstAutoMatrix`/`scanNext`/`scanFirstUnknown`/`scanNextFromSnapshotMultiType`) / **MIGRATED** (`scanFirst`'s exact-value path, via `LegacyScannerBackend`) | Only the plain exact-value path is routed this stage; every other mode is genuinely still required, unconditionally |
| `src/core/live-memory/scanner-backend-legacy.ts` | **MIGRATED** (new this stage) | The adapter itself |
| `src/core/live-memory/index.ts` | **DEAD_AFTER_STAGE_7 candidate** | Re-exports `scanFirst`/`scanFirstRange`/`scanNext`, but no other file imports them via this barrel — confirmed via grep. Not deleted this stage (no evidence a hidden external consumer doesn't exist outside this repo's own source tree, e.g. a build script); flagged for verification before Stage 8 deletion |

### `native-memory-driver.ts` scan-adjacent helpers (`getRegions`, `readBuffer`, `getModules`)

Called directly (bypassing `memory-scanner.ts`) by: `aob-resolver.ts`, `signature-engine.ts`, `pointer-scanner.ts`, `pointer-resolver.ts` — all **STILL_REQUIRED**, none migrated this stage except `aob-resolver.ts`'s specific `scanAobInProcess` entry point when called via `LiveMemorySession.scanAobViaBackend`.

### `aob-resolver.ts` (`scanAobInProcess`, `parseAobSignature`, `findAobInBuffer`)

| Caller | Classification | Note |
|---|---|---|
| `src/core/live-memory/live-memory-session.ts` (`scanAobSignature`, legacy path) | **STILL_REQUIRED** as a fallback / **MIGRATED** via `scanAobViaBackend` | The legacy method itself is untouched and still callable; the production IPC channel now calls the routed method |
| `src/core/live-memory/scanner-backend-legacy.ts` | **MIGRATED** (new this stage) | The adapter |
| `src/core/live-memory/feature-resolver.ts` | **STILL_REQUIRED** | Signature-based feature resolution — not routed this stage |
| `src/core/in-process-script/hook-engine.ts` | **OTHER** | A genuinely distinct subsystem (code-injection hook targeting), not the memory-scanning feature this stage covers. Not previously listed in the Stage 7 §7.2 scanner map's original trace — found during this inventory pass. Not migrated, and not intended to be migrated as part of scanner production routing; it has its own authority model |
| `src/core/live-memory/signature-engine.ts` (imports `findAobInBuffer`/`parseAobSignature` for its own use) | **STILL_REQUIRED** | See below |

### `signature-engine.ts` (`scanExactSignature`, `scanFuzzySignature`, `resolveSignature`) — a SEPARATE AOB-shaped implementation, NOT migrated this stage

| Caller | Classification | Note |
|---|---|---|
| `src/core/process-watcher` / `src/core/live-memory/process-watcher.ts` | **STILL_REQUIRED** | |
| `src/core/runtime/address-resolver.ts` | **STILL_REQUIRED** | |

**Important scope note**: `signature-engine.ts` independently calls `driver.readBuffer` directly (not through `aob-resolver.ts`) and suffers the identical 1 MiB defect mechanism (confirmed in doc 71). Stage 7's AOB routing covers only `aob-resolver.ts`'s `scanAobInProcess` (via `LiveMemorySession.scanAobViaBackend`) — it does NOT cover `signature-engine.ts`'s independent implementation. Any future claim that "the AOB defect is closed" must account for this second, unmigrated code path; see doc 85.

### Pointer scanning (`pointer-scanner.ts`, `pointer-resolver.ts`)

All callers (`live-memory-session.ts`, `src/core/live-memory/research/pointer-candidate-analysis.ts`) are **POINTER_SPECIFIC** — explicitly and correctly out of Stage 7's scope per mission §7.14. D05 remains open, untouched.

**Zero unknown callers**: every caller of every function in the three named legacy modules was traced to a known file above; none is unaccounted for.
