# Milestone L — Research Lab Acceptance

**Milestone ID:** `milestone-l-research-lab`  
**Status:** Accepted locally (commit on `master`; tag with `TAG IT` when ready)  
**Date:** 2026-07-13  
**Prior accepted baseline:** Milestone J — `v1-milestone-j-control-workflow-accepted` @ `c4d7c79a84c5d5e36ff850920bac7e057b2dbec9`

---

## Purpose

Milestone L packages the **External Trainer Research Lab** — a read-only and diff-based workflow for turning community cheat tables, UEDumper exports, and user-supplied trainer binaries into **research-grade** `schema.v1` / Trainer Library entries **without** executing third-party trainers or auto-converting AssemblerScript into in-process hooks.

**Explicitly deferred to a separate milestone:** In-Process Script Execution pilot (code caves, hook install, trainer spawn). That code must not ship under this milestone tag.

---

## Accepted Workflows

### 1. PE analysis (trainer metadata)

| Item | Detail |
|------|--------|
| UI | Trainer Research Lab → Step 1 “Pick trainer .exe” |
| IPC | `trainer-research-pick-exe`, `trainer-research-analyze-exe` |
| Module | `src/core/trainer-research/pe-analyzer.ts` |
| Behavior | Reads PE headers, SHA-256, sections, interesting strings |
| Safety | **Never executes** the trainer binary |

### 2. Memory diffing (game process)

| Item | Detail |
|------|--------|
| UI | Steps 2–5: attach game → baseline → toggle external cheat → diff → export |
| IPC | `live-memory-*` scan unknown + attach (existing V2 live memory) |
| Module | `src/core/trainer-research/` (`ct-export`, `schema-draft`) |
| Behavior | User runs trainer/CE externally; Solith diffs **game** memory only |
| Export | `.CT` (pointer entries), `schema.v1` JSON, optional library import |
| Schema types | `scan_unknown`, `freeze`, `write_once` per candidate |

### 3. Script Research Analyzer

| Item | Detail |
|------|--------|
| UI | “Script Research Analyzer” panel |
| IPC | `trainer-research-pick-ct`, `trainer-research-analyze-ct-scripts` |
| Module | `src/core/script-research/` |
| Parses | `AssemblerScript` / `AutoAssemblerScript`: AOB, symbols, memory operands |
| Does **not** | Execute scripts, inject hooks, or auto-compile AA |
| Replication | Workflow steps: CE toggle → memory diff → pointer scan → schema.v1 |
| CT import | `import-definition-ct.ts` attaches script research notes to catalog packs |

### 4. UEDumper Dumpspace import

| Item | Detail |
|------|--------|
| UI | “UEDumper Dumpspace import” panel |
| IPC | `trainer-research-pick-dumpspace-folder`, `trainer-research-import-dumpspace`, `trainer-research-merge-ue-scripts` |
| Module | `src/core/ue-research/` |
| Input | `OffsetsInfo.json`, `ClassesInfo.json`, `StructsInfo.json` from external UEDumper run |
| Output | L0 `schema.v1` research features + catalog entry |
| Does **not** | Bundle UEDumper binary, kernel driver paths, or live UObject editor |
| Merge | Cross-links UE struct members with script analyzer cheat names |

### 5. Read-only AOB scan (Script Research helper)

| Item | Detail |
|------|--------|
| IPC | `live-memory-scan-aob` |
| Module | `live-memory-session.scanAobSignature`, `aob-resolver` |
| Behavior | Locates pattern in attached process — **reference only**, no patch |

---

## Key Paths

```
src/core/trainer-research/          PE analyzer, CT export, schema draft
src/core/script-research/           AA script analyzer, CT script research
src/core/ue-research/               Dumpspace import, UE/script merge
src/core/definitions/ct-metadata.ts Metadata import for script-heavy CTs
src/app/pages/ExternalTrainerResearchLab.tsx
electron/trainer-research-ipc.ts
fixtures/community-ct/CrimsonDesert.CT
fixtures/ue-dumpspace-minimal/
scripts/inspect-ct.mjs
```

---

## Safety Charter (Milestone L)

**Allowed**

- Read-only PE analysis of user-supplied `.exe`
- Attach to **game** process with offline confirmation + online guard
- Memory diff while user toggles cheats in external CE/trainer
- Parse AssemblerScript for patterns/symbols (no execution)
- Import UEDumper JSON exports
- Export/import research drafts to Trainer Library (L0 / community)

**Forbidden under L**

- In-process hook install / code-cave emulation
- Launching third-party injectors from Solith (deferred milestone)
- Auto-converting all AA scripts to executable hooks
- Bundling UEDumper or FLiNG binaries
- Online/multiplayer cheating, anti-cheat bypass, kernel drivers

---

## Verification Gates (run before tag)

```powershell
cd "G:\ACTIVE_PROJECTS\SOLITH"
npx tsc --noEmit
npx tsx --test tests/trainer-research.test.ts
npx tsx --test tests/script-research.test.ts
npx tsx --test tests/ue-dumpspace-import.test.ts
npx tsx --test tests/ct-metadata.test.ts
```

**Expected (2026-07-13):**

| Gate | Result |
|------|--------|
| `trainer-research.test.ts` | 6/6 pass |
| `script-research.test.ts` | 6/6 pass |
| `ue-dumpspace-import.test.ts` | 5/5 pass |
| `ct-metadata.test.ts` | 2/2 pass |

---

## Fixtures

| Fixture | Use |
|---------|-----|
| `fixtures/community-ct/CrimsonDesert.CT` | Script-heavy CT (OpenCheatTables); metadata + AA analysis |
| `fixtures/ue-dumpspace-minimal/` | Unit tests for Dumpspace JSON parser |

---

## Navigation

- **Specialized → Trainer Research Lab** (`trainer-research` view in `App.tsx`)

---

## Explicit Non-Scope (unchanged from Milestone J)

- Accepted Stardew save-field controls remain the only **production-accepted** executable save writes (4 controls)
- In-process pilot remains **uncommitted / untagged** until a separate milestone authorization
- No merge to `main`, no release tag, no push unless user says `MERGE IT` / `TAG IT` / `PUSH IT` / `RELEASE IT`

---

## Next Milestone (proposed)

**Milestone M — In-Process Script Execution (pilot)**  
Scope: Crimson Desert hook presets, code-cave install, gated trainer spawn — separate feature flag, separate acceptance doc, separate tag.
