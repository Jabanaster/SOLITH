# B1.1 Promotion Decision Package

Date: 2026-08-01 (updated 2026-08-04 — OD-2.5-003 closed, B1.1 promoted conditional)
Master SHA: `5944beaa16607a4a96359676d05436bbf3568d19`
Candidate ID: `SOLITH-B1.1-INTERNAL-UNSIGNED-2.4.0-alpha.2-5944beaa-x64-20260801T102149Z`
Artifact hashes: installer `BB880D6F4A0D375FB294626B4FADD2B2AA687BD18A81A54D8A66EDA335A72B58`, unpacked `Solith.exe` `3B7A6CD1894444FE81909D5B165B0442894EE7D34BECD9BCD3A1500635CEB4C6`. Unsigned (confirmed via `Get-AuthenticodeSignature`).

## Verification summary

- Source verification (local master, pre-package): TypeScript (Electron + main) 0 diagnostics both, `npm test` 1055/1055 + 10/10, `npm run test:startup-visibility` 10/10, `npm run test:live-memory` 257/257, builds + output verifier 29/29, `git diff --check` clean, working tree clean.
- Master verification: **complete** — see `post-master-verification.md`. Local `master` merged from `integration/b1-1-closeout` (`1521c3c`) onto reconciled `origin/master` (`acef7dc`), merge commit `a3165e5`, independently reviewed twice (post-merge review, then this packaging review).
- Packaged verification: **complete** for this candidate — 44/44 candidate-specific packaged tests pass (`test:packaged-smoke` 23/23 + Gate 2.5 trust-boundary suites 21/21), run against the actual built `Solith.exe`. See `Candidates/.../gate2-5-packaged-verification.md`.
- Local installation verification: **complete** — install/first-launch/uninstall/reinstall all verified on this (non-clean) local machine. See `Candidates/.../installation-verification.md`.
- Upgrade verification: **NOT PERFORMED — NO VERIFIED PRIOR CANDIDATE AVAILABLE** (this is the first candidate).
- Clean-machine status: **SUBSTANTIALLY VERIFIED**. Identity gate (installer SHA-256/size/Authenticode,
  verified both pre-transfer on host and post-transfer in the VM) and clean-environment setup (VirtualBox
  Windows 11 VM, pre-install snapshot, no prior SOLITH/dev-tooling exposure, controlled offline-style
  transfer) are **VERIFIED** (2026-08-02). A follow-up 2026-08-04 run added two independently-captured
  PowerShell transcripts covering launch, itemized manual smoke-check, normal shutdown/process cleanup,
  uninstall (directory/exe/shortcuts/AppData/registry), installer re-identity, and reinstall
  (directory/exe/version/registry) — 18 discrete items now **VERIFIED** by transcript output, not operator
  narration. Two items remain **OWNER-CONFIRMED PASS only**: post-reinstall application usability, and
  final close/process cleanup (the expected `PASS:` line for this last check was not printed due to a
  shell `else`-statement artifact, though no lingering-process table printed either). Game Bar transport
  and trainer hotkey registration (including a reported F12 accelerator failure) are **owner-reported, not
  evidenced** in either 2026-08-04 transcript — those transcripts capture OS process/filesystem/registry
  state only, not the application's internal startup log. See `clean-machine-acceptance-plan.md`,
  `Candidates/.../clean-machine-run-20260802.md`, and
  `Candidates/.../clean-machine-run-20260804-evidenced.md` for the full breakdown.

## Outstanding owner decisions (from `Gate2_5/owner-decision-package.md`, reconciled)

- **OD-2.5-001** (Electron TypeScript baseline): technically resolved, independently reviewed multiple times, **OWNER-ACCEPTED 2026-08-04 — CLOSED** (see `Gate2_5/owner-decision-package.md`). Does not by itself authorize OD-2.5-003 or OD-2.5-004.
- **OD-2.5-002** (GameLibrary whitespace baseline): named, documented, not cleaned up — still conditional.
- **OD-2.5-003** (final B1.1 promotion): **CLOSED — OWNER-AUTHORIZED, 2026-08-04.** B1.1 promoted, conditional on the disclosed residual items (see Recommendation below). Does not authorize signing, release, deployment, or publishing.
- **OD-2.5-004** (branch merge / master verification): **CLOSED** — master integration and post-merge verification complete, reviewed via a dedicated push-readiness audit, and owner-authorized push executed 2026-08-04 (`origin/master` now `3fd402b`).
- **OD-2.5-005** (documentation reconciliation): scoped edits applied in a prior session, explicitly not marked complete, informational/non-blocking.

## Startup-performance status

```
STARTUP WINDOW CREATION — VERIFIED IMPROVED IN PACKAGED CANDIDATE
RENDERER FIRST-PAINT VARIANCE — OPEN
```

Packaged candidate `ready-to-show` range: 354.8-408.5ms across 3 cold + 3 warm real launches. See `Candidates/.../packaged-startup-results.md`.

## Known test flakes

None observed or reported in any suite run this session (all runs single-pass; one apparent packaged Gate 2.5 failure this session was traced to a missing local `.NET` test-fixture build, not a flake or a candidate defect — rebuilt the fixture and reran clean, 21/21).

