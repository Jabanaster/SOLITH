# B1.1 Promotion Decision Package

Date: 2026-08-01 (updated — packaged candidate added)
Master SHA: `5944beaa16607a4a96359676d05436bbf3568d19`
Candidate ID: `SOLITH-B1.1-INTERNAL-UNSIGNED-2.4.0-alpha.2-5944beaa-x64-20260801T102149Z`
Artifact hashes: installer `BB880D6F4A0D375FB294626B4FADD2B2AA687BD18A81A54D8A66EDA335A72B58`, unpacked `Solith.exe` `3B7A6CD1894444FE81909D5B165B0442894EE7D34BECD9BCD3A1500635CEB4C6`. Unsigned (confirmed via `Get-AuthenticodeSignature`).

## Verification summary

- Source verification (local master, pre-package): TypeScript (Electron + main) 0 diagnostics both, `npm test` 1055/1055 + 10/10, `npm run test:startup-visibility` 10/10, `npm run test:live-memory` 257/257, builds + output verifier 29/29, `git diff --check` clean, working tree clean.
- Master verification: **complete** — see `post-master-verification.md`. Local `master` merged from `integration/b1-1-closeout` (`1521c3c`) onto reconciled `origin/master` (`acef7dc`), merge commit `a3165e5`, independently reviewed twice (post-merge review, then this packaging review).
- Packaged verification: **complete** for this candidate — 44/44 candidate-specific packaged tests pass (`test:packaged-smoke` 23/23 + Gate 2.5 trust-boundary suites 21/21), run against the actual built `Solith.exe`. See `Candidates/.../gate2-5-packaged-verification.md`.
- Local installation verification: **complete** — install/first-launch/uninstall/reinstall all verified on this (non-clean) local machine. See `Candidates/.../installation-verification.md`.
- Upgrade verification: **NOT PERFORMED — NO VERIFIED PRIOR CANDIDATE AVAILABLE** (this is the first candidate).
- Clean-machine status: **NOT PERFORMED — EXTERNAL ENVIRONMENT REQUIRED**. See `clean-machine-acceptance-plan.md`.

## Outstanding owner decisions (from `Gate2_5/owner-decision-package.md`, reconciled)

- **OD-2.5-001** (Electron TypeScript baseline): technically resolved, independently reviewed multiple times — **OWNER ACCEPTANCE STILL REQUIRED**.
- **OD-2.5-002** (GameLibrary whitespace baseline): named, documented, not cleaned up — still conditional.
- **OD-2.5-003** (final B1.1 promotion): **NOT AUTHORIZED**.
- **OD-2.5-004** (branch merge / master verification): now **VERIFIED COMPLETE** (master integration and post-merge verification both done and independently reviewed this session).
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
- `clean-machine-acceptance-plan.md` (updated with this candidate's identity, still unperformed)
- `Gate2_5/owner-decision-package.md` (pre-existing, reconciled)
- `Docs/Reports/PERFORMANCE_REPORT.md` (startup investigation, pre-existing)

## Remaining risks

- Renderer first-paint variance (OPEN, unresolved, not release-blocking per prior documented status but should be disclosed).
- OD-2.5-001 owner acceptance outstanding — technical resolution complete, not owner-accepted.
- OD-2.5-002 whitespace baseline still conditional.
- Unsigned internal status — expected for this candidate profile, not a defect, but must not be represented as a public release candidate.
- Lack of external clean-machine acceptance — the largest remaining gap before any public release consideration.
- No verified prior candidate — upgrade-path behavior remains unverified.
- V1 residual privileged IPC — unchanged this session, not re-audited beyond confirming no security-boundary file changed unexpectedly through packaging.

## Recommendation

```
DO NOT PROMOTE
```

Source, master, and packaged-candidate verification are all now clean (44/44 candidate-specific security tests pass, 0 bypass, unsigned status confirmed empirically). However, clean-machine acceptance remains unperformed and external-environment-gated, OD-2.5-001 and OD-2.5-003 remain outstanding owner decisions, and no upgrade-path baseline exists. Promotion is not authorized by this document and was not performed.

AcceptanceRequired: OWNER DECISION REQUIRED for OD-2.5-001, OD-2.5-003, and this promotion recommendation, together, plus external clean-machine acceptance before any public-facing decision.
