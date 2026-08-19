# Release Readiness Decision

Date: 2026-08-01 (updated 2026-08-04 — OD-2.5-003 closed, B1.1 promoted conditional; still NOT RELEASE READY)
Candidate: `SOLITH-B1.1-INTERNAL-UNSIGNED-2.4.0-alpha.2-5944beaa-x64-20260801T102149Z`, master SHA `5944beaa16607a4a96359676d05436bbf3568d19`, unsigned.

## Status by area

| Area | Status |
|---|---|
| Feature completeness | Out of scope for this decision package — not assessed here; see `ROADMAP.md`. |
| Security status | Batch B1.1 candidate-specific packaged verification: 44/44 pass, 0 bypass. OD-2.5-001 owner-accepted and closed (2026-08-04). OD-2.5-004 closed (branch merge verified, push-readiness audited, owner-authorized push executed — `origin/master` now at `3fd402b`, 2026-08-04). OD-2.5-003 closed (owner-authorized 2026-08-04) — B1.1 promoted, conditional. B1.1 promotion is not release authorization; see Conclusion below. |
| Packaging status | Unsigned internal candidate built and verified. See `Docs/Security/Evidence/BatchB1_1_Closeout/Candidates/SOLITH-B1.1-INTERNAL-UNSIGNED-2.4.0-alpha.2-5944beaa-x64-20260801T102149Z/`. |
| Candidate identity | Installer SHA-256 `BB880D6F4A0D375FB294626B4FADD2B2AA687BD18A81A54D8A66EDA335A72B58`; unpacked `Solith.exe` SHA-256 `3B7A6CD1894444FE81909D5B165B0442894EE7D34BECD9BCD3A1500635CEB4C6`. |
| Packaged verification | Complete for this candidate: `test:packaged-smoke` 23/23, Gate 2.5 trust-boundary suites 21/21 (44/44 total), run against the real built exe. |
| Clean-machine acceptance | SUBSTANTIALLY VERIFIED. Candidate identity (SHA-256/size/Authenticode) and clean-environment setup independently VERIFIED inside an isolated VirtualBox Windows 11 VM (2026-08-02). A 2026-08-04 follow-up run added two independently-captured PowerShell transcripts VERIFYING launch, itemized manual smoke-check, normal shutdown/process cleanup, uninstall (directory/exe/shortcuts/AppData/registry), installer re-identity, and reinstall (directory/exe/version/registry) — 18 discrete transcript-backed items. Post-reinstall usability and final-close cleanup remain OWNER-CONFIRMED PASS only. Game Bar transport and trainer hotkey registration (including a reported F12 accelerator failure) are owner-reported, not evidenced in either transcript. See `Docs/Security/Evidence/BatchB1_1_Closeout/Candidates/.../clean-machine-run-20260802.md` and `.../clean-machine-run-20260804-evidenced.md`. |
| Startup performance | `STARTUP WINDOW CREATION — VERIFIED IMPROVED IN PACKAGED CANDIDATE`; `RENDERER FIRST-PAINT VARIANCE — OPEN`. Packaged `ready-to-show` range 354.8-408.5ms (6 real launches). |
| Wisp status | Isolated, unmodified, paused pending security/B1.1 closeout (confirmed zero diff since `502300b`). |
| Game Bar status | Unmodified since `502300b`; transport ordering unchanged. Note: packaged GameBar transport failed to start in this specific test session due to a local shell-`PATH` artifact (`whoami.exe` shadowed by Git Bash) unrelated to the candidate — see `Candidates/.../packaged-startup-results.md`. |
| CT Import status | Unmodified; covered by full passing suite. |
| Installation status | Verified on local (non-clean) machine: install, first launch, uninstall, reinstall all pass. Not clean-machine verified. |
| Upgrade status | NOT PERFORMED — NO VERIFIED PRIOR CANDIDATE AVAILABLE. |
| Documentation status | Reconciled at source and candidate-evidence level this session; OD-2.5-005 documentation-consolidation item remains marked incomplete/informational. |
| Supportability | Not assessed in this package. |
| Rollback | Not assessed — no prior candidate exists to roll back to for this line. |
| Observability | `SOLITH_STARTUP_TRACE` diagnostic marks available, opt-in, not enabled by default; confirmed working in the packaged candidate. |
| Known limitations | Renderer first-paint variance (open); GameLibrary whitespace baseline (OD-2.5-002, conditional); unsigned status (expected for internal candidate, not release-appropriate); reported F12 trainer-accelerator registration failure, not independently evidenced. |
| Release blockers | Production signing not performed; no upgrade-path baseline; candidate is explicitly unsigned/internal, not release-labeled. B1.1 promotion (OD-2.5-003) is now closed but confers no signing/release/deployment/publishing authorization — each remains a separate, unauthorized future owner decision. Clean-machine functional evidence is substantially transcript-verified (see above); the residual owner-confirmed-only items (post-reinstall usability, final-close cleanup) and owner-reported-only items (Game Bar/F12) are disclosed but not treated as blockers equivalent in weight to signing/upgrade-baseline/unsigned-status. |

## Conclusion

```
NOT RELEASE READY
```

Reasons (per the rule that `RELEASE READY` requires none of the following to be true, and multiple are true here): production signing has not been performed; no upgrade-path baseline exists; the candidate is explicitly an unsigned internal candidate, not a release-authorized artifact. OD-2.5-001, OD-2.5-004, and OD-2.5-003 are all now closed — B1.1 is promoted, conditional — but B1.1 promotion is a distinct decision from release readiness and does not resolve any of the three reasons above.

`master` verification and candidate-specific packaged security verification, previously listed as blockers, are now both closed for this candidate. The 2026-08-02 clean-machine run closed the candidate-identity and clean-environment-integrity gap. The 2026-08-04 follow-up run closed most of the clean-machine functional-behavior gap with transcript-backed evidence for 18 discrete items (launch, itemized smoke-check, shutdown/cleanup, uninstall, reinstall); it left a narrower residual gap (post-reinstall usability, final-close cleanup — owner-confirmed only; Game Bar transport and trainer hotkey registration including a reported F12 failure — owner-reported, not evidenced by either transcript). OD-2.5-001 was owner-accepted 2026-08-04; OD-2.5-004 was verified complete and pushed to `origin/master` the same day (`3fd402b`); OD-2.5-003 was owner-authorized the same day, closing B1.1 promotion, conditional on the disclosed residual items. This is real, verified progress, but production signing, an upgrade-path baseline, and the candidate's unsigned/internal status remain unresolved — any one of which independently keeps this candidate NOT RELEASE READY. B1.1 promotion does not imply, authorize, or shortcut release readiness.

Release is not authorized by this document and was not authorized in this run. Nothing in this update authorizes signing, deployment, publishing, tagging, or artifact upload.
