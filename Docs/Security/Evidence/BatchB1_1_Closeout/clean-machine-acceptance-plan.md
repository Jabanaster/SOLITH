# Clean-Machine Acceptance Plan

Date: 2026-08-01 (status updated 2026-08-04 — evidenced functional/uninstall/reinstall run added)
Status:

```
CLEAN-MACHINE ACCEPTANCE:
SUBSTANTIALLY VERIFIED — IDENTITY GATE, ENVIRONMENT, FUNCTIONAL LAUNCH, AND UNINSTALL/REINSTALL ARE
TRANSCRIPT-VERIFIED. POST-REINSTALL USABILITY AND FINAL-CLOSE CLEANUP REMAIN OWNER-CONFIRMED PASS ONLY.
GAME BAR TRANSPORT AND TRAINER HOTKEY REGISTRATION (INCLUDING AN F12 FAILURE) ARE OWNER-REPORTED, NOT
EVIDENCED IN THE AVAILABLE TRANSCRIPTS.
```

A clean-machine run was executed on 2026-08-02 against a VirtualBox Windows 11 VM. The candidate-identity
gate (SHA-256, size, Authenticode status) and the clean-environment setup/snapshot discipline were
independently captured by the orchestrating session and are VERIFIED. The 2026-08-02 report's
install/launch/functional/uninstall/reinstall steps were relayed by the human operator without
independently captured commands, screenshots, or logs, and were USER-REPORTED PASS only.

A follow-up run on 2026-08-04 produced two PowerShell transcripts
(`functional-evidence-corrected-20260804-002655.log`,
`uninstall-reinstall-evidence-20260804-004542.log`) that independently capture process state,
filesystem state, and registry state across launch, smoke-check, close, uninstall, and reinstall. See
`Candidates/SOLITH-B1.1-INTERNAL-UNSIGNED-2.4.0-alpha.2-5944beaa-x64-20260801T102149Z/clean-machine-run-20260804-evidenced.md`
for the full item-by-item VERIFIED / OWNER-CONFIRMED / NOT-EVIDENCED breakdown, which supersedes the
2026-08-02 report's USER-REPORTED-ONLY classification for the specific items it directly evidences. The
2026-08-02 report (`clean-machine-run-20260802.md`) is retained for the identity-gate and
environment-setup findings, which are unchanged. This plan document is retained below for reference; treat
the two linked run reports as the current status, not the "NOT PERFORMED" text further down.

## Environment requirements

- OS: Windows 11 (build matching or newer than the development machine, 10.0.26200), x64.
- Fresh VM or physical machine with no prior SOLITH install, no dev tooling (no Node, no Electron, no repo checkout).
- Snapshot taken immediately after OS provisioning, before any candidate install — restore to this snapshot before every acceptance run and between scenarios that require a clean state.
- Network: both online and offline conditions tested (trainer catalog sync and Game Bar transport behavior differ by connectivity).
- Prerequisites: none beyond stock Windows (no .NET/VC++ redistributable requirement currently documented — confirm from actual NSIS installer behavior during the real run, not assumed here).

## Candidate identity requirement

- Exact candidate SHA-256 (installer and unpacked `Solith.exe`) must be recorded from Phase 10 evidence before use here. This plan does not authorize using any historical hash.

## Current candidate (2026-08-01)

- Candidate ID: `SOLITH-B1.1-INTERNAL-UNSIGNED-2.4.0-alpha.2-5944beaa-x64-20260801T102149Z`
- Source SHA: `5944beaa16607a4a96359676d05436bbf3568d19`
- Version: `2.4.0-alpha.2`, architecture `x64`
- Installer: `Solith Setup 2.4.0-alpha.2.exe`, SHA-256 `BB880D6F4A0D375FB294626B4FADD2B2AA687BD18A81A54D8A66EDA335A72B58`
- Unpacked `Solith.exe` SHA-256: `3B7A6CD1894444FE81909D5B165B0442894EE7D34BECD9BCD3A1500635CEB4C6`
- Signing: unsigned (`NotSigned`, confirmed via `Get-AuthenticodeSignature` on installer, unpacked exe, and installed exe)
- Local-machine (non-clean) install/launch/uninstall/reinstall already verified — see `Candidates/SOLITH-B1.1-INTERNAL-UNSIGNED-2.4.0-alpha.2-5944beaa-x64-20260801T102149Z/installation-verification.md`. This is NOT a substitute for the clean-machine run below.
- Local-machine packaged Gate 2.5 result: 44/44 pass — see `Candidates/.../gate2-5-packaged-verification.md`.
- Required screenshots/logs for the actual external run: unsigned-warning dialog (SmartScreen), install-wizard screens, first-launch window, uninstall confirmation, `Get-CimInstance Win32_Process` before/after uninstall.
- Evidence file naming for the external run: `Candidates/SOLITH-B1.1-INTERNAL-UNSIGNED-2.4.0-alpha.2-5944beaa-x64-20260801T102149Z/clean-machine-run-<date>.md`.
- VM snapshot instructions: snapshot immediately after OS provisioning and Windows Update completion, before any candidate transfer; restore before every scenario requiring a clean state, per Procedure step 1 above.

## Procedure

1. Restore VM to clean snapshot.
2. Copy candidate installer to VM via a trusted, offline transfer (no untrusted network fetch).
3. Verify installer SHA-256 matches Phase 10 evidence before running it.
4. Run installer; record: install path, shortcut creation, any UAC/SmartScreen prompt text, install duration.
5. First launch: record startup timing marks if `SOLITH_STARTUP_TRACE=1` is set for this run only, window visibility, no crash/error dialog, application identity/version shown in-app.
6. Run security scenarios: main-frame trusted sender, child-frame rejection, popup/navigation denial, DevTools sender rejection — using the packaged app only, no dev flags.
7. Run startup scenarios: cold launch (first-ever), warm launch (second launch), fallback-timeout path is not forceable in a real acceptance run (no env var overrides on a genuine clean-machine run) — observe real `ready-to-show` timing only.
8. Upgrade scenario: install an older supported version first (if available), then upgrade to the candidate; verify settings and database preserved, no stale executable remains running.
9. Uninstall: run uninstaller, verify `deleteAppDataOnUninstall: true` behavior, no orphaned process, no orphaned scheduled task or firewall rule.
10. Reinstall after uninstall: verify clean re-initialization.
11. Rollback procedure: if any scenario fails, restore snapshot; do not attempt to patch or repair the clean-machine instance.

## Logs and evidence to collect

- Installer stdout/exit code (if run non-interactively) or install-wizard screenshots.
- First-launch and subsequent-launch screenshots.
- Windows Event Viewer Application log entries for the SOLITH process, if any errors.
- Process list before/after uninstall (`Get-Process`, `Get-CimInstance Win32_Process`) confirming no orphan.
- Candidate SHA-256 used, VM snapshot ID/timestamp, Windows build number.

## Pass/fail criteria

- Pass: install, launch, all security scenarios, upgrade, uninstall, reinstall all complete with no crash, no security-boundary bypass, no orphaned process/file, and match packaged (non-clean-machine) behavior already verified in Phase 11.
- Fail: any crash, any security scenario allowing an untrusted sender/navigation/popup, any orphaned process after uninstall, or any divergence from Phase 11 packaged results not explained by the clean environment itself.

This plan did not itself authorize execution and originally required an external clean environment not
available to the session that wrote it. That environment has since become available and the run was
executed 2026-08-02 — see the status block at the top of this document and the linked run report for the
result, including the parts that remain user-reported and unverified.
