# AgentBridge

File-based V1 relay: **Claude codes → ChatGPT reviews → Codex builds/tests**.

Workshop AI is not used in V1.

## Validation

Use AgentBridge-specific validation. Do not use `npm run build` to verify the relay.

```bash
npm run verify:agentbridge
```

This runs:

1. `npm run compile` — TypeScript compile for the repo
2. `npm run build:agentbridge` — AgentBridge JS syntax checks + Codex relay test
3. AgentBridge smoke checks — CLI help, Workshop rejection, Codex parsing

### AgentBridge-only build

```bash
npm run build:agentbridge
```

Runs AgentBridge JS validation and `npm run test:codex-relay`. Does **not** run Electron packaging.

### Codex relay test only

```bash
npm run test:codex-relay
```

## CLI

```bash
npm run agentbridge -- create
npm run agentbridge -- next TASK_001
npm run agentbridge -- ingest claude <file> [taskId]
npm run agentbridge -- ingest chatgpt <file> [taskId]
npm run agentbridge -- ingest codex <file> [taskId]
npm run agentbridge -- status [taskId]
npm run agentbridge -- report [taskId]
```

`ingest` task resolution order:

1. Explicit `taskId` argument
2. Active task (stored in SQLite/config)
3. Error

## Known issues

### Electron packaging (`npm run build`)

`npm run build` may fail due to a **pre-existing** Electron Builder entry path mismatch:

- Configured entry: `electron/main/main.js`
- Compiled output: `dist/electron/main/main.js`

This is **unrelated** to AgentBridge V1 or the Codex relay migration.

Do **not** claim the full app build passes until the Electron entry path is fixed. Fixing Electron packaging is an optional separate task.

AgentBridge V1 validation status is determined by `npm run verify:agentbridge`, not `npm run build`.

## Layout

```
workflow/agentbridge/   # Relay CLI + state store
agents/codex/input/     # Codex build prompts
agents/codex/output/    # Codex output copies
templates/codex-build.md
scripts/test-codex-relay-flow.ts
```
