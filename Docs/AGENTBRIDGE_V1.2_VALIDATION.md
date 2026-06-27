# AgentBridge V1.2 — Registry-first Intelligent Router — Validation Report

## Summary

V1.2 adds a **registry-first, advisory-only** intelligent router on top of the locked
V1.1 relay. The router answers `route(task) -> plan` deterministically using **registry
data only** — it never executes agents, never mutates relay state, and never changes the
Claude → ChatGPT → Codex flow.

- Relay flow is unchanged: **Claude → ChatGPT → Codex**.
- **Codex remains the locked verifier.**
- **Workshop remains removed/rejected** and fails registry validation if enabled.
- Local model is a **stub with `ready:false`** and is disabled in config.
- Learning records are **stored only** and do **not** influence routing by default.
- No API, no UI, no multi-project execution added.

## Files changed

New:
- `workflow/agentbridge/registry.js` — agent registry data + `validateRegistry` + router config.
- `workflow/agentbridge/router.js` — deterministic `detectProject`, `classifyTask`, `route`.
- `scripts/test-router.ts` — router test suite (`npm run test:router`).
- `Docs/AGENTBRIDGE_V1.2_VALIDATION.md` — this report.

Modified:
- `workflow/agentbridge/agentbridge.js` — added `router plan` / `registry list` / `registry validate` / `learning list` CLI, `planTask` helper, registry-shaped `recordTaskOutcome`; relay execution untouched.
- `workflow/agentbridge/store.js` — generic `getJson`/`setJson`, `recordOutcome`, `getAgentStats` for registry/config/learning persistence.
- `scripts/build-agentbridge.js` — validates `registry.js`/`router.js` syntax and runs `test:router`.
- `scripts/verify-agentbridge.js` — registry/router advisory smoke checks.
- `package.json` — `test:router` script.
- `.gitignore` — ignore runtime route-plan artifacts.

## Architecture

### 1. Agent Registry (`registry.js`)

Agents are data records (registry-driven, not hardcoded). Each record has:
`id, displayName, role, capabilities[], allowedTaskTypes[], canVerify, canExecute,
enabled, ready, priority`.

Default agents: `claude` (primary), `chatgpt` (reviewer), `codex` (verifier, `canVerify:true`),
`local` (primary stub, `enabled:false`, `ready:false`). Workshop is absent.

`validateRegistry(agents, config)` rejects malformed entries (missing/blank id/role,
non-array capabilities/allowedTaskTypes, non-boolean flags, non-number priority, duplicate
ids), rejects an **enabled** `workshop`, enforces exactly one enabled verifier equal to the
locked verifier (`codex`), and requires at least one enabled primary.

Router config persisted separately:

```json
{
  "manual_default": true,
  "auto_advisory_only": true,
  "locked_verifier": "codex",
  "learning": { "enabled": true, "influence_routing": false },
  "local_model": { "enabled": false, "ready": false }
}
```

### 2. Project Detector (`router.detectProject`)

Deterministic, no external calls. Returns:

```json
{ "project_type": "electron-node", "has_package_json": true, "has_electron": true, "has_tests": true, "has_build_script": true }
```

`project_type` ∈ `electron-node | node | python | unity | generic | unknown`.

### 3. Task Classifier (`router.classifyTask`)

Deterministic keyword rules → `implementation | review | verification | test | packaging |
documentation | unknown`.

### 4. Deterministic Router (`router.route`)

`route(task, { agents, routerConfig, projectProfile?, classification? }) -> plan`. Pure: no
writes, no execution, no relay mutation. Selects `primary`/`reviewer` by role + priority
(ties broken by id) + `allowedTaskTypes`, and `verifier` = locked verifier. Plan shape:

```json
{
  "task_type": "implementation",
  "project": { "project_type": "electron-node", "has_package_json": true, "has_electron": true, "has_tests": true, "has_build_script": true },
  "mode": { "manual_default": true, "auto_advisory_only": true },
  "agents": { "primary": "claude", "reviewer": "chatgpt", "verifier": "codex" },
  "locked_verifier": "codex",
  "reason": "...",
  "steps": ["Claude proposes...", "ChatGPT reviews...", "Codex verifies...", "Human approves..."],
  "execution_allowed": false
}
```

### 5. Persistence

Registry agents, router config, and learning records persist via the V1.1 store
(SQLite + JSON fallback). Learning records store `taskType, route, outcome, loopCount,
buildResult, timestamp`. `influence_routing` is `false` by default — recorded data never
changes `route()` output.

### 6. CLI (read-only / advisory)

```bash
agentbridge router plan "<task>"   # advisory plan JSON (no writes, no execution)
agentbridge registry list          # list registered agents
agentbridge registry validate      # validate registry (exit 1 if invalid)
agentbridge learning list          # list learning records
```

Existing relay commands `create`, `next`, `ingest`, `status`, `report`, `tasks`, `show`,
`run-codex` are unchanged.

## Commands run + results

| Gate | Command | Result |
| --- | --- | --- |
| Router suite | `npm run test:router` | PASS (15 checks) |
| Relay E2E | `npm run test:codex-relay` | PASS |
| V1.1 suite | `npm run test:agentbridge-v11` | PASS |
| Smoke | `npm run smoke:agentbridge` | PASS |
| Verify | `npm run verify:agentbridge` | PASS |
| Build | `npm run build` | PASS (Electron NSIS installer) |

### Router test coverage (`test:router`)

1. registry loads · 2. registry validates required fields · 3. malformed entries fail
validation · 4. Workshop rejected · 5. Codex is verifier · 6. deterministic plans ·
7. manual default · 8. auto advisory only (`execution_allowed:false`) · 9. learning records
do not influence routing by default · 10. local model `ready:false` · 11. new registry agent
routed without router code changes · 12. project detector profile · 13. task classifier
categories · 14. route output shape · 15. router is pure (no file writes).

## Proofs

- **Relay behavior unchanged:** `test:codex-relay` and `test:agentbridge-v11` pass unmodified;
  router code is never invoked by `next`/`ingest`/`run-codex`/`status`/`report`.
- **Router is advisory only:** `route()` returns a plan with `execution_allowed:false`,
  performs no file writes (test 15), and is not called during relay execution.
- **New agents via data only:** test 11 adds a synthetic `qwen` primary purely as registry
  data and it is selected by the router with **no router logic changes**.
- **Workshop rejected:** absent from defaults (test 4) and an enabled `workshop` fails
  `validateRegistry`.
- **Codex locked verifier:** every plan resolves `agents.verifier === "codex"`.

## Known limitations

- `local` model is a non-functional stub (`ready:false`, `enabled:false`).
- `auto` mode is advisory only; it never triggers execution.
- Learning influence (`learning.influence_routing`) is intentionally a no-op in V1.2.
- Classifier/detector are deterministic keyword/marker rules, not model-based.
- Older learning records created during development may predate the V1.2 record shape; they
  live only in the gitignored runtime store and are not shipped.
