# Known Issues

This document records the current known bugs, design limitations, and trade-offs.

## Open Issues

### KI-001: Playwright not installed — smoke tests require manual install step
`@playwright/test` is in `devDependencies` but browsers must be downloaded before tests run:
```powershell
npm install && npx playwright install && npm run test:electron-smoke
```

### KI-002: Installer not verified end-to-end in a clean environment
The `npm run build` pipeline runs electron-builder, but the generated installer has not been launched from a clean machine to confirm renderer assets, demo-game fixture, and userData path all resolve correctly.

### KI-003: fix-esm-imports.mjs / .ps1 in repo root (dead code)
These files are no longer referenced by any build script. They can be deleted:
```powershell
Remove-Item "fix-esm-imports.mjs", "fix-esm-imports.ps1"
```

### KI-004: Page UIs are scaffold-level
TrainerPage, SaveEditor, DiscoveryLab, Recipes, Backups, and Journal need full UI implementation.

### KI-005: No first-run experience or onboarding wizard

## Resolved

| Issue | Resolution |
|-------|-----------|
| Node ESM bare imports crashing at runtime | Replaced tsc + fix-esm-imports with tsup bundling |
| Shared database singleton causing test failures across runs | Added `resetForTesting()` with unique temp DB per suite |
| Remote Google Fonts CDN reference in index.html | Removed; local system font stacks only |
| Missing `prefers-reduced-motion` support | Added at end of index.css |
| No single-instance lock | Implemented in electron/main.ts |
| No unified dev command | `npm run dev` via scripts/dev.mjs |

## Architectural Limitations
1. **Binary Files**: Safe structures are verified but bitwise parsing and validations for unknown binary file types are not supported in V1.
2. **Offline AI Connection**: If local AI services (Ollama/LM Studio) are not running, rule-based fallback explanations are used.
3. **Reparse Points/Junction Escapes**: Symbolic links and junctions at the target path are actively detected and rejected, but testing of complex Windows volume mount points depends on native OS permissions.
