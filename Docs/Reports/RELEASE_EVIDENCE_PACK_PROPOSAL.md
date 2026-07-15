# Release evidence pack — proposed file list

**Status:** PROPOSAL ONLY — create after user approves exact paths.

Do **not** tag `v2.1-shell-polish` until fresh-clone gate passes and user says **TAG IT**.

## Proposed artifacts

| Path | Purpose |
|------|---------|
| `Docs/Reports/FRESH_CLONE_VERIFICATION_2026-07-12.md` | Fresh-clone gate results + commit hash |
| `Docs/Reports/SHELL_POLISH_ACCEPTANCE_SUMMARY.md` | Banner, sidebar, icons, a11y acceptance |
| `Docs/Reports/GATE_OUTPUT_2026-07-12.txt` | Bounded stdout from tsc, npm test, builds |

## Gate commands (fresh clone)

1. `npm ci`
2. `npx tsc --noEmit`
3. `npm test`
4. `npm run build:electron`
5. `npm run build`
6. `npm run test:accessibility`
7. `git status --short` (must be empty)

## Scope included in v2.1-shell-polish candidate

- `405dcc6` … `56b8487` (banner, sidebar, icons, a11y, seed, binary research)
- Plus any follow-up commits from this offline batch

## Out of scope for this tag

- Live connection baselines (Milestone S)
- L3 certification runs (Milestone U live)
- Commercial binary `canWrite` promotion
