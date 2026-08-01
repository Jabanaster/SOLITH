# Release Readiness Decision

Date: 2026-08-01 (updated — packaged candidate added)
Candidate: `SOLITH-B1.1-INTERNAL-UNSIGNED-2.4.0-alpha.2-5944beaa-x64-20260801T102149Z`, master SHA `5944beaa16607a4a96359676d05436bbf3568d19`, unsigned.

## Status by area

| Area | Status |
|---|---|
| Feature completeness | Out of scope for this decision package — not assessed here; see `ROADMAP.md`. |
| Security status | Batch B1.1 candidate-specific packaged verification: 44/44 pass, 0 bypass. OD-2.5-001/003 outstanding (OD-2.5-004 now closed). |
| Packaging status | Unsigned internal candidate built and verified. See `Docs/Security/Evidence/BatchB1_1_Closeout/Candidates/SOLITH-B1.1-INTERNAL-UNSIGNED-2.4.0-alpha.2-5944beaa-x64-20260801T102149Z/`. |
| Candidate identity | Installer SHA-256 `BB880D6F4A0D375FB294626B4FADD2B2AA687BD18A81A54D8A66EDA335A72B58`; unpacked `Solith.exe` SHA-256 `3B7A6CD1894444FE81909D5B165B0442894EE7D34BECD9BCD3A1500635CEB4C6`. |
| Packaged verification | Complete for this candidate: `test:packaged-smoke` 23/23, Gate 2.5 trust-boundary suites 21/21 (44/44 total), run against the real built exe. |
| Clean-machine acceptance | NOT PERFORMED — EXTERNAL ENVIRONMENT REQUIRED. Plan updated with this candidate's identity but still unexecuted. |
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
| Known limitations | Renderer first-paint variance (open); GameLibrary whitespace baseline (OD-2.5-002, conditional); unsigned status (expected for internal candidate, not release-appropriate). |
| Release blockers | Clean-machine acceptance unavailable; production signing not performed; OD-2.5-001/003 unresolved owner decisions; no upgrade-path baseline; candidate is explicitly unsigned/internal, not release-labeled. |

## Conclusion

```
NOT RELEASE READY
```

Reasons (per the rule that `RELEASE READY` requires none of the following to be true, and multiple are true here): clean-machine acceptance is missing; production signing has not been performed; required owner decisions (OD-2.5-001, OD-2.5-003) are missing; no upgrade-path baseline exists; the candidate is explicitly an unsigned internal candidate, not a release-authorized artifact.

`master` verification and candidate-specific packaged security verification, previously listed as blockers, are now both closed for this candidate — this is real, verified progress toward release readiness, but it is not sufficient by itself.

Release is not authorized by this document and was not authorized in this run.
