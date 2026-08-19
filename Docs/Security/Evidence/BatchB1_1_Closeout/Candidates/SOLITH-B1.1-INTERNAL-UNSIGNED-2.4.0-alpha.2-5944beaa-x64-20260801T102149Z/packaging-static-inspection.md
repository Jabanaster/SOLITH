# Packaging and Packaged-Output Static Inspection

## Preflight (before build)

- No `CSC_*`/`WIN_CSC_*`/certificate env vars set.
- No `"publish"` key in `package.json` build config — no upload/publish destination configured.
- `SOLITH_TEST_BUILD` gated `=== '1'` at every use site in `electron/live-memory-ipc.ts` — fail-closed by default, unset during packaging.
- `isDev` gate (`process.argv.includes('--dev') || process.env.SOLITH_DEV === '1'`) confirmed present and controlling all dev-origin/localhost trust in both `electron/main.ts` and `electron/wisp-overlay.ts` before packaging.
- Explicit `CSC_IDENTITY_AUTO_DISCOVERY=false` set for the build to force no accidental local-cert auto-discovery.

## Post-build verification

`npx electron-builder --win nsis` log shows `signing with signtool.exe` attempts for `Solith.exe`, `solith-readonly-scanner.exe`, `elevate.exe`, and the uninstaller — these are electron-builder's default signtool invocation attempts. Verified empirically, not assumed: `Get-AuthenticodeSignature` on `dist\win-unpacked\Solith.exe` and `dist\Solith Setup 2.4.0-alpha.2.exe` both returned `Status: NotSigned`. No certificate was available/configured, so the signtool calls were no-ops. Confirmed unsigned.

## Extracted `app.asar` scan

Extracted via `asar extract` and grepped for secrets/dev-origin markers:

- `localhost:3000` — present in `dist-electron/main.js`, every occurrence gated behind the same `isDev` check confirmed in source review (main window load, Wisp overlay, trainer overlay). Packaged launch (no `--dev`, no `SOLITH_DEV=1`) never satisfies `isDev` — unreachable in production.
- `SOLITH_TEST_BUILD` — present, every occurrence gated `=== "1"` / `!== "1"` throw guards. Confirmed absent/unset in packaged environment (verified in Phase 6 negative-control test, below).
- `127.0.0.1` — present in local-network loopback-port scanning code (`connection-observer`), unrelated to Electron origin trust; not a dev-server trust bypass.
- No `BEGIN PRIVATE KEY`, `BEGIN CERTIFICATE`, `sk-`, `Bearer `, or `Authorization:` matches anywhere in the extracted bundle.
- No `.env` files, no `userData` test artifacts, no source maps (`files` excludes `*.map` in `package.json`) present in packaged output.
- Native-module build residue: `memoryjs` build directory contains Visual Studio compiler-generated files (`.vcxproj`, `.tlog`, `.iobj`) with embedded build-machine absolute paths (`G:\ACTIVE_PROJECTS\...`). This is standard native-addon build tooling residue, not an application secret or reachable vulnerability — noted, not treated as a defect.

## Result

```
PACKAGING PREFLIGHT: PASS
```

No production bypass, no secret, no reachable dev-origin trust, no signing material found.
