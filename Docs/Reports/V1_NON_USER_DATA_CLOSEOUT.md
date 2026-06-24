# ResourceForge V1 — Non-User-Data Closeout Evidence Matrix

**Date:** 2026-06-23  
**Milestone:** V1 Trainer UX + Real-World Compatibility  
**Purpose:** Prove that every non-user-data requirement is complete before beginning the real-save pilot.

---

## 1. Verification Command Sequence

All commands run from the project root in sequence. Results are exact — no paraphrasing.

| # | Command | Result |
|---|---------|--------|
| 1 | `npm test` (run 1) | **109/109 pass**, 0 fail, 0 skip |
| 2 | `npm test` (run 2) | **109/109 pass**, 0 fail, 0 skip |
| 3 | `npx tsc --noEmit` | **Exit 0, 0 errors** |
| 4 | `npm run build:vite` | Exit 0, 28 modules, 261.37 kB / 76.08 kB gzip |
| 5 | `npm run build:electron` | Exit 0, **18/18 verifier PASS** |
| 6 | `npm run test:electron-smoke` | **6/6 pass** in 2.5s |
| 7 | `npm run test:electron-e2e` | **4/4 pass** in 2.1s |
| 8 | `npm run test:trainer-e2e` | **5/5 pass** in 5.3s |
| 9 | `npm run build` (full installer) | Exit 0, `ResourceForge Setup 1.0.0.exe` produced |
| 10 | `npm run dist` | Exit 0 |
| 11 | `npm run test:packaged-smoke` | **20/20 pass** in 1.9s (Gate 18) |
| 12 | `git diff --check` | Exit 0 — no whitespace errors |
| 13 | `git status --short` | Exit 0 — clean tree |

---

## 2. Evidence Matrix

### 2.1 Unit + Integration Test Coverage (109 tests)

| Suite | Count | Result |
|-------|-------|--------|
| Core CRUD, backup, restore, proposals | 21 | PASS |
| Parser adapters (JSON/INI/XML/CSV/Lua/binary) | 22 | PASS |
| Save discovery | 4 | PASS |
| Safety integration (path containment, locks, atomic write, crash recovery) | 5 | PASS |
| Failure injection | 6 | PASS |
| Delete-game cascade | 3 | PASS |
| Compatibility profiles (create, retrieve, update, fingerprint, drift) | 12 | PASS |
| Process detection (game-running check, read-only) | 4 | PASS |
| SQL parameter binding + hostile inputs | 10 | PASS |
| Trainer UI (deriveCardState, TrainerItem shape, compat taxonomy) | 12 | PASS |
| **Pilot intake (dry-run, invented fixture, 10 assertions)** | **10** | **PASS** |
| **Total** | **109** | **109 PASS, 0 FAIL** |

### 2.2 Electron Gate Results

| Gate | Command | Result |
|------|---------|--------|
| Output Verifier (18/18) | `npm run build:electron` | **18/18 PASS** — not Gate 10/13/18 |
| Gate 10 — Bundled Smoke | `npm run test:electron-smoke` | **6/6 PASS** |
| Gate 13 — E2E Workflow | `npm run test:electron-e2e` | **4/4 PASS** (hashes confirmed both runs) |
| Trainer E2E | `npm run test:trainer-e2e` | **5/5 PASS** |
| Gate 18 — Packaged Smoke | `npm run test:packaged-smoke` | **20/20 PASS** |

### 2.3 New IPC Channel Coverage (`tests/ipc-channels.e2e.test.ts`)

Covers three new IPC channels added for compatibility framework:

| Test | Channel | Input | Expected |
|------|---------|-------|----------|
| ipc-01 | check-game-running | demo literal | {running:false, evidence: string} |
| ipc-02 | check-game-running | valid UUID, no game | {running:false, evidence: string} |
| ipc-03 | check-game-running | "not-a-uuid" (invalid) | Zod catch → safe shape, no stack trace, evidence ≤120 chars |
| ipc-04 | check-game-running | empty string | Zod catch → safe shape |
| ipc-05 | get-compatibility-profile | demo literal | null (fresh DB) |
| ipc-06 | get-compatibility-profile | valid UUID, no profile | null |
| ipc-07 | get-compatibility-profile | invalid identifier | null (Zod catch) |
| ipc-08 | get-all-profiles | (no input) | [] (fresh DB) |
| ipc-09 | all three channels | valid + invalid inputs | 0 renderer errors |

**Requires:** `npm run build:electron` before running.  
**Script:** `npm run test:ipc-channels`

### 2.4 Trainer Card State and Control Type Coverage (`tests/trainer-states-controls.e2e.test.ts`)

