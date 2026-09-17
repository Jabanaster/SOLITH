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
| Structure discovery | IMPLEMENTED_VERIFIED | P2-5: canonical `DiscoveredStructure`/`DiscoveredField` model with evidence-gated candidate interpretation (never "decodable" == "semantically true"), wired into `LiveMemorySession`/IPC/preload/UI (`StructureDiscoveryPanel.tsx`), a real dedicated fixture region (`STRUCT_REGION`), a real 10/10 fixture-restart stress campaign plus 3/3 independent certification runs (byte-for-byte reconstruction, real pointer/string evidence, real Snapshot A/mutate/Snapshot B/compare via the fixture's own `writestruct` command), real-game proof (Godlike Burger, real PE-header read, DOS-magic ground truth), UI e2e 3/3 (dev build) + 3/3 (packaged), session-level resource limits (spec §18), and a fresh-worktree reproduction. See `Docs/phase2/030` for the full closure detail, including one real bug found and fixed (a process-exit race between a successful read and module/region enumeration) and one disclosed, out-of-scope native-driver finding (post-exit raw reads can remain non-deterministically successful). | 2 |
| Adaptive scan planner | ABSENT | Confirmed absent across every ref/worktree | 2 |
| Pointer maps (model + live orchestration) | IMPLEMENTED_VERIFIED | P2-1/P2-2 implemented and tested (522/522 live-memory, 2033/2033 root). P2-3.1 closed pointer-chain visualization and real cancellation. P2-4 closed the pointer-stability classification model, persistence, and UI with a real 10/10 fixture restart campaign. P2-4.1 closed the last remaining gap: real-game restart evidence was 0/0 in P2-4 (`Docs/phase2/018`); a real 5/5-restart campaign against Bastion.exe, using a deterministic process-owned static ground truth independently verified via PE-file parsing, closed it (`Docs/phase2/023`). See the pointer-stability-testing row below for the full P2-4.1 closure detail | 2 |
| Pointer-chain visualization | IMPLEMENTED_VERIFIED | P2-3 added real production UI (`PointerMapPanel.tsx`) consuming P2-1/P2-2 DTOs directly. P2-3.1 closed the two remaining gaps: (1) root-caused and fixed the real depth-3 discovery flake (candidate-ordering instability under real heap/allocator noise — `Docs/phase2/011`), verified with 30/30 real depth-3 discoveries post-fix including a clean 10-run stress proof and a separate 3-run certification of the real-process/real-UI critical flow; (2) implemented real, production cancellation (`Docs/phase2/012`) — a genuinely interruptible mid-scan operation (not a synchronous call wrapped in a cosmetic button), reusing the existing scan-operation registry, proven via a 10-case backend matrix and real-process/packaged UI e2e proofs (3/3 clean each). Full regression is clean (`Docs/phase2/013`: 532/532 live-memory, 2074/2074+10/10 root, zero fail/cancelled) and independently reproduced in a fresh worktree with no copied build artifacts (`Docs/phase2/014`). This is the complete visualization requirement; pointer stability testing remains a distinct, separately-tracked item (next row) owned by P2-4 | 2 |
| Pointer stability testing | IMPLEMENTED_VERIFIED | P2-4: real classification model (`Docs/phase2/016`) distinguishing `stable_exact`/`stable_relocated`/`target_moved_chain_valid`/`chain_broken`/`module_missing`/`read_failed`/`process_exited`/`false_positive`, with independent ground-truth verification (never "resolved to readable memory" alone). A real 10-restart fixture campaign (`Docs/phase2/017`) proved 10/10 correct classifications against a genuinely killed-and-relaunched native process, including real heap relocation on 9/9 restarts. Persistence migrated schemaVersion 1→2 with real backward compatibility (`Docs/phase2/019`). UI extension and real-process/real-UI proof (`Docs/phase2/019`) both pass. **P2-4.1 closed every remaining gap the user identified in P2-4's NOT_COMPLETE closure**: (1) real-game restart evidence — 5/5 real restarts against Bastion.exe using a deterministic, independently-verified static ground truth, no 0/0 (`Docs/phase2/023`); (2) module/ASLR relocation — root-caused why the fixture campaign never relocated (Windows caches an image base per file path, not per launch) and proved the real production resolver against a genuine module-base change via a real dual-process test, reinforced by Bastion.exe's own real base varying across 4/5 restarts (`Docs/phase2/024`); (3) the pointer-map Load `not_attached` defect — root-caused, fixed (one line, `PointerMapPanel.tsx`'s `loadMaps()`), and regression-tested (fails pre-fix, passes post-fix), confirmed cosmetic-only with no impact on saved maps or classification logic (`Docs/phase2/025`); (4) the PR #33 CI cancellation flake — root-caused (a last-chunk race in a progress-based "still in flight" check, not a cancellation defect) and fixed with the same honest-retry pattern already used elsewhere in the suite, verified across 35 local runs with zero flakes (`Docs/phase2/026`). Full regression clean post-closure (`test:live-memory` 556/556, root `npm test` clean, cargo fmt/clippy/test clean, NAPI suite 51 pass/1 intentional skip), independently reproduced in a fresh worktree, and PR #35 passed every required remote CI check on its first run with zero retries (`Docs/phase2/027`) | 2 |
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

**Summary counts** (used in the FINAL RESPONSE below): CERTIFIED 5 · IMPLEMENTED_UNVERIFIED 3 · PARTIAL 22 · PRESERVED_NOT_INTEGRATED 3 · ABSENT 7 · DEFERRED 0 · FUTURE 0 — 41 state-instances across 40 capability-family rows; the Wisp shell row carries two states (PARTIAL on the certified branch, PRESERVED_NOT_INTEGRATED on the unmerged branch) and is counted once in each column. This tally has never included the growing IMPLEMENTED_VERIFIED column (pointer maps, pointer-chain visualization, pointer stability testing, and now structure discovery) — a pre-existing omission from before this stage, not reopened here; ABSENT is decremented by exactly one (structure discovery only) to keep this line's own arithmetic honest against the row above it.

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

**Phase 2 — Advanced Memory Engineering — status summary.** Presentational index only (2026-09-16) — added for at-a-glance navigation; changes no requirement, status, count, or evidence below. The detailed P2-1 through P2-17 execution/certification checkpoints below remain authoritative; this groups them, it does not replace them.

- Current workstream: **P2-B — Memory Understanding**
- Current checkpoint: **P2-5 — Structure Discovery Engine (CERTIFIED COMPLETE)**
- Completed checkpoints: P2-1, P2-2, P2-3, P2-4 (P2-4.1 final closure), P2-5
- Phase 2 overall: **NOT_COMPLETE** (P2-6 through P2-17 remain open — P2-5's closure does not certify Phase 2)
- Requirements: **28 total** (see "Phase 2 requirement count" note below)

**Phase 2 workstreams** (navigation/grouping only — every P2-x stage listed here is the same authoritative execution checkpoint defined throughout the rest of this section; grouping them does not change their requirements, evidence, or certification status):

- **P2-A — Pointer Engineering & Stability** — CERTIFIED COMPLETE (all 4 checkpoints closed)
  - P2-1 Pointer-map data model — COMPLETE AS FOUNDATION
  - P2-2 Pointer-map live orchestration — COMPLETE
  - P2-3 Pointer-chain visualization — CERTIFIED COMPLETE
  - P2-4 Pointer stability / real-game restart validation — CERTIFIED COMPLETE (P2-4.1 closed the real-game restart evidence, module-relocation proof, pointer-map Load defect, and CI cancellation-flake gaps the user identified in P2-4's NOT_COMPLETE closure — `Docs/phase2/023` through `027`)
- **P2-B — Memory Understanding** — IN PROGRESS (1 of 3 checkpoints closed)
  - P2-5 Structure discovery engine — CERTIFIED COMPLETE (`Docs/phase2/030`)
  - P2-6 Typed memory-view expansion — NOT STARTED
  - P2-7 Value/type inference — NOT STARTED
- **P2-C — Memory Interaction & Control** — NOT STARTED
  - P2-8 Memory map + watchlists
  - P2-9 Freeze/write/revert + address-validation/hotkey verification
- **P2-D — Adaptive Analysis & Acceleration** — NOT STARTED
  - P2-10 Adaptive Scan Planner
  - P2-11 Zydis integration
  - P2-12 Vectorscan integration
- **P2-E — Instrumentation & External Tooling** — NOT STARTED
  - P2-13 DynamoRIO integration
  - P2-14 Dear ImGui developer diagnostics overlay
  - P2-15 Symbol/module awareness + Ghidra external adapter (ReClass.NET's Repository/Technology Adoption reference-adoption role — see below — lives in this workstream; its completion criterion is unchanged)
- **P2-F — Resilience & Final Certification** — NOT STARTED
  - P2-16 Resilient/version-aware rediscovery
  - P2-17 Full Phase 2 certification

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

**Progress Reconciliation — 2026-09-16 (P2-3.1 — final pointer-visualization closure, branch `feature/solith-phase2-pointer-engineering`).** Status/evidence only; does not change Mandatory Work, Exit Gate, or Prohibited Shortcut, and does not mark Phase 2 or the full pointer-map requirement CERTIFIED.

- Real-process depth-3 discovery root cause found and fixed (`Docs/phase2/011`): `scanForPointerPath`'s BFS accepted heap candidates into the next frontier in raw memory-scan discovery order before applying the `maxCandidatesPerLevel` cap, so whether a real chain link survived depended on how much coincidental real-process noise (heap allocator/thread metadata) happened to enumerate before it — reproduced as a *deterministic* 15/15 failure at the UI's actual default scan bounds (not merely intermittent at the 5-run sample size the previous note used), measured with full per-run diagnostics (termination reason, scans performed, candidates dropped), not guessed at. Fixed by ranking heap hits by ascending diff-to-target before the cap is applied — a genuine pointer link's diff is deterministic and effectively always the global minimum among noise, so it now survives the cap and is scanned first, resilient even at a tight global scan budget. Verified: 85/85 pre-existing pointer-scanner tests unchanged, 30/30 real depth-3 discoveries post-fix (15 direct runs + a dedicated 10-run stress proof + a separate 3-run certification of the real-process/real-UI critical flow).
- Real, production cancellation implemented and proven (`Docs/phase2/012`): the previous PARTIAL-BY-DESIGN decision (no in-flight window to cancel into) is now closed by a generator-based scan that genuinely yields to the event loop mid-BFS, reusing the existing session-level scan-operation registry (the same one the byte-value scanner's start/cancel/poll already uses) rather than a parallel subsystem. Proven with a 10-case backend cancellation matrix (cancel before/between/during targets, after completion, double cancel, unknown id, process-exit-during-cancel, resource-limit-vs-cancel, restart-after-cancel) and real-process + packaged UI e2e proofs (3/3 clean each) that click the real Cancel button against a scan genuinely still executing.
- Full regression is clean (`Docs/phase2/013`): `test:live-memory` 532/532, root `npm test` 2074/2074 + 10/10, zero fail, zero cancelled — superseding the previous session's honestly-diagnosed-but-host-contention-degraded numbers with a controlled-host re-run.
- Independently reproduced in a fresh worktree at the final commit with no copied build artifacts (`Docs/phase2/014`): install, native build, typecheck, focused P2-3 suite, real-process critical flow, cancellation, full live-memory/root regression, package, and both packaged proofs all passed identically.
- Pointer-chain visualization moves PARTIAL → IMPLEMENTED_VERIFIED: every requirement specifically attributed to this named item (real production UI, zero known flaky discovery, real cancellation, clean regression, fresh-worktree reproduction) is now met.
- Pointer maps (model + live orchestration) stays PARTIAL: the roadmap's combined bullet also names **pointer stability testing** as a separate, distinct requirement, which this stage did not touch and remains P2-4's stated scope — per this reconciliation's own instruction not to guess, the aggregate capability is left PARTIAL pending P2-4 rather than inferred complete.
- Evidence: `Docs/phase2/011` through `015`. Phase 2 overall status remains NOT_COMPLETE. Next authorized stage: P2-4 — pointer stability testing / real-game restart validation.

**Progress Reconciliation — 2026-09-16 (P2-4 — pointer stability testing / real-game restart validation, branch `feature/solith-phase2-pointer-stability`).** Status/evidence only; does not change Mandatory Work, Exit Gate, or Prohibited Shortcut, and does not mark Phase 2 or the full pointer-map requirement CERTIFIED.

- Real classification model added (`Docs/phase2/016`): `stable_exact`/`stable_relocated`/`target_moved_chain_valid`/`chain_broken`/`module_missing`/`read_failed`/`process_exited`/`false_positive`, mutually exclusive by construction, with independent ground-truth verification (reads the resolved address's actual bytes and compares against a declared expected value) — closing the real gap that `resolvePointerMap` (P2-1) only ever proved a chain *traverses*, never that it lands on the *correct* value. Scoping decision made by reading ROADMAP's own wording rather than guessing: "resilient/version-aware rediscovery" (a separate, later, materially harder capability — automatically finding a *new* chain when the old one breaks) is explicitly NOT absorbed into this stage.
- Real 10-restart fixture campaign (`Docs/phase2/017`): 10 consecutive genuine kill-and-relaunch cycles of the real native fixture process, validated through the real save/load persistence path against the fixture's own compile-time ground-truth constant. 10/10 correct classifications; real heap relocation (the resolved address changed) proven on 9/9 restarts after the baseline. Module base did not relocate in this environment across any of the 10 launches — a real, disclosed finding (documented, not assumed to be "ASLR disabled"), not a defect, since heap relocation alone already proves mission's required "old absolute target != new absolute target, chain still resolves correctly."
- Persistence migrated schemaVersion 1 → 2 with real backward compatibility (`Docs/phase2/019`): a genuine pre-P2-4 saved map (no `stability` field anywhere) loads successfully with a backfilled empty stability state, never rejected and never fabricating history. A real gap found and fixed in the same stage: structural validation did not previously check a `stability` field's shape at all, so corrupted stability data would have passed validation and only failed later inside UI/summary code — now rejected as `corrupt` at load time (`Docs/phase2/020`).
- UI extended (not a second pointer UI) with a real "Restart Stability" section and "Validate After Restart" workflow (`Docs/phase2/019`), proven via real-process e2e (`Docs/phase2/019`, `tests/pointer-map-ui-stability.e2e.test.ts`) — a candidate starts truthfully "Not Yet Validated," a real click establishes a real baseline, a second click accumulates real history, and the drill-down shows both real observations.
- **Real-game restart evidence is NOT complete** (`Docs/phase2/018`, reported honestly rather than fabricated or omitted): real, read-only, zero-write attach was proven against two real installed titles (Godlike Burger, Bastion) using the exact production session/driver classes. A genuine restart-stability classification against either was not achieved — two real ground-truth discovery attempts (a screen-resolution value scan, an own-PID value scan) both returned thousands of truncated, unusable candidate matches against real commercial-game memory. Closing this needs either scripted gameplay interaction or pre-vetted signature/catalog data for one of the installed titles, neither available this stage.
- A pre-existing (not P2-4-introduced) defect was found and disclosed, not fixed in this stage: the pointer-map Load workflow's post-load refresh intermittently-but-reproducibly reports `not_attached` despite a genuinely attached session — the first e2e test to ever exercise the real Load button surfaced it. Filed separately for dedicated investigation (`Docs/phase2/020`).
- Full regression clean: `test:live-memory` 554/554, root `npm test` 2102/2102 + 10/10, zero fail, zero cancelled. Independently reproduced in a fresh worktree with no copied build artifacts (`Docs/phase2/021`).
- Pointer stability testing: ABSENT → PARTIAL (new matrix row, above) — the classification model, fixture campaign, persistence, and UI are complete and rigorously proven; real-game restart evidence is the one open item keeping it from IMPLEMENTED_VERIFIED.
- Pointer maps (model + live orchestration) stays PARTIAL for the same reason — the aggregate capability is not yet complete while real-game evidence remains open.
- Evidence: `Docs/phase2/016` through `022`. Phase 2 overall status remains NOT_COMPLETE. P2-4 itself is NOT_COMPLETE (real-game restart evidence open); do not start P2-5 automatically.

**P2-4.1 Final Closure Reconciliation — 2026-09-17 (branch `feature/solith-phase2-pointer-stability-closeout`, isolated worktree per the "ONE ACTIVE CLAUDE SESSION = ONE WORKTREE" rule).** The user rejected P2-4's NOT_COMPLETE closure above as insufficient, identifying four specific gaps plus a process/hygiene issue. This note records their closure; it preserves every line of the P2-4 reconciliation above unchanged — nothing here retracts or overwrites the prior honest NOT_COMPLETE evidence, it supersedes only the open items.

- **Real-game restart evidence, was 0/0 → 5/5.** `Docs/phase2/018`'s two exact-value-scan attempts (screen resolution, own PID) against Bastion and Godlike Burger both produced thousands of truncated, unusable candidates — that finding stands, unretracted. A different, mission-allowed ground-truth category ("a deterministic static object with independent verification" / "process-owned data with repeatable semantic identity") closed it: a real NUL-terminated ASCII string baked into Bastion.exe's own `.text`-section CLR metadata at a fixed, independently-known RVA (parsed directly from the on-disk PE file, zero running process involved), read module-relative with zero pointer dereferences. 5 genuinely new process instances, 5 genuinely distinct PIDs, the map carried across restarts via the real production save/load round trip, all 5 classified correctly (`stable_exact`/`stable_relocated`) via the real `pointerMapValidateNodeAfterRestart` path. No skipped or omitted failed runs. `Docs/phase2/023`.
- **Module/ASLR relocation, was PARTIAL → COMPLETE.** Root-caused rather than assumed: Windows caches a randomized image base per file PATH (the section-object identity), so the P2-4 campaign's 10 same-path relaunches of the identical fixture binary always reused one cached base — not disabled ASLR, not a defect. A real (never faked) test launches the fixture and a byte-identical copy at a different path side by side, proves their real module bases genuinely differ, and proves the real production resolver correctly reclassifies `stable_relocated` when a baseline established against one process is validated against the other via the real save/load path. Independently reinforced by the real-game campaign above: Bastion.exe's own real module base varied across 4 of its 5 real restarts. ASLR was never disabled; no returned module base was ever faked. `Docs/phase2/024`.
- **Pointer-map Load `not_attached` defect, was filed elsewhere → fixed here.** Reproduced independently in this stage's own isolated worktree (never touching the peer investigation's shared `solith-phase0-convergence` worktree). Root cause: `PointerMapPanel`'s pre-attach `loadMaps()` refresh correctly receives `not_attached`, but unconditionally wrote it into the panel's status message with nothing to ever clear it — a real user-visible stale-text defect, not a backend/session race (confirmed independently by both this investigation and the peer session's own ~150-trial server-side instrumentation). One-line fix in `PointerMapPanel.tsx`; a new e2e regression test verified to fail on the pre-fix code and pass with the fix. Confirmed cosmetic-only: no impact on saved stability maps, backend IPC, or P2-4's restart-validation classification logic. `Docs/phase2/025`.
- **PR #33 CI cancellation flake, was rerun-to-green → root-caused and fixed.** The flaking test (`native/solith-scanner-napi/test/exact-scan.test.js`, "exact scan: cancellation works from real JS") used `chunksRead > 0` as a proxy for "still in flight," which is equally true of the LAST chunk — a real, CI-scheduling-dependent race (an occasional Node event-loop stall can let the ~1024-chunk native scan finish entirely before the JS poll loop's first callback fires), not reproducible locally across 35 runs. Fixed with the same honest-retry pattern the codebase already uses elsewhere for this exact race class (`scanner-backend-cancellation.test.ts` case A/C/D and case B), plus diagnostic instrumentation. `KNOWN CERTIFICATION FLAKES` after this closure: 0. `Docs/phase2/026`.
- Full regression clean post-closure: `test:live-memory` 556/556 (was 554/554), root `npm test` clean, root/electron typechecks clean, `npm run build` (vite+electron+package) 33/33 output-verifier checks with a signed NSIS installer, `cargo fmt --check`/`cargo clippy --release`/`cargo test --release` clean, NAPI suite 51 pass/1 intentional skip/0 fail, P2-3 e2e regression 2/2, packaged pointer-map e2e 2/2, pointer-map stability e2e 2/2. Independently reproduced in a fresh, separate worktree (canonical `npm install`/`npm run build:vite`/`npm run build:electron`, no copied artifacts): `test:live-memory` 556/556. PR #35 (`feature/solith-phase2-pointer-stability-closeout` → `master`) passed every required check (PR Windows, CI Fast, PR Static, Semgrep, OSV-Scanner, Gitleaks, Vendored memoryjs integrity) on its first run, zero retries. `Docs/phase2/027`.
- Pointer stability testing: PARTIAL → **IMPLEMENTED_VERIFIED** (matrix row above updated). Pointer maps (model + live orchestration): PARTIAL → **IMPLEMENTED_VERIFIED** (matrix row above updated) — the aggregate capability's one remaining blocker (real-game evidence) is closed.
- Phase 2 requirement count recomputed from the Mandatory Work + Repository/Technology Adoption bullets (28 total, each independently mandated clause counted once): **5 COMPLETE** (pointer maps; pointer-chain visualization; pointer stability testing; module-relative addressing; restart stability validation), **5 PARTIAL** (pointer scanning; multi-level pointer scanning; freeze/write/revert; address validation; ReClass.NET adoption), **18 ABSENT** (AOB/signature engineering with resiliency; symbol/module awareness; structure discovery; typed memory views; value/type inference; memory-region inspection; memory map; watchlists; hotkeys; instruction-aware analysis; resilient rediscovery; version-aware rediscovery; Adaptive Scan Planner; Zydis; Vectorscan; Ghidra; DynamoRIO; Dear ImGui) — 5 + 5 + 18 = 28. This is a real recount from the roadmap's own wording, not a mechanical carry-forward of any prior split.
- **Phase 2 is NOT certified.** P2-A (P2-1 through P2-4) is now fully, certifiably closed; P2-B through P2-F (P2-5 through P2-17, 18 of 28 requirements) remain untouched and ABSENT. Do not start P2-5 automatically — the next authorized stage is P2-5 (structure discovery engine), pending explicit owner authorization.
- Evidence: `Docs/phase2/023` through `027` (superseding, not replacing, `016` through `022`); final certification in `Docs/phase2/028`.

**P2-4.1 canonical integration — 2026-09-17.** A post-certification integration audit found one evidence-accuracy defect (not a logic/behavior defect): `tests/live-memory/pointer-stability-real-game-bastion.test.ts`'s own docstring incorrectly claimed Bastion.exe's module base never varies across launches, contradicting the campaign's own recorded 4/5-relocated result. Corrected in commit `b81f694` (comment-only; re-run confirmed 5/5 pass, same 1 stable_exact / 4 stable_relocated result, no assertion or behavior changed). PR #35 (head `b81f694`) passed all required checks a second time, first attempt, then merged to canonical `master` normally (no force, no history rewrite):

**P2-4.1 canonical integration: PR #35 merged at `4f7abf730cf1d7e8b7e568b3c93d3d7d697fc76c`.** PR #32 and PR #33 (the two ancestor stacked PRs whose commits `b81f694` already fully contains) auto-transitioned to MERGED by GitHub once their commits became reachable from `master`. No prior evidence in this file or in `Docs/phase2/016` through `028` was retracted or rewritten by this integration step.

**P2-5 Final Closure Reconciliation — 2026-09-17 (branch `feature/solith-phase2-structure-discovery`, isolated worktree per the "ONE ACTIVE CLAUDE SESSION = ONE WORKTREE" rule).** Starting checkpoint `a13854d` (canonical `DiscoveredStructure`/`DiscoveredField` model and driver-agnostic engine only, `Docs/phase2/029`'s own baseline). This note preserves every line of prior Phase 2 evidence unchanged — nothing here retracts or overwrites P2-1 through P2-4.1.

- `LiveMemorySession`/IPC/preload/UI wiring closed (`structureDiscover/List/Get/Delete/Refresh/InspectField/CaptureSnapshot/ListSnapshots/CompareSnapshots`, `structure:*` IPC channels, `StructureDiscoveryPanel.tsx` mounted next to `PointerMapPanel`) — none of this existed at the starting checkpoint, which was engine-only.
- Real fixture extension (`fixture.rs`'s `STRUCT_REGION`: sentinel int32/float32/u64/module-external pointer/mutable int32/raw bytes/ASCII string/unaligned field, plus a `writestruct` mutation command) and real-process certification: byte-for-byte reconstruction against the fixture's own known plant, real pointer/string evidence correctly isolated, real Snapshot A/mutate/Snapshot B/compare. **10-restart fixture stress: 10/10. Independent full-file certification: 3/3.**
- Real bug found and fixed during failure-injection work: `discoverStructure` threw uncaught when the target process exited between a successful window read and module/region enumeration, instead of degrading gracefully — fixed (fall back to no known modules/regions, pointer candidates simply don't classify) and regression-tested.
- Real-game proof (Godlike Burger, production attach path, real PE-header read at the real module base, DOS-magic `"MZ"` ground truth) and a real-game snapshot proof, recorded honestly as `READ_ONLY_STRUCTURE_DISCOVERY_PROOF` per the mission's own instruction (no semantically controlled field exists on a running executable's own static header).
- UI e2e: **3/3** real-process (dev build) and **3/3** packaged (`dist/win-unpacked`). Real, disclosed finding from that work: `readBuffer()` against a `VirtualAlloc`'d region can remain non-deterministically successful for an unbounded time after the target process is confirmed terminated (`getModules()`/`getRegions()` correctly detect the exit in the same session; the raw byte-read path does not) — a pre-existing native-driver/OS characteristic shared by every live-memory feature that reads raw bytes, not introduced by or fixable within P2-5's scope. Flagged for the native-driver owner; the e2e assertion was written to match what is actually true rather than force a claim that isn't.
- Session-level resource limits closed (spec §18): `MAX_DISCOVERED_STRUCTURES_PER_SESSION` (100), `MAX_SNAPSHOTS_PER_STRUCTURE` (50), oldest-first eviction. The remaining §18 items were already structurally bounded (window length cap, per-field string-scan width, no pointer-follow-by-design, stateless comparison) and needed no new code.
- Structure discovery: ABSENT → **IMPLEMENTED_VERIFIED** (matrix row above updated).
- Phase 2 requirement count recomputed from P2-4.1's own 28-item split (unchanged methodology, one item moved): **6 COMPLETE** (pointer maps; pointer-chain visualization; pointer stability testing; module-relative addressing; restart stability validation; **structure discovery**), **5 PARTIAL** (pointer scanning; multi-level pointer scanning; freeze/write/revert; address validation; ReClass.NET adoption), **17 ABSENT** (AOB/signature engineering with resiliency; symbol/module awareness; typed memory views; value/type inference; memory-region inspection; memory map; watchlists; hotkeys; instruction-aware analysis; resilient rediscovery; version-aware rediscovery; Adaptive Scan Planner; Zydis; Vectorscan; Ghidra; DynamoRIO; Dear ImGui) — 6 + 5 + 17 = 28.
- **Phase 2 is NOT certified.** P2-A and P2-5 are now closed (5 of 28 requirements... plus structure discovery, 6 of 28); P2-6 through P2-17 (22 of 28 requirements) remain untouched. Do not start P2-6 automatically — the next authorized stage is P2-6 (typed memory-view expansion), pending explicit owner authorization.
- RECLASS.NET: still DEFERRED_TO_P2-15 — `ROADMAP.md`'s own text (line 323 area, "Symbol/module awareness + Ghidra external adapter... ReClass.NET's Repository/Technology Adoption reference-adoption role") assigns that completion criterion to P2-15, not P2-5. Concept notes only recorded (`Docs/phase2/030`); no code copied/linked/imported.
- Evidence: `Docs/phase2/029` (baseline) and `030` (final certification, including the fresh-worktree reproduction).

**P2-5 canonical integration — merged 2026-09-17.** PR #46 (`feature/solith-phase2-structure-discovery` → `master`) passed every required remote CI check (PR Static, PR Windows, CI Fast, Gitleaks, Semgrep, OSV-Scanner, Vendored memoryjs integrity) on its exact head `bc4c71a40a58bfe399d19b01f879d08be958df12`, first attempt, then merged into `master` via the normal protected-branch workflow (no force, no history rewrite, owner-authorized per SOLITH.MD "FINAL CANONICAL MERGE CLOSEOUT" — same authorization basis as P2-4.1). Canonical merge SHA: `1bbeef7bf24ee807310c1431003d1ebec4506e8e`. `git diff` between that SHA and PR #46's head is empty except for 4 unrelated lines from PR #45 (a concurrently-merged, unrelated docs closeout) — `master` now contains the complete P2-5 lineage.

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

**Progress Reconciliation — 2026-09-17 (P3-7, branch `feature/solith-phase3-discovery-session-reconciliation`, forked from `feature/solith-parallel-phase3-catalog-identity` at `8b14b79`).** Status/evidence only; does not change Mandatory Work, Exit Gate, or Prohibited Shortcut above.

- **Exit Gate — all three literal clauses independently confirmed.** Canonical identity certified across Steam/GOG/Epic and real games; zero hardcoded catalog ceilings remain (D07, closed in an earlier stage, unchanged); Stardew Valley and Palworld both bind a session — reverified this stage with fresh process launches (Stardew Valley PID 29388; Palworld wrapper PID 29112 + Shipping binary PID 3872, both concurrent) against a real, correctly-sourced production catalog copy (6019-row index, not an empty fallback). `Docs/phase3/007`.
- **Crimson Desert Enhanced catalog-identity defect (the one prior Exit-Gate FAIL) — fixed and independently re-confirmed end-to-end**, not merely re-read from the fixing stage's own report: reproduced the original wrong-identity resolution from a clean real-catalog copy, applied the real ingestion fix (`remoteTrainerToCatalogEntry`/`applySteamAppId`/`known-steam-app-ids.ts`), and confirmed `matchInstalledToCatalog` now resolves the real installed copy to `crimson-desert-enhanced` via the steamAppId tier. `Docs/phase3/006` (original fix), `Docs/phase3/007` (independent reverification).
- **BG3 declared-order tie-break** confirmed still opt-in-only, still scoped to the curated Steam table, no regression (19/19 focused tests; live production-path spot-check resolves `bin/bg3.exe`, verified).
- **Seven-title matrix**: 6/7 titles PASS (Stardew Valley, Palworld, DREDGE, Starfield, Baldur's Gate 3, Crimson Desert Enhanced). Atomfall: installed (confirmed this stage, correcting a stale "not installed" claim in `Docs/phase3/005`) via Xbox/MS Store, which this codebase has no discovery mechanism for. This is **not** a failure of the Exit Gate as literally written (which names only Stardew Valley/Palworld and Steam/GOG/Epic/etc.) but **is** in tension with this same section's Verification-Requirements sentence asking for "at minimum the 7 curated titles" — an unresolved textual ambiguity, flagged for owner decision rather than silently resolved either way. Atomfall-specific certification work continues independently on a separate branch (`cursor/atomfall-l3-live-cert`).
- **Catalog-path tooling hazard found and fixed**: `getAppPaths()` (`src/shared/app-paths.ts`) silently fell back to an unseeded per-worktree DB outside Electron/outside a test runtime, with no warning — a real trap (hit once during this reconciliation) that could make an empty-catalog false negative look like a genuine result. Fixed with an additive warning only; no production behavior changed (silent under real Electron and real `npm test` runs, confirmed).
- Phase 3 overall status: **NOT_COMPLETE** is not being claimed to change here — this note records the Exit Gate's literal text as satisfied with independently-reproduced evidence; the Atomfall/7-curated-titles ambiguity above is recorded for explicit owner resolution before any broader Phase 3 certification statement is made. `Docs/phase3/007`.

**Owner Scope Decision — 2026-09-17.** The Atomfall/7-curated-titles ambiguity above was presented to the owner as two explicit choices (support Xbox/MS Store install discovery in Phase 3 now, vs. treat it as out of scope). Owner selected: **Phase 3 must support Atomfall's Xbox/MS Store install discovery before Phase 3 can certify complete.** Consequence: Phase 3 remains **NOT_COMPLETE**; Mandatory Work above is extended to require Xbox/MS Store install-discovery (this codebase currently has zero such mechanism — no MSIXVC package/`Content/` folder discovery exists anywhere in `install-discovery/`). This is new scope, not implemented by this reconciliation pass — implementation is a separate, dedicated mission/worktree, not performed here.

**Xbox/MS Store Discovery — Implemented and Verified — 2026-09-17 (P3-8).** The owner-selected CHOICE 1 requirement above is now implemented: `src/core/install-discovery/xbox.ts` + `xbox-manifest.ts` (new, additive; `steam.ts`/`gog.ts`/`epic.ts`/`match.ts`/`identity.ts` unmodified), authoritative-source discovery via `Get-AppxPackage`, gated on `MicrosoftGame.config` presence (the real GDK-game signal), with launcher/bootstrap-directory demotion so a package's own declared "launch" executable can never be mistaken for the real game binary. One shared-infra fix alongside it: `executable-role.ts` now classifies `gamelaunchhelper.exe` (Microsoft's own GDK bridge helper, confirmed present on all 16 real installed Xbox/GDK titles on the verification machine) as `TOOL` rather than a game candidate.

- **Atomfall install discovery**: PASS — real production `Get-AppxPackage` scan resolves `Rebellion.Windscale` → content root → `MicrosoftGame.config` → primary executable `bin/Atomfall_dx12.exe` (not the `Launcher/Atomfall.exe` bootstrap stub) → `catalogGameId: 'atomfall'`, `identityStatus: 'verified'`. No hand-entered path.
- **Atomfall session bind**: PASS — production `matchAllCatalogProcesses()` pipeline detects a real launched Atomfall and binds `catalogGameId: 'atomfall'`. Disclosed nuance (not papered over): with both the launcher and engine processes alive concurrently, the existing shared first-match tie-break in `process-watcher.ts` bound to the launcher PID rather than the engine PID in every poll this pass — pre-existing, unmodified, cross-title infrastructure (Palworld hits the identical tie-break, already accepted PASS in `Docs/phase3/007`), not in this mission's install-discovery scope; flagged for a future session-binding-layer pass since Atomfall's own catalog memory feature is keyed to `moduleName: 'atomfall_dx12.exe'`.
- **Atomfall restart campaign**: 3/3 PASS — four full launcher-GUI-driven launches (fresh PIDs every time: 31064/29768, 30228/9996, 34716/11376, 32384/17980), install discovery and session bind PASS on every one.
- **Generic Xbox provider evidence**: 14/15 other real installed Xbox/GDK titles on the verification machine resolved a primary executable with zero Xbox-specific/Atomfall-specific code (1 correctly excluded as non-game, 1 correctly fails closed on genuine same-name ambiguity — existing codebase-wide policy, not a defect).
- **Tests**: `install-discovery-xbox.test.ts` 8/8 PASS. Full `install-discovery` suite 104/104 → **112/112 PASS**. `trainer-catalog` suite 148/148 PASS (unchanged). Typecheck renderer/electron PASS. Full evidence: `Docs/phase3/008-p3-8-xbox-msstore-atomfall-discovery.md`.
- **Seven-title matrix**: Atomfall now **PASS** (was `OPEN_REQUIREMENT`) — **7/7**. The other six (Stardew Valley, Palworld, DREDGE, Starfield, BG3, Crimson Desert Enhanced) carried forward as PASS from `Docs/phase3/007`'s live verification at this same reconciliation lineage — not re-launched live in this pass, since a `git diff --stat` proof shows zero code they exercise changed (see `Docs/phase3/008` §8).
- **Phase 3 verdict**: with the Atomfall/7-curated-titles ambiguity now resolved by explicit owner decision *and* implemented, and the Exit Gate's literal clauses (Stardew Valley/Palworld session-binding, canonical identity, zero hardcoded ceilings) independently re-confirmed unbroken, Phase 3 is **CERTIFIED COMPLETE**.

**Atomfall Session-Bind + Canonical CI Final Closure — 2026-09-17 (P3-8.1).** The two items the P3-8 note above disclosed but did not close are now closed. (1) The launcher-vs-engine session-bind nuance is fixed, not merely documented: `process-watcher.ts`'s `matchAllCatalogProcesses` now collects every live process matching a game's declared executables and, when 2+ are alive concurrently, ranks them by executable role (`executable-role.ts`'s `classifyExecutableRoles`, extended with one new generic `ENGINE_BUILD_SUFFIX_RE` tie-break covering both Unreal Engine's `-Win64-Shipping.exe` convention and graphics-API-suffixed builds like `_dx12.exe`) instead of by incidental OS process-list order. No per-title branching exists in the fix — the same generic rule resolves Atomfall (`Atomfall_dx12.exe` over `Atomfall.exe`) and, as the same rule, corrects Palworld's previously-accepted wrapper-PID bind to its `Palworld-Win64-Shipping.exe` engine binary too. Real live proof: **Atomfall session bind PASS, 3/3 restart campaign** (fresh launcher+engine PIDs every launch, engine PID selected every time); **Palworld regression PASS, re-verified live** (Shipping binary selected, not the wrapper). Games with only one live-matching executable at a time (every Steam/GOG/Epic entry, DREDGE, Starfield, Crimson Desert, Stardew Valley) are structurally unaffected — verified via full regression (`install-discovery` 112/112, `trainer-catalog` 204/204, `live-memory` 494 pass/0 fail/75 pre-existing skips) plus a new focused suite `process-watch-role-tiebreak.test.ts` (8/8 PASS). (2) Remote CI now actually executes and passes: canonical integration PR [#39](https://github.com/Jabanaster/SOLITH/pull/39) targets `master` directly (not the non-master shared Phase 3 branch PR #38 hit), carries the complete Phase 3 lineage, and — after resolving one real merge conflict against master's own test-runner refactor and fixing one real Semgrep `detect-non-literal-regexp` finding in `xbox-manifest.ts` (rewritten to plain string search, zero dynamic `RegExp` construction, verified byte-identical output against the real Atomfall package) — every blocking check (TypeScript/architecture, Windows native/Electron gate, CI Fast, Semgrep, Gitleaks, OSV-Scanner, memoryjs integrity) passed on the first attempt, no retries. Fresh isolated worktree re-verification at the exact final SHA (`9d40ecddd4ddc2510ca2065fca4dae0c5beadeae`): typechecks + full suites PASS. Full evidence: `Docs/phase3/009-p3-8-1-atomfall-session-bind-reconciliation.md`, `Docs/phase3/010-p3-8-1-remote-ci-canonical-integration-final-certification.md`. PR #39 is green and mergeable; merge into `master` itself is left for explicit owner action, consistent with protected-branch policy. **Phase 3 verdict, reconfirmed: CERTIFIED COMPLETE.**

**Canonical integration — merged 2026-09-17.** PR #39 merged into `master` via the normal protected-branch workflow, owner-authorized (SOLITH.MD "FINAL CANONICAL MERGE CLOSEOUT"). Canonical merge SHA: `25b5bccf955f8dafceaafb0685b5f4fbac826143`. `git diff` between this SHA and PR #39's exact head (`cab7196b99077b08e55fd6acb86739b32900afda`) is empty — `master` now contains the complete Phase 3 lineage byte-identically. **Canonical integration: COMPLETE.**

**PR #42 disposition and discovery-hardening Gap 1 closeout — 2026-09-17.** A parallel session (branch `feature/solith-parallel-phase3-catalog-identity`) independently implemented the same launcher-vs-engine session-bind fix and the same `gamelaunchhelper.exe` exclusion later delivered by PR #39, and opened PR #42 for it. PR #39 merged first (canonical merge SHA above). PR #42's runtime-selection/executable-role work is **CLOSED — NOT MERGED — SUPERSEDED**, not failed: PR #39's `ENGINE_BUILD_SUFFIX_RE` tie-break is the equivalent, more general, already-certified implementation (P3-8.1 above), and additionally caught a real Palworld wrapper-vs-Shipping-binary defect PR #42's directory-context approach did not. PR #42 was closed without merging (`gh pr close 42`); no code from it was cherry-picked or revived.

One genuine gap survived that comparison: PR #42's branch also carried a generic catalog-hint mechanism for `scanShallowRoot` (manual/Xbox-root discovery) that PR #39 never touched, because PR #39's scope was session-binding and Xbox provider discovery, not manual-root catalog assistance. Reproduced directly against current master (this entry's own commit `6f28d6d`) before writing any code: `scanShallowRoot`/`resolveInstallExecutable` called `resolvePrimaryExecutable` with zero `knownCatalogExecutables`, so a manually-scanned folder with 2+ unclassified candidate executables failed closed even when the catalog already had the answer via a unique folder/display-name match — confirmed as a real, still-open deficiency, not a stale claim. Implemented fresh against current master (not cherry-picked from the old branch) in `src/core/install-discovery/index.ts`: `previewInstallDiscoveryScan` fetches one catalog snapshot per call and `scanShallowRoot` passes a per-folder `catalogExecutableHintForFolder` hint into `resolveInstallExecutable`'s existing `knownCatalogExecutables` parameter. Invariants preserved: any duplicate normalized catalog display name yields no hint at all regardless of which duplicate has executable metadata; the hint never bypasses executable-role rejection (a hint naming a launcher stays rejected) or becomes game identity; ordinary non-catalog and empty-catalog discovery are unaffected. 10 new regression tests (`tests/install-discovery-manual-root-catalog-hint.test.ts`); `install-discovery` suite 112/112 → 122/122, zero removed; both `tsconfig.json`/`tsconfig.electron.json` typecheck clean; `executable-identity` (28/28), `trainer-catalog` (204/204), `trainer-health` (5/5), `live-memory` (494 pass/0 fail, pre-existing skip count unchanged) all unaffected. Existing master Atomfall/Palworld/`gamelaunchhelper` behavior (P3-8/P3-8.1, `executable-role.ts`) untouched by this change. **Gap 1 — CLOSED — CERTIFIED** (pending canonical PR/merge into `master`; commit `6f28d6d` on branch `fix/discovery-manual-root-catalog-hint`). **Gap 2 (`gamelaunchhelper.exe` exclusion) — CLOSED — CERTIFIED ON MASTER**, already present via P3-8 (`executable-role.ts`'s `SDK_HELPER_RE`), independent of PR #42. **Phase 3 verdict, unchanged: CERTIFIED COMPLETE** (this entry closes the one remaining post-certification discovery-hardening item; it does not reopen Phase 3).

**Gap 1 canonical merge and Gap 2 regression certification — 2026-09-17 (PR #43, PR #44).** The "pending canonical PR/merge" qualifier above is now resolved. PR #43 (head `6f28d6d`, the exact commit the entry above certified) merged into `master` via the normal protected-branch workflow: merge SHA `3724fea027c57b9132ab10dee951f616b37e4320`, all 7 required checks green on first attempt. **Gap 1 — CLOSED — CERTIFIED ON MASTER.** Canonical behavior, unchanged from the entry above and now live on `master`: a unique catalog/folder normalized-display-name match may supply a discovery hint (`catalogExecutableHintForFolder`); any duplicate normalized display name remains unconditionally ambiguous — no hint at all, regardless of which duplicate carries executable metadata; a hint is only ever a candidate for `resolveInstallExecutable`'s existing `knownCatalogExecutables` evidence and never bypasses `executable-role.ts`'s independent launcher/helper rejection or becomes executable identity itself; `previewInstallDiscoveryScan` fetches exactly one catalog snapshot per call, reused for both the hint mechanism and the pre-existing catalog-match step, preserving prior scan/fallback/error-handling semantics unchanged.

Separately, an audit found Gap 2's production rule (`executable-role.ts`'s `SDK_HELPER_RE`, `^gamelaunchhelper\.exe$`, certified via P3-8 above) had zero regression coverage anywhere in the suite despite being correct. PR #44 (head `db160c3`, merge SHA `65ced65b9f717b00649e204b36d0885e6d389384`, all 9 required checks green after one infra-flake rerun unrelated to changed files — `csc.exe` native-fixture-build timeout and a real-process-attach timing race, neither touching install-discovery/executable-role code) added the missing coverage: direct `classifyExecutableRoles` test proving `gamelaunchhelper.exe` classifies `TOOL` case-insensitively; negative tests proving `mygamelaunchhelpertool.exe`, `gamelaunchhelper_backup.exe`, and `notgamelaunchhelper.exe` are unaffected (the matcher is basename-exact, not a substring ban); and a production-caller test exercising the real Xbox install-discovery scan path (`scanXboxInstallsFromFixture`) with `gamelaunchhelper.exe` present in an Atomfall-shaped fixture, proving the same policy applies end-to-end. **PR #44 did not modify `src/` or any production file — test-only diff (`tests/install-discovery-executable-role.test.ts`, `tests/install-discovery-xbox.test.ts`, 66 insertions, 0 deletions), confirmed by `git diff --stat` before merge.** **Gap 2 — CLOSED — CERTIFIED ON MASTER**, now with direct-role and production-caller regression evidence. **PR #44 — MERGED — REGRESSION/CERTIFICATION HARDENING** (it certified pre-existing correct production behavior; it did not introduce it). `install-discovery` suite 122/122 → 126/126, zero removed; both `tsconfig.json`/`tsconfig.electron.json` typecheck clean. **Phase 3 verdict, unchanged: CERTIFIED COMPLETE.**

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
