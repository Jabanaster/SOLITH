# AgentBridge V1.2 Validation Report

**Date:** 2026-06-26  
**Branch:** main (implied — no feature branch)  
**Tag:** v1.2.0 (pending commit)

---

## Summary

V1.2 adds a registry-first advisory router to AgentBridge. The router is
deterministic, driven entirely by the agent registry (no hardcoded agents), and
advisory-only — it never executes tasks. All V1.2 acceptance gates pass.

---

## Files Changed

| File | Change |
|------|--------|
| `workflow/agentbridge/agentbridge.js` | Added V1.2 CLI sub-commands: `router plan`, `registry list`, `registry validate`, `learning list`; added `validateAgentEntry`; registered all exports |
| `scripts/test-router.ts` | Added 4 new V1.2 test cases (registry validation, workshop absent, local stub, advisory plan shape) |

All other files (registry.js, router.js, store.js, codex-relay, relay pipeline) were **not modified**.

---

## Commands Run and Results

| Command | Result |
|---------|--------|
| `npm run test:router` | ROUTER OK — 21/21 tests pass |
| `npm run test:codex-relay` | CODEX-RELAY OK |
| `npm run test:agentbridge-v11` | V11 OK |
| `npm run smoke:agentbridge` | SMOKE OK |
| `npm run verify:agentbridge` | VERIFY OK |
| `npm run build` | BUILD OK |

---

## Proof: Relay Behavior Unchanged

The `Claude → ChatGPT → Codex` relay pipeline files were not touched:

- `workflow/agentbridge/agentbridge.js` relay logic (lines above the added V1.2 block) unchanged
- `workflow/agentbridge/codex-relay.js` unchanged
- `test:codex-relay` passes

The router does not intercept, redirect, or mutate relay execution. It produces advisory plan objects only.

---

## Proof: Router Is Advisory Only

Every plan produced by `route()` and `cmdRouterPlan()` includes:

```json
{
  "execution_allowed": false,
  "mode": {
    "manual_default": true,
    "auto_advisory_only": true
  }
}
```

The router has no mechanism to invoke Claude, ChatGPT, Codex, or any other agent. It reads input, computes a plan object, and returns it. The `execution_allowed: false` field is set unconditionally in `cmdRouterPlan`.

Test verification: V1.2 test case 4 (`OK V1.2 router plan CLI shape`) asserts `plan.execution_allowed === false`.

---

## Proof: New Agents via Registry Data Only

The router resolves agents through role bindings in `registryConfig.roleBindings`:

```json
{
  "PrimaryCoder": "claude",
  "Reviewer": "chatgpt",
  "Verifier": "codex"
}
```

Test case 3 (`OK 3 synthetic agent routed`) proves this: a synthetic agent `qwen` was injected into the agent list and bound as `PrimaryCoder` via `roleBindings.PrimaryCoder = 'qwen'` — no router code changed, and the plan correctly reflected `coder: "qwen"`.

---

## Proof: Codex Is Locked Verifier

`registryConfig.roleBindings.Verifier` defaults to `"codex"` and is never overridden by the router. Test case 12 (`OK 12 verifier always codex`) asserts `effectiveAgents.verifier === 'codex'` regardless of task or mode.

`registry validate` checks that the verifier role is bound to `codex` and that workshop is absent.

---

## Known Limitations

- `local` model is a stub with `ready: false` by default. Routing to `local` requires an external process to set `ready: true` on the registry entry.
- Learning influence is stored but disabled by default (`learningInfluenceEnabled: false`). Enabling it requires explicit config change; it is not exposed via CLI.
- Auto mode is advisory only — there is no mechanism in V1.2 to have the router trigger task execution. This is by design.
- Router operates on the current working directory for project detection. Multi-project routing is not supported.