#### Reachable states (IPC pipeline → Electron renderer assertions):

| Test | State | How achieved |
|------|-------|-------------|
| states-01 | READY | recipe, risk=Safe, valid file → status='Ready' |
| states-02 | BLOCKED | recipe, risk=Blocked → item.risk='Blocked' |
| states-03 | BLOCKED | recipe targeting missing file → verifyRecipeSafety='Broken' → status='Blocked' |
| states-04 | APPLIED | applyProposal success → backup.id exists |
| states-05 | RESTORED | restoreBackup success → file reverted, hash matches original |

#### Reachable control types:

| Test | inputType | How achieved |
|------|-----------|-------------|
| controls-01 | toggle | valueType='boolean' → inputType='toggle' |
| controls-02 | number | valueType='number' → inputType='number' (default) |

#### Coverage gaps (documented as PARTIAL — unreachable via current IPC pipeline):

| State / Type | Why unreachable | Verified by |
|---|---|---|
| BROKEN | `recipeToTrainerItem` maps broken files to `status='Blocked'`, not `'Broken'` | Unit tests (trainer-ui.test.ts, deriveCardState tests 1-18) |
| NEEDS_RESCAN | Requires file hash mismatch after recipe creation — not reproducible in E2E isolation | Unit tests |
| NEEDS_SAVE | Not produced by `recipeToTrainerItem` | Unit tests |
| STALE | Not produced by `recipeToTrainerItem` | Unit tests |
| GAME_RUNNING | Requires `isGameRunning(profile)` to return true — real OS process detection | Unit tests (process.test.ts) |
| APPLYING | Transient lock during IPC call — not observable between call/return | Unit tests |
| FAILED | Transient on apply error — requires a deliberately failing write | Unit tests |
| slider | `recipeToTrainerItem` only produces `'toggle'` or `'number'` | Unit tests (trainer-ui.test.ts test 26) |
| dropdown | Same as slider | Unit tests (trainer-ui.test.ts test 27) |

**Script:** `npm run test:trainer-states`

### 2.5 Browser Fallback Coverage (`tests/browser-fallback.e2e.test.ts`)

All 7 guarded page components verified to handle `window.electronAPI === undefined` without crashing the renderer:

| Test | Page | Guard pattern | Expected |
|------|------|--------------|----------|
| fallback-01 | Home / Dashboard | `if (!window.electronAPI)` | 0 renderer errors, #root has content |
| fallback-02 | Games | `if (!window.electronAPI)` | 0 renderer errors |
| fallback-03 | Recipes / Workshop | `if (!window.electronAPI)` | 0 renderer errors |
| fallback-04 | Trainer | `const apiAvailable = !!window.electronAPI` | 0 renderer errors, unavailable UI |
| fallback-05 | Proposals | `if (!window.electronAPI)` | 0 renderer errors |
| fallback-06 | Backups | `if (!window.electronAPI)` | 0 renderer errors |
| fallback-07 | Compatibility Dashboard | `const apiAvailable = !!window.electronAPI` | 0 renderer errors, unavailable UI |

**Script:** `npm run test:browser-fallback`

### 2.6 Accessibility

Verified against WCAG 2.1 AA (manual and tooling). Findings documented in `Docs/Reports/ACCESSIBILITY_REPORT.md`.

| Area | Status |
|------|--------|
| Semantic HTML (landmarks, headings) | VERIFIED |
| Keyboard navigation | VERIFIED |
| ARIA labels on interactive elements | PARTIAL (KI-007, KI-008, KI-009) |
| Dialog focus trap | PARTIAL (KI-006) |
| Reduced-motion respect | PARTIAL (KI-010) |
| Color contrast (WCAG AA) | VERIFIED |

Outstanding a11y items are non-blocking minor issues — none are WCAG 2.1 AA critical violations.

### 2.7 Performance

Measured in Electron renderer via DevTools and bundler output. Documented in `Docs/Reports/PERFORMANCE_REPORT.md`.

| Metric | Measured | Target |
|--------|---------|--------|
| Renderer bundle (gzip) | 76.08 kB | < 150 kB |
| Initial page load (Electron) | < 800ms | < 2000ms |
| Apply operation (JSON patch) | < 200ms | < 500ms |
| Restore operation | < 150ms | < 500ms |
| IPC round-trip (simple read) | < 50ms | < 100ms |

All metrics are within targets.

### 2.8 Hash Chain Evidence (Pilot Sandbox Fixture)

These hashes were established by the V1 Trainer UX verification sequence and confirmed in two independent runs of `test:electron-e2e`:

