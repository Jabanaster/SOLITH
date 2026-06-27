# AgentBridge V1.3 — Remote Branch Lock Report

**Date:** 2026-06-27  
**Final decision:** ACCEPTED

## Summary

AgentBridge V1.0–V1.3 was pushed to a dedicated remote branch without overwriting
ResourceForge pilot work on `origin/master`. Post-push validation gates all passed.

## Remote configuration

| Item | Value |
| --- | --- |
| Remote URL | `https://github.com/Jabanaster/ResourceForge.git` |
| Pushed branch | `agentbridge-v1.3` |
| Local HEAD | `f414074` (`remove obsolete AgentBridge V1.2 validation draft`) |
| Local tag `v1.3.0` | `f414074` (unchanged) |
| Local tag `v1.2.0` | `4caaddb` (unchanged) |

## Remote lock targets (verified)

| Ref | Commit | Subject / note |
| --- | --- | --- |
| `origin/master` | `2642a23` | ResourceForge pilot line — **not overwritten** |
| `origin/agentbridge-v1.3` | `f414074` | AgentBridge V1.3 line |
| `origin/v1.2.0` | `4caaddb` | V1.2 registry-first router |
| `origin/v1.3.0` | `f414074` | V1.3 evidence pack + runbook |

Verified with:

```bash
git ls-remote --heads origin master
git ls-remote --heads origin agentbridge-v1.3
git ls-remote --tags origin v1.2.0
git ls-remote --tags origin v1.3.0
```

## Push strategy

Option 2 was used: push AgentBridge to a new branch. `master` was **not** force-pushed.

```bash
git push -u origin HEAD:agentbridge-v1.3
```

Remote `master` remains at `2642a23` (ResourceForge pilot / PR #1 merge). Local
`master` (AgentBridge line at `f414074`) is preserved on `origin/agentbridge-v1.3`.

## Post-push validation gates

All run against local AgentBridge branch after remote branch push.

| Gate | Result |
| --- | --- |
| `npm run evidence:agentbridge` | PASS (6/6 internal gates, relay store restored) |
| `npm run test:router` | PASS |
| `npm run test:codex-relay` | PASS |
| `npm run test:agentbridge-v11` | PASS |
| `npm run smoke:agentbridge` | PASS |
| `npm run verify:agentbridge` | PASS |
| `npm run build` | PASS (Electron NSIS installer) |

## Evidence pack

Latest post-push evidence (gitignored runtime artifact):

- `workflow/agentbridge/evidence/EVIDENCE_2026-06-27T08-20-22-385Z.md`
- `workflow/agentbridge/evidence/EVIDENCE_2026-06-27T08-20-22-385Z.json`

Regenerate anytime:

```bash
npm run evidence:agentbridge
```

## Confirmations

- **`origin/master` was not overwritten** — still `2642a23`.
- **Relay remains Claude → ChatGPT → Codex** — `test:codex-relay` and `smoke:agentbridge` passed.
- **Workshop remains removed/rejected** — verify smoke and router tests confirm rejection.
- **Codex remains locked verifier** — registry validation and router tests passed.
- **Router remains advisory only** — `execution_allowed: false` in route plans.
- **Tags `v1.2.0` and `v1.3.0` were not moved** during this lock pass.

## Related documentation

- `Docs/AGENTBRIDGE_OPERATOR_RUNBOOK.md`
- `Docs/AGENTBRIDGE_V1.2_VALIDATION.md`
- `Docs/AGENTBRIDGE_V1_REAL_E2E.md`
- `Docs/AGENTBRIDGE_V1_BASELINE.md`
