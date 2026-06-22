# AgentBridge V1 Baseline

## Flow

Claude codes → ChatGPT reviews → Codex builds/tests.

Workshop is removed from the V1 build path.

## Commands

```bash
npm run agentbridge -- create [projectPath]
npm run agentbridge -- next <taskId>
npm run agentbridge -- ingest claude <file> [taskId]
npm run agentbridge -- ingest chatgpt <file> [taskId]
npm run agentbridge -- ingest codex <file> [taskId]
npm run agentbridge -- status [taskId]
npm run agentbridge -- report [taskId]
npm run test:codex-relay
npm run smoke:agentbridge
npm run build:agentbridge
npm run verify:agentbridge
```

## Validation status

The V1 baseline is validated with `npm run verify:agentbridge`. It compiles the repository, validates AgentBridge files, runs the Codex relay test, and runs the real-task smoke test without Electron packaging.

Checkpoint status on 2026-06-22:

- `npm run smoke:agentbridge` — PASS
- `npm run verify:agentbridge` — PASS
- Real task relay — Claude → ChatGPT APPROVED → Codex PASS → final report created
- Git commit — unavailable because this directory is not a Git worktree

## Known issue

The full `npm run build` may fail because of a pre-existing Electron entry path mismatch between `electron/main/main.js` and `dist/electron/main/main.js`. This is unrelated to AgentBridge V1 and the Codex relay migration. Do not claim the full app build passes until that path is fixed separately.

## V1 limitations

- No API automation
- No UI
- No multi-project support
