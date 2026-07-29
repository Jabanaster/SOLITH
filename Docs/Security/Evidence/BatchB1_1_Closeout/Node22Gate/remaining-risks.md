# Remaining Risks

## R-B11-N22-001

ID: R-B11-N22-001
Title: Raw-byte rollback equality remains unavailable
Severity: Medium
AffectedControl: Rollback expected-state equality
Evidence: `..\Lifecycle\rollback-float-integrity-test-matrix.csv`
ExistingMitigation: Type-aware comparison covers supported source types and fails closed for unsafe or unsupported values.
AcceptanceStatus: Proposed for acceptance
AcceptedBy: Unassigned
AcceptanceDate: Unassigned
FollowUp: Gate 2 feasibility and owner disposition.

## R-B11-N22-002

ID: R-B11-N22-002
Title: Packaged Windows lifecycle certification remains outstanding
Severity: Medium
AffectedControl: Packaged renderer crash, shutdown, feature-disable, restart, and PID-reuse behavior
Evidence: `..\Lifecycle\verification-final.txt`
ExistingMitigation: Deterministic lifecycle tests are green and tied to production event wiring.
AcceptanceStatus: Proposed for acceptance
AcceptedBy: Unassigned
AcceptanceDate: Unassigned
FollowUp: Gate 2 packaged Windows lifecycle certification.

## R-B11-N22-003

ID: R-B11-N22-003
Title: Electron TypeScript baseline contains 31 diagnostics across 13 files
Severity: Low
AffectedControl: Full Electron TypeScript release gate
Evidence: `typescript-electron-node22.txt`; exact diagnostic comparison against `..\Lifecycle\verification-tsc-electron.txt` produced zero differences.
ExistingMitigation: No diagnostic appears in the B1.1 lifecycle coordinator, session cleanup, trusted-sender registry or wrapper, process-selection registry or IPC, main lifecycle wiring, consent store, rollback session, or freeze-concurrency registry.
AcceptanceStatus: Proposed for acceptance
AcceptedBy: Unassigned
AcceptanceDate: Unassigned
FollowUp: Separate Electron TypeScript Baseline Cleanup milestone.

## R-B11-N22-004

ID: R-B11-N22-004
Title: GameLibrary.tsx contains unrelated trailing whitespace
Severity: Low
AffectedControl: `git diff --check` release gate
Evidence: `git-diff-check-node22.txt`; `..\Lifecycle\verification-diff-check.txt`
ExistingMitigation: The two findings at lines 286 and 303 predate this evidence backfill and were not modified.
AcceptanceStatus: Proposed for acceptance
AcceptedBy: Unassigned
AcceptanceDate: Unassigned
FollowUp: Separate atomic cleanup or explicit release-gate disposition.

## R-B11-N22-005

ID: R-B11-N22-005
Title: Initial Gate 1 npm test attempt was interrupted by the command harness
Severity: Informational
AffectedControl: Test execution evidence
Evidence: Accepted Gate 1 execution history; authoritative rerun is `npm-test-node22.txt`.
ExistingMitigation: The invalid short-timeout attempt was discarded and the complete Node 22 rerun passed 1,034 of 1,034 tests.
AcceptanceStatus: Proposed for acceptance
AcceptedBy: Unassigned
AcceptanceDate: Unassigned
FollowUp: None; retain classification history.

## R-B11-N22-006

ID: R-B11-N22-006
Title: Dirty tree changed outside the authorized evidence directory during capture
Severity: High for evidence integrity
AffectedControl: Gate 1 evidence backfill provenance
Evidence: `git-status-before.txt`; `git-status-after.txt`; `git-diff-stat-before.txt`; `git-diff-stat-after.txt`; `git-diff-name-only-before.txt`; `git-diff-name-only-after.txt`; `changed-files.txt`
ExistingMitigation: Work stopped without reverting or modifying the affected paths.
AcceptanceStatus: Proposed for acceptance
AcceptedBy: Unassigned
AcceptanceDate: Unassigned
FollowUp: Project owner must reconcile the concurrent tree changes, then authorize a fresh evidence-only rerun.
