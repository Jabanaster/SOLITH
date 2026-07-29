# Remaining Risks

## R-B11-LC-001
ID: R-B11-LC-001
Title: Raw-byte rollback equality unavailable
Severity: Medium
AffectedControl: Rollback floating-point and int64 integrity
Evidence: rollback-float-integrity-test-matrix.csv
Mitigation: Central type-aware comparator; unsafe int64 and unsupported types fail closed.
AcceptanceStatus: Proposed for acceptance
AcceptedBy: Unassigned
AcceptanceDate: Unassigned
FollowUp: Add raw-byte read/encoded-value support in a separately scoped native-driver redesign.

## R-B11-LC-002
ID: R-B11-LC-002
Title: Full npm test blocked by local Node runtime mismatch
Severity: Medium
AffectedControl: Real full verification
Evidence: verification-npm-test.txt
Mitigation: Re-run exact `npm test` under the project-required Node 22.x without changing scripts.
AcceptanceStatus: Proposed for acceptance
AcceptedBy: Unassigned
AcceptanceDate: Unassigned
FollowUp: Provide/use an already-approved Node 22 runtime; no package installation was performed.

## R-B11-LC-003
ID: R-B11-LC-003
Title: Unrelated Electron TypeScript baseline remains
Severity: Low
AffectedControl: Full Electron typecheck
Evidence: verification-tsc-electron.txt
Mitigation: Scoped files are clean except the documented pre-existing `memory-manager.ts` diagnostic; remaining errors are classified as pre-existing/unrelated or introduced by unrelated current changes.
AcceptanceStatus: Proposed for acceptance
AcceptedBy: Unassigned
AcceptanceDate: Unassigned
FollowUp: Resolve in the owning non-B1.1 workstream.

## R-B11-LC-004
ID: R-B11-LC-004
Title: Platform-specific lifecycle tests use isolated fakes
Severity: Low
AffectedControl: Renderer crash, shutdown, Windows process identity
Evidence: renderer-crash-test-matrix.csv; shutdown-test-matrix.csv; process-selection-test-matrix.csv
Mitigation: Tests tie to actual Electron event/source wiring and exercise behavior with deterministic fakes; no live game process required.
AcceptanceStatus: Proposed for acceptance
AcceptedBy: Unassigned
AcceptanceDate: Unassigned
FollowUp: Add packaged Electron crash/shutdown certification on Windows.

## R-B11-LC-005
ID: R-B11-LC-005
Title: Dirty-tree diff check fails on unrelated trailing whitespace
Severity: Low
AffectedControl: Final scope integrity
Evidence: verification-diff-check.txt
Mitigation: Files are outside B1.1 scope and were preserved unchanged.
AcceptanceStatus: Proposed for acceptance
AcceptedBy: Unassigned
AcceptanceDate: Unassigned
FollowUp: Owning UI workstream should remove trailing whitespace.
