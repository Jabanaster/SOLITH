# Solith V1 Stabilization Manifest

**Status:** CONTROLLING — feature freeze active  
**Effective:** 2026-07-26  
**Security and release-control gate:** 2026-08-02, binary pass/fail  
**Next executive review:** 2026-08-03  
**Supersedes for V1 scope:** broad roadmap status, historical RC claims, and feature-completion claims not tied to this manifest

## 1. Authority and ownership

- **Release owner:** Chase Smith
- **Go/no-go authority:** Chase Smith, acting as executive release authority
- **Security veto:** The security reviewer may block release. The release owner may not waive an unresolved privileged execution path into V1.
- **QA veto:** The release owner may not approve release without independently recorded packaged-runtime gate results tied to the exact candidate.
- **Change authority during freeze:** Only the release owner may approve a V1-required change. Deferred and Experimental work may be preserved but may not be merged into the stabilization candidate.

There is one release decision and one accountable owner. A contributor, test author, or feature owner cannot declare the product released.

## 2. Candidate identity

### Current development baseline

- **Repository:** `G:\ACTIVE_PROJECTS\SOLITH`
- **Branch:** `master`
- **Current parent commit:** `487417d9a42d6a566097c1c3058d685414e759ac`
- **Current state:** Development state only; not a release candidate
- **Reason:** Staged, unstaged, and untracked production changes are present.

### Candidate target

- **Candidate branch:** `stabilization/v1`
- **Candidate tag:** `v2.4.0-alpha.2-stabilization-rc1`
- **Candidate commit:** Not created. It must be the clean, reviewed commit to which the candidate tag is applied.
- **Tag policy:** The tag is created only after the release baseline requirements in this manifest pass. It must never point at the current dirty working tree.

Historical `v2.4.0-rc.*` tags are not candidates and provide no current release authority.

## 3. Exact V1 scope

Only the following workflows may appear as supported V1 functionality.

| Included workflow | V1 acceptance criterion | Required evidence |
|---|---|---|
| Local game library | User can add, edit, remove, scan, and rediscover a local game without network dependency or metadata loss | Unit/integration tests; packaged Electron E2E; clean restart persistence; invalid-path and duplicate-game tests |
| Safe trainer catalog browsing | User can search and inspect catalog entries without confusing “listed” with “supported” | Packaged search/filter E2E; support-tier labels; empty/error/loading-state evidence; accessibility pass |
| Metadata-only CT import | Selected CT/ZIP content imports as inert metadata; scripts cannot execute; declined or rejected imports persist nothing | Parser/security tests; archive bounds; cancellation; malformed archive; no-write-on-decline; packaged file-picker/import/search/display E2E |
| Backups and rollback evidence | Before an approved save edit, the original is backed up; restore is explicit, validated, and recoverable | Failure-injection tests; packaged backup/restore E2E; interrupted-write recovery; hash verification; clean-VM drill |
| One certified save-edit workflow | Stardew Valley approved save fields only, with preview, approval, backup, atomic write, verification, and rollback | Exact supported version/format; packaged clean-VM E2E; invalid input; changed-file race; power/process interruption; user acceptance |
| Independently certified live controls | Only controls with current per-build certification and restore/safety evidence are visible as executable | Explicit support matrix; executable hash; certification artifact; offline guard; consent; original-value capture; restore proof; packaged E2E |
| Completed stable walkthroughs | Walkthroughs for included V1 workflows may ship if they are accurate, dismissible, keyboard accessible, and do not expose excluded modules | Content review; packaged navigation/a11y E2E; restart preference persistence |
| Basic in-app Wisp | Existing in-window companion may ship only if optional, non-blocking, performant, accessible, and independent of overlays or Game Bar | Disable control; keyboard/screen-reader behavior; performance result; no privileged APIs; packaged smoke |

No other workflow is included by implication.

## 4. Explicit V1 exclusions

The following are excluded from the stabilization candidate:

- General or broad live-memory support claims
- L0/L1 discovery entries presented as supported trainers
- Any live control without current executable-hash/build certification
- Privileged helper execution unless Section 8 passes in full
- Xbox Game Bar integration
- Wisp desktop overlay promises or overlay expansion
- New Wisp animation/artwork systems not required for the basic in-app companion
- Hub/community service as a release dependency
- Hub production deployment
- Experimental research labs as user-facing supported workflows
- Managed-runtime `.NET`/Mono work
- New game support
- Catalog expansion
- New binary save formats
- New OCR, scanner, overlay, hotkey, injector, or research capability
- Architecture experiments
- Cosmetic redesign unrelated to a failing V1 acceptance criterion

