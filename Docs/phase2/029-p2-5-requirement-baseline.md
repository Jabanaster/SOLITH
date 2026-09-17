# Phase 2 P2-5 — Structure Discovery Engine: Requirement Baseline

Isolated worktree `G:\ACTIVE_PROJECTS\solith-phase2-structure-discovery`, branch `feature/solith-phase2-structure-discovery`, forked from canonical `master` at `e559e5611319336e2bbd65262d26847de6b2518d` (per the "ONE ACTIVE CLAUDE SESSION = ONE WORKTREE" rule — this worktree is dedicated to P2-5 only; the peer session's dirty worktree at `solith-phase0-convergence` was not read, touched, or built upon).

## Source of truth

Requirements below are extracted directly from `ROADMAP.md` (P2-B workstream, "Mandatory Work" and "Repository / Technology Adoption" sections), not from any external prompt. Read fresh for this doc.

## Requirement extraction

| REQUIREMENT | CURRENT STATE | PARTIAL/ABSENT | DEPENDENCY | REAL-PROCESS PROOF NEEDED | PACKAGED PROOF NEEDED | EXIT CRITERION |
|---|---|---|---|---|---|---|
| Structure discovery (typed field breakdown over a bounded byte region) | Confirmed absent under this name; nearest prior art is single-address multi-type read (`research/memory-viewer.ts`) | ABSENT | `MemoryDriver`, `LiveMemorySession` | Yes | Yes | Discover offsets/types/candidates against a real running process, not FakeMemoryDriver alone |
| Memory-region inspection | Partially covered by `research/hex-inspector.ts` (single hex window, no field typing) | PARTIAL | `MemoryDriver.readBuffer` | Yes | Yes | Bounded region byte-level inspection with field-level breakdown |
| Pointer candidate detection within discovered fields | Pointer-map/pointer-scanner stack exists at the chain level (P2-1–P2-4); no per-field "does this 4/8-byte span look like a pointer into a live region" check exists | PARTIAL (chain-level exists, field-level does not) | `pointer-resolver.ts`, `MemoryDriver.getModules/getRegions` | Yes | Yes | Field-level pointer candidate classification, not full chain resolution |
| ReClass.NET reference-adoption concept notes | Not yet documented anywhere in the repo | ABSENT (but formally owned by P2-15, not P2-5 — see note below) | — | No | No | Concept notes only; formal completion criterion is P2-15's, per `ROADMAP.md` line 323 |

Everything else in the Mandatory Work list for P2-B (typed memory views, value/type inference) is explicitly out of scope for P2-5 per `ROADMAP.md`'s own workstream split (P2-6, P2-7) and per this mission's own §6/§11 boundary instructions. P2-5's exit gate is scoped to structure *discovery* (offsets, raw bytes, candidate types, snapshots, diffs) — not the full typed-view or inference subsystems.

## Correction to the roadmap-adjacent instruction doc (mission input)

The instruction document driving this stage states P2-5 "may satisfy the ROADMAP ReClass reference-adoption criterion if all specified requirements are met." **`ROADMAP.md` line 323 says otherwise**: *"Symbol/module awareness + Ghidra external adapter (ReClass.NET's Repository/Technology Adoption reference-adoption role — see below — lives in this workstream; its completion criterion is unchanged)"* — i.e. P2-15 (P2-E workstream), not P2-5. This baseline treats ReClass.NET concept-adoption notes written during P2-5 as **supporting material for P2-15's later closure**, and will not mark that roadmap criterion COMPLETE from P2-5 alone. Flagging this now, per the mission's own instruction to read the roadmap fresh rather than rely solely on the prompt.

## Pre-existing infrastructure audit (corrected)

An initial automated audit of this worktree returned three confirmed-false claims (it said `src/app/components/PointerMapPanel.tsx`, `LiveMemorySession.pointerMapCreate`, and the `solith-scanner-fixture` Rust binary do not exist). All three were independently re-verified present by direct `ls`/`grep` against this exact worktree at `e559e56`. Its other findings were independently spot-checked and confirmed accurate. Corrected inventory:

**REUSE — pointer engineering stack (this repo's own P2-1–P2-4.1 work):**
- `src/core/live-memory/pointer-map.ts`, `pointer-map-orchestration.ts`, `pointer-map-store.ts` — map/node model, live orchestration, SQLite persistence.
- `src/core/live-memory/pointer-resolver.ts`, `pointer-scanner.ts` — chain resolution and candidate scanning.
- `src/core/live-memory/pointer-stability.ts`, `pointer-stability-orchestration.ts` — restart-stability classification (`stable_exact`/`stable_relocated`/etc.), directly reusable for field-level pointer-candidate stability if P2-5 needs it.
- `LiveMemorySession.pointerMapCreate/pointerMapAddNode/pointerMapValidateNodeAfterRestart/pointerMapSave/pointerMapLoad` (`src/core/live-memory/live-memory-session.ts`).
- `src/app/components/PointerMapPanel.tsx` — renderer pattern to follow for a new structure-discovery panel.
- `native/solith-scanner-core/src/bin/fixture.rs` (Cargo bin name `solith-scanner-fixture`) — the established real-process fixture for this Phase 2 lineage; extend this with a deterministic multi-field struct layout for P2-5's real-process proof (§17), not the unrelated C# `gate2-2-memory-fixture` (a different, single-int fixture from an unrelated Gate-2 workstream).

**REUSE — pre-existing "research" subsystem (older "Phase 9 + Phase 3" numbering, genuinely separate from this Phase-2 lineage but directly applicable):**
- `src/core/live-memory/research/memory-viewer.ts` (`MemoryViewer.readTypedValues`) — single-address multi-type read; the per-offset type-interpretation building block for P2-5.
- `src/core/live-memory/research/hex-inspector.ts` — bounded hex window (max 4096 bytes), truncation-flagged; reusable for raw-byte display.
- `src/core/live-memory/research/pointer-candidate-analysis.ts` — confidence-scored pointer candidates (`low`/`medium`/`high`); pattern to follow for P2-5's field-level `POINTER_CANDIDATE` classification (§9).
- `src/core/live-memory/research/session-snapshot.ts` — JSON-persisted, `schemaVersion`-tagged snapshot/diff pattern. **Pattern reuse only, not data-model reuse**: it diffs a *watchlist of individually-tracked addresses/values*, not a *raw byte range*, so P2-5's snapshot/diff engine (§7-8, whole-region byte comparison) is new data-model work that follows this file's persistence/versioning conventions rather than extending its type directly.
- `src/app/components/AddressDataResearchPanel.tsx` — existing renderer precedent for hex/pointer/snapshot-diff UI; P2-5's UI should integrate into the existing Live Memory tooling area rather than duplicate a second standalone panel family.
- IPC/preload chain template: `electron/ipc-validation.ts` (`ResearchViewSchema` et al., `LIVE_ADDRESS_STRING` — BigInt-safe hex/decimal string schema) → `electron/live-memory-ipc.ts` (`research:*` handlers, `requireTrustedSender`/`requireSession`/schema-parse/feature-gate/audit-append/sanitized-error pattern) → `electron/preload.ts`/`preload.cjs` → renderer. New ops (`discoverStructure`, `captureStructureSnapshot`, `compareStructureSnapshots`, `refreshStructure`, `inspectField`) should follow this exact chain.

**CONFIRMED GENUINELY NEW (no prior art in either subsystem):**
- A canonical `DiscoveredStructure`/`DiscoveredField`/`StructureSnapshot`/`FieldInterpretation`/`FieldEvidence` model spanning an arbitrary offset range with per-field width/alignment/confidence tracking.
- Whole-region raw-byte snapshot capture and byte-range diffing (distinct from the existing watchlist-value diff).
- Multi-width candidate interpretation per field (u8/i8 through f64, distinguishing "decodes as" from "is semantically").
- Unaligned-field and unknown-span tracking as first-class states.

## Test convention templates confirmed usable

- `tests/live-memory/research-tools.test.ts` + `tests/fixtures/fake-memory-driver.ts` — direct template for a `structure-discovery.test.ts` unit suite against a fake driver.
- This session's own `tests/live-memory/pointer-stability-*.test.ts` — direct template for the real-process fixture proof (§18) and real-game proof (§19), including the spawn/attach/kill restart-loop pattern and the "independently verifiable ground truth, never resolved-therefore-correct" discipline this whole Phase 2 lineage has been held to.
- `tests/pointer-map-ui-stability.e2e.test.ts` — direct template for the Electron e2e workflow test (§20 UI, §25 failure injection).

## Standing process note (per explicit user instruction)

Comments and docstrings inside test/evidence files are part of the audit surface, not harmless metadata — a stale comment in `pointer-stability-real-game-bastion.test.ts` contradicted its own test's measured evidence during P2-4.1's canonical-integration audit and had to be corrected before merge. This baseline, and every subsequent P2-5 evidence doc, will cross-check narrative claims (comments, docstrings, evidence prose) against actually-observed runtime behavior before treating them as certification-grade.

## Scope note on this stage's pacing

P2-5's full exit gate (mission §35) spans: a new canonical model, a real fixture extension, a new native/IPC/preload chain, a new UI panel, real-process and real-game proof campaigns, packaged-build verification, a full regression pass, a fresh worktree, and a clean-first-run remote CI cycle — the same rigor this conversation already applied to P2-4.1, but for entirely new capability rather than an evidence closeout of already-built work. This is being executed incrementally in this same worktree/branch across the following steps, each independently verified before moving to the next, rather than certified in one unverified pass.
