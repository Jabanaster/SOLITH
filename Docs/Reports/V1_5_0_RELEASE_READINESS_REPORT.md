# ResourceForge V1.5.0 Release Readiness Report

## Release Identity

- Release: ResourceForge V1.5.0
- Starting locked release: v1.4.0
- Starting locked commit: e5696f77aa067ea22d222dca5f1c5555ce3be159
- V1.5 packaging hardening commit: b21df9fdec1bd8383677fe51a5199c8cce452840
- Branch: master
- Tag plan: create annotated `v1.5.0` only after final source and fresh-clone gates pass.

## Implementation Summary

V1.5 is a packaging and distribution readiness release. It does not expand trainer behavior, save write support, game support, or runtime control scope.

Changes made:

- Updated package metadata from `1.0.0` to `1.5.0`.
- Hardened Windows installer metadata for ResourceForge naming.
- Added deterministic release artifact path helpers.
- Added release artifact verification for installer, unpacked executable, packaged app assets, packaged TrainerHost, metadata, and stale release naming.
- Added SHA-256 checksum generation for built release artifacts.
- Added tests for release metadata, artifact path expectations, and checksum helper behavior.
- Added V1.5 distribution guide.
- Added V1.5 release checklist.

Files changed before this report:

- `package.json`
- `package-lock.json`
- `scripts/release-artifact-utils.mjs`
- `scripts/verify-release-artifacts.mjs`
- `scripts/generate-release-checksums.mjs`
- `tests/release-artifacts.test.ts`
- `Docs/Guides/V1_5_DISTRIBUTION_GUIDE.md`
- `Docs/Reports/V1_5_RELEASE_CHECKLIST.md`

## Version And Package Metadata

- `package.json` version: `1.5.0`
- `package-lock.json` version: `1.5.0`
- Product name: `ResourceForge`
- App ID: `com.resourceforge.app`
- Windows executable name: `ResourceForge`
- NSIS installer artifact name: `ResourceForge Setup ${version}.${ext}`
- Publish/updater configuration: absent

## Installer And Artifact Paths

Source artifact verification used:

- Installer: `G:\GAME TRAINER\dist\ResourceForge Setup 1.5.0.exe`
- Installer blockmap: `G:\GAME TRAINER\dist\ResourceForge Setup 1.5.0.exe.blockmap`
- Unpacked executable: `G:\GAME TRAINER\dist\win-unpacked\ResourceForge.exe`
- App archive: `G:\GAME TRAINER\dist\win-unpacked\resources\app.asar`
- Packaged TrainerHost: `G:\GAME TRAINER\dist\win-unpacked\resources\app.asar.unpacked\dist-electron\host-entry.js`

Checksum output from source artifact verification:

```text
df1ad4a2e47c7241461cec99fe2c29ee63ca6068d940713c9036c7414c3a8b60  dist/ResourceForge Setup 1.5.0.exe
a58f96b726e6a4782e9d455ade9fb806146cfd5c40c602d6b4d39de911aee73e  dist/ResourceForge Setup 1.5.0.exe.blockmap
```

Checksum output from local fresh-clone verification at `G:\RESOURCEFORGE_V15_LOCAL_VERIFY`:

```text
97eae807a9c272afe4a8cc8740602f693bdfb0a621aae2712a438b6bfa7d52dd  dist/ResourceForge Setup 1.5.0.exe
f692ff83eb56946afe5cf9d7ea2980ba875105c53616c2a34e4df2535ca069de  dist/ResourceForge Setup 1.5.0.exe.blockmap
```

Installer checksums are recorded per built artifact. The installer build process signs and packages the artifact during each build, so checksum values are expected to describe the specific artifact produced in that verification workspace.

## Verification Results

Pre-change source verification from v1.4.0 passed:

- `npx tsc --noEmit`
- `npm run test:game-profile`
- `npm run test:trainer-schema`
- `npm run test:trainer-host`
- `npm run test:milestone-e`
- `npm run test:milestone-j`
- `npm test`
- `npm run build:electron`
- `npm run build`
- `node scripts/verify-electron-output.mjs`
- `node scripts/validate-packaged-host.mjs`
- `node scripts/orphan-check.mjs`

Post-implementation source verification passed:

- TypeScript compile passed.
- Game profile tests passed.
- Trainer schema tests passed.
- TrainerHost tests passed.
- Milestone E tests passed.
- Milestone J tests passed.
- Full test suite passed with 422 passing tests.
- Electron output verification passed with 19/19 checks.
- Packaged TrainerHost validation passed with 23/23 checks.
- Orphan process check passed.
- Release artifact verification passed with 19/19 checks.
- Checksum generation passed.
- Source working tree remained clean after committed implementation gates.

Local fresh-clone verification passed:

- Path: `G:\RESOURCEFORGE_V15_LOCAL_VERIFY`
- HEAD: b21df9fdec1bd8383677fe51a5199c8cce452840
- `npm ci` passed.
- TypeScript compile passed.
- Game profile tests passed.
- Trainer schema tests passed.
- TrainerHost tests passed.
- Milestone E tests passed.
- Milestone J tests passed.
- Full test suite passed with 422 passing tests.
- Electron output verification passed with 19/19 checks.
- Packaged TrainerHost validation passed with 23/23 checks.
- Orphan process check passed.
- Release artifact verification passed with 19/19 checks.
- Checksum generation passed.
- Fresh clone working tree remained clean.

Artifact verification passed:

- ResourceForge installer exists.
- ResourceForge installer blockmap exists.
- ResourceForge unpacked executable exists.
- Packaged app archive exists.
- Packaged TrainerHost exists in the unpacked ASAR area.
- Built renderer asset directory exists before packaging.
- Compiled Electron main, preload, and host bundles exist.
- Installer name includes `1.5.0`.
- Installer name does not include `1.4.0`.
- ResourceForge installer artifact names do not include old internal project names.
- No publish/updater configuration is present.

## Safety Guarantees Preserved

ResourceForge remains:

- Local-only.
- Offline-first.
- Single-player only.
- Save/data-file focused.
- Backup/rollback protected for supported writes.
- Explicit about risk states.
- Clear that unsupported formats are blocked.
- Clear that JSON/INI remain preview/read-only for unsupported write execution.

V1.5 preserved these explicit non-goals:

- No online cheating.
- No multiplayer manipulation.
- No anti-cheat bypass.
- No memory scanning or writing.
- No process injection.
- No debugger attachment.
- No cloud dependency.
- No telemetry.
- No new unsupported writes.

## Known Limitations

- JSON/INI remain preview/read-only for unsupported write execution.
- Unsupported formats remain blocked from write execution.
- Executable writes remain limited to accepted supported XML controls.
- Discovery remains advisory unless mapped to existing supported write paths.
- The Windows installer uses the default Electron icon in the current packaging configuration.

## Remote Verification Plan

After final gates pass:

1. Audit tags and remotes.
2. Create annotated `v1.5.0`.
3. Push `master`.
4. Push `v1.5.0`.
5. Clone from the configured remote into a new `G:\RESOURCEFORGE_V15_REMOTE_VERIFY` path.
6. Run the full source, build, artifact, packaged host, orphan, and checksum gates from that remote clone.