Excluded modules may remain in source only if they are visibly marked experimental, cannot be mistaken for V1 support, are disabled by default, add no privileged attack surface, and do not cause a required gate to fail. Otherwise they must be removed from the V1 build.

## 5. Dirty-tree classification rules

Only these labels are valid:

- **V1-required** — directly satisfies an acceptance criterion in Section 3 or release control in this manifest.
- **Deferred** — potentially useful after V1 but not required for a V1 acceptance criterion.
- **Experimental** — feasibility/research work that is not eligible for the V1 candidate.

Nothing may remain unclassified. A mixed file must be split so only V1-required hunks enter the candidate. The file-level label below describes the current change set, not the permanent value of the file.

## 6. Current dirty-tree classification

### V1-required

These changes may be retained only after atomic review and direct acceptance-test mapping:

| Path | Acceptance mapping |
|---|---|
| `.gitignore` | Candidate hygiene and production-asset control |
| `electron/ct-library-ipc.ts` | Metadata-only CT import |
| `electron/install-discovery-ipc.ts` | Local game library/install discovery |
| `electron/ipc-validation.ts` | IPC validation for included workflows |
| `electron/main.ts` | Included IPC wiring only; excluded feature wiring must be split out |
| `electron/preload.ts` | Included V1 preload APIs only; overlay/experimental APIs must be split out |
| `electron/trainer-catalog-ipc.ts` | Safe catalog browsing |
| `package.json` | Tests/scripts needed for this manifest only |
| `src/app/App.tsx` | Included navigation and walkthrough wiring only |
| `src/app/components/PageModuleHeader.tsx` | Stable walkthrough entry for included pages |
| `src/app/components/PageWalkthrough.tsx` | Stable included-workflow walkthroughs |
| `src/app/help/walkthroughs.ts` | Included V1 walkthrough definitions only |
| `src/app/live-memory/process-picker.ts` | Explicit selection for certified live controls only |
| `src/app/pages/Backups.tsx` | Backups and rollback evidence |
| `src/app/pages/CtLibraryExplorerPage.tsx` | Metadata-only CT import/search/display |
| `src/app/pages/LiveMemoryTrainerPage.tsx` | Certified controls only; discovery/general claims must be split out |
| `src/app/pages/SaveEditor.tsx` | Certified save-edit workflow |
| `src/app/pages/SaveLocations.tsx` | Certified save-edit workflow |
| `src/app/pages/TrainerControlPanel.tsx` | Certified save/live controls only |
| `src/app/pages/TrainerLibraryPage.module.css` | Safe catalog browsing UI required for acceptance |
| `src/app/pages/TrainerLibraryPage.tsx` | Safe browsing, support labels, preview gates |
| `src/app/routes/GameLibrary.tsx` | Local game library |
| `src/app/styles/index.css` | Only styles required by included workflows; Wisp/overlay polish must be split out |
| `src/core/ct-library/import-state.ts` | Metadata-only CT import |
| `src/core/database/index.ts` | Game metadata persistence |
| `src/core/definitions/import-definition-ct.ts` | Metadata-only CT import |
| `src/core/games/index.ts` | Local game library persistence |
| `src/core/install-discovery/index.ts` | Local game discovery |
| `src/core/install-discovery/types.ts` | Local game discovery |
| `src/shared/types/index.ts` | Included workflow contracts only |
| `src/types/global.d.ts` | Included V1 preload surface only; experimental types must be split out |
| `tests/game-metadata-persistence.test.ts` | Local library acceptance evidence |
| `tests/page-walkthrough.test.tsx` | Walkthrough acceptance evidence |
| `tests/process-picker.test.ts` | Certified live-control process selection |
| `tests/trainer-library-preview-gates.test.ts` | Honest catalog/support presentation |
| `Docs/Reports/STRICT_EXECUTIVE_PROJECT_REVIEW_2026-07-26.md` | Release-control evidence |
| `Docs/V1_STABILIZATION_MANIFEST.md` | Controlling V1 scope and release gate |

### Deferred

These changes do not enter the candidate unless reduced to a hunk that directly satisfies an included V1 criterion:

| Path | Preservation decision |
|---|---|
| `ROADMAP.md` current unstaged additions | Preserve after stabilization; the manifest is the controlling scope document |
| `src/app/pages/CompatibilityDashboard.tsx` | Preserve for post-V1 support/diagnostics work |
| `src/app/pages/DiscoveryLab.tsx` | Preserve as post-V1 discovery tooling |
| `src/app/pages/ExternalTrainerResearchLab.tsx` | Preserve as post-V1 research tooling |
| `src/app/pages/Recipes.tsx` | Preserve as post-V1 authoring workflow |
| `src/app/pages/RegistryExplorerPage.tsx` | Preserve as post-V1 research tooling |
| `src/app/pages/SessionMonitorPage.tsx` | Preserve as post-V1 diagnostic tooling |

