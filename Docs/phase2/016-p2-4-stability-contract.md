# Phase 2 P2-4 — Pointer Stability Contract

ROADMAP's Mandatory Work bullet names **pointer stability testing** as a distinct item from P2-3's "pointer-chain visualization" (`ROADMAP.md:300`). This document is the P2-4 requirement matrix and the classification contract implementing it.

## Scope: P2-4 now, P2-16 later

Mission §1 required separating what P2-4 owns from what a later "resilient/version-aware rediscovery" stage owns, reading ROADMAP literally rather than guessing. `ROADMAP.md:304` names a separate bullet: "Resilient rediscovery; restart stability validation; version-aware rediscovery." Read against `ROADMAP.md:300`'s "pointer stability testing" and this stage's own mission title ("Pointer Stability Testing / Real-Game Restart Validation"):

- **P2-4 (this stage)**: does a *saved* pointer chain still correctly identify its intended target after the process restarts? Detection and measurement — classify, record, and surface truthfully whether an existing chain survived.
- **Later (resilient/version-aware rediscovery)**: what happens when a chain does NOT survive — automatically finding a *new* valid chain after a game update changes offsets. A materially different, harder capability (search/rediscovery, not classification) that P2-4 does not attempt and does not claim.

## Classification vocabulary (mission §2)

Reused/extended from the existing canonical vocabulary where one already existed (`PointerMapNodeStatus`); no parallel status enum was invented for states that vocabulary already covers.

| State | Meaning |
|---|---|
| `stable_exact` | Chain resolves; ground truth verified; module base AND resolved address identical to the recorded baseline. |
| `stable_relocated` | Chain resolves; ground truth verified; module base differs from baseline (real ASLR relocation), chain still correct. |
| `target_moved_chain_valid` | Chain resolves; ground truth verified; module base unchanged but the resolved (heap) address differs from baseline — pure heap relocation, chain still correct. |
| `chain_broken` | An intermediate pointer dereference failed inside `resolvePointerPath` itself — a real broken link. |
| `module_missing` | The expected module is not loaded in the current process. |
| `read_failed` | The chain resolved to an address, but reading the ground-truth bytes there failed (the destination is not currently readable). |
| `process_exited` | The process is gone. |
| `false_positive` | The chain resolved and the address IS readable, but the bytes do NOT match the declared ground truth — readable is not the same claim as correct. |
| `stale_unresolved` (display-only) | No observation exists yet for this generation — never produced by the classifier itself, only shown by the UI/session layer when a node has zero history. |

The three "correct" states (`stable_exact`, `stable_relocated`, `target_moved_chain_valid`) are mutually exclusive by construction — see `validateNodeAfterRestart`'s decision tree in `src/core/live-memory/pointer-stability.ts` — so which one applies to a given observation never depends on evaluation order.

## Ground truth, not "resolved to readable memory" (mission §4)

`resolvePointerMap` (P2-1) proves a chain traverses without error. It never reads the destination value. `validateNodeAfterRestart` adds the missing step: after computing the resolved address, it reads `groundTruth.readSize` bytes there and calls `groundTruth.verify(bytes)`. A chain that resolves to some other readable-but-wrong memory is `false_positive`, never silently reported as stable — mission §9's explicit requirement.

Ground truth crosses the IPC boundary as a serializable spec (`StabilityGroundTruthSpec`: `{kind: 'u32'|'u64', expected, description}`), never a closure — the verifying function itself (`groundTruthFromSpec`) is built server-side only.

## Reuse, not a parallel system (mission §12)

- `PointerMapNode` gains an optional `stability` field; no second pointer-map/node type was created.
- `validateNodeAfterRestart`/`validateMapAfterRestart` (`pointer-stability-orchestration.ts`) operate on the real `PointerMap`/`PointerMapNode` from P2-1, calling the real `resolvePointerPath` from P2-1 — no re-derived pointer-chain semantics.
- Session methods (`pointerMapValidateNodeAfterRestart`, `pointerMapValidateAfterRestart`, `pointerMapGetNodeStability`) live on `LiveMemorySession`, the same production service every other pointer-map operation already uses.
- No separate "campaign" tracking object: the launch number for a new observation is derived from how many observations already exist on that node (`stability.observations.length + 1`), so there is nothing extra to start, forget to increment, or lose track of across a session restart.

## Persistence (mission §13)

See `Docs/phase2/019` for the schema migration itself — `POINTER_MAP_SCHEMA_VERSION` moved 1 → 2, with pre-P2-4 (schemaVersion 1) saved maps migrated forward on load, never rejected.
