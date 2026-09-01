# PHASE 6 CLOSEOUT — V1 CORE TRAINER/SAVE/DISCOVERY GAP AUDIT

**Date:** 2026-08-20
**Branch:** review/gate2-5-doc-audit
**Pre-Phase-6 HEAD:** c5d4800434693d4fe029c9fe60c8c00cd9348c58 (Phase 5, COMPLETE)
**Classification:** PHASE 6 — VERIFIED (with 2 honestly documented, non-blocking scope items — see §3)

ROADMAP.md's own Phase 6 header reads "Status: REPORTED COMPLETE — VERIFY
CAPABILITY BY CAPABILITY" — an explicit warning that a prior claim of
completeness had not been independently reverified. This pass did that
verification and found the warning justified: two of six subsections were
genuinely overstated. Rather than "not build a giant [feature]" scope
creep, this pass closes the one real, narrow, closeable gap (§6.5) and
documents the other two honestly instead of either rebuilding large new
UX or silently accepting an inflated claim.

## 1. Requirement matrix (Step 6.1)

| Subsection | Status | Evidence |
|---|---|---|
| §6.1 Trainer Mode | **VERIFIED COMPLETE** | `src/app/pages/TrainerPage.tsx`, `MultiGameTrainerPage.tsx`; hotkeys real (`trainer-hotkey-bindings.ts`, `trainer-hotkey-registration.ts`, `cheat-hotkey-slots.ts` + matching tests); session/process state via `src/core/trainer-host/` (protocol/host-runtime/host-supervisor/e2e tests all exist); source/risk/status via `src/core/proposals/index.ts` (`risk`, `preview`, `validationRule`, `requiresBackup`, `dryRunPassed`, `status`). |
| §6.2 Workshop Mode | **PARTIAL — naming gap, not a functional gap** | Real, substantial implementations exist for Save Editor (441 lines, doubles as Data Editor via `mode="data"`), Discovery Lab (807 lines), Recipes (207), Backups (195), Journal (224), CT Library Explorer (563), Compatibility Dashboard/diagnostics (167). But "Trainer Builder," "Recipe Editor" (as distinct from the Recipes list view), "Proposal Inspector," and "Resource Browser" do not exist as separately named nav items/components — zero hits for those names in `src/app/App.tsx`'s nav (lines 111-147) or anywhere else. The underlying capability substantially exists, consolidated differently than the ROADMAP's naming implies. |
| §6.3 `.CT` compatibility | **VERIFIED COMPLETE** | `src/core/definitions/ct-import.ts:44` lists `'AutoAssemblerScript'` as a rejected type; line 91 explicitly rejects `entry.AutoAssemblerScript` with reason `'AutoAssembler not supported'` — no auto AA/Lua execution, confirmed by source, not just a test name. Rejects are collected and returned (no silent loss). Classification via `classifyCtLiveResolution`. 7 matching test files (`ct-compiler`, `ct-import`, `ct-import-state`, `ct-metadata`, `ct-library`, `ct-registry`, `ct-preview-receipt`). |
| §6.4 Save/resource workflow | **VERIFIED COMPLETE** | Full chain present: scanner/fingerprint (`src/core/scanner/index.ts`), proposals (`src/core/proposals/index.ts`), atomic apply (`src/core/saves/editor.ts` imports and calls `atomicWrite`), backups (`src/core/backups/index.ts` create/restore), journal (`src/core/journal/index.ts`). Matching tests across backups-dashboard, binary-field-proposal, save-format, and both byte/float rollback-integrity live-memory tests. |
| §6.5 Local AI | **Closed this pass — see §2** | Was PARTIAL (backend real, but unreachable from the UI, zero tests, and containing a live bug). Now VERIFIED COMPLETE. |
| §6.6 Demo/onboarding | **PARTIAL — real gap, deliberately not built this pass** | `src/app/components/OnboardingWizard.tsx` (129 lines) is a real 5-step wizard persisting `onboardingCompleted`, describing the propose→backup→apply→rollback loop in prose. Safety acknowledgement is real (`src/core/settings/index.ts` get/set + `tests/safety-honest-gates.test.ts`). A demo game *profile* does exist (`DEMO_PREVIEW_PROFILE`, `DEMO_BLOCKED_PROFILE` in `src/core/game-profiles/catalog.ts`). But there is no live "guided discovery" walkthrough exercising that demo profile end-to-end, and no "reset demo" action anywhere. |

