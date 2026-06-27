# AgentBridge Operator Runbook

A short, durable guide for running the AgentBridge file-based relay by hand.

## What AgentBridge is

A local, file-based manual relay. There is **no API, no UI, no auto-execution, and
no multi-project routing**. A human moves each task forward one step at a time.

- **Relay:** Claude → ChatGPT → Codex
- **Claude:** primary coder / fixer (produces implementation or fix output)
- **ChatGPT:** reviewer / auditor (advisory feedback, APPROVED / changes requested)
- **Codex:** locked verifier (runs build/test, reports PASS / FAIL / NOT_RUN)
- **Workshop:** removed/rejected — must never be reintroduced
- **Router (V1.2):** advisory only — `route(task) -> plan`. It never executes or
  mutates relay state.

## Flow states

```
created
  -> waiting_claude_code
  -> waiting_chatgpt_review
  -> waiting_codex_build
  -> passed | failed | stopped
       (FAIL routes back to waiting_claude_fix -> ... up to MAX_LOOPS)
```

## Manual steps: create -> next -> ingest -> run Codex -> report

All commands are run from the repository root.

### 1. Create a task

```bash
npm run agentbridge -- create "G:\\path\\to\\project"
# or
node workflow/agentbridge/agentbridge.js create "G:\\path\\to\\project"
```

Creates a task, sets it active, and prints the task ID (e.g. `TASK_042`).

### 2. Generate the next prompt

```bash
node workflow/agentbridge/agentbridge.js next TASK_042
```

Writes the prompt for the next required agent into `workflow/agentbridge/prompts/<agent>/`
(Codex prompts also go to `agents/codex/input/`). Hand that prompt to the agent.

### 3. Ingest the agent's output

Save the agent's reply to a file, then:

```bash
node workflow/agentbridge/agentbridge.js ingest claude   path/to/claude_output.md   TASK_042
node workflow/agentbridge/agentbridge.js ingest chatgpt  path/to/chatgpt_review.md  TASK_042
node workflow/agentbridge/agentbridge.js ingest codex    path/to/codex_result.md    TASK_042
```

The state machine advances automatically based on the content:
- ChatGPT `APPROVED` → moves to Codex build.
- Codex `PASS` → task `passed`.
- Codex `FAIL` → back to Claude fix (until `MAX_LOOPS`).
- Codex `NOT_RUN` → task `stopped` (build was not executed).

The verifier (`ingest codex`) is the only step that can mark a task `passed`.

### 4. Run Codex build (optional automation)

Codex command execution is **disabled by default**. To enable safe local builds:

```bash
node workflow/agentbridge/agentbridge.js config set codexBuildCommand "npm run build"
node workflow/agentbridge/agentbridge.js config set allowCodexCommandExecution true
node workflow/agentbridge/agentbridge.js run-codex TASK_042
```

`run-codex` runs the configured command **inside the project root only**, captures
output, enforces a timeout, blocks dangerous commands, and then ingests the result as
the Codex verifier output. Disabled or missing command → `NOT_RUN`.

### 5. Report

```bash
node workflow/agentbridge/agentbridge.js status TASK_042
node workflow/agentbridge/agentbridge.js report TASK_042
```

`report` writes `workflow/agentbridge/FINAL_REPORT_<taskId>.md` with task ID, project
path, status, Claude outputs, ChatGPT review, Codex build result, unresolved issues,
and next step.

## Advisory router (V1.2) — read only

```bash
node workflow/agentbridge/agentbridge.js router plan "implement a settings panel"
node workflow/agentbridge/agentbridge.js registry list
node workflow/agentbridge/agentbridge.js registry validate
node workflow/agentbridge/agentbridge.js learning list
```

The router only returns a plan (`execution_allowed: false`). It does not run agents and
does not change task state.

## Evidence pack (V1.3)

```bash
npm run evidence:agentbridge
# or
node workflow/agentbridge/agentbridge.js evidence
```

Produces a timestamped proof bundle under `workflow/agentbridge/evidence/`
(`EVIDENCE_<timestamp>.md` + `.json`): git state, relay status, registry validation,
a router sample, gate results, report links, this runbook, and safety notes. The
relay task store is snapshotted and restored around the gate run, so generating
evidence does not mutate relay state.

## Safety notes

- **Manual is the default.** Nothing runs without an operator command.
- **Router is advisory only.** It never executes or mutates state.
- **Codex is the locked verifier.** Only Codex can mark a task passed.
- **Command execution is opt-in** (`allowCodexCommandExecution`, default false) and is
  restricted to the project root with dangerous-command blocking.
- **Workshop is rejected.** `ingest workshop` is refused and an enabled `workshop`
  agent fails registry validation.

## Validation gates

```bash
npm run evidence:agentbridge
npm run test:router
npm run test:codex-relay
npm run test:agentbridge-v11
npm run smoke:agentbridge
npm run verify:agentbridge
npm run build
```
