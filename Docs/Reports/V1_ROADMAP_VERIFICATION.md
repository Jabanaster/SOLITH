# VERIFICATION REPORT — "SOLITH V1 — FULL ROADMAP UPDATE"

**Subject document:** "SOLITH V1 — FULL ROADMAP UPDATE" (supplied verbatim via `SOLITH.MD`, dated by its own text as produced without repository access)
**Verified against:** Repository `Jabanaster/SOLITH`, branch `review/gate2-5-doc-audit`, HEAD `ac91acc63439ac135598f0ac07c01884f6b205f4`, working tree at time of verification
**Method:** Direct repository inspection (git metadata, `package.json`, `ROADMAP.md`, `PROJECT_SPEC.md`, `SOLITH_SECURITY_ROADMAP.md`, test suite execution, build pipeline execution, E2E execution) — not inference from the subject document or from prior chat summaries

---

## 1. Foundational finding

The subject document's central premise is stated in its own text: *"The GitHub repository was not accessible through the connected GitHub integration in this session. Therefore none of the above can currently be independently verified."* Every status marking in the document (`REPORTED COMPLETE — VERIFY`, `UNKNOWN`, `UNVERIFIED`, `NOT PROVEN`) is a direct consequence of that stated access failure, not of any inspection of the actual project.

This session has direct, continuous read/write access to the repository, its git history, its test suites, its build pipeline, and its runtime (packaged Electron app under Playwright). The repository is not inaccessible. It is a normal, actively maintained, git-tracked project with 1,648+ unit tests, a live CI-equivalent local verification pipeline, and multiple prior security-hardening cycles recorded in `SOLITH_SECURITY_ROADMAP.md` going back to at least Gate 2.1 (2026-07-28).

**Conclusion of the foundational finding:** the subject document is not a status report on SOLITH. It is a status report on the *absence* of information, produced by a session that had no access to the thing it was asked to describe. Its recommendations (re-establish repository access, run Phase 0) are the correct next step *for that session*, but its content beyond that point — the phase numbering, the "unknown" classifications, the effort estimates, the risk register — is speculative scaffolding, not a finding about SOLITH's actual state.

---

## 2. Full accuracy check against actual current state

### 2.1 Repository identity and reachability

