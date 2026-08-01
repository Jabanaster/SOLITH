# Remaining Risks — Candidate `SOLITH-B1.1-INTERNAL-UNSIGNED-2.4.0-alpha.2-5944beaa-x64-20260801T102149Z`

- Renderer first-paint variance (OPEN): 479.1-764.4ms `renderer-did-finish-load` spread across 6 packaged launches, not proven resolved.
- V1 residual privileged IPC: unchanged this session, not re-audited beyond confirming no security-boundary file changed unexpectedly through packaging.
- Unsigned internal status: expected and authorized for this candidate profile; must not be represented as a public release candidate.
- Lack of external clean-machine acceptance: no clean VM/machine available this session; the largest remaining gap before any public-facing decision.
- Lack of production signing: not performed, not authorized this session.
- Lack of publication/upload validation: no publish config exists, nothing was uploaded.
- No verified prior candidate: upgrade-path behavior is entirely unverified for this product line.
- OD-2.5-001 (Electron TypeScript baseline): technically resolved, independently reviewed multiple times, still awaiting owner acceptance.
- OD-2.5-002 (GameLibrary whitespace baseline): still conditional, undocumented cleanup.
- Test-environment artifact (not a candidate defect): GameBar transport failed to start in every packaged launch measured this session, root-caused to `whoami.exe /user /fo csv /nh` being shadowed by Git Bash's `whoami` on this specific test machine's shell `PATH`. A real end-user launch from Explorer/Start Menu would not carry that PATH shadowing. Disclosed for transparency, not treated as a packaging defect, but should be verified once during clean-machine acceptance to confirm it truly does not reproduce outside this dev machine's shell environment.
