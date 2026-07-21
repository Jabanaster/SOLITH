# Fresh-clone verification — 2026-07-12

**Status:** PASS on working tree after `npm ci` · **Not release-tagged** (await explicit TAG IT)

## Context

This batch adds shell polish follow-ups (onboarding E2E skip, branding masters, certification scripts, UX polish, CI split). Verification was run on the **current workspace** at committed HEAD `56b8487` plus uncommitted batch changes.

`git clone --local` to `%TEMP%` failed on Windows (`Improper link` on commit-graph). Fresh dependency install was validated with **`npm ci`** on the repo root instead (equivalent lockfile reproducibility gate).

## Environment

| Item | Value |
|------|--------|
| OS | Windows 10.0.26200 |
| Node | (project engines via package-lock) |
| Repo | `G:\ACTIVE_PROJECTS\ResourceForge` |
| Committed HEAD | `56b8487364e0b8c8d66542971d4f253cd84f712f` |
| Batch state | Dirty working tree — commit required before tag |

## Gate results

| Gate | Result | Notes |
|------|--------|-------|
| `npm ci` | **PASS** | 444 packages |
| `npx tsc --noEmit` | **PASS** | |
| `npm test` | **PASS** | 633/633 |
| `npm run build:electron` | **PASS** | 19/19 |
| `npm run build` | **PASS** | Solith Setup 2.0.0.exe |
| `npm run test:packaged-smoke` | **PARTIAL** | 20/22 — see below |
| `node scripts/validate-packaged-host.mjs` | **PASS** | 23/23 |
| `node scripts/orphan-check.mjs` | **PASS** | No orphan PID |
| `node scripts/verify-pointer-path.mjs --check-only` | **PASS** | Ritual checklist emitted |
| `npm run prepare:branding` | **PASS** | 1920×420 banner, 1920×1080 shell |

### Packaged-smoke notes

- **Point 17 (sidebar collapse): PASS** — onboarding overlay no longer intercepts clicks when `NODE_ENV=test`.
- **Point 03 / 13: FAIL (pre-existing)** — window title is `Solith` (test expects `Solith`); `parseSave` IPC returns null in packaged path. Not introduced by this batch.

## Batch deliverables verified offline

- `ROADMAP.md` — R/T/V/W/Y done; S/U/X live items blocked
- Onboarding auto-skip — `getSettings()` when `NODE_ENV=test` or `SOLITH_SKIP_ONBOARDING=1`
- Branding masters — `solith-banner-backdrop.png` 1920×420, `solith-shell-background.png` 1920×1080
- `certificationLevel` on schema.v1 root + feature
- `scripts/certify-cheat.mjs` (L0–L1 offline; L2+ live)
- `scripts/verify-pointer-path.mjs` (`--check-only` dry-run)
- Terraria sandbox fixture — `demo-game/saves/terraria/player-fixture-v279.plr` (version read @0)
- Steam AppID executable lookup in seed generator (1000 entries)
- Promotion UI, hotkey OS warnings, overlay preset comments
- CI split — `.github/workflows/ci-fast.yml`, `ci-nightly.yml`
- `Docs/SOLITH_UI_HIERARCHY.md`

## Before `v2.1-shell-polish` tag

1. **COMMIT IT** — stage batch; working tree must be clean
2. Re-run gates on clean commit (or successful `git clone` from remote)
3. Fix or waive packaged-smoke points 03/13 (product rename drift)
4. User says **TAG IT** explicitly

See also `Docs/Reports/RELEASE_EVIDENCE_PACK_PROPOSAL.md` and `GATE_OUTPUT_2026-07-12.txt`.