| Subject document claim | Actual state | Match |
|---|---|---|
| Repository not accessible; branch/HEAD/dirty state/CI unknown | `origin` = `https://github.com/Jabanaster/SOLITH.git`; branch `review/gate2-5-doc-audit`; HEAD `ac91acc6…`; 6 known, previously-classified dirty paths (3 untracked report files, 3 sibling worktree directories); no CI service configured in this repo — verification runs as a local scripted pipeline (`npm test`, `npm run build:*`, Playwright suites), which is a real and current substitute, not an absence | **Mismatch** |
| "Determine active branch" — required, not done | Trivially available: `git branch --show-current` | **Mismatch** |
| "Determine HEAD commit SHA" — required, not done | Trivially available | **Mismatch** |
| "Determine whether the working tree is dirty" — required, not done | Trivially available; dirty set is small, named, and has been stable across many prior sessions (documented in `SOLITH_SECURITY_ROADMAP.md`'s own session log) | **Mismatch** |

### 2.2 "Authoritative source register" (Milestone 0.2)

The subject document instructs a search for a security roadmap, architecture index, test index, release checklist, decision log, and source register, treating all of these as unknown/unlocated.

Actual state: these exist, are current, and are cross-referenced with each other in the repository root:

- `ROADMAP.md` — the real, current, phase-numbered project roadmap (Phases 0–10: Stabilize, Quick Release Polish, Canonical Game Model, Trainer Library, Artwork Identity, Popularity/Catalog Updates, V1 Core Gap Audit, **Security/Packaging/Supply Chain/QA**, Customization, Final Acceptance, V1 Release). This is a *different and incompatible phase structure* from the subject document's own Phase 0–20 scheme (see §5).
- `SOLITH_SECURITY_ROADMAP.md` — a 2,100+ line, actively maintained security status document with a mandatory "update at the end of every session" rule, a dated Session Update Log going back to Gate 2.1, and an explicit documentation-authority statement naming itself the sole canonical security-status source.
- `PROJECT_SPEC.md` — the real product-definition document (Trainer Mode / Workshop Mode, primary user workflows, application layout, trainer control types, source/risk/status badges, required architecture) — this uses entirely different terminology from the subject document's "Player loop / Creator loop / cheat-table profile model" framing (see §5).
- `AGENTS.md`, `README.md`, `CHANGELOG.md`, `THIRD_PARTY_LICENSES.md` — present and cross-referenced.
- No document named "Capability and Boundary Charter" or "Project Setup document" (the two documents the subject text cites as its own governing authority) exists anywhere in this repository. These may be documents from a different session's context that were never committed, or documents describing a different/earlier conceptual version of the project.

**This is a material omission, not merely an unverified claim**: the source register the subject document says must be built from scratch already exists, in more current and more detailed form than anything the subject document could produce.

### 2.3 Test / verification state

| Subject document status | Actual state |
|---|---|
| "Automated V1 verification — UNVERIFIED" | `npm test` — **1,648/1,648 passing** (main suite) + **10/10** (SQL parameter-binding suite), confirmed by direct execution at HEAD `ac91acc`. `npm run test:live-memory` — **257/257 passing**. Multiple Playwright E2E suites (`trainer-e2e` 5/5, `ipc-channels` 13/13, `walkthrough-navigation` 3/3, `accessibility` 8/8, `new1-new2-trust-boundary` 20/20) all passing at the same HEAD. |
| "Packaged-app verification — UNVERIFIED" | Packaged build executed this session: `npm run build:vite` → `npm run build:electron` (output verifier **29/29 PASS**) → Playwright tests against the real packaged `Solith.exe`, including a full attach→scan→apply→restore round-trip with SHA-256 hash verification of before/after workspace state. |
| "Independent security review — UNVERIFIED" | Partially accurate: no independent review of the *current* HEAD has occurred. However, multiple independent-review cycles are on record for earlier commits (Gate 2.4/2.5, `owner-decision-package.md`), and B1.1 has been owner-promoted (conditional) based on that review chain — the document's blanket "UNVERIFIED" omits this entirely. |
| "Dependency/license closeout — UNVERIFIED" | Partially accurate for a *formal deliverable*, but ROADMAP.md §7.5 already carries a vendored-dependency/license inventory (IBM Plex Sans OFL 1.1, JetBrains Mono OFL 1.1, Tabler icons MIT, patched memoryjs MIT), and `npm audit` reports **0 vulnerabilities** as of this session, following a real, reproducibility-verified `npm ci`. |

### 2.4 Security-boundary state

| Subject document status | Actual state |
|---|---|
| "Sender/frame/stale-frame security — REPORTED COMPLETE — VERIFY" | This session's own audit (independent of the subject document, run for a separate authorization) found **151 of 180** `ipcMain.handle` channels had *no* sender-identity check at all — a real, previously unreported High-severity gap. All 180 have since been closed and verified (positive + negative E2E evidence). The subject document's "reported complete" framing is not merely unverified — it was, until this session's fix, actively wrong for 84% of the IPC surface. |
| "Renderer/privileged-process separation" required verification | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` confirmed on all 3 windows (main, Wisp overlay, trainer overlay) by source inspection; no generic renderer-to-OS bridge found; preload exposes only named methods (no wildcard invoke wrapper). |
| Registry Explorer scope ("determine whether V1 Registry Explorer is read-only or mutation-authorized") | Resolved by direct code inspection this session: read-only by construction — no write/mutate export exists anywhere in `src/core/registry/`; real Windows-registry access is limited to two hardcoded, non-renderer-exposed `reg query` calls for Steam/Epic install-path discovery. |

### 2.5 `.CT` compatibility state

The subject document classifies basic `.CT` import/export as **"REQUIRED V1 — CURRENT STATUS UNKNOWN"** and treats the entire defensive-parser requirement (file-size limit, nesting/depth limits, schema validation, non-executing default, compatibility classifier) as a large, unstarted risk area ("Critical" risk, "1–3+ weeks" if materially incomplete).

Actual state: a working `.CT` importer already exists (`src/core/definitions/ct-import.ts`), with:
- an explicit script/executable-content rejection list (`CheatScript`, `AutoAssemblerScript`, `LuaScript` are parsed, classified, and placed in a `rejected` bucket — never executed);
- every imported entry forced to `requiresApproval: true`, `requiresOfflineConfirm: true`, `verificationStatus: 'community'` regardless of source-file claims;
- (as of this session) a defense-in-depth XXE/entity-expansion/nesting-depth guard, added and RED→GREEN tested against the exact attack classes the subject document lists (external entity, entity expansion, deep nesting, oversized file).

This is not "unknown." It is an existing, tested implementation with a specific, inspectable supported subset — the subject document's own Decision A ("avoid making full CE compatibility a V1 requirement") is already the implemented policy, not an open decision.

### 2.6 Player-loop / creator-loop state

The subject document treats the entire player-facing trainer workflow and creator workflow as **"REQUIRED PRODUCT CAPABILITY — VERIFY V1 SCOPE"**, with an explicit warning that this "may be one of the largest V1 implementation gaps."

Actual state: `tests/trainer.e2e.test.ts`'s "full Trainer UX workflow" test exercises attach/load → apply a proposed edit → verify the resulting workspace hash matches a pre-computed expected value → restore → verify the workspace hash returns to its original value, end-to-end against the real packaged application, and passes. A working Proposal Inspector page, Recipe Editor, Trainer Catalog (search/import/promote/certify), and AI-config-driven proposal flow all exist and have dedicated IPC handlers and tests. This is a functioning, tested, non-trivial workflow — not an unknown.

---

## 3. Why the subject document is inaccurate

1. **It was written under a stated access failure and never revised.** Its own text discloses the cause; the resulting content should have been scoped to "what I could not check," not extended into a 34-section roadmap with phase numbering, effort estimates, and a risk register built on top of unverified assumptions.
2. **It invents a phase structure that does not match the project's real roadmap.** `ROADMAP.md`'s actual Phase 0–10 structure and `PROJECT_SPEC.md`'s Trainer Mode/Workshop Mode framing are not reconcilable with the subject document's Phase 0–20 "Player loop / Creator loop / cheat-table profile model" structure. Adopting the subject document as a working plan would mean planning against a project that does not exist in this repository.
3. **It defaults every unknown to "not complete" without weighting available indirect evidence.** Even without repository access, git commit messages, prior session summaries, and `SOLITH_SECURITY_ROADMAP.md`'s own extensive dated history were potentially available context clues that substantial security and feature work had already occurred; the document does not appear to have drawn on any of that.
4. **Its effort estimates are explicitly labeled speculative** ("Any tighter project-wide ETA before inspecting the repository would be fabricated precision") — this is honest self-disclosure, but it means the estimates provide zero planning value and should not be carried forward into any real schedule.

---

## 4. Specific corrections required

1. Discard the subject document's phase numbering (Phase 0–20) and blocker IDs (BLK-01…BLK-08) — they do not correspond to `ROADMAP.md`'s real phase structure and would fork planning into two incompatible tracks.
2. Replace the "Executive project status" table (§1 of the subject document) with current, evidenced status: Phase 5 and Phase 6 of the real `ROADMAP.md` are VERIFIED COMPLETE (per this repository's own closeout reports); Phase 7 (Security/Packaging/Supply Chain/QA) is **BLOCKED**, not "reported complete — verify," with a specific, itemized list of what remains (independent review of current HEAD, code-signing decision, installer lifecycle testing, full failure-injection matrix) — see `Docs/Reports/PHASE_7_CLOSEOUT.md` for the current, evidence-backed version of exactly this kind of status table.
3. Remove the claim that "no current evidence-backed capability matrix" exists — `SOLITH_SECURITY_ROADMAP.md` contains one, updated as recently as this session, with per-item VERIFIED COMPLETE / PARTIAL / PENDING status and dated evidence.
4. Correct the `.CT` compatibility section from "current status unknown" to: implemented, with an explicit rejected-content policy and (as of this session) a defense-in-depth XXE/nesting guard; remaining open work is narrower than the subject document implies (further field-coverage/export-fidelity verification, not "does it exist at all").
5. Correct the player/creator loop sections from "unknown, possibly one of the largest gaps" to: a working, E2E-tested core loop exists (attach → propose → apply → verify → restore); remaining open work is broader UX/accessibility/error-recovery polish, not existence.
6. Remove or re-source the citations to "the charter" and "the Project Setup document" — neither exists under those names in this repository; any requirement attributed to them should be re-attributed to `PROJECT_SPEC.md` §3 (prohibited capabilities) and `ROADMAP.md`, which are the actual governing documents, or the citation should be dropped if it cannot be re-sourced.
7. Re-run Milestone 0.1–0.3 for real, in a session with actual repository access (trivial: branch, HEAD, dirty state, and toolchain versions are all one-command lookups), rather than carrying forward the subject document's placeholder "NOT COMPLETE" status.

---

## 5. Section-by-section accuracy breakdown

| Subject document section | Rating | Basis |
|---|---|---|
| §1 Executive status / capability table | **Inaccurate** | Built entirely on the stated access failure; contradicted by direct evidence for security, `.CT`, player/creator loop, and packaging rows |
| §2 Priority model (P0–P3) | **Partially accurate** | The general priority logic (security/lifecycle before feature polish, defer 3D Wisp/Game Bar/save editor) is reasonable and roughly matches this repository's own actual sequencing discipline, but is not derived from this project's real phase structure |
| §3 Phase 0 (repository/scope audit) | **Inaccurate as a current-state claim, accurate as a generic procedure** | The procedure itself is sound; the "NOT COMPLETE" status and "not accessible" blocker are false for this session |
| §4 Phase 1 (security verification) | **Inaccurate** | Renderer isolation and BrowserWindow hardening are verified correct; the specific IPC sender-validation gap the document treats as merely unverified was a real, now-fixed defect this session found and closed |
| §5 Phase 2 (process/session lifecycle) | **Unverifiable from this report alone** | This session did not re-audit PID-reuse/identity-integrity lifecycle behavior specifically; prior gates (Gate 2.1–2.5 in `SOLITH_SECURITY_ROADMAP.md`) did, extensively, with real defects found and fixed (native write-path silently no-op'ing) — the subject document is unaware of that entire body of work |
| §6–7 Phases 3–4 (search/write/freeze) | **Inaccurate** | Extensively covered by the existing live-memory test suite (257/257 passing) and multiple packaged-lifecycle gates; not an unknown |
| §8–10 Phases 5–7 (table model / `.CT` import / export) | **Inaccurate** | A real implementation with tested defensive controls exists; see §2.5 above |
| §11–12 Phases 8–9 (player/creator loop) | **Inaccurate** | A working, E2E-tested core loop exists; see §2.6 above |
| §13 Phase 10 (Registry Explorer) | **Inaccurate** | Read-only status is already resolved and verifiable from source, not an open decision |
| §14–17 Phases 11–14 (errors, performance, accessibility, privacy) | **Partially accurate** | Genuinely less thoroughly verified than security/lifecycle/IPC; accessibility E2E suite exists (8/8 passing) and covers some of this, but formal performance/resource-bound stress testing was not evidenced this session either |
| §18 Phase 15 (automated tests) | **Inaccurate** | A large, passing automated suite already exists (1,648 + 257 + multiple E2E suites); this is the single largest factual gap in the subject document |
| §19 Phase 16 (packaged verification) | **Inaccurate** | Packaged verification is a routine, repeatable part of this project's existing workflow, not an unstarted phase |
| §20 Phase 17 (manual E2E acceptance) | **Partially accurate** | The specific *manual* (human-operated) acceptance pass may genuinely not have occurred recently; automated E2E covering the same loops does exist and does pass |
| §21 Phase 18 (licensing/provenance) | **Partially accurate** | A partial inventory exists (`ROADMAP.md` §7.5, `THIRD_PARTY_LICENSES.md`); a fully closed-out formal deliverable does not appear to exist yet |
| §22 Phase 19 (release documentation) | **Partially accurate** | Extensive closeout reports exist per-phase (`Docs/Reports/*`), but a single consolidated release-evidence package does not |
| §23 Phase 20 (final independent review) | **Accurate** | No independent review of the current HEAD has occurred; this is a genuine, currently open item, consistent with this session's own Phase 7 closeout finding |
| §24–34 (blockers, approvals, risk register, effort estimates, dependency chain, completion definition) | **Inaccurate as applied to this project's actual state** | Internally coherent as a generic template, but every severity/likelihood judgment is explicitly built on "Unknown" inputs that are not actually unknown |

---

## 6. Dependencies and phase locks misrepresented

- The subject document's entire dependency chain (§31) roots at "AUTHORITATIVE REPOSITORY ACCESS," treating every subsequent phase as blocked on that one node. Since that node is not actually blocked, none of the downstream phase-lock reasoning applies as stated.
- It asserts Phase 8 (player loop) and Phase 9 (creator loop) depend on Phases 2, 4, 5, 6 all being *verified* first, which is a reasonable dependency shape in the abstract, but in the real project these are not sequenced as discrete phases at all — feature work (Trainer Catalog, Proposal Inspector, AI config) and security hardening (B1.1, this session's Batch B2 work) have proceeded on parallel, interleaved tracks across many sessions, not the strict waterfall the subject document assumes.
- It treats Registry Explorer scope (§13) as an open decision gating further work; it is not gating anything — it was already implemented read-only and requires no owner decision.
- It treats `.CT` defensive parsing (Phase 6) as a prerequisite that must be completed before Phase 7 (export) and Phase 8/9 (player/creator loop) can proceed; in the real project, import, a working player/creator loop, and export-adjacent functionality (Recipe Editor, Proposal Inspector) already coexist, so this dependency framing does not describe how the project actually developed.

---

## 7. What the roadmap assumes vs. what the project actually contains

| Subject document assumes | Project actually contains |
|---|---|
| A greenfield or early-stage project where core capabilities are unverified or possibly missing | A mature, actively hardened project with a multi-month security-gate history (Gate 2.1 through Gate 2.5+), 1,600+ passing unit tests, multiple passing E2E suites, and several previously-closed phases |
| Governing documents named "Capability and Boundary Charter" and "Project Setup document" | Governing documents named `PROJECT_SPEC.md`, `ROADMAP.md`, `SOLITH_SECURITY_ROADMAP.md`, `AGENTS.md` — different names, and in places different scope/terminology, from what the subject document cites |
| A single linear Phase 0→20 critical path gating all further work on a repository-access step | A project that has been developing along parallel feature and security tracks for many sessions already, with its own phase structure (`ROADMAP.md` Phases 0–10) that does not map onto the subject document's phases |
| `.CT` import/export, player loop, and creator loop as unknown-or-possibly-missing | All three implemented, with automated test coverage, and (for `.CT` import) hardened against the specific attack classes the document itself lists as required |
| IPC/frame security as "reported complete, needs verification" | A real, specific, previously-unidentified IPC authorization gap (151/180 unguarded handlers) that has since been found and closed this session — worse than "unverified," and now better than the document's own target state |
| Total inability to produce any of the 14 listed "waiting on my output" deliverables (repo audit, source register, capability matrix, blocker list, security matrix, test matrix, etc.) | Equivalents of nearly all 14 already exist in this repository in some current form (`SOLITH_SECURITY_ROADMAP.md`'s status tables, `ROADMAP.md`'s phase gates, `Docs/Reports/*` closeout reports, this session's own IPC/command/`.CT`/dependency audits) |

---

## 8. Final accuracy rating

**LOW.**

**Justification:** The subject document's self-disclosed premise (no repository access) is true, and its recommended immediate action (restore access, then audit before planning) was the correct call *for that session*. But the document does not stop there — it extends 34 sections deep into phase planning, effort estimation, and a risk register, all conditioned on unknowns that are not actually unknown to a session with real repository access, which this one has. Every category checked against direct evidence in §2 — repository identity, source-document register, test/verification state, security-boundary state, `.CT` compatibility, and player/creator-loop functionality — was found to be either factually wrong or missing large amounts of existing, directly verifiable positive evidence. A small number of sections (§20 final independent review, parts of §17/18 privacy and performance verification) hold up as genuinely accurate open items, and the general prioritization logic in §2 is reasonable in the abstract — but these are not enough to lift the overall rating above Low given how much of the document's substantive content is either contradicted or rendered moot by directly available evidence.

**Recommended handling:** Do not use this document as a planning baseline. Use `ROADMAP.md` and `SOLITH_SECURITY_ROADMAP.md` as the authoritative, current sources — both exist, are actively maintained, and (unlike the subject document) are the two documents this repository's own conventions already designate as canonical for exactly this purpose.