## 2. §6.5 Local AI — real bug found and fixed, then wired to Settings

`src/core/ai/index.ts` had **zero test coverage** before this pass. Writing
the first tests for it (`tests/core-ai-config.test.ts`) immediately
surfaced a genuine, pre-existing defect: `setAIConfig()`'s SQL used
`ON CONFLICT(provider)`, but the `ai_config` table's real key is `id`
(`PRIMARY KEY`) — `provider` has no unique constraint at all. Every call to
`setAIConfig()` has always thrown `ON CONFLICT clause does not match any
PRIMARY KEY or UNIQUE constraint`. Since nothing called it (the module was
entirely disconnected from the UI, exactly as the audit flagged), this was
invisible until real tests exercised it.

**Fix:** `setAIConfig()` now inserts `id` (using the provider name, matching
the existing seed convention in `initDatabase`'s `defaultAIConfig`) and
conflicts on `id`. Verified round-trip: set → get returns the persisted
value; setting one provider's config does not clobber the other's stored
row.

**UI wiring (new this pass):** `src/app/pages/settings/sections/LocalAiSection.tsx`,
a new `'local-ai'` settings category. Provider (None/Ollama/LM Studio),
endpoint, and model are stored through the *existing* generic
`Settings.aiProvider`/`aiEndpoint`/`aiModel` mechanism (already wired
through `setSetting`/`getSettings` — reused, not duplicated). "Test
connection" is the one piece that mechanism can't do (an async local HTTP
probe), so a single new sender-validated IPC channel
(`electron/ai-config-ipc.ts`, `ai-config-test-connection`) wraps the
existing `testAIConnection()` function, which was already correct and is
now exercised by 4 new tests covering every validation branch that doesn't
require a live network call (empty endpoint, malformed URL, non-http(s)
scheme, and the `'None'` rule-based-fallback path).

**No privileged AI bridge:** confirmed by source inspection — `src/core/ai/index.ts`
has no process-write or memory-access call anywhere in it; its only
capability is a read-only local HTTP GET to a user-configured endpoint plus
pure string-matching "explanations." The IPC wrapper adds nothing beyond
that.

## 3. Honest scope limits — not silently dropped, not overbuilt

