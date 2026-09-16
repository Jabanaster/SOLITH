# SOLITH — CANONICAL ROADMAP

> **Authority.** This file is the single authoritative SOLITH roadmap, reconstructed under Step 0.14 from the certified current state of the repository, the Step 0.13.5 evidence package (docs 21–37), Audit 2's forensic findings, and owner-approved product direction. It supersedes `MASTER_ROADMAP.md` (SOL-0…SOL-22), the prior `ROADMAP.md` (Phase 0–10 UI/catalog roadmap), and `SOLITH_SECURITY_ROADMAP.md` as the active sequencing document. Those three files are retained on disk as historical record only — see §0 below — and none of their internal phase numbering carries forward as active authority.
>
> **Baseline.** `c38d039e238807d5115565b92c612ae69f0cc7a8` on `feature/solith-canonical-convergence-phase0`, PR #29 open/unmerged. See §3.
>
> **Reconstruction evidence.** `38-step-0.14-roadmap-source-reconciliation.md`, `39-step-0.14-roadmap-consistency-audit.md`, `40-step-0.14-final-roadmap-certification.md` in `SOLITH_PHASE0_EVIDENCE/2026-09-12/`.

---

## 0. Relationship to superseded roadmap documents

| File | Disposition | What survives into this document |
|---|---|---|
| `ROADMAP.md` (prior content, Phase 0–10) | **Superseded, historical only.** Reflected an earlier UI/catalog/packaging-QA maturity stage of the product, predating Phase -1 preservation, Phase 0 canonical convergence, and Step 0.13.5. Several of its phases (game library, artwork, catalog, trainer library UX) were reported `VERIFIED COMPLETE` against a branch state that is not this roadmap's certified baseline and are not re-verified here. | The offline/local-first legal boundary language, the "Definition of Done" discipline (folded into §11 Certification Rules), and the curated-catalog-tier concept (folded into Phase 3). |
| `MASTER_ROADMAP.md` (SOL-0…SOL-22) | **Superseded, historical only.** A broader "gaming intelligence platform" vision revised 2026-09-01, itself replacing an even older security/authority-track roadmap (archived at `Docs/ROADMAP_ARCHIVE_SECURITY_TRACK_2026-09-01.md`). Per this Step 0.14 mission's explicit instruction, SOL-N numbering is **not** continued. | The "explicitly outside SOLITH" boundary list (folded into §2), and several SOL-N forward-looking ideas (autonomous gameplay agents, broader game-understanding agents, advanced AI-assisted gameplay analysis) that had no current implementation and are correctly relocated to §10 FUTURE / POST-1.0 rather than treated as active scope. |
| `SOLITH_SECURITY_ROADMAP.md` | **Superseded as active sequencing, historical evidence only.** Documents real, already-completed Electron/IPC/consent hardening (Gates 2.1–2.5) that predates and is consistent with this roadmap's Certified Ledger (§4) and Capability State Matrix (§5). Its own phase numbering is not continued. | The hardening work it documents is reflected as already-`CERTIFIED` rows in §5 (Desktop shell / IPC, Signing) and its still-open concerns (packaged-runtime env-var gating, consent lifecycle) are carried forward as defects D16 and preserved-work items in §6/§8. |

Full reconciliation detail, including what was explicitly rejected rather than silently dropped, is in `38-step-0.14-roadmap-source-reconciliation.md`.

---

## 1. Product Identity

SOLITH is a **game trainer & cheat platform** for authorized **offline / single-player use**.

Its purpose is to combine:

- automatic intelligent memory scanning
- advanced memory engineering
- native trainer creation
- deep Cheat Engine compatibility
- save editing
- mod/game modification
- game/version identity
- gaming-specific research
- community trainer ecosystem
- Wisp as an optional animated in-game discovery/trainer interface

SOLITH is **not**:

- a generic PC agent
- a generic computer-use platform
- a generic desktop automation tool
- an anti-cheat bypass/evasion tool
- a competitive multiplayer cheating platform
- a DRM circumvention/piracy tool
- a coding agent

Generic machine authority belongs in CodeWorkshop, not SOLITH.

---

## 2. Legal / Use Boundary

- **Offline/single-player only.** No online-identity requirement is imposed anywhere in the core product (Ollama/ONNX/whisper.cpp are all bring-your-own-local; Stagehand/browser-use are scoped to fixed-template research only).
- **No anti-cheat bypass or evasion.** No adopted technology (§7) or planned capability (§9) targets this. This is a standing product-boundary screen re-applied to every adoption decision in Step 0.13.5.
- **No competitive multiplayer cheating platform.** SOLITH's trainer/scanner/hook capabilities are scoped to single-player/offline processes.
- **No DRM circumvention or piracy tooling.**
- **No kernel-mode bypass, stealth, or credential-access tooling.** MinHook/Detours/PolyHook 2 (Phase 13) are game-instrumentation tools only, never generic PC authority.
- **Copyleft isolation.** BepInEx (LGPL-2.1, Phase 9) and DynamoRIO's LGPL-2.1 extensions (excluded, Phase 2) are never statically linked or vendored into SOLITH's own bundle — see §7 for the documented compliance architecture.
- **No bundling of non-redistributable data.** The PCGamingWiki-derived `ludusavi-manifest` save-path data (CC BY-NC-SA 3.0) is never bundled — see §7, item 14b.
- **Generic machine authority is out of scope** (belongs to CodeWorkshop): general PC administration, autonomous software engineering, repository management, arbitrary browser automation, general file management, OS maintenance, software installation, general computer-use agency. SOLITH may use underlying capabilities (e.g. Stagehand) only when scoped narrowly to a gaming task, never as general browsing/automation authority.

---

## 3. Current Authoritative Baseline