### Experimental

These changes are barred from the V1 candidate:

| Path | Preservation decision |
|---|---|
| `electron/wisp-overlay.ts` | Preserve on a dedicated experimental branch; no V1 integration |
| `src/app/assets/wisp/index.ts` unstaged animation-set changes | Preserve with Wisp experimental work |
| `src/app/components/SolithWispCompanion.tsx` unstaged expansion | Preserve experimental expansion; retain only the previously accepted basic in-app companion in V1 |
| `src/index.tsx` unstaged overlay/bootstrap changes | Preserve with Wisp/overlay experiment |
| `src/app/assets/wisp/solith-wisp-base-float.png` | Preserve with Wisp experimental assets |
| `src/app/assets/wisp/solith-wisp-controller-float.png` | Preserve with Wisp experimental assets |
| `src/app/assets/wisp/solith-wisp-crystal-float.png` | Preserve with Wisp experimental assets |
| `src/app/assets/wisp/solith-wisp-dragon-float.png` | Preserve with Wisp experimental assets |
| `src/app/assets/wisp/solith-wisp-error-float.png` | Preserve with Wisp experimental assets |
| `src/app/assets/wisp/solith-wisp-phoenix-float.png` | Preserve with Wisp experimental assets |
| `src/app/assets/wisp/solith-wisp-scan-float.png` | Preserve with Wisp experimental assets |
| `src/app/assets/wisp/solith-wisp-shield-float.png` | Preserve with Wisp experimental assets |
| `src/app/assets/wisp/solith-wisp-success-float.png` | Preserve with Wisp experimental assets |
| `src/app/assets/wisp/solith-wisp-warning-float.png` | Preserve with Wisp experimental assets |

## 7. Required atomic commit structure

The stabilization branch must not receive the current dirty tree as one commit. Retained changes must be decomposed in this order:

1. `docs: lock V1 stabilization scope and release authority`
2. `test: add V1 acceptance coverage without production changes`
3. `fix: stabilize local game metadata and install discovery`
4. `fix: stabilize inert CT import and catalog preview gates`
5. `fix: stabilize certified process selection and support labeling`
6. `feat: add accessible walkthroughs for included V1 workflows`
7. `chore: reconcile V1 preload/types/styles and repository hygiene`
8. `release: certify clean-clone stabilization candidate`

Each commit must pass its focused tests. The complete candidate must pass all gates in Section 9. Deferred and Experimental changes must not be hidden inside these commits.

## 8. Privileged-helper binary gate

The helper has until **2026-08-02 17:00 PDT** to satisfy every condition:

- Helper artifacts are hash-pinned by an immutable shipping trust root.
- The shipping manifest is signed or otherwise cryptographically bound to a non-extractable release trust decision.
- Authenticode publisher identity is verified against an explicit publisher allowlist.
- Publisher, file hash, file identity, process identity, proposal, consent, and requested action are bound together.
- Replacement, mutation, manifest tampering, wrong publisher, missing signature, expired consent, replay, PID reuse, path change, and hash change all fail closed.
- Tests exercise the packaged Electron IPC boundary, not only pure functions.
- Audit records preserve exact denial reasons without exposing secrets.
- The release build contains no environment variable or renderer input that can bypass approval.
- Independent hostile review signs off on the exact candidate artifact.

**Binary decision:**

- If every condition passes, the helper may be listed as an included V1 capability with its exact evidence.
- If any condition fails or remains unverified at the deadline, helper registration and execution are disabled in release builds, removed from the V1 manifest, and deferred. No waiver is permitted.

## 9. Packaged-runtime gates

Each gate runs separately against the exact tagged candidate. Each must have its own timeout, exit code, process teardown, log, and bounded artifact directory.

| Gate | Maximum duration | Pass requirement |
|---|---:|---|
| Electron smoke | 5 minutes | All cases pass; app exits; no residual candidate-owned process |
| Consent E2E | 10 minutes | Deny/approve/expiry/replay/identity/online blocks pass at packaged IPC boundary |
| Accessibility | 10 minutes | Zero serious or critical violations in included workflows; keyboard path recorded |
| Performance | 10 minutes | Published cold-start, navigation, memory, and responsiveness budgets pass |
| Browser fallback | 5 minutes | Supported fallback behavior passes without exposing privileged APIs |
| Installer lifecycle | 20 minutes | Clean install, first launch, restart, uninstall, and documented userData behavior pass |
| Upgrade test | 20 minutes | Prior supported build upgrades without data loss; rollback path documented |
| Backup failure/recovery | 20 minutes | Interrupted write cannot corrupt the only copy; restore hash and content verified |