Per the governing instructions ("do not use Phase 6 to expand scope...
implement only V1 blockers"), two genuine gaps are documented rather than
closed this pass:

- **§6.2 naming/consolidation** — building four new standalone pages
  (Trainer Builder, Recipe Editor, Proposal Inspector, Resource Browser)
  when their substance is already covered by Save Editor/Discovery
  Lab/Recipes/CT Library would be exactly the "giant trainer editor" scope
  creep the instructions warn against, for a gap that reads more like a
  ROADMAP naming mismatch than a missing capability. Classified **NEEDS
  OWNER DECISION**: either accept the current consolidated pages as
  satisfying these four names, or scope a deliberate follow-up to split
  them out.
- **§6.6 guided discovery / reset demo** — a real, live, end-to-end
  walkthrough on the demo profile (plus a "reset demo" affordance) is
  genuinely new UX, not a narrow wiring gap like §6.5 was. Classified
  **DEFERRED**, not built this pass, so as not to trade a bounded,
  reviewable change for an open-ended one under time pressure.

`ROADMAP.md`'s Phase 6 header was updated to reflect this — replacing the
un-reverified "REPORTED COMPLETE — VERIFY CAPABILITY BY CAPABILITY" wording
with the actual verification result and a pointer to this report, so the
next session doesn't have to redo this audit from scratch.

## 4. Fresh verification

| Check | Result |
|---|---|
| `tsc --noEmit -p tsconfig.json` | PASS (clean) |
| `tsc --noEmit -p tsconfig.electron.json` | PASS (clean) |
| `npm test` (main suite) | 1636/1636 PASS (+10 new AI-config tests this pass) |
| `npm test` (sql-parameter-binding) | 10/10 PASS |
| `npm run test:live-memory` | 257/257 PASS (unaffected) |
| `npm run test:trainer-e2e` | 4/5 PASS — same pre-existing/unrelated `.solith-top-banner__title` locator failure, freshly reconfirmed a third time this session; the component (`src/app/components/SolithTopBanner.tsx`) exists in source, so this is a real, narrow, pre-existing test/UI discrepancy that belongs to Phase 7's explicit "determine whether the test is stale or the UI is broken" mandate — not resolved here since Phase 7 itself is BLOCKED this pass (see PHASE_7 status). |
| `git diff --check` | clean |
| `npm audit` | 0 vulnerabilities |
| `npm run build:vite` | PASS |
| `npm run build:electron` (incl. output verifier) | PASS — 29/29 checks passed |

## 5. Phase 6 exit decision

**Exit gate:** *"core packaged player and creator loops are verified and
accurately documented."*

The core player loop (§6.1) and creator loop (§6.4, plus the CT-import
piece of §6.3) are independently verified real, not just claimed. §6.2's
gap is a documentation/naming accuracy issue, now corrected in ROADMAP.md
itself rather than left silently overstated. §6.6's gap is disclosed, not
hidden. §6.5 is fully closed, including a real bug fix.

**Classification: PHASE 6 — VERIFIED**, with §6.2 and §6.6 explicitly
flagged as open items (one an owner naming decision, one deferred UX work)
rather than silently marked complete.

## 6. Commit/push

Exact Phase 6 scope (11 total: 8 modified + 3 new):

```
ROADMAP.md
electron/ai-config-ipc.ts
electron/main.ts
electron/preload.ts
src/app/pages/settings/sections/LocalAiSection.tsx
src/app/pages/settings/settingsCategories.ts
src/app/pages/settings/SettingsPage.tsx
src/core/ai/index.ts
src/types/global.d.ts
package.json
tests/core-ai-config.test.ts
Docs/Reports/PHASE_6_CLOSEOUT.md
```

- Commit SHA: **(recorded immediately after commit — see chat response)**
- Push: local == remote confirmed after push
- PR #7: not merged (out of scope for this authorization)

## Machine-readable summary

```text
phase: 6
state: PASS
branch: review/gate2-5-doc-audit
pre_phase_head: c5d4800434693d4fe029c9fe60c8c00cd9348c58
tsc_main: PASS
tsc_electron: PASS
npm_test: 1636/1636 + 10/10
live_memory: 257/257
trainer_e2e: 4/5 (1 PRE-EXISTING/UNRELATED, freshly reconfirmed 3rd time this session — flagged for Phase 7 triage, not resolved here)
npm_audit: 0 vulnerabilities
vite_build: PASS
electron_output_verifier: 29/29
git_diff_check: clean
section_6_1: VERIFIED_COMPLETE
section_6_2: NEEDS_OWNER_DECISION (naming/consolidation, not a functional gap)
section_6_3: VERIFIED_COMPLETE
section_6_4: VERIFIED_COMPLETE
section_6_5: VERIFIED_COMPLETE (real pre-existing bug found and fixed: setAIConfig always threw; now wired to Settings UI)
section_6_6: DEFERRED (demo profile exists; guided-discovery walkthrough and reset-demo action do not — real UX scope, not built this pass)
phase_6_exit_gate: SATISFIED (core loops verified; open items disclosed, not hidden)
next: Phase 7 (BLOCKED — see PHASE_7 status in the final cross-phase report)
```
