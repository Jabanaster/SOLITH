# Solith V1.5 Release Checklist

## Source Gates

- `git status --short`
- `npx tsc --noEmit`
- `npm run test:game-profile`
- `npm run test:trainer-schema`
- `npm run test:trainer-host`
- `npm run test:milestone-e`
- `npm run test:milestone-j`
- `npm test`

## Build Gates

- `npm run build:electron`
- `npm run build`
- `node scripts/verify-electron-output.mjs`
- `node scripts/validate-packaged-host.mjs`
- `node scripts/orphan-check.mjs`

## Artifact Gates

- `node scripts/verify-release-artifacts.mjs`
- `node scripts/generate-release-checksums.mjs`

Record:

- Installer path
- Unpacked executable path
- Packaged host path
- SHA-256 checksums
- Any generated artifact warnings

## Fresh Clone Gates

- Local fresh clone from `G:\GAME TRAINER`
- Remote fresh clone from origin URL after push
- Same source, build, artifact, checksum, packaged host, and orphan gates in each clone

## Tag Audit

- Working tree clean
- `v1.5.0` absent before tagging
- `v1.4.0^{}` remains `e5696f77aa067ea22d222dca5f1c5555ce3be159`
- `v1.3.1^{}` remains `6adc3dd7655a1289d33bd6040bd9b9f70fbc4f1f`
- `v1.2.0` and `v1.3.0` absent locally and remotely
- Origin is safe to fast-forward

## Release

- Create annotated tag: `git tag -a v1.5.0 -m "Solith v1.5.0"`
- Push `master`
- Push `v1.5.0`
- Verify remote `master`
- Verify remote `v1.5.0^{}`
- Run remote fresh-clone verification

## Safety Lock

Solith V1.5 remains local-only, offline-first, single-player only, save/data-file focused, backup/rollback protected, and blocked from unsupported write execution. No telemetry, updater, cloud dependency, online cheating, multiplayer manipulation, anti-cheat bypass, process injection, debugger attachment, memory scanning, or live memory writing is part of V1.5.

