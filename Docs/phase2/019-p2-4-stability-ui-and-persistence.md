# Phase 2 P2-4 — Stability UI and Persistence Migration

## UI (mission §15/§16)

Extends `PointerMapPanel` (the existing pointer-map UI, not a second one). The Chain Detail panel gains a "Restart Stability" section per selected candidate:

- Current state badge (`stabilityStatusBadge`) — a node with no observations shows a truthful "Not Yet Validated" caution badge, never a silent green.
- Attempt / correct / broken / false-positive raw counts, plus the stability rate expressed as both a fraction and a percentage (`summarizeStabilityObservations`) — the denominator is never hidden behind a lone percentage.
- Last restart result and last resolved address.
- A "Validate After Restart" form: ground-truth kind (`u32`/`u64`), expected value, description — the user supplies what the resolved address *should* hold, since only the user knows what a given candidate is semantically supposed to mean; SOLITH cannot guess this. Submitting calls the real `pointerMapValidateNode` IPC channel.
- An optional drill-down history list showing every recorded observation.

Real-process/real-UI proof: `tests/pointer-map-ui-stability.e2e.test.ts` — see its own header comment for the "Load button" defect this test discovered and deliberately scoped around (filed separately, `Docs/phase2/020`).

## Persistence migration (mission §13)

`src/core/live-memory/pointer-map-store.ts`: `POINTER_MAP_SCHEMA_VERSION` moved 1 → 2.

- **Before**: `loadPointerMap` rejected any row whose `schemaVersion` did not exactly equal the current constant — meaning bumping the version at all would have broken every pre-existing P2-2 saved map outright.
- **After**: a row is rejected only if its `schemaVersion` is *newer* than this code understands (genuine forward-compatibility protection — a future format change this code was never built to read). Any version at or below the current one is migrated forward. A real `schemaVersion: 1` row (the exact shape P2-2 actually wrote to disk, with no `stability` field anywhere) is loaded successfully, with every node backfilled `stability: { baseline: null, observations: [] }` — a real empty state, never fabricated restart history, and never a crash or a rejected load.

Test: `tests/live-memory/pointer-map-store.test.ts` — "a real schemaVersion=1 row (saved before pointer stability existed) migrates forward, not rejected" constructs the exact P2-2 JSON shape by hand (not derived from current code, so it cannot accidentally already match the new shape) and asserts the migrated result. The pre-existing "rejects an unsupported future schema version" test (using `schemaVersion: 999`) continues to pass unchanged, confirming forward-compat protection still works for genuinely newer formats.
