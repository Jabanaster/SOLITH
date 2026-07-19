# Solith v1.0.0 Release Smoke Report

## Audit Scope

- Tag tested: `v1.0.0`
- Branch: `master`
- Commit tested: `2c5c2d67a3172d7bcb9b376be44ed6dd43c0a52f`
- Release-smoke goal: verify local release artifacts and packaged runtime without pushing or publishing

## Commands Run

- `npm run test:milestone-e`
- `npm run test:milestone-j`
- `npm run test:electron-smoke`
- `npm run test:electron-e2e`
- `npm run test:packaged-smoke`
- `npm test`
- `npm run build:electron`
- `npm run build`
- `node scripts/validate-packaged-host.mjs`
- `node scripts/orphan-check.mjs`

## Release Artifacts

- `dist\ResourceForge Setup 1.0.0.exe` | 112,606,835 bytes | SHA-256 `222420A61686EE7F325FB1A03D887067C100F9803EC4DAFCAA5FC715A22ECAB6`
- `dist\win-unpacked\ResourceForge.exe` | 232,313,344 bytes | SHA-256 `E8C2B8DB7111655B44C23D0F61B0AF3977416B991691D22DB78596624AF11FED`

## Release Smoke Result

- Packaged exe launches successfully.
- Process stays alive past 2 seconds and 10 seconds.
- Packaged smoke passes.
- Demo workflow SHA-256 proof remains valid.
- TrainerHost packaged validation passes.
- Orphan check passes.
- Generated outputs remain ignored as expected (`dist/` and `dist-electron/` are ignored by `.gitignore`).

## Known Limitations

- Local/offline single-player use only.
- No online-game support.
- No multiplayer cheating support.
- No unsafe live-process modification requirement for V1.
- No push performed.
- No release published.

## State

- `PUSHED=NO`
- `RELEASED=NO`
- `TAG_STILL_ON_HEAD=NO`

## Recommendation

The local `v1.0.0` tag is release-smoke verified, but it still points at the readiness commit rather than this report commit. Retag locally only if you want the tag to include this evidence commit.

