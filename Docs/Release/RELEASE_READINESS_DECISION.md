# Release Readiness Decision

Date: 2026-08-01 (updated 2026-08-04 — evidenced clean-machine functional/uninstall/reinstall run added)
Candidate: `SOLITH-B1.1-INTERNAL-UNSIGNED-2.4.0-alpha.2-5944beaa-x64-20260801T102149Z`, master SHA `5944beaa16607a4a96359676d05436bbf3568d19`, unsigned.

## Status by area

| Area | Status |
|---|---|
| Feature completeness | Out of scope for this decision package — not assessed here; see `ROADMAP.md`. |
| Security status | Batch B1.1 candidate-specific packaged verification: 44/44 pass, 0 bypass. OD-2.5-001 owner-accepted and closed (2026-08-04). OD-2.5-003 outstanding; OD-2.5-004 status is disputed between documents as of 2026-08-04 (see `Gate2_5/owner-decision-package.md`'s OD-2.5-004 entry, "NOT STARTED," versus this package's earlier "VERIFIED COMPLETE" claim elsewhere) — pending a dedicated OD-2.5-004 execution review before being treated as closed here. |
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
| Release blockers | Production signing not performed; OD-2.5-001/003 unresolved owner decisions; no upgrade-path baseline; candidate is explicitly unsigned/internal, not release-labeled. Clean-machine functional evidence is now substantially transcript-verified (see above); the residual owner-confirmed-only items (post-reinstall usability, final-close cleanup) and owner-reported-only items (Game Bar/F12) are disclosed but not treated as blockers equivalent in weight to the four listed here. |

## Conclusion

```
NOT RELEASE READY
```

Reasons (per the rule that `RELEASE READY` requires none of the following to be true, and multiple are true here): production signing has not been performed; required owner decisions (OD-2.5-003, and OD-2.5-004 pending its dedicated execution review) are missing; no upgrade-path baseline exists; the candidate is explicitly an unsigned internal candidate, not a release-authorized artifact.

`master` verification and candidate-specific packaged security verification, previously listed as blockers, are now both closed for this candidate. The 2026-08-02 clean-machine run closed the candidate-identity and clean-environment-integrity gap. The 2026-08-04 follow-up run closed most of the clean-machine functional-behavior gap with transcript-backed evidence for 18 discrete items (launch, itemized smoke-check, shutdown/cleanup, uninstall, reinstall); it left a narrower residual gap (post-reinstall usability, final-close cleanup — owner-confirmed only; Game Bar transport and trainer hotkey registration including a reported F12 failure — owner-reported, not evidenced by either transcript). OD-2.5-001 was owner-accepted 2026-08-04 and is closed. This is real, verified progress toward release readiness, but it does not by itself resolve the still-outstanding OD-2.5-003/OD-2.5-004 owner decisions, the missing signing step, or the missing upgrade-path baseline, any one of which independently keeps this candidate NOT RELEASE READY.

Release is not authorized by this document and was not authorized in this run.