The gate controller must fail on timeout. A timeout is not “inconclusive”; it is a failed release gate.

## 10. Release-candidate definition

The release candidate exists only when all conditions are simultaneously true:

- Clean clone
- Exact tagged commit
- Clean `git status`
- Locked dependencies
- Reproducible build
- Recorded SHA-256 hashes for installer and required packaged helpers
- Node and npm versions recorded
- Exact commands recorded
- Independent packaged gates complete
- No untracked production assets
- No unresolved privileged path
- Explicit per-game/per-control support matrix
- Known limitations bound to the candidate
- Root and backend dependency audit results recorded
- Release owner signs the evidence index

Until then, all artifacts are development artifacts.

## 11. Support matrix policy

Every surfaced game/control must have exactly one reader-facing state:

- **Certified** — executable for an identified build with current safety and recovery evidence
- **Discovery-only** — research workflow; not supported and not executable by default
- **Listed** — catalog metadata only
- **Unsupported** — unavailable

Only **Certified** controls count as V1 live functionality. “Thousands of games,” catalog presence, CT metadata, and session-local discovery do not count as support.

## 12. Deferred branches and preservation locations

| Work | Classification | Preservation location | Stop condition |
|---|---|---|---|
| Xbox Game Bar Wisp prototype | Experimental | Branch `prototype/xbox-gamebar-wisp`; worktree `G:\ACTIVE_PROJECTS\SOLITH-GAMEBAR`; current commit `9940d8786fcbdb1b934dc774b3b67026c6745820` | Stop after compile/feasibility evidence; no V1 integration |
| Packaged Electron/Node spawn repair | Deferred | Branch `jabanaster-fix-packaged-spawn-electron-node`; worktree `C:\Users\chase\copilot-worktrees\GAME TRAINER\jabanaster-vigilant-succotash`; current commit `59b757b356d11d0b14a26e0d502bccedfaec21e3` | Cherry-pick only if mapped to a failing V1 packaged gate |
| Wisp overlay/animation expansion | Experimental | Create branch `experimental/wisp-overlay-expansion` from the current work before cleaning `master` | Preserve source/assets; stop integration and polish |
| Research/compatibility/registry/session UI changes | Deferred | Create branch `deferred/post-v1-research-ui` from the current work before cleaning `master` | No candidate merge without a V1 acceptance mapping |
| Broad roadmap | Deferred | Existing `ROADMAP.md` and historical branches/tags | No roadmap execution during stabilization |
| Hub production track | Deferred | Existing `solith-hub-backend` and `cursor/phase3-hub-sync-trust-ui` history | No V1 dependency or deployment without independent service certification |

Preservation is not approval. A preserved branch may not be merged merely because it compiles.

## 13. August 2 binary gate

### PASS

PASS requires:

- Candidate tag exists on a reviewed commit.
- Clean-clone build is reproducible.
- Git status is clean before and after verification.
- Every packaged-runtime gate passes separately.
- Dependency and artifact evidence is complete.
- Helper trust passes Section 8, or helper execution is absent from the release build.
- Support matrix is explicit and honest.
- No Deferred or Experimental delta is present in the candidate.

### FAIL

Any missing condition is FAIL. On FAIL:

1. Do not retag or redefine the failed artifact as a candidate.
2. Remove privileged helper execution if it has not passed.
3. Remove uncertified live controls from executable V1 scope.
4. Remove optional Wisp/walkthrough behavior if it causes a gate failure.
5. Reduce V1 to local library, inert catalog/CT browsing, backups, and the single certified save-edit workflow.
6. Set the next candidate only after the reduced clean-clone gate passes.

There is no conditional release and no schedule waiver.

## 14. Stop-work directive

Effective immediately, stop:

- Xbox Game Bar integration beyond compile/feasibility evidence
- Wisp overlay and animation expansion
- Catalog expansion
- New game support
- New research tools
- Hub release integration
- Cosmetic work
- New architecture
- New roadmap milestones

Permitted work is limited to classification, preservation, atomic decomposition, security correction or helper removal, V1 acceptance fixes, packaged-gate reliability, documentation reconciliation, and clean-candidate certification.
