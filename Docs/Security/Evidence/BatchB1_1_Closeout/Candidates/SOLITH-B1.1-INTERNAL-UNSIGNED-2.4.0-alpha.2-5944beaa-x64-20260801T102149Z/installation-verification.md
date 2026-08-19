# Installation, Launch, Uninstall, Reinstall Verification

Machine: Windows 10.0.26200 (Windows 11), user `dis-is-the-wae\chase`. Local test machine — this is not clean-machine acceptance (no clean/external VM used); see `clean-machine-acceptance-plan.md` for that separate, still-unperformed, requirement.

Installer: `dist\Solith Setup 2.4.0-alpha.2.exe` (NSIS, one-click, per-user — `perMachine=false`, no elevation required). Silent flag `/S` used for all installs/uninstalls (supported by electron-builder NSIS regardless of one-click mode).

## Install

```
Start-Process "Solith Setup 2.4.0-alpha.2.exe" -ArgumentList "/S" -Wait
```
Exit code: `0`. Installed to `%LOCALAPPDATA%\Programs\solith`. Unsigned warning is expected for an unsigned candidate (not tested interactively since `/S` bypasses UI, but `Get-AuthenticodeSignature` on the installer itself independently confirms `NotSigned`, so Windows SmartScreen/Defender would show the expected unsigned-publisher warning on interactive double-click).

Installed files verified present: `Solith.exe`, `Uninstall Solith.exe`, resources, locales, native DLLs (`d3dcompiler_47.dll`, `ffmpeg.dll`, etc.), `resources.pak`. `Solith.exe` `FileVersion` = `2.4.0-alpha.2`, `ProductName` = `Solith`. SHA-256 of installed `Solith.exe` = `3B7A6CD1894444FE81909D5B165B0442894EE7D34BECD9BCD3A1500635CEB4C6`, exact match to the unpacked build artifact hash.

Shortcuts created: Start Menu (`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Solith.lnk`) and Desktop (`%USERPROFILE%\Desktop\Solith.lnk`). No unexpected files found alongside (pre-existing unrelated user files on Desktop — `SOLITH LAUNCH.txt`, `SOLITH.MD` — were not created by this installer).

## First launch

Real launch (no env overrides), `SOLITH_STARTUP_TRACE=1` only. Result: app launched, database initialized at `%APPDATA%\Solith\solith.db`, main window shown (`ready-to-show` at 447.0ms), no fatal exception, no unhandled rejection in captured output. See `packaged-startup-results.md` for the full mark sequence and the disclosed GameBar-transport/`whoami` PATH-shadowing test-environment note (non-blocking, environment-specific, not a candidate defect).

Process exited cleanly on `taskkill /T /F /PID <spawned-pid>` (scoped to the exact spawned process tree only); no stale process remained afterward.

## Uninstall

```
Start-Process "Uninstall Solith.exe" -ArgumentList "/S" -Wait
```
Exit code: `0`. Verified removed: install directory (`%LOCALAPPDATA%\Programs\solith`), Start Menu shortcut, Desktop shortcut, and `%APPDATA%\Solith` (consistent with `deleteAppDataOnUninstall: true` in the NSIS config). No `Solith.exe` process remained. No unrelated file was removed (Desktop's pre-existing unrelated files remained untouched).

## Reinstall

Same installer run again (`/S`), exit code `0`. `Solith.exe` reinstalled with identical SHA-256 (`3B7A6CD1894444FE81909D5B165B0442894EE7D34BECD9BCD3A1500635CEB4C6`), Start Menu shortcut recreated. No stale binary, no duplicate shortcuts observed. Uninstalled again afterward (`/S`, exit `0`) to leave the test machine clean — final state re-verified: no install directory, no `%APPDATA%\Solith`, no leftover process.

## Limitations

Only per-user (`perMachine=false`) install path was exercised — this build has no per-machine/admin-elevated install variant configured. Not tested: interactive (non-`/S`) installer UI/unsigned-warning dialog appearance, since this session ran headlessly. Signature absence was independently confirmed via `Get-AuthenticodeSignature`, which is a stronger check than observing the dialog.

This is local-machine installation verification only. It does not substitute for clean-machine acceptance (separate external-environment requirement, unperformed).