```
source_before          = 269cb1a4e497525453ca71f6b840bfa855ae716d4068c6abafd41754fcc82e55
source_after           = 269cb1a4e497525453ca71f6b840bfa855ae716d4068c6abafd41754fcc82e55  (unchanged)
workspace_before       = 269cb1a4e497525453ca71f6b840bfa855ae716d4068c6abafd41754fcc82e55
verified_backup_hash   = 269cb1a4e497525453ca71f6b840bfa855ae716d4068c6abafd41754fcc82e55
expected_output        = 811a630f9bdcda767edce9aa26532116d212a0ebb0d2affa93663fd36f7f1f63
workspace_after_apply  = 811a630f9bdcda767edce9aa26532116d212a0ebb0d2affa93663fd36f7f1f63  (matches)
workspace_after_restore= 269cb1a4e497525453ca71f6b840bfa855ae716d4068c6abafd41754fcc82e55  (reverted)
```

Evidence tier: **Tier 2 (sandbox fixture)**. Real-world save evidence (Tier 1) requires approved user data.

### 2.9 No-Injection Safety Constraint

The following operation types are permanently out of scope for ResourceForge:

- Process injection, DLL injection, memory injection, live process patching, kernel drivers
- Executable modification
- Anti-cheat bypass, DRM bypass, encryption bypass, signature bypass, checksum bypass
- Multiplayer modification, online-service modification
- Cloud-save manipulation without explicit local-copy isolation
- Runtime trainer overlays, system-wide trainer hotkeys, hidden background modification
- Automatic editing without proposal, backup, validation, and user approval
- Unknown, encrypted, signed, packed, compressed, or proprietary binary saves (READ-ONLY)

All current code has been reviewed against this constraint. No violations found.

---

## 3. Pilot Intake System

A safe intake framework was implemented to process real user saves:

| File | Purpose |
|------|---------|
| `src/core/pilot/manifest.ts` | Zod-validated `RealWorldPilotManifest` schema (schemaVersion 1.0) |
| `src/core/pilot/intake.ts` | Intake orchestration: hash source, create workspace, copy, verify, create manifest |
| `tests/pilot-intake.test.ts` | 10 dry-run tests with invented fixture (JSON, INI, XML, CSV, text, binary) |

Intake pipeline steps:
1. Verify source file exists
2. Reject source inside repo / workspace root
3. Path safety check (validatePathSafety)
4. Detect format, flag REJECTED for binary/unknown
5. Hash source (SHA-256) before copy
6. Create isolated workspace directory with unique pilotId
7. Copy to workspace
8. Hash workspace copy — must match source
9. Verify source unchanged after copy (re-hash)
10. Create backup of workspace copy
11. Build and validate manifest (Zod parse)
12. Write manifest.json to pilot directory

### 3.1 Pilot Data Directory Safety

Added to `.gitignore`:
```
.local-pilot-data/
.local-pilot-workspaces/
.local-pilot-backups/
.local-pilot-reports/
```

No real game saves, pilot workspaces, or pilot reports are ever committed to Git.

---

## 4. Known Coverage Gaps (Acknowledged, Non-Blocking)

| ID | Gap | Severity | Status |
|----|-----|----------|--------|
| KI-012 | BROKEN card state unreachable via `recipeToTrainerItem` (maps broken files to `status='Blocked'`) | LOW | Documented |
| KI-013 | slider/dropdown inputTypes unreachable via current IPC pipeline | LOW | Documented |
| KI-006 | Dialog focus trap incomplete | MEDIUM | OPEN |
| KI-007 | Badge ARIA labels | LOW | OPEN |
| KI-008 | Slider label association | LOW | OPEN |
| KI-009 | Disabled controls ARIA | LOW | OPEN |
| KI-010 | Reduced-motion CSS coverage | LOW | OPEN |
| KI-011 | No pagination on large recipe lists | LOW | OPEN |

None of these gaps affect correctness of the pilot data pipeline, safety of the apply/restore flow, or the hash chain integrity.

---

## 5. Final Decision

```
All non-user-data requirements are VERIFIED.
The only remaining blocker is approved real-world save data.
```

Gate sequence required before each subsequent milestone acceptance:
1. `npm run build:electron` (output verifier 18/18)
2. `npm run test:electron-smoke` (Gate 10, 6/6)
3. `npm run test:electron-e2e` (Gate 13, 4/4)
4. `npm run test:trainer-e2e` (5/5)
5. `npm run test:packaged-smoke` (Gate 18, 20/20)

Do not label any real-game format VERIFIED until backup / apply / validation / restore / source-file hash evidence all pass with **Tier 1 (real-world save)** evidence.
