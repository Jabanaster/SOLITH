# Clean-Machine Acceptance Plan

Date: 2026-08-01
Status:

```
CLEAN-MACHINE ACCEPTANCE:
NOT PERFORMED — EXTERNAL ENVIRONMENT REQUIRED
```

No clean external machine or VM is available in this environment. This document is preparation only — nothing below has been executed, and this status must not be locally simulated.

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

This plan does not authorize execution. Execution requires an actual external clean environment, which is not available to this session.
