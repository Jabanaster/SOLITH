# Process, Helper, and Cleanup Review

Process-identification criteria used throughout: `Get-CimInstance Win32_Process -Filter "Name='<exact-name>'"`, checked for `Solith.exe`, `electron.exe`, and `Gate2_2Fixture.exe`.

Checkpoints where orphan-process absence was explicitly verified (all returned empty):

1. After the 6 packaged-startup measurement launches (3 cold + 3 warm) — `Solith.exe` empty.
2. After the real first-launch test (default userData) — `Solith.exe` empty.
3. After install → first-launch → uninstall cycle — `Solith.exe` empty, install dir removed.
4. After reinstall → uninstall cycle — `Solith.exe` empty, install dir removed.
5. Final sweep — `Solith.exe`, `electron.exe`, `Gate2_2Fixture.exe` all empty.

Cleanup method: every spawned launch in the measurement/first-launch scripts used `taskkill /T /F /PID <exact-spawned-pid>`, scoped only to the process tree this session spawned — no enumeration or termination of unrelated processes at any point. Installer/uninstaller runs used `Start-Process -Wait`, which blocks until the NSIS process tree itself exits; no manual kill was needed for those.

No intentionally persistent helper component was identified for this candidate profile (no background service, no elevated helper installed by default install/uninstall path tested).
