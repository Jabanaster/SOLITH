# Candidate Manifest

Candidate ID: `SOLITH-B1.1-INTERNAL-UNSIGNED-2.4.0-alpha.2-5944beaa-x64-20260801T102149Z`

## Identity

- Application version: `2.4.0-alpha.2`
- Source branch: `master` (dedicated worktree `G:\ACTIVE_PROJECTS\solith-master-integration`)
- Full source SHA: `5944beaa16607a4a96359676d05436bbf3568d19`
- Architecture: `x64`
- Node: `v22.23.1` (pinned toolchain, `G:\ACTIVE_PROJECTS\_tooling\node-v22.23.1-win-x64`)
- npm: `10.9.8`
- Signing status: **unsigned** (`CSC_IDENTITY_AUTO_DISCOVERY=false`; `Get-AuthenticodeSignature` confirms `NotSigned` on both `dist\win-unpacked\Solith.exe` and `dist\Solith Setup 2.4.0-alpha.2.exe`, and on the installed copy after installation)

## Build command

```
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --win nsis
```

Preceded immediately by a clean pre-packaging verification pass on the same HEAD (see below).

## Artifacts

| File | SHA-256 | Size (bytes) |
|---|---|---|
| `dist\Solith Setup 2.4.0-alpha.2.exe` (installer) | `BB880D6F4A0D375FB294626B4FADD2B2AA687BD18A81A54D8A66EDA335A72B58` | 167,639,765 |
| `dist\Solith Setup 2.4.0-alpha.2.exe.blockmap` | `B60C36DCE2F9AD757792B9B7A0B838F06BDC1BF83F5DAB106B2430281AB1978C` | (blockmap, generated) |
| `dist\win-unpacked\Solith.exe` (unpacked main executable) | `3B7A6CD1894444FE81909D5B165B0442894EE7D34BECD9BCD3A1500635CEB4C6` | 232,375,296 |

Installed-copy identity re-verified post-install: `Solith.exe` SHA-256 at `%LOCALAPPDATA%\Programs\solith\Solith.exe` = `3B7A6CD1894444FE81909D5B165B0442894EE7D34BECD9BCD3A1500635CEB4C6` (matches unpacked build exactly, both install and reinstall).

`dist\latest.yml` and `dist\builder-debug.yml` were generated locally by electron-builder (default behavior). No `publish` key exists in `package.json`, so nothing was uploaded — these are local-only artifacts and were not distributed anywhere.

## Verification summary

- Source verification (immediately pre-package, same HEAD): TypeScript (Electron + main) 0/0 diagnostics, `npm test` 1055/1055 + 10/10, `test:startup-visibility` 10/10, `test:live-memory` 257/257, `build:vite` pass, `build:electron` pass, `verify:electron-output` 29/29, `git diff --check` clean, `git status --short` clean.
- Packaging: unsigned, no publish, no signing material, exit 0.
- Packaged static inspection: no reachable dev-origin trust, no active `SOLITH_TEST_BUILD` bypass (all occurrences gated `=== "1"`, unset in packaging), no embedded secrets/keys/certificates. Native-module build residue (embedded compiler paths in `memoryjs` build artifacts) present and documented as harmless.
- Packaged candidate-specific Gate 2.5 result: **44/44 pass, 0 fail** (`test:packaged-smoke` 23/23 + `gate2-5-frame-devtools-overlay-lifecycle` / `gate2-5-frame-overlay-closeout` / `gate2-3-freeze-authorization-security` / `gate2-4-final-certification` combined 21/21), run against the real built `Solith.exe`, not source-mode Electron.
- Packaged startup: 3 cold + 3 warm real launches, `ready-to-show` range 354.8-408.5ms across all 6 runs. See `packaged-startup-results.md`.
- Installation: install (`/S`), first launch (real, default userData, DB initialized), uninstall (`/S`), reinstall (`/S`), all exit 0, all verified. See `installation-verification.md`.
- Upgrade: `NOT PERFORMED — NO VERIFIED PRIOR CANDIDATE AVAILABLE`.
- Clean-machine acceptance: `NOT PERFORMED — EXTERNAL ENVIRONMENT REQUIRED`.
- B1.1 status: see `Docs/Security/Evidence/BatchB1_1_Closeout/B1_1_PROMOTION_DECISION.md` (updated).
- Release status: see `Docs/Release/RELEASE_READINESS_DECISION.md` (updated) — unchanged, `NOT RELEASE READY`.
