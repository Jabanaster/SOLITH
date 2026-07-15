# Fresh-clone verification — 2026-07-15

**Status:** PASS on `master` @ `620e76d` · **Not release-tagged** (await explicit **TAG IT** for `v2.1-shell-polish`)

## Context

Re-gate after Milestones **L** / **M**, shell polish / save UX (`a9483f6`), and evidence-branch docs merge (roadmap + adoption plan + Terraria stub + shell-polish summary).

`git clone --local` on Windows remains unreliable (commit-graph / improper link). Reproducibility gate: clean-tree commands on repo root at the verified commit.

## Environment

| Item | Value |
|------|--------|
| OS | Windows 10.0.26200 |
| Repo | `G:\ACTIVE_PROJECTS\ResourceForge` |
| HEAD | `620e76de427aa01f46bb143d09cca4b901602068` |
| Working tree at gate | Clean of source changes; gate stdout file then committed |

## Gate results

| Gate | Result | Notes |
|------|--------|-------|
| `npx tsc --noEmit` | **PASS** | exit 0 |
| `npm test` | **PASS** | exit 0 |
| `npm run build:electron` | **PASS** | 19/19 verify-electron-output |
| `npm run build` | **PASS** | `Solith Setup 2.0.0.exe` |
| `npm run test:accessibility` | **PASS** | exit 0 |
| `node scripts/validate-packaged-host.mjs` | **PASS** | exit 0 |
| `node scripts/orphan-check.mjs` | **PASS** | exit 0 |

Bound stdout: `Docs/Reports/GATE_OUTPUT_2026-07-15.txt`

## Also locked (already tagged)

| Tag | Commit |
|-----|--------|
| `v1-milestone-l-research-lab-accepted` | `cdd8c51` |
| `v1-milestone-m-in-process-pilot-accepted` | `97326d7` |

## Before `v2.1-shell-polish`

1. **PUSH IT** — publish `master` (`a9483f6..620e76d`)
2. Confirm remote clean
3. User says **TAG IT** `v2.1-shell-polish` (optional annotated message)
4. Adoption **AG** can proceed separately (packaged-smoke title/`parseSave` alignment)

See `Docs/Reports/SHELL_POLISH_ACCEPTANCE_SUMMARY.md` and `RELEASE_EVIDENCE_PACK_PROPOSAL.md`.