| Item | Value |
|---|---|
| Repository / worktree | `G:\ACTIVE_PROJECTS\solith-phase0-convergence`, branch `feature/solith-canonical-convergence-phase0` |
| MASTER BASE | `4ab7433e4db242a1479244a992b18ed068d8fb8e` |
| PHASE 0 CERTIFIED CANDIDATE | `0dd6b414a96c1a6ea6124b411dd5371defa868fd` (tree `77c0e8a2f5bf57f98cdd73410fc6c2d2f192501c`) |
| POST-CERTIFICATION REPAIR SHA / CURRENT HEAD | `c38d039e238807d5115565b92c612ae69f0cc7a8` (tree `93036ecdd556652b0689f499f6c371aaf0df8ba5` — explicitly not byte-identical to the Phase 0 tree, and not claimed to be) |
| Lineage | `4ab7433e` → `9a5d4d5` (test-truth correction) → `0dd6b414` (Phase 0 certified) → `c38d039e` (P0-SCAN-001 `scanFirstRange` repair). Linear, no rebasing, no force-push. |
| Worktree | Clean |
| Test baseline | 1781/1781 + 10/10 pass, 0 fail. Focused: `memory-scanner` 28/28, `dependency-security-overrides` 2/2, `test:live-memory` 283/283 |
| `npm audit` | 0 vulnerabilities (info/low/moderate/high/critical) |
| Remote CI (PR #29, live HEAD) | 7/7 required checks pass |
| PR #29 | OPEN / UNMERGED — this roadmap does not authorize merging it |
| Step 0.13.5 | CERTIFIED COMPLETE (17 evidence docs, 21–37) |

This is the only baseline this roadmap plans against. It is not conflated with `review/gate2-5-doc-audit@0432be9` (the branch Audit 2 was run against) or with any preserved/unmerged branch.

---

## 4. Certified / Completed Ledger

Historical/certification record. **These are not active roadmap phases and are not reopened by this document.**

| Entry | Status | Evidence |
|---|---|---|
| **PHASE -1 — Preservation Program** | COMPLETE / CERTIFIED | `PHASE-1-FINAL-CLOSEOUT.md` — 13/13 steps complete, 14/14 remote refs verified, 0 stranded checkouts, 0 live stashes |
| **PHASE 0 — Canonical Master Convergence / Reproducibility** | TECHNICALLY CERTIFIED | `PHASE-0-CERTIFICATION.md` — branch/master safety 9/9 checks pass, reproducibility (npm ci/typecheck/build/package/fresh-clone) 8/8 pass, dependency/security certified, test-truth certification passed |
| **STEP 0.13.5 — Repo Adoption + License Foundation** | CERTIFIED | Docs 21–37; 39/39 repositories pinned and license-clear; final adoption freeze (12 FULL / 16 PARTIAL / 5 SPECIALIST / 1 FALLBACK / 2 REFERENCE_ONLY / 0 BLOCKED); 23-item defect matrix reconciled; preserved work fully dispositioned; capability matrix complete |
| **POST-PHASE-0 REPAIR — P0-SCAN-001 (`scanFirstRange` truth-reporting sub-defect)** | CLOSED / CI CERTIFIED | Commit on `c38d039e`; 5 new regression tests; 7/7 required PR #29 checks green. Only the `scanFirstRange` sub-mechanism is closed — 4 sibling functions and the deeper scanner defects (1 MiB cap, alignment, AOB fail-open, pointer-depth) remain open and are Phase 1 scope (D01–D06 below) |

---

## 5. Current Capability State Matrix

Vocabulary (exactly these seven states, no others): `CERTIFIED` (reproducible evidence exists) · `IMPLEMENTED_UNVERIFIED` (real code, not independently verified running) · `PARTIAL` (works with confirmed real gaps) · `PRESERVED_NOT_INTEGRATED` (real work exists on an unmerged branch) · `ABSENT` (confirmed does not exist) · `DEFERRED` (exists but intentionally disabled/gated) · `FUTURE` (planned, not yet built).

Reproduced from `36-step-0.13.5-capability-state-matrix.md` (re-certified fresh against the current baseline in §3; no capability below is marked `CERTIFIED` without a cited reproducible check).

| Capability family | State | Evidence | Owning phase (this roadmap) |
|---|---|---|---|
| Installer/build/package | CERTIFIED | `build:electron`, packaging, PR #29 Windows gate green | 14 |
| Desktop shell (Electron main/preload/renderer, IPC) | CERTIFIED | IPC trust boundary 199/199 machine-verified | — (already closed) |
| Process attach | CERTIFIED | Live attach to real Stardew Valley process (PID 28336) | 12 |
| Scanner | PARTIAL | Truth-reporting fixed for `scanFirstRange` only; 1 MiB cap/alignment/AOB fail-open/pointer-depth all confirmed present; real-game coverage measured at 4.5% | 1 |
| Scan refinement (auto-matrix) | PARTIAL | Real fan-out exists, synchronous, no yield/worker/cancellation | 1 |
| Memory read | PARTIAL | Basic reads confirmed live; `int64` reads always throw in production | 1 |
| Memory write | IMPLEMENTED_UNVERIFIED | Consent/rollback exists and unit-tested; never exercised against a real running game | 2 |
| Freeze/revert | IMPLEMENTED_UNVERIFIED | Same basis; known freeze/write address-validation inconsistency | 2 |
| Pointer scanning | PARTIAL | Exists, tested, inherits scanner's silent-truncation defects | 1 (truth-reporting), 2 (feature) |
| AOB scanning | PARTIAL | Works sub-cap; fails silently above cap; two incompatible grammars | 1 |
| Structure discovery | ABSENT | No typed memory-node/class-reconstruction UX | 2 |
| Adaptive scan planner | ABSENT | Confirmed absent across every ref/worktree | 2 |
| Pointer maps (model + live orchestration) | PARTIAL | P2-1/P2-2 implemented and tested (522/522 live-memory, 2033/2033 root); real spawned-process proof, not a shipped-title game; pointer-chain visualization absent; not Phase-2 certified | 2 |
| Pointer-chain visualization | PARTIAL | P2-3: real production UI (`PointerMapPanel.tsx`) consuming P2-1/P2-2 DTOs directly, multi-target grouping, chain/completeness/status display, filter/sort, export into the existing trainer-YAML path; real-process UI proof and packaged UI proof both pass in isolation, but a 5-run sample of the two-target/depth-3 dev-build flow showed 2 failures from real depth-3 pointer-discovery noise (documented Phase 1/P2-2 flake class, not a UI defect) — not yet at the "zero known flaky tests" bar; pointer stability testing (a separate named roadmap sub-item) still open, owned by P2-4 | 2 |
| Game identity | PARTIAL | Detection/matching real; binding gate broken for 91.7% of catalog | 3 |
| Executable/version fingerprinting | PARTIAL | SHA-256 works; PE analysis hand-rolled, 205 lines | 3 |
| Catalog | PARTIAL | 6,028-row catalog real and fast; pagination windows block most binding | 3 |
| CT parsing/ingest | CERTIFIED | 23,953 files / 713,349 cheats / 442,602 pointers / 150,502 scripts / 120,245 AOBs, live-verified | — (already closed) |
| CT execution (CT→native) | PARTIAL | Dead for 91.7% of catalog via identity-window root cause | 3, 5 |
| CT export | PARTIAL | Export real and tested; YAML round-trip destroys evidence comments | 5 |
| Native trainer representation | PARTIAL | 21 competing representations, no canon, no migration | 4 |
| Trainer Creator | ABSENT | Only a legacy `Recipe`-writing surface exists | 6 |
| Automatic discovery capture | ABSENT | No code path persists a scan/correlation result | 6 |
| Community backend/client | PARTIAL | Client sync real; deployed backend provenance unverifiable (~7 weeks stale) | 7 |
| Community trust/provenance | PARTIAL | Mechanism exists, fails open in practice | 7 |
| Save discovery | PARTIAL | One hardcoded game (Avowed/WinGDK); no generalized manifest discovery | 8 |
| Save editing | PARTIAL | Text-format adapters real and generic; all 5 binary formats are demos | 8 |
| Save rollback | PARTIAL | Backup/restore/dry-run mechanism real; single-slot defect at 4 sites | 8 |
| Mod discovery/installation/conflicts | ABSENT | Zero commits, ever, for any mod capability | 9 |
| Wisp shell | PARTIAL (certified branch) / PRESERVED_NOT_INTEGRATED (unmerged branch) | Data/state model exists, zero visual runtime on certified branch; real quick-slot/consent infra on `feature/adaptive-wisp-platform` | 11 |
| Wisp animation | ABSENT | Zero animation runtime reachable from certified branch; preserved branch's "animation" is a static CSS sprite | 11 |
| Wisp adaptive behavior | PRESERVED_NOT_INTEGRATED | Real control-plane logic on unmerged branch, with confirmed defects | 11 |
| Wisp voice / AI | ABSENT | No speech or Wisp-specific perception integration | 11 |
| Wisp overlay/Game Bar | PRESERVED_NOT_INTEGRATED | Real code on separate branch/worktree; open bearer-token defect | 11, 13 |
| Game research | PARTIAL | UI shell page exists; no browser-automation backend wired | 6 |
| Local AI | IMPLEMENTED_UNVERIFIED | Live, DB-backed Ollama/LM Studio config code; not independently executed this session | 11 |
| Telemetry | ABSENT | No runtime frame/performance telemetry | 14 |
| Security | PARTIAL | Electron/IPC hardening confirmed strong; env-var gating defect open (D16) | 13 |
| Recovery | PARTIAL | Write-consent/rollback strong; DB corruption/migration recovery confirmed broken | 13 |
| Legal/license provenance | PARTIAL | Candidate-repo licensing 100% clear (this roadmap's own inputs); SOLITH's own shipped `LICENSE`/`THIRD_PARTY_LICENSES.md`/CT-table attribution gaps remain open | 14 |
| Signing | CERTIFIED | Ed25519 catalog-update signing, pinned trust root, fails closed | — (already closed) |
| Release certification | PARTIAL | Phase 0's narrow certification is real; the 10-game/whole-product gate has not been attempted | 15 |

**Summary counts** (used in the FINAL RESPONSE below): CERTIFIED 5 · IMPLEMENTED_UNVERIFIED 3 · PARTIAL 22 · PRESERVED_NOT_INTEGRATED 3 · ABSENT 8 · DEFERRED 0 · FUTURE 0 — 41 state-instances across 40 capability-family rows; the Wisp shell row carries two states (PARTIAL on the certified branch, PRESERVED_NOT_INTEGRATED on the unmerged branch) and is counted once in each column.

---

## 6. Known Defect Ledger

All defects classified `ROADMAP_PHASE_REQUIRED` in Step 0.13.5 (`28-step-0.13.5-foundation-defect-matrix.md`, `35-step-0.13.5-final-defect-matrix.md`), each assigned exactly one owning phase. **Zero orphans.**

> **Reconciliation note.** Doc 35's own summary line states "16 ROADMAP_PHASE_REQUIRED"; its own itemized body, read literally, names 18 distinct items. This is a pre-existing tally inconsistency in already-certified Step 0.13.5 evidence (root-caused in `39-step-0.14-roadmap-consistency-audit.md`), not a new defect and not grounds to drop two real, independently-described items. This ledger maps every named item.

| ID | Defect | Evidence | Owning phase |
|---|---|---|---|
| D01 | Sibling scan-function truth-reporting gaps (`scanFirst`, `scanFirstUnknown`, `scanNextFromSnapshot`, `scanNextFromSnapshotMultiType`, `scanFirstByComparison` — same `catch{continue}` shape as the closed `scanFirstRange` defect, same missing `truncated=true`) | Audit 2 §16; doc 28 | 1 |
| D02 | 1 MiB region-read cap (95.5% of a real game's writable memory unread — measured 42.1 MB of 893 MiB on Stardew Valley) | Audit 2 §16 S3 | 1 |
| D03 | Forced 4-byte alignment silently discards unaligned values inside regions that *are* read | Audit 2 §16 S1 | 1 |
| D04 | AOB/signature resolution silently returns `found:false` above the cap, disabling all 120,245 CT AOB signatures against real heaps | Audit 2 §16 S2 | 1 |
| D05 | Pointer-scan depth truncation/misreporting (`levelsSearched:1` vs `maxDepth:3`, `truncated:false`) | Audit 2 §16 S4 | 1 |
| D06 | int64 mismatch — lossy above 2^53 at the IPC boundary; `readMemory(...,'int64')` always throws in production | Audit 2 §16 S5/S7 | 1 |
| D07 | CT/catalog hardcoded lookup windows (200-row / 500-row over a 6,028-row catalog); Stardew Valley and Palworld cannot bind | Audit 2 §20 | 3 |
| D08 | Trainer representation fragmentation — 21 competing representations, no canon, no migration path | Audit 2 §19 | 4 |
| D09 | Community fail-open certificate behavior (`cert_level` defaults `L3_Certified`) | Audit 2 §22 | 7 |
| D10 | Community cursor/pagination defects (poisoned sync cursor permanently disables sync; keyset pagination breaks on ≥100 same-timestamp rows) | Audit 2 §22 | 7 |
| D11 | Save backup single-slot defect — TrainerHost `.trainer-backup`, 4 sites; a second write destroys the pristine original | Audit 2 §24 | 8 |
| D12 | Fake/demo save-format support — all 5 binary formats are SOLITH-invented demos over one field map; zero real commercial binary saves | Audit 2 §24 | 8 |
| D13 | Adaptive scan planner absence | Audit 2 §17 | 2 |
| D14 | Automatic discovery-capture absence — no code path persists a scan/correlation result | Audit 2 §21 | 6 |
| D15 | Unhandled promise rejection on a transient disk-write failure kills the Electron main process | Audit 2 §23 | 13 |
| D16 | `SOLITH_PRIVILEGED_CONSENT` / `SOLITH_SKIP_ONBOARDING` ungated in packaged builds | Audit 2 §1 | 13 |
| D17 | Deployed community backend Worker provenance unknown (~7 weeks stale, no deployment provenance) | Audit 2 §22 | 7 |
| D18 | `nul` (tasklist dump) untracked/ungitignored risk — status not independently re-verified this session, cheap precondition check | Audit 2 §6 item 12 | 14 |

**Already-closed and not-a-defect items** (not re-listed as roadmap work): `scanFirstRange` truth-reporting (closed, §4); the corrected test assertion (closed, §4); HEAD-does-not-compile class (never applicable to this lineage); mod-system absence (`NOT_A_DEFECT` — pure scope decision, resolved in Phase 9); Wisp "partial state" defects on the certified branch (`NOT_A_DEFECT` there — no implementation exists to be partial; become real fix conditions for Phase 11 only if the corresponding preserved code is cherry-picked, see §8).

---

## 7. Technology / Repository Adoption Freeze

Exact frozen matrix from Step 0.13.5 (`26`, `27`, `33`). **FULL 12 · PARTIAL 16 · SPECIALIST 5 · FALLBACK 1 · REFERENCE_ONLY 2 · BLOCKED 0.** 39/39 pins license-clear, 0 unresolved. No repo hunt was repeated; no role was changed from the Step 0.13.5 freeze. Phase numbers below are this roadmap's own final assignment (Step 0.13.5's own "Phase (placeholder)" column explicitly deferred this decision to Step 0.14).

| # | Repository | Pin | License | Role | Exact capability adopted | Owning phase(s) |
|---|---|---|---|---|---|---|
| 01 | napi-rs | `napi-derive-v3.6.5` | MIT | FULL | Typed Rust↔Node FFI boundary for all future native work | **1** |
| 02 | Zydis | `v4.1.1` | MIT | FULL | x86/x64 instruction decode/encode, instruction-aware AA validation | **2** (also 5) |
| 03 | LIEF | `1.0.0` | Apache-2.0 | FULL | PE header/section/import/export/signing parsing, replaces `pe-analyzer.ts` | **3** |
| 04 | BLAKE3 | `1.8.7` | CC0-1.0/Apache-2.0 | FULL | Authoritative content-addressed hashing | **3** |
| 05 | xxHash | `v0.8.3` | BSD-2-Clause | PARTIAL | Fast pre-filter hashing ahead of BLAKE3/SHA-256 | **3** |
| 06 | Vectorscan | `vectorscan/5.4.13` | BSD-3-style | SPECIALIST | SIMD large-signature-batch matching, not the interactive scanner | **2** |
| 07a/b | Rive runtime + react | commit `02bea09`/`v4.34.2` | MIT | FULL | Primary Wisp character/state-machine animation | **11** |
| 08 | Motion | commit `372846e` | MIT | FULL | Application-chrome transitions | **10** (Wisp-chrome use: 11) |
| 09 | Radix UI Primitives | commit `f7ecd5a` | MIT | FULL (owner-approved) | Dialog/menu/popover/tooltip/dropdown behavior + a11y | **10** (first concrete use: 6) |
| 10 | shadcn/ui | `shadcn@4.21.0` | MIT | FULL (owner-approved) | Copy-in component pattern, re-themed to SOLITH tokens | **10** (first concrete use: 6) |
| 11 | Monaco Editor | `v0.56.0` | MIT | FULL | CT/AA/pointer script editing | **6** (also 5) |
| 12 | react-resizable-panels | `4.12.4` | MIT | FULL | Resizable split-pane layout | **10** (also 6) |
| 13 | dnd-kit | `@dnd-kit/collision@0.5.0` | MIT | FULL | Drag/drop reordering | **10** (also 6) |
| 14a | Ludusavi (code) | `v0.31.0` | MIT | PARTIAL | Backup/restore/compare architecture concepts | **8** |
| 14b | ludusavi-manifest (schema only) | commit `4e17e53` | MIT (schema)/CC BY-NC-SA 3.0 (data, **not adopted**) | PARTIAL | Manifest schema/tooling as design reference only | **8** |
| 15 | Playnite | `10.60` | MIT | PARTIAL | Install-discovery provider-architecture concepts (no code link) | **3** |
| 16 | ReClass.NET | `v1.2` | MIT | PARTIAL | Typed memory-node-tree UX concepts (no code link) | **2** |
| 17 | PresentMon | `v2.5.1` | MIT | PARTIAL | Spawn official release binary for frame-timing telemetry | **14** (consumer: 11) |
| 18 | YARA-X | `v1.20.0` | BSD-3-Clause | PARTIAL | Rule-based file/trainer-package classification | **7** |
| 19 | Ghidra | `Ghidra_12.1.3_build` | Apache-2.0 core + 20+ bundled | SPECIALIST | External, user-installed `analyzeHeadless` adapter — NOT-SHIP | **2** |
| 20 | DynamoRIO | `cronbuild-11.91.20708` | BSD-3-Clause core (LGPL-2.1 extensions excluded) | SPECIALIST | BSD core client API only, optional dynamic instrumentation | **2** |
| 21 | MinHook | `v1.3.4` | BSD-2-Clause | PARTIAL — PRIMARY hooking | Trampoline hooking, replaces `hook-engine.ts`'s code-cave mechanism | **13** |
| 22 | BepInEx | `v5.4.23.5` | LGPL-2.1 | PARTIAL — separately bounded | Optional, separately-distributed Unity/.NET mod-loader companion | **9** |
| 23 | Harmony | `v2.4.2.0` | MIT | PARTIAL — BepInEx-mediated | Method-patching inside an optional SOLITH-authored BepInEx plugin | **9** |
| 24 | Windows App SDK | `v1.8.11` | MIT | PARTIAL | Native Windows notification/lifecycle riding existing MSIX path | **11** |
| 25 | Win2D | commit `2568038` | MIT | REFERENCE_ONLY | Nothing adopted; revisit only if a native overlay outside Chromium is ever scoped | **11** (not scheduled) |
| 26 | PixiJS | `v8.20.1` | MIT | FULL | Particle/glow/status-effect Wisp visual layer | **11** |
| 27 | Three.js | `r186` | MIT | PARTIAL | Optional, lazy-loaded 3D Wisp mode | **11** |
| 28 | ONNX Runtime | `v1.30.0` | MIT + ThirdPartyNotices | PARTIAL | CPU/DirectML providers only for optional local model inference; CUDA excluded | **11** |
| 29 | whisper.cpp | `v1.9.4` | MIT | PARTIAL | Spawn official release binary for optional local speech-to-text | **11** |
| 30 | Ollama | `v0.34.0` | MIT (runtime) | PARTIAL | Formalize the already-live `/api/tags` LLM-reasoning integration | **11** (already live; ongoing) |
| 31a/b | cosign / sigstore | `v3.1.3`/`v1.10.10` | Apache-2.0 | PARTIAL | Optional community trainer-package provenance layer; core Ed25519 trust root unchanged | **7** |
| 32 | Dear ImGui | `v1.92.9b` | MIT | SPECIALIST | Internal dev-mode diagnostic overlay, never user-facing | **2** |
| 33 | Microsoft Detours | `v4.0.1` | MIT | FALLBACK | Reactive-only, when MinHook's scope is insufficient | **13** |
| 34 | PolyHook 2 | commit `49a95d4` | MIT | SPECIALIST | Complex hook types (vtable, exception-directory) | **13** |
| 35 | browser-use | `0.13.10` | MIT | REFERENCE_ONLY | Documented fallback only if Stagehand concretely lacks a capability | **6** |
| 36 | Stagehand | `@browserbasehq/stagehand@3.7.3` | MIT | PARTIAL — PRIMARY | Fixed-template-only gaming documentation/patch-note research | **6** |

**License exit gate (carried forward from Step 0.13.5, re-confirmed, not re-litigated):** unresolved licenses 0, redistribution gaps 0, unknown licenses 0, TBDs 0. Ghidra and the ludusavi-manifest data are resolved by architecture (NOT-SHIP / not-bundled), not by leaving a question open. BepInEx and DynamoRIO's LGPL-2.1 surfaces have documented compliance boundaries (§2, §9, §2/§13).

---

## 8. Preserved Work Ledger

Final dispositions from `34-step-0.13.5-final-preserved-work-map.md`. **0 provisional items remaining.**

| Preserved source | Disposition | Exact scope | Owning phase |
|---|---|---|---|
| `preserve/ct-selective-import-2026-09-12` (`selective-import.ts` + 3 dependents, 1 coherent unit) | `CHERRY_PICK_SELECTED_HUNKS` | Must land as one commit with dedicated test coverage; landing any file alone yields non-compiling code | **5** |
| `preserve/catalog-process-detection-fix-2026-09-12` | `CHERRY_PICK_SELECTED_HUNKS` | Re-derive fresh against the certified branch (PR #26 is stale and does not carry this fix); same defect class as D07 | **3** |
| `feature/adaptive-wisp-platform` — visual/rendering layer | `SUPERSEDED_BY_NEW_STACK` | Confirmed via direct source read: a static CSS-positioned sprite with zero animation runtime; 100% subsumed by the Rive/PixiJS/Motion stack | **11** (not integrated) |
| `feature/adaptive-wisp-platform` — consent/authority subsystem | `CHERRY_PICK_SELECTED_HUNKS` | `WispConsentDialog.tsx`, `WispConsentQueue.tsx`, `wisp-action-executor.ts` consent gating, `wisp-consent-ipc.ts`. **Excludes** three named functional defects (dead `toggle`, unreverted `momentary`, defeated compatibility gate) — must fix as a condition of landing | **11** |
| `feature/adaptive-wisp-platform` — adaptive/quick-slot control plane | `CHERRY_PICK_SELECTED_HUNKS`, conditional on a dedicated read/fix pass | `adaptive-wisp-live-adapter.ts`, quick-slot controller, active-profile-provider, game-identity-bridge, hotkey lifecycle (30+ existing test files) | **11** |
| `review/adaptive-wisp-increment4-security` (commit `4a8ca91`) | `CHERRY_PICK_SELECTED_HUNKS` | Reattach/PID-reuse/freeze-expiry security proofs not present elsewhere | **11** (security proofs also inform 13) |
| `preserve/review-gate2-5-working-tree-2026-09-12` — live-memory attach-path trust fix (`verifiedCatalogGameId`) | `CHERRY_PICK_SELECTED_HUNKS` if the certified branch is found to share the trust gap | Check `electron/live-memory-ipc.ts` on the certified branch before cherry-picking | **13** |
| `preserve/review-gate2-5-working-tree-2026-09-12` — `<img src>` scheme allowlist (`cover-url.ts`) | `CHERRY_PICK_SELECTED_HUNKS` if the certified branch shares the gap | Check before cherry-picking | **13** |
| `preserve/review-gate2-5-working-tree-2026-09-12` (remainder, whole) | `REFERENCE_ONLY` | The `artwork-cache-ipc.ts` syntax fix and `package.json`/lock sync fix are **not** eligible — confirmed the certified branch never had those defects | not scheduled |
| All other Phase -1 preserved refs (`fix/f012-targeted-correction`, `candidate/v1-security-integration`, `security/f005-dce-isolation`, `chore/electron-ts-baseline-cleanup`, `feature/gamebar-solith-transport`, `feature/master-p0-security-closeout`, remaining `review/adaptive-wisp-increment*`/`*-closeout` refs) | `REFERENCE_ONLY` | Not re-read for content in Step 0.13.5; a second-pass content read is a reasonable input-gathering task inside whichever phase needs them (11 for Wisp-adjacent refs, 13 for security-adjacent refs) if their content later proves load-bearing | as needed |

**0 preserved items rejected outright.** `ADOPT_WHOLE_COMMIT`/`REIMPLEMENT_CLEANLY` do not apply at this granularity — everything useful either lands as a cherry-picked multi-file unit or is superseded by a newly-decided architecture.

---

## 9. Active 15-Phase Roadmap

Every phase must close at **100%** — no known in-scope failure accepted, no fake green, no skipped truth, no "mostly complete," no unsupported feature advertised as complete, no unresolved P0/P1 within scope, no guessed certification, no placeholder implementation counted as done, no silent fallback masking failure. Tests may fail *during* implementation; a phase marked COMPLETE must satisfy every exit gate below.

### PHASE 1 — Memory Scanner Reconstruction

**Objective.** Rebuild SOLITH's scanner into a complete, trustworthy, high-performance game-memory scanner.

**Why This Phase Exists.** The scanner is the foundation every other subsystem (CT execution, pointer scanning, Trainer Creator discovery) depends on, and it is currently the single most defect-dense subsystem in the estate: it silently under-reads real games by 95.5% and, until the post-Phase-0 repair, lied about it.

**Current State.** PARTIAL (§5). `scanFirstRange`'s truth-reporting is closed; four other silent-false-negative mechanisms remain open (D02–D06) plus four sibling functions sharing the same reporting bug (D01).

**Mandatory Work.**
- Fix D01 (sibling truth-reporting gaps) using the exact proven `scanFirstRange` pattern — add `truncated = true` at each remaining `catch{continue}` site, one regression test per site.
- Remove the 1 MiB region-read cap (D02); implement chunked scanning of large readable regions with truthful coverage reporting.
- Remove forced 4-byte alignment where inappropriate (D03); support unaligned values.
- Repair AOB/signature scanning above the previous cap (D04); eliminate false `found:false` behavior caused by incomplete coverage.
- Fix pointer-depth/truncation truth-reporting (D05).
- Resolve the int64 mismatch at the IPC boundary (D06) — fix site is `ipc-validation.ts`, not only the decoder.
- Implement exact scan, unknown initial value, changed/unchanged/increased/decreased/increased-by/decreased-by (where supported), value-range scans, integer families, float/double, strings, byte arrays, AOB/binary patterns, and scan refinement.
- Large-process support, cancellation, progress reporting, resumable scan sessions, performance measurement, memory safety, process-exit/stale-process handling.

**Repository / Technology Adoption.** napi-rs (native Rust↔Node boundary for all future native scanner work, FULL). Native Rust scanner architecture as needed; no other Phase 1 repo adoptions are frozen (Zydis/Vectorscan support Phase 2's advanced-analysis work, not the base scanner rewrite).

**Preserved Work Inputs.** None — no preserved ref contains scanner-reconstruction code.

**Known Defects Closed.** D01, D02, D03, D04, D05, D06.

**Verification Requirements.** Extended `memory-scanner`/`live-memory` suites; real-game scan coverage measured against at least one of the 7 curated titles (Phase 12's roster) with a recorded, honest coverage percentage — not a synthetic-fixture-only claim; large-region behavior verified; performance baseline recorded; fresh install/build/package validation.

**Exit Gate.** Zero known Phase-1 scanner correctness defects. Truthful coverage reporting at every code path. Full required automated suite green. Real-game scan coverage independently verified and recorded (not benchmarked against Cheat Engine yet — see Prohibited Shortcut). Large-region behavior verified. Performance baseline recorded. Fresh install/build/package validation passes.

**Prohibited Shortcut.** Do not claim the scanner "exceeds Cheat Engine" until an actual benchmark is run (owner goal, not yet measured). Do not narrow "chunked reading" to a slightly larger fixed cap and call it unbounded. Do not mark D01 closed by fixing only a subset of the five sibling functions.

---

### PHASE 2 — Advanced Memory Engineering & Adaptive Scan Intelligence

**Objective.** Turn SOLITH from a basic scanner into a serious memory-engineering platform, with an adaptive scan planner so ordinary players do not need Cheat Engine-level internals knowledge.

**Why This Phase Exists.** Pointer scanning, structure discovery, and an adaptive planner are all currently absent or shallow; Audit 2 confirms the adaptive planner does not exist anywhere in the codebase, on any branch.

**Current State.** Pointer scanning PARTIAL; structure discovery ABSENT; adaptive scan planner ABSENT (D13); memory write/freeze IMPLEMENTED_UNVERIFIED against a real game.

**Mandatory Work.**
- Pointer scanning, multi-level pointer scanning, pointer maps, pointer-chain visualization, pointer stability testing.
- AOB/signature engineering with signature resiliency; module-relative addressing; symbol/module awareness.
- Structure discovery, typed memory views, value/type inference, memory-region inspection, memory map, watchlists.
- Freeze/write/revert with transactional edit behavior; hotkeys; address validation (close the known freeze/write inconsistency where freeze accepts an address the write path refuses); instruction-aware analysis.
- Resilient rediscovery; restart stability validation; version-aware rediscovery.
- **Adaptive Scan Planner — MANDATORY** (owner emphasis, not optional): intelligently select/refine scan strategy so ordinary players do not need Cheat Engine internals (D13).

**Repository / Technology Adoption.** Zydis (FULL — instruction decode/encode, AA codegen validation). Vectorscan (SPECIALIST — large signature-batch acceleration only; native scanner stays primary for interactive scans). ReClass.NET (PARTIAL — typed memory-node-tree UX concepts, no code link). Ghidra (SPECIALIST — external, user-installed `analyzeHeadless` adapter, NOT-SHIP). DynamoRIO (SPECIALIST — BSD-3-Clause core client API only, LGPL-2.1 extensions excluded). Dear ImGui (SPECIALIST — internal dev-mode diagnostic overlay only, never user-facing).

**Preserved Work Inputs.** None.

**Known Defects Closed.** D13.

**Verification Requirements.** New pointer/structure-discovery test suites; adaptive-planner strategy-selection tests; restart-stability tests against a real game; freeze/write real-game exercise (closing the "never exercised against a real running game" gap in §5).

**Exit Gate.** 100% of Phase 2 scope certified — including at least one real-game freeze/write/revert exercise (not merely unit-tested), and the adaptive planner demonstrably selecting a scan strategy without user Cheat Engine knowledge.

**Prohibited Shortcut.** Do not ship the adaptive planner as a fixed decision tree dressed up as "adaptive" without a real strategy-selection mechanism. Do not certify memory write/freeze from unit tests alone.

**Progress Reconciliation — 2026-09-16 (P2-1/P2-2, branch `feature/solith-phase2-pointer-engineering`, verified HEAD `c104e33fb93ee4b44323feea912b491b544dd2c7`).** This note updates status/evidence only; it does not change Mandatory Work, Repository/Technology Adoption, Exit Gate, or Prohibited Shortcut above, and does not mark any Phase 2 capability CERTIFIED.

- Pointer-map data model (P2-1): real, immutable `PointerMap`/`PointerMapNode` model with truthful per-node resolution states (`resolved` / `module_missing` / `read_failed` / `process_exited`). Focus-tested, not independently phase-certified.
- Pointer-map live orchestration (P2-2): real production service on `LiveMemorySession` — named maps, multi-target scan (`scanTargetsIntoMap`) with independent per-target grouping, truthful per-target completeness plus a worst-of aggregate reusing `CanonicalCompleteness`, between-target cancellation, resource limits (`MAX_TARGETS_PER_SCAN` / `MAX_NODES_PER_TARGET` / `MAX_NODES_PER_MAP`), process-exit and stale-target handling, schema-versioned SQLite persistence (reload forced inactive until re-resolved), a 13-endpoint IPC + preload contract with BigInt-safe address transport, and a real two-target spawned-process proof including a save/kill/respawn/load restart-stability proof. Evidence: `Docs/phase2/001` through `005`; commits `2441de5`, `8f1e885`, `ba2bd38`, `c104e33`; live-memory 522/522; root 2033/2033; renderer and electron typecheck PASS; local HEAD == remote HEAD.
- Still ABSENT or PARTIAL and not touched by P2-1/P2-2: pointer-chain visualization, pointer stability/restart validation beyond the one fixture pair proven above, structure discovery, typed memory views, value/type inference, memory map, watchlists, freeze/write/revert real-game exercise, the known freeze/write address-validation inconsistency, the Adaptive Scan Planner, Zydis, Vectorscan, DynamoRIO, Dear ImGui overlay, symbol/module awareness, the Ghidra external adapter, resilient/version-aware rediscovery, and final Phase 2 certification.
- Phase 2 requirement count carried in stage evidence docs: 28 (every independently mandated bullet above and in Repository/Technology Adoption counts once, including ReClass.NET's reference-adoption-only criterion — non-code completion criteria are not excluded from the count).
- Phase 2 overall status: NOT_COMPLETE. Next authorized stage: P2-3 — pointer-chain visualization UI.

**Progress Reconciliation — 2026-09-16 (P2-3, branch `feature/solith-phase2-pointer-engineering`).** Status/evidence only; does not change Mandatory Work, Exit Gate, or Prohibited Shortcut, and does not mark Phase 2 or the full pointer-map requirement CERTIFIED.

- Pointer-chain visualization: ABSENT → PARTIAL. Real, production-consuming UI (`PointerMapPanel.tsx`) added to `LiveMemoryTrainerPage` — map create/rename/delete/save/load/list-saved; multi-target scan with distinct per-target groups (including truthful zero-candidate groups, never silently absent); chain-step display sourced from the P2-1/P2-2 DTOs with no re-derived pointer semantics and no fabricated intermediate addresses; node status and completeness shown via a real badge vocabulary (never a stale "Resolved" state after a kill or reload); filter/sort by target/status/module/depth; copy actions and export wired into the existing trainer-YAML export path (no competing export implementation). No new graph/canvas dependency added — a plain grouped list, matching what the codebase already had available. A real, pre-existing P2-2 gap was found and fixed in the same stage: the pointer-map IPC bounds schema silently dropped `maxCandidatesPerLevel`, the exact bound P2-2's own real-process evidence already required for reliable depth-3 discovery — added to the IPC schema, preload types, and the new UI's scan form.
- Real-process UI proof (dev build, two independent real targets, depth-3 and depth-1, full inspect/resolve/kill/re-resolve cycle): passed cleanly across isolated single runs, but a representative 5-run sample showed 3 clean passes and 2 failures specifically at real depth-3 discovery for one of the two targets — a real process's incidental pointer-shaped noise around `ntdll.dll` can still crowd out the true path even at `maxCandidatesPerLevel` raised to 32, the same class of stochastic real-hardware flake the core Phase 1/P2-2 suites already documented (doc 003, doc 129), not a defect newly introduced by the UI. Packaged UI proof (single target, depth-1, full attach/create/scan/save/load cycle against the actual packaged `Solith.exe`) passed 3/3 clean.
- This is why pointer-chain visualization is marked PARTIAL, not CERTIFIED or IMPLEMENTED_VERIFIED: the UI itself is real and correct, but real depth-3 discovery reliability is not yet at Phase 1's "zero known flaky tests" bar. Closing that is scan-planner/discovery-tuning work, not UI work, and is explicitly not re-litigated here.
- The roadmap's combined "pointer maps, pointer-chain visualization" Mandatory Work bullet also names **pointer stability testing** as a separate requirement — that remains open and is P2-4's stated scope, so the pointer-map feature as a whole is **not** marked IMPLEMENTED_VERIFIED yet.
- Evidence: `Docs/phase2/006` through `010`. Phase 2 overall status: NOT_COMPLETE. Next authorized stage: P2-4 — pointer stability testing / real-game restart validation.

---

### PHASE 3 — Game Identity, Executable Detection & Catalog

**Objective.** Establish one canonical GAME → EDITION → EXECUTABLE → VERSION → PROCESS identity model.

**Why This Phase Exists.** This is Audit 2's own assessment of the single highest-leverage fix in the entire estate: hardcoded 200/500-row catalog windows currently block 91.7–96.7% of the 6,028-row catalog from binding a session at all, excluding 2 of the 7 curated flagship titles (Stardew Valley, Palworld).

**Current State.** Game identity PARTIAL; executable/version fingerprinting PARTIAL; catalog PARTIAL (D07).

**Mandatory Work.**
- Remove the hardcoded 200/500 catalog limits (D07); full catalog traversal/query with pagination/indexing, no coverage ceiling.
- Nested executable support (fixes the Crimson Desert resolution gap); launcher support; multiple executable roles; edition detection; version/build fingerprints.
- Installed-game reconciliation; stale-install handling; process binding; trainer applicability; version-mismatch handling; no generic fake trainers for unrelated games (closes the "Unlimited Ammo offered for Stardew Valley" defect class).
- Provider normalization; game library discovery.
- Hash architecture: xxHash = fast non-security fast-path/cache identity; BLAKE3 = authoritative SOLITH identity; SHA-256 = external compatibility only where required.
- Reevaluate the preserved catalog/process-detection work.

**Repository / Technology Adoption.** LIEF (FULL — replaces `pe-analyzer.ts`). BLAKE3 (FULL — authoritative hashing). xxHash (PARTIAL — fast pre-filter only). Playnite (PARTIAL — install-discovery provider-architecture concepts, no code link).

**Preserved Work Inputs.** `preserve/catalog-process-detection-fix-2026-09-12` (`CHERRY_PICK_SELECTED_HUNKS`, re-derived fresh — the stale PR #26 route does not carry this fix).

**Known Defects Closed.** D07.

**Verification Requirements.** Existing install-discovery suite extended; regression test proving a title outside the old top-500 window binds successfully; real-game validation across providers (Steam/GOG/Epic/etc.) and at minimum the 7 curated titles.

**Exit Gate.** Canonical identity certified across target providers and real games. Zero hardcoded catalog ceilings remain. Stardew Valley and Palworld both bind a session.

**Prohibited Shortcut.** Do not raise the window from 500 to a larger fixed number and call the ceiling removed — the fix is architectural (pagination/index), not a bigger constant.

---

### PHASE 4 — Canonical SOLITH Trainer Model & Runtime

**Objective.** Replace/converge the 21 fragmented trainer representations into one coherent, versioned native SOLITH trainer model.

**Why This Phase Exists.** Audit 2: "a v2 of the format is unshippable" as it stands — zero migration path exists (`schemaVersion: z.literal(1)`, zero `migrat*` hits) and the existing `SolithDefinitionV1 ⇄ ModPack` round-trip is lossy.

**Current State.** Native trainer representation PARTIAL (D08).

**Mandatory Work.** The canonical model must represent, at minimum: trainer identity, game identity, supported versions, cheats, values, pointers, AOB locators, scripts/actions, dependencies, entry groups, value types, dropdowns, hotkeys, activation rules, safety requirements, provenance, authorship, verification maturity, compatibility, migrations, rollback/revert behavior. Define canonical serialization, schema versioning, migration policy, and runtime execution semantics. The native SOLITH format is canonical; CT is interoperability (Phase 5), not the internal model.

**Repository / Technology Adoption.** None — this is SOLITH-owned consolidation work (Zydis/LIEF from Phases 2/3 feed richer metadata inputs but no new repo is adopted here).

**Preserved Work Inputs.** None.

**Known Defects Closed.** D08.

**Verification Requirements.** Round-trip fidelity tests (no dropped AOB signatures, no fabricated descriptions); migration tests across schema versions; consolidation of the 3 existing parsers/3 registry schemas/3 stores into one, with a passing regression suite proving no functional loss.

**Exit Gate.** One authoritative trainer representation and runtime exists; every prior representation either migrates cleanly or is explicitly retired with a documented migration path.

**Prohibited Shortcut.** Do not declare convergence by adding a 22nd representation that wraps the other 21.

---

### PHASE 5 — Deep Cheat Engine Compatibility

**Objective.** Utilize legitimate `.CT` files as fully as technically practical, without ever making CT the canonical internal model.

**Why This Phase Exists.** CT parsing/ingest is already CERTIFIED (23,953 files verified) but CT *execution* is dead for 91.7% of the catalog (Phase 3's identity-window defect) and CT export lossily destroys evidence comments on YAML round-trip.

**Current State.** CT execution PARTIAL; CT export PARTIAL.

**Mandatory Work.** Support, where feasible: hierarchy/groups, descriptions, value records, pointers, multi-level pointers, module-relative addresses, AOB scans, freeze, dropdowns, hotkeys, symbols, allocations, dependencies, version checks, script metadata, Auto Assembler semantics, safely-scoped Lua-related semantics only, enable/disable behavior, cleanup/deallocation, nested entries, compatible export back to CT where practical. Every unsupported semantic must be explicitly detected, reported, and safely rejected or degraded — never silent.

**Repository / Technology Adoption.** Zydis (instruction-aware analysis, shared with Phase 2). Monaco Editor (FULL — CT/AA script editing, diagnostics, diff).

**Preserved Work Inputs.** `preserve/ct-selective-import-2026-09-12` (`CHERRY_PICK_SELECTED_HUNKS`, one coherent 4-file unit — `selective-import.ts` + `ct-library-ipc.ts` + `preview-receipt.ts` + `write-library.ts`; must land together).

**Known Defects Closed.** None directly (CT execution's root cause is D07, closed in Phase 3; this phase's own scope is compatibility depth, not that root cause).

**Verification Requirements.** A published CT compatibility matrix; broad corpus validation against the existing 23,953-file library; real execution validation once Phase 3 lands (CT execution cannot be certified until the catalog-window fix is live).

**Exit Gate.** Published CT compatibility matrix exists; broad corpus validation passes; real execution validated end-to-end for at least the curated flagship titles' available CT tables.

**Prohibited Shortcut.** Do not silently drop an unsupported CT semantic — every gap must surface to the user as an explicit, reported limitation.

---

### PHASE 6 — Automatic Discovery + Trainer Creator

**Objective.** Turn successful discoveries into trainer candidates automatically, and give users a real authoring surface for the canonical format.

**Why This Phase Exists.** Audit 2's own assessment: the highest-leverage *build* item in the estate. Trainer Creator is confirmed absent (only a legacy `Recipe`-writing surface exists); automatic discovery-capture is confirmed absent (every promote path is manual).

**Current State.** Trainer Creator ABSENT; automatic discovery capture ABSENT (D14); game research PARTIAL (UI shell exists, no backend wired).

**Mandatory Work.**
- Maturity ladder: DISCOVERED → IN_GAME_VERIFIED → SESSION_VERIFIED → RESTART_VERIFIED → VERSION_VERIFIED → COMMUNITY_VERIFIED → RECOMMENDED.
- Automatic capture of candidate addresses, pointer chains, AOBs, value semantics, discovered concept, game/version, stability evidence, author/discoverer attribution. The discovering user receives credit. Community verification can mature the discovery. Never publish private raw memory/save data.
- Trainer Creator: professional editing, visual groups, drag/drop, search, validation, diagnostics, Monaco scripting, resizable workspaces, undo/redo, autosave/recovery, compatibility preview.

**Repository / Technology Adoption.** Monaco Editor (Trainer Creator scripting surface), react-resizable-panels, dnd-kit, Radix UI Primitives, shadcn/ui, Motion (all first concretely consumed here; primary FULL_ADOPTION home is Phase 10). Stagehand (PARTIAL — PRIMARY, fixed-template gaming documentation/patch-note/compatibility research feeding compatibility preview). browser-use (REFERENCE_ONLY — fallback only if a specific research task concretely exceeds Stagehand's capability).

**Preserved Work Inputs.** None directly (Trainer Creator is new-build).

**Known Defects Closed.** D14.

**Verification Requirements.** New end-to-end authoring test suite (create/edit/delete/validate/save/reopen producing canonical `SolithDefinitionV1`); discovery-to-candidate capture regression tests; fixed-template research task tests (never arbitrary goals).

**Exit Gate.** Complete creator workflow certified end-to-end; automatic discovery capture demonstrably turns a real scan session into a maturity-ladder-tracked candidate without manual reconstruction.

**Prohibited Shortcut.** Do not ship a Trainer Creator that only edits the legacy `Recipe` format and call it done. Do not let Stagehand/browser-use perform any non-fixed-template, arbitrary-goal browsing.

---

### PHASE 7 — Community Trainer Ecosystem

**Objective.** Build the community pipeline around GAME → CONCEPT → IMPLEMENTATIONS → VERSIONS → VERIFICATIONS, safely.

**Why This Phase Exists.** The existing hub-sync client code is real, but `cert_level` fails open to `L3_Certified` by default, cursor/pagination bugs can permanently disable sync, and the deployed backend Worker's own code provenance is unverifiable (~7 weeks stale, no deployment record).

**Current State.** Community backend/client PARTIAL; community trust/provenance PARTIAL (D09, D10, D17).

**Mandatory Work.** Contributor identity, discoverer attribution, verification evidence, rankings, compatibility, version tracking, provenance, moderation/reporting, artifact hashing, signing, rollback, cache/offline behavior, reputation/trust evidence, community trainer update path, malicious-content screening, **fail-closed** trust behavior (closes D09), correct pagination/cursor behavior (closes D10), certificate/trust-root correctness. Arbitrary downloaded executable/script content must never silently execute. **Sequence first:** establish what is actually deployed and its provenance (closes D17) before building further on top of it.

**Repository / Technology Adoption.** Sigstore/cosign (PARTIAL — optional provenance layer only; core Ed25519 catalog-signing trust root unchanged). YARA-X (PARTIAL — content classification/screening for community packages).

**Preserved Work Inputs.** None specific to this phase.

**Known Defects Closed.** D09, D10, D17.

**Verification Requirements.** Live-repro regression tests building on Audit 2's own harnesses; a deployment-provenance audit of the actual running backend before further backend work proceeds; fail-closed behavior tests for every trust-boundary decision.

**Exit Gate.** Community workflow certified safely end-to-end; deployed backend code traceable to a specific commit; zero fail-open trust defaults remain.

**Prohibited Shortcut.** Do not build new backend features on top of an unverified, undocumented deployment — establish provenance first, per Audit 2's own explicit sequencing.

---

### PHASE 8 — Save Editing, Backup & Recovery

**Objective.** Replace demo/fake save support with real-game save capability.

**Why This Phase Exists.** All 5 "binary format" save adapters are SOLITH-invented demos over one identical field map with zero real commercial binary saves supported (D12); the TrainerHost single-slot backup defect can destroy a pristine original on a second write (D11).

**Current State.** Save discovery PARTIAL; save editing PARTIAL; save rollback PARTIAL.

**Mandatory Work.** Save discovery, format detection, structured parsing, support for real commercial game formats (starting with the curated flagship titles), pre-edit backup, versioned backup history, transactional writes, pristine-original preservation, rollback, corruption detection, diffing, validation, user preview, restore, disaster recovery. Fix the known one-slot `.trainer-backup` defect (D11) at all 4 sites. Do not claim arbitrary binary save support beyond what is actually validated (closes D12 honestly, not by relabeling the demos).

**Repository / Technology Adoption.** Ludusavi (PARTIAL — backup/restore/dry-run/compare architecture concepts). ludusavi-manifest (PARTIAL — MIT-licensed schema/tooling as a design reference only; the PCGamingWiki-derived CC BY-NC-SA 3.0 data is **never bundled**, per the certified 0.13.5 shipping model).

**Preserved Work Inputs.** None.

**Known Defects Closed.** D11, D12.

**Verification Requirements.** Format-specific parity tests against real save files for the curated flagship titles (binary-format reverse-engineering cannot be validated synthetically); backup/rollback stress tests covering the exact 4 fixed sites.

**Exit Gate.** Real-game save validation complete for at minimum the curated flagship-title roster; zero SOLITH-invented "binary format" is presented to the user as if it were general commercial format support.

**Prohibited Shortcut.** Do not ship a 6th synthetic demo format and count it as "real save support."

---

### PHASE 9 — Mod / Game Modification Platform

**Objective.** Ship a real, LOCKED V1 mod/game-modification platform.

**Why This Phase Exists.** Mods have never existed in any commit on any ref (confirmed `NOT_A_DEFECT` — a pure owner scope decision, not a regression) and the owner's locked intent requires them in V1.

**Current State.** Mod discovery/installation/conflicts ABSENT.

**Mandatory Work.** Mod discovery, install, uninstall, enable/disable, profiles, dependency modeling, conflict detection, load-order concepts where relevant, version compatibility, game-specific adapters, configuration editing, file modification, asset modification where formats are understood, backup, rollback, restoration, mod creation/editing where technically supported. No anti-cheat bypass. No competitive multiplayer cheating.

**Repository / Technology Adoption.** BepInEx (PARTIAL, separately bounded — optional, separately-distributed Unity/.NET mod-loader companion; never statically linked or source-vendored into SOLITH's own bundle, per the LGPL-2.1 compliance architecture in §7). Harmony (PARTIAL, BepInEx-mediated only — runs inside the target game's .NET runtime via an optional SOLITH-authored BepInEx plugin, never a direct SOLITH dependency).

**Preserved Work Inputs.** None.

**Known Defects Closed.** None (absence, not a regression).

**Verification Requirements.** A compliance-boundary CI gate proving no BepInEx source is vendored into SOLITH's own repo/bundle; mod lifecycle tests on real games.

**Exit Gate.** Mod lifecycle certified on real games; LGPL-2.1 compliance boundary CI-enforced, not merely documented.

**Prohibited Shortcut.** Do not vendor a single BepInEx source file into SOLITH's own bundle "temporarily." Do not target anti-cheat-protected multiplayer titles.

---

### PHASE 10 — Core Convergence, Workflow & QOL

**Objective.** Make every prior subsystem behave like one product.

**Why This Phase Exists.** Scanner, memory engineering, identity, trainer runtime, CT, Trainer Creator, community, saves, and mods are built as increasingly capable but still separate subsystems through Phase 9; this phase connects them, and is also where the UI dependency the owner explicitly re-approved (Radix/shadcn, superseding the 2026-07-09 decision) is adopted at its foundational, cross-cutting scope.

**Current State.** No dedicated capability-matrix row — this phase is integration, not a new capability family.

**Mandatory Work.** Consistent navigation; one game context; one trainer context; one session context; undo/recovery consistency; keyboard-first workflows; controller-friendly interaction where useful; drag/drop; searchable/filterable surfaces; customizable workspaces; progress/status UX; error clarity; autosave; recovery; no dead controls; no fake controls; no disconnected duplicated subsystems.

**Repository / Technology Adoption.** Radix UI Primitives (FULL, owner-approved — every hand-rolled dialog/menu/tooltip component migrated incrementally, proving clean build/package/fresh-clone at each step, never a big-bang rewrite). shadcn/ui (FULL, owner-approved — copy-in components re-themed to SOLITH's existing CSS-token system; Tailwind is explicitly not introduced as a parallel styling system). Motion (FULL — application-chrome transitions). react-resizable-panels, dnd-kit (FULL — layout and reordering).

**Preserved Work Inputs.** None.

**Known Defects Closed.** None directly.

**Verification Requirements.** A11y checks per migrated component; existing UI test suites extended; a clean build/package/fresh-clone check after each incremental Radix/shadcn migration step (owner's explicit requirement — this is not optional polish).

**Exit Gate.** No dead or fake controls remain anywhere in the product; every subsystem built in Phases 1–9 is reachable through one consistent navigation and session model.

**Prohibited Shortcut.** Do not perform a big-bang Radix/shadcn rewrite. Do not introduce Tailwind as a second, parallel styling system alongside the existing CSS custom-property system.

---

### PHASE 11 — Wisp Consolidation & Animated In-Game Interface

**Objective.** Rebuild/consolidate Wisp against certified core systems as an optional, never-required animated interface.

**Why This Phase Exists.** Wisp currently has a data/state model but zero animation runtime on the certified branch; a materially fuller but defect-laden implementation exists, unmerged, on `feature/adaptive-wisp-platform`, whose visual layer is confirmed superseded but whose consent/control-plane code is genuinely valuable.

**Current State.** Wisp shell PARTIAL (certified) / PRESERVED_NOT_INTEGRATED (unmerged branch); Wisp animation ABSENT; Wisp adaptive behavior PRESERVED_NOT_INTEGRATED; Wisp overlay/Game Bar PRESERVED_NOT_INTEGRATED; Local AI IMPLEMENTED_UNVERIFIED.

**Mandatory Work.**
- Adopt Rive as primary character/state animation, PixiJS for capped 2D visual effects, Motion for app-shell/interface motion only, Three.js for optional/lazy 3D Wisp, Windows App SDK for native Windows integration where appropriate, Win2D reference-only unless a future native-rendering requirement proves need.
- Required Wisp behaviors where assets allow: idle, breathing, attentive, thinking, happy, smile, wave, twirl/spin, celebrate, warning, concern, success, failure response, scan response, trainer activation response, discovery response, sleep/quiet mode, interaction response. Wisp should react to active game, scan state, trainer state, discoveries, warnings, compatibility, progress, community verification.
- Optional: Ollama reasoning, ONNX local perception/inference, whisper.cpp voice input, Three.js 3D presentation — each independently optional from Wisp's visual profile.
- Required resource modes: OFF, LOW_POWER, STANDARD, ENHANCED, 3D_OPTIONAL, per the frozen 5-tier budget (§7, doc 27): concrete CPU/GPU/memory/VRAM/FPS targets and a hard particle cap (200 STANDARD / 500 ENHANCED, enforced in code). Respect reduced-motion (OS-level and SOLITH-level) and the frozen resource budgets. Wisp is never required to operate SOLITH — every function must be reachable and fully functional with Wisp OFF (an architectural invariant, not a feature — and one Audit 2 already found violated once, in `AppSidebar`'s Wisp-chip-gated `library` route, which must be fixed as part of this invariant, not incidentally).
- Selectively integrate the preserved adaptive-Wisp security/consent work where still appropriate (§8), fixing its three named defects as a condition of landing, not inheriting them silently.
- The static old Wisp visual implementation is superseded by the new stack — do not attempt to revive it.

**Repository / Technology Adoption.** Rive runtime + react (FULL). PixiJS (FULL). Motion (Wisp-chrome use; primary adoption phase 10). Three.js (PARTIAL, lazy-loaded only). Windows App SDK (PARTIAL). Win2D (REFERENCE_ONLY, not scheduled). Ollama (PARTIAL, already-live formalization). ONNX Runtime (PARTIAL, CPU/DirectML only). whisper.cpp (PARTIAL). PresentMon (consumer of Phase 14's telemetry adoption, for Wisp performance-impact reporting).

**Preserved Work Inputs.** `feature/adaptive-wisp-platform` — consent/authority subsystem and adaptive/quick-slot control plane (both `CHERRY_PICK_SELECTED_HUNKS`, per §8, with named defects fixed on landing). `review/adaptive-wisp-increment4-security` commit `4a8ca91` (`CHERRY_PICK_SELECTED_HUNKS`). Visual layer explicitly `SUPERSEDED_BY_NEW_STACK` — not an input.

**Known Defects Closed.** None of D01–D18 directly; the three named adaptive-Wisp functional defects (dead `toggle`, unreverted `momentary`, defeated compatibility gate) become fix conditions of this phase if the corresponding preserved code is cherry-picked (§6, "already-closed and not-a-defect" note), and the Game Bar transport's persistent-bearer-token defect (§5, Wisp overlay row) must close before that subsystem integrates.

**Verification Requirements.** State-machine transition smoke tests; Electron/Chromium render-mount tests; particle-cap enforcement tests; profile-ladder resource measurement against the engineering targets in §7's frozen budget (empirical, not assumed); real-game CPU/GPU-contention scenario for the game-focus step-down behavior.

**Exit Gate.** Wisp function/animation/performance certified against the frozen resource budget with real measurements, not engineering-target assumptions. Wisp OFF proven to leave 100% of trainer/scanner/catalog/Creator functionality reachable.

**Prohibited Shortcut.** Do not ship Wisp with an unenforced particle cap ("tuned down" instead of code-enforced). Do not cherry-pick the adaptive-Wisp control plane without fixing its three named defects first. Do not let any core navigation path depend on Wisp being visible.

---

### PHASE 12 — Real-Game Certification Program

**Objective.** Prove every certified capability against real commercial games, not synthetic fixtures.

**Why This Phase Exists.** Audit 2's central finding across this entire estate: fixture-only and mock-only "certifications" have repeatedly been shown to hide real defects (95.5% unread memory, 91.7% catalog dead-ends, a self-invalidating Wisp certification). This phase is the structural fix — certification is only ever with respect to a real, running, commercial game.

**Current State.** Only Stardew Valley has been exercised in prior audits; Palworld, DREDGE, Crimson Desert, Baldur's Gate 3, and Starfield are confirmed installed/available but not yet exercised; Atomfall's "certification" was found invalid (self-skipping suites).

**Mandatory Work.** Minimum 10 commercial games, minimum 5 distinct engine/runtime families. The 7 curated flagship titles already give 5 distinct families (Stardew Valley: XNA/MonoGame; Palworld: Unreal Engine; DREDGE: Unity; Crimson Desert: proprietary; Baldur's Gate 3: Divinity 4.0; Starfield: Creation Engine 2; Atomfall: Unreal Engine — Palworld and Atomfall share a family), so the minimum-diversity gate is already satisfiable from the curated 7; select 3 additional titles specifically to broaden engine coverage further and to stress-test save/mod/community paths the curated 7 do not exercise. All 10 must prove correct game identity, correct process attach, honest memory coverage, scanner operation. At least 6: reversible write, freeze, rollback. At least 5: real trainer execution. At least 3: restart-stable rediscovery. Also exercise CT, saves, mods, community, and Wisp where applicable. If 10 games reveal insufficient architectural diversity, expand before certification.

**Repository / Technology Adoption.** None new — this phase exercises what Phases 1–11 already adopted.

**Preserved Work Inputs.** None.

**Known Defects Closed.** None directly; this phase is where every prior phase's exit-gate claims get their real-game proof.

**Verification Requirements.** A recorded, per-game evidence artifact for every claim above (matching the standard Audit 2 already applied to Stardew Valley) — no self-skipping suite may count as evidence, and no evidence artifact may be assumed to exist without being committed.

**Exit Gate.** All 10 games' required proofs recorded with committed evidence artifacts. No phase completion is granted from this program until evidence is adequate — an inadequate 10-game sample must be expanded, not waived.

**Prohibited Shortcut.** Do not repeat the Atomfall pattern — a suite that self-skips on every machine but one, with no committed evidence artifact, is not a certification.

---

### PHASE 13 — Safety, Security & Recovery Hardening

**Objective.** Harden the game-scoped authority, consent, and recovery surfaces to a shippable standard.

**Why This Phase Exists.** Electron/IPC hardening is already CERTIFIED, but real gaps remain: an unhandled promise rejection on transient disk-write failure kills the main process (D15), packaged builds don't gate `SOLITH_PRIVILEGED_CONSENT`/`SOLITH_SKIP_ONBOARDING` (D16), and database corruption/migration recovery is confirmed broken.

**Current State.** Security PARTIAL; Recovery PARTIAL.

**Mandatory Work.** Authority boundaries, process containment, stale-process rejection, memory-write validation, safe freeze lifecycle, transactional rollback, backups, corrupted-save recovery, trainer/script isolation, community-content protection, malicious-package detection, emergency revert, consent, auditability, update security, signing integrity, IPC hardening, packaged-runtime validation. Fix D15 (unhandled promise rejection) and D16 (env-var gating) explicitly. Fix the database corruption/migration-recovery gap (quarantine, no throw-out-of-init on corrupt/truncated/non-SQLite input). Close the Game Bar transport's persistent-bearer-token defect before that subsystem is considered integrated (cross-referenced from Phase 11).

**Repository / Technology Adoption.** MinHook (PARTIAL — PRIMARY hooking, replaces `hook-engine.ts`'s hand-rolled code-cave mechanism). Microsoft Detours (FALLBACK — reactive only). PolyHook 2 (SPECIALIST — vtable/exception-directory hooking only). These are game-instrumentation tools only — no generic PC authority.

**Preserved Work Inputs.** `preserve/review-gate2-5-working-tree-2026-09-12`'s live-memory attach-path trust fix and `<img src>` scheme allowlist (both `CHERRY_PICK_SELECTED_HUNKS`, conditional on confirming the certified branch shares the underlying gap — see §8). `review/adaptive-wisp-increment4-security`'s reattach/PID-reuse/freeze-expiry proofs inform this phase's session-security work.

**Known Defects Closed.** D15, D16.

**Verification Requirements.** Failure-injection tests for every listed failure mode (permission disappears mid-operation, temp write fails, atomic replacement fails, interruption during operation, backup corruption, rollback target locked); a packaged-build test proving the env-var gates are actually enforced (`app.isPackaged`-gated), not merely present in source.

**Exit Gate.** Every failure-injection scenario resolves to either "the original remains unchanged" or "a verified backup exists with a recorded recovery state" — no third outcome. D15 and D16 closed and packaged-build tested.

**Prohibited Shortcut.** Do not gate `SOLITH_PRIVILEGED_CONSENT` behind a check that itself only runs in dev builds.

---

### PHASE 14 — Release-Candidate Hardening

**Objective.** Turn the complete system into a polished release candidate.

**Why This Phase Exists.** Every functional phase above must still be packaged, documented, and legally clean before release; SOLITH's own shipped `LICENSE`/`THIRD_PARTY_LICENSES.md`/CT-table attribution gaps (distinct from this roadmap's own 100%-clear candidate-repo licensing) are still open.

**Current State.** Installer/build/package CERTIFIED (baseline); Legal/license provenance PARTIAL; Telemetry ABSENT.

**Mandatory Work.** Performance profiling, resource use, memory leaks, long-running sessions, crash recovery, UI polish, accessibility, onboarding, tutorials, documentation, migration, upgrade behavior, installer, uninstall, update flow, offline behavior, telemetry/privacy behavior, error recovery, packaging, signing, clean-machine install, fresh-profile install, no fake/placeholder UI, no dead controls, no stale docs. Legal/license revalidation: add the missing `LICENSE` file (`package.json` already claims MIT), complete `THIRD_PARTY_LICENSES.md` (currently omits react/react-dom/sql.js/tesseract.js/xml2js/yaml/yauzl/zod/Electron), address the unaddressed video asset, and resolve the 299 community-authored CT tables redistributed with no attribution or license (Audit 2's own characterization: "the largest unaddressed commercial exposure"). Third-party notices; CT redistribution boundaries; mod/license boundaries; model-license boundaries; provenance. Close D18 (the `nul` tasklist-dump hygiene check) as part of clean-machine install verification.

**Repository / Technology Adoption.** Windows App SDK (packaging polish, cross-referenced from Phase 11). PresentMon (PARTIAL — spawn the official release binary for frame-timing telemetry, feeding Phase 11's Wisp performance reporting and this phase's own performance-profiling requirement).

**Preserved Work Inputs.** None new.

**Known Defects Closed.** D18.

**Verification Requirements.** Fresh-clone/build/package validation; fresh Windows machine installation; a re-run of the full license audit against the actual shipped artifact (not just the candidate-repo inputs this roadmap governs).

**Exit Gate.** Clean-machine and fresh-profile installs both proven; `LICENSE` and `THIRD_PARTY_LICENSES.md` both complete and accurate against the actual shipped dependency set; CT-table attribution question dispositioned (attributed, or excluded from redistribution).

**Prohibited Shortcut.** Do not ship with a `THIRD_PARTY_LICENSES.md` that omits dependencies actually bundled. Do not leave the 299 unattributed community CT tables in the shipped catalog without an explicit disposition.

---

### PHASE 15 — Final Whole-Product Certification & SOLITH 1.0

**Objective.** Certify the complete product as SOLITH 1.0. **100% mandatory — no optional completion gate.**

**Why This Phase Exists.** Every phase above closes its own scope; this phase is the whole-product gate that nothing may bypass.

**Current State.** N/A — this phase's entire content is the aggregate exit criteria of Phases 1–14.

**Mandatory Work.** Zero known P0 defects. Zero known P1 defects. Every roadmap requirement dispositioned. All required automated tests green. Fresh clone/build/package green. Fresh Windows machine installation proven. Scanner, advanced memory, identity, native trainer, CT compatibility, Trainer Creator, automatic discovery, community, saves, mods, Wisp, recovery, and security all certified per their own phase's exit gate. Legal/license gate green. Signing green. 10-game certification (Phase 12) green. Documentation complete. Onboarding complete. No fake UI. No placeholder product claims. No unresolved critical/high security finding. Reproducible release artifact. Final whole-repo Audit-3-style certification.

**Repository / Technology Adoption.** None new.

**Preserved Work Inputs.** None new — this phase confirms every preserved-work item from §8 reached a terminal, non-provisional state somewhere in Phases 1–14.

**Known Defects Closed.** Confirmation that D01–D18 are all closed (or, for any that prove genuinely out of scope for 1.0, explicitly and separately re-classified with owner sign-off — never silently dropped).

**Verification Requirements.** A fresh, independent whole-repo certification pass in the style of Audit 2 itself — adversarial, evidence-demanding, real-game-based — run against the release candidate, not against development branches.

**Exit Gate.** SOLITH 1.0 is not COMPLETE until every mandatory gate above passes. There is no partial-credit version of this phase.

**Prohibited Shortcut.** Do not certify 1.0 on the strength of Phases 1–14's own internal exit-gate claims alone — this phase requires its own independent adversarial re-verification, exactly because Audit 1 (2026-09-12, pre-Audit-2) already showed that a prior "certification" can be wrong.

---

## 10. Future / Post-1.0

Kept explicitly separate. Does not contaminate V1 completion.

- Autonomous gameplay (carried forward from `MASTER_ROADMAP.md` SOL-14, never implemented, correctly relocated here rather than treated as active scope)
- Broader game-understanding agents (SOL-generation intent, same disposition)
- Additional 3D/avatar sophistication beyond Phase 11's 3D_OPTIONAL tier
- Larger game-certification matrix beyond Phase 12's 10-game minimum
- Additional engines/platforms
- Advanced accessibility automation
- Optional experimental instrumentation
- Further community intelligence
- Advanced AI-assisted gameplay analysis (SOL-22 intent, same disposition)

---

## 11. Certification Rules

- `CERTIFIED` means reproducible evidence exists. Source presence does not equal certified. Test existence does not equal certified. Preserved-branch existence does not equal integrated. UI existence does not equal functional. Parser success does not equal runtime execution. Mock success does not equal real-game success.
- Fresh-clone / packaged-runtime / real-game distinctions remain explicit in every certification claim — never collapsed.
- A phase is complete only when: exact scope is defined; relevant source is inspected; no correct working system is rewritten unnecessarily; tests pass; type checking passes; production build passes; packaged behavior is tested where applicable; no security control is weakened; failure states are handled; database migrations are idempotent; restart behavior is correct; no unrelated user data is removed; known limitations are recorded; repository state is reviewed; exact commands/results are recorded; completion is never inferred from stale documentation.
- For file/resource editing work specifically, additionally require: approved target containment, proposal, preview, dry run, explicit approval, verified backup, atomic apply, validation, rollback/recovery evidence, journal/state persistence.
- After every significant implementation or verification cycle: update only the statuses actually affected; use current repository evidence; remove stale active test counts/baseline claims; keep historical claims in git history or an archive, not active sequencing; preserve explicit owner decisions; recalculate the single highest-priority next action.

---

## 12. Definition of SOLITH 1.0

SOLITH 1.0 is defined by Phase 15's exit gate in full, requiring at minimum:

- Zero known P0/P1 defects across the entire product.
- All 15 phases' individual exit gates satisfied with reproducible evidence.
- Mods, CT compatibility, community, and Trainer Creator all shipped in V1 (owner-locked decisions, §37 of the Step 0.13.5 evidence).
- The adaptive scan planner and automatic discovery capture both mandatory and shipped, not deferred.
- Wisp shipped as a genuinely optional, late-consolidated interface — never a functional dependency of any other capability.
- 10-game real-game certification (Phase 12) green, across at least 5 engine/runtime families.
- Full legal/license gate green, covering both the Step 0.13.5 candidate-repo inputs (already 100% clear) and SOLITH's own shipped dependency/asset/CT-table attribution (Phase 14).
- A reproducible release artifact and a final, independent, Audit-3-style whole-repo certification pass.

There is no partial or "mostly 1.0" state. Until every item above holds with reproducible evidence, the product remains pre-1.0 regardless of how many individual phases report complete.
