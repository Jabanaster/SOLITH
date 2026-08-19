# Remaining Risks — Candidate `SOLITH-B1.1-INTERNAL-UNSIGNED-2.4.0-alpha.2-5944beaa-x64-20260801T102149Z`

- Renderer first-paint variance (OPEN): 479.1-764.4ms `renderer-did-finish-load` spread across 6 packaged launches, not proven resolved.
- V1 residual privileged IPC: unchanged this session, not re-audited beyond confirming no security-boundary file changed unexpectedly through packaging.
- Unsigned internal status: expected and authorized for this candidate profile; must not be represented as a public release candidate.
- Clean-machine acceptance is now substantially evidenced, not thin: the 2026-08-02 run VERIFIED the
  candidate's identity (SHA-256/size/Authenticode, pre- and post-transfer) and the clean-environment setup.
  A follow-up 2026-08-04 run produced two independently-captured PowerShell transcripts
  (`functional-evidence-corrected-20260804-002655.log`, `uninstall-reinstall-evidence-20260804-004542.log`)
  that VERIFY launch, process capture, the itemized manual smoke-check sequence, normal shutdown/process
  cleanup, uninstall (directory/exe/shortcuts/AppData/registry all confirmed removed), installer
  re-identity, and reinstall (directory/exe/version/registry all confirmed restored) — 18 discrete items,
  see `clean-machine-run-20260804-evidenced.md` for the line-by-line citation. Two items remain
  OWNER-CONFIRMED PASS only, not independently verified: post-reinstall application usability, and final
  close/cleanup (the intended `PASS:` confirmation line for the very last cleanup check was not printed due
  to a shell `else`-statement artifact, though no lingering-process table was printed either). This is a
  narrower, better-evidenced gap than the prior "thin, user-reported-only" status, not a fully closed one.
- OBSERVED LIMITATION — F12 trainer hotkey: reported that F1 through F11 registered successfully but F12
  failed with `"Electron rejected accelerator"` during this candidate's clean-machine testing. Neither the
  2026-08-04 functional transcript nor the uninstall/reinstall transcript captures application-internal
  startup log output (they capture OS process/filesystem/registry state only), so this item is
  owner-reported, not independently transcript-verified. Not silently omitted, and not automatically
  classified as a release blocker without further evidence — root cause and severity are undetermined
  pending review of the application's own startup log or a targeted reproduction.
- Game Bar transport start/stop during the 2026-08-04 clean-machine functional run: owner-reported, not
  evidenced in either 2026-08-04 transcript for the same reason as the F12 item above (transcripts do not
  capture in-app log output).
- Lack of production signing: not performed, not authorized this session.
- Lack of publication/upload validation: no publish config exists, nothing was uploaded.
- No verified prior candidate: upgrade-path behavior is entirely unverified for this product line.
- OD-2.5-001 (Electron TypeScript baseline): technically resolved, independently reviewed multiple times, owner-accepted 2026-08-04 — CLOSED.
- OD-2.5-002 (GameLibrary whitespace baseline): still conditional, undocumented cleanup.
- Test-environment artifact (not a candidate defect): GameBar transport failed to start in every packaged launch measured this session, root-caused to `whoami.exe /user /fo csv /nh` being shadowed by Git Bash's `whoami` on this specific test machine's shell `PATH`. A real end-user launch from Explorer/Start Menu would not carry that PATH shadowing. Disclosed for transparency, not treated as a packaging defect. The 2026-08-04 clean-machine run used the real Windows shortcut/exe path (not this dev machine's shell), so this specific PATH-shadowing artifact should not apply there — but since Game Bar status was not itself transcript-evidenced on 2026-08-04 (see above), this has not been positively confirmed non-reproducing in the clean VM either.
