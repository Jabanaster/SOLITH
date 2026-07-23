# Solith V1.5 Distribution Guide

## Scope

Solith V1.5 is a local-only, offline-first, single-player save/data-file tool. It does not provide online cheating, multiplayer manipulation, anti-cheat bypass, telemetry, cloud sync, process injection, debugger attachment, memory scanning, or live memory writing.

## Build Artifacts

Run the release build from the repository root:

```powershell
cd "G:\ACTIVE_PROJECTS\SOLITH"
npm run build
```

Expected Windows artifacts:

- Installer: `dist\Solith Setup 1.5.0.exe`
- Installer blockmap: `dist\Solith Setup 1.5.0.exe.blockmap`
- Unpacked app: `dist\win-unpacked\Solith.exe`
- Packaged TrainerHost entry: `dist\win-unpacked\resources\app.asar.unpacked\dist-electron\host-entry.js`

## Artifact Verification

After building, run:

```powershell
node scripts/verify-release-artifacts.mjs
node scripts/validate-packaged-host.mjs
node scripts/orphan-check.mjs
node scripts/generate-release-checksums.mjs
```

`verify-release-artifacts.mjs` checks Solith package metadata, installer naming, unpacked executable layout, packaged host files, renderer asset presence, and absence of stale Solith installer names for other versions.

`generate-release-checksums.mjs` prints SHA-256 checksums for release artifacts. Keep checksum output in release notes or the release report; generated checksum files are not tracked by default.

## Installation

1. Run `dist\Solith Setup 1.5.0.exe`.
2. Launch Solith from the Start Menu shortcut or installed executable.
3. Use Solith only with local single-player games or local data files you own or have permission to modify.

Solith stores local app data in the normal Electron user-data location for the current Windows user. The packaged smoke tests use isolated temporary user-data paths and do not touch production app data.

## Safe Use

- XML save-field writes are limited to accepted supported controls and require approval.
- Backups and rollback status should be checked before retrying failed supported writes.
- JSON and INI remain preview/read-only for write execution.
- Unsupported formats remain blocked from write execution.
- Discovery results remain advisory unless they map to an existing supported write path.

## Uninstall

Use Windows Apps & Features or the Solith uninstaller created by the installer. Uninstalling the app does not imply game save cleanup; review any local app-data or backup folders intentionally before removing them.

