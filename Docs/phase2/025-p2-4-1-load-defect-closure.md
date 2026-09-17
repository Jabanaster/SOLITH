# Phase 2 P2-4.1 — Pointer-Map Load Defect Closure

`Docs/phase2/020` disclosed a real, pre-existing defect (not introduced by P2-4) found while writing the first e2e test to ever exercise the real "Load" button: after loading a saved pointer map, the panel's post-load refresh intermittently-but-reproducibly appeared to report `not_attached` despite a genuinely attached session. It was filed to a separate investigation rather than dispositioned inside P2-4's own scope. The user rejected that as insufficient — "a real pre-existing pointer-map Load defect was found and pushed to another investigation instead of being reconciled before P2-4 closes" — and required root cause, fix-or-scoped-proof, and full regression here.

## Coordination, without touching another session's worktree

A separate Claude session ("Fix pointer-map Load causing not_attached error") was already independently investigating this defect in the shared `solith-phase0-convergence` worktree. Per the user's standing rule ("ONE ACTIVE CLAUDE SESSION = ONE WORKTREE"), that worktree was never touched, read for editing, or interfered with. Instead: (1) the defect was reproduced independently, from scratch, in this stage's own isolated worktree; (2) the peer session's own root-cause report was requested and received via cross-session message for comparison; both independently arrived at the identical mechanism.

## Root cause

Not a backend/session-lifecycle race. `PointerMapPanel`'s `loadMaps()` effect fires on mount, before any attach has ever happened, and correctly (harmlessly) receives `not_attached` back from `pointerMapList` — the expected pre-attach state. Its failure branch, however, unconditionally wrote that into the panel's local `message` state:

```ts
} else if (!result?.success) {
  setMessage(`Failed to list pointer maps: ${result?.error ?? 'unknown error'}`);
}
```

Nothing ever cleared that message on a later successful refresh. If "Load" on an already-saved map was the user's first interaction with the panel (attach, then Load, no Create/Scan first — a completely normal flow), the stale `"Failed to list pointer maps: not_attached"` text was still the only thing on screen during the brief async window between the click and `handleLoadSavedMap`'s own final "Loaded ..." message.

Ruled out before landing on the real cause: a `requireBundle`/`disposeSession` session-teardown race (peer session's exhaustive server-side instrumentation across ~150 trials observed zero backend session drops) — ruled out because the original symptom co-occurred with the Detach button remaining visible and functional, which necessarily contradicts any backend session reset.

## Fix

`src/app/components/PointerMapPanel.tsx`'s `loadMaps()`:

```ts
} else if (!result?.success && result?.error !== 'not_attached') {
  // 'not_attached' is the expected pre-attach state ...
  setMessage(`Failed to list pointer maps: ${result?.error ?? 'unknown error'}`);
}
```

`not_attached` is now treated as the expected pre-attach state and never surfaces as a failure message.

## Regression proof: fails on pre-fix code, passes with the fix

A new e2e test, `tests/pointer-map-ui-stability.e2e.test.ts` ("Load as the first interaction after a fresh attach never shows a stale not_attached error"): a real two-launch scenario — session 1 creates and saves a real map against a real fixture instance and closes; session 2 is a genuinely fresh Electron launch against a genuinely new fixture process instance, sharing the same on-disk userData, attaches, then clicks Load on the saved map as the very first panel interaction (no Create/Scan first). The body is polled continuously through the async window between the click and the final message, so a transient stale error cannot slip past an end-state-only assertion.

Verified both directions directly, not assumed:
- **With the fix reverted** (`git stash` on the one-line change, renderer rebuilt): test **fails** — `sawStaleError` is `true`.
- **With the fix applied**: test **passes**, both alone and alongside the existing "Validate After Restart" e2e test in the same file (2/2 pass together).

## Scope, confirmed by reproduction

Cosmetic UI status text only. The `pointer-map-load`/`pointer-map-list` backend IPC handlers, saved stability pointer-maps on disk, and P2-4's restart-validation classification logic were never touched by this defect or its fix — the backend always returned the correct data; only a stale renderer status string was ever wrong. No impact on P2-2/P2-3's historical claims (neither exercised the Load button before P2-4).

## Disposition

**FIXED, not merely proven out of scope.** Root cause identified and independently corroborated by a peer investigation reaching the identical conclusion. One-line fix applied. Regression test added and verified to catch the exact regression (fails pre-fix, passes post-fix). Full `test:live-memory` regression remains clean (556/556) after the fix.