## Dependency audit

`npm audit`: 0 vulnerabilities.

## Evidence index

- `post-master-verification.md` (master integration)
- `Candidates/SOLITH-B1.1-INTERNAL-UNSIGNED-2.4.0-alpha.2-5944beaa-x64-20260801T102149Z/` (this candidate: manifest, hashes, packaging log, static inspection, packaged Gate 2.5, startup timing, installation verification, upgrade status, process cleanup)
- `clean-machine-acceptance-plan.md` (updated with this candidate's identity; runs executed 2026-08-02 and 2026-08-04)
- `Candidates/SOLITH-B1.1-INTERNAL-UNSIGNED-2.4.0-alpha.2-5944beaa-x64-20260801T102149Z/clean-machine-run-20260802.md` (identity gate + environment, VERIFIED)
- `Candidates/SOLITH-B1.1-INTERNAL-UNSIGNED-2.4.0-alpha.2-5944beaa-x64-20260801T102149Z/clean-machine-run-20260804-evidenced.md` (functional/uninstall/reinstall, transcript-VERIFIED, with the remaining OWNER-CONFIRMED and NOT-EVIDENCED items itemized)
- `Gate2_5/owner-decision-package.md` (pre-existing, reconciled; OD-2.5-001/OD-2.5-003 decision packets added 2026-08-04)
- `Docs/Reports/PERFORMANCE_REPORT.md` (startup investigation, pre-existing)

## Remaining risks

- Renderer first-paint variance (OPEN, unresolved, not release-blocking per prior documented status but should be disclosed).
- OD-2.5-001 — CLOSED (owner-accepted 2026-08-04). OD-2.5-004 — CLOSED (verified complete, pushed to `origin/master` as `3fd402b`, 2026-08-04). OD-2.5-003 — CLOSED (owner-authorized 2026-08-04, B1.1 promoted conditional). Signing, release, deployment, and publishing remain separate, unauthorized future decisions.
- OD-2.5-002 whitespace baseline still conditional.
- Unsigned internal status — expected for this candidate profile, not a defect, but must not be represented as a public release candidate.
- Clean-machine functional evidence is now substantially transcript-verified (18 items, see evidence index above), narrowing but not eliminating the gap: post-reinstall usability and final close/cleanup remain OWNER-CONFIRMED PASS only, and Game Bar transport / trainer hotkey registration (including a reported F12 accelerator failure) are owner-reported, not evidenced in either 2026-08-04 transcript.
- No verified prior candidate — upgrade-path behavior remains unverified (also not exercised in the clean-machine run, since there was no prior installed version to upgrade from).
- V1 residual privileged IPC — unchanged this session, not re-audited beyond confirming no security-boundary file changed unexpectedly through packaging.
- F12 trainer hotkey accelerator registration reportedly failed ("Electron rejected accelerator") during clean-machine testing; F1-F11 reportedly registered successfully. Not independently evidenced by the available transcripts (see `remaining-risks.md`); severity/root cause undetermined.

## Recommendation

```
B1.1 PROMOTED — CONDITIONAL
```

Source, master, and packaged-candidate verification are all clean (44/44 candidate-specific security tests pass, 0 bypass, unsigned status confirmed empirically). The candidate's identity was independently re-verified inside an isolated clean Windows 11 VM (exact SHA-256/size/Authenticode match, pre- and post-transfer), the clean-machine environment itself is independently verified, and the clean-machine functional result (launch, itemized smoke-check, normal shutdown/cleanup, uninstall, reinstall) is independently transcript-verified for 18 discrete items rather than resting on an unelaborated operator report. OD-2.5-001 (Electron TypeScript baseline) is owner-accepted and closed. OD-2.5-004 (branch merge/master verification) is verified complete and pushed to `origin/master` (`3fd402b`). OD-2.5-003 (this promotion decision) was explicitly authorized by the owner on 2026-08-04 — see the verbatim decision in `Gate2_5/owner-decision-package.md`.

Promotion is **conditional**: it does not waive or silently resolve the disclosed residual items — no upgrade-path baseline (first candidate, nothing to upgrade from), post-reinstall usability and final-close cleanup remain owner-confirmed rather than independently transcript-verified, the reported F12 accelerator failure and Game Bar transport status remain owner-reported and not evidenced by either 2026-08-04 transcript, renderer first-paint variance remains OPEN, OD-2.5-002 (GameLibrary whitespace baseline) remains conditional, and the candidate remains explicitly unsigned/internal. This document's authorization is limited exactly to updating the promotion disposition, committing the closure documentation, and pushing the resulting documentation commits after verification — it does **not** authorize production signing, public release, deployment, publishing installers, creating a GitHub release, creating release tags, uploading artifacts, or any implementation change. Each of those remains a separate, unauthorized, future owner decision.

AcceptanceRequired: OD-2.5-001, OD-2.5-004, and OD-2.5-003 are all now closed. No further owner action is required to close B1.1 promotion itself. The next gate — signing/release review — requires its own separate, explicit owner authorization and is not implied by anything in this document.
