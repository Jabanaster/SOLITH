# Solith Release Checklist

Solith is not release-ready unless every item below is verified on a clean Windows environment.

## Clean environment gate

Run from a fresh clone:

```powershell
npm ci
npm run build
npm test
npm run test:electron-smoke
```

Exit criteria:

- no hidden dependency on old `dist/` or `dist-electron/`
- no dependency on local `data/ct-library/` artifacts
- no dependency on user-specific paths, attached games, or private CT archives
- no known failing tests on main/release branches
- `npm audit --audit-level=low` is clean, or every accepted exception is
  documented in `Docs/SECURITY_AUDIT_EXCEPTIONS.md` with a removal condition

## Pull request gate

Every PR must run:

- TypeScript compile check
- schema boundary verification
- orphan/boundary check
- full build/package command
- full `npm test`
- Electron smoke test
- key E2E smoke flows

## Live-memory safety gate

No write-capable live-memory behavior may activate unless all conditions are true:

- game process is explicitly selected
- offline guard passes
- user approval is captured
- feature is certified or explicitly gated
- original value / bytes are captured where applicable
- restore path is available where applicable
- executable hash/version matches
- AOB result is unambiguous
- audit log entry is written
- feature is not enabled by default
- no background auto-activation occurs

## CT Library gate

CT files are metadata-only inputs:

- Auto Assembler and Lua scripts are never executed
- imported entries are L0 / metadata-only by default
- imports are bounded
- long imports are cancellable before UI release
- rejection reports are visible to the user
- large libraries load by shard, not monolithic JSON

## Packaged release gate

Before release:

- install the generated installer on a clean Windows VM
- launch the installed app
- run packaged smoke coverage
- verify userData initialization
- verify uninstall
- document signed vs unsigned installer status
- publish known limitations
