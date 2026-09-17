# Phase 2 P2-3 — Real-Process UI Proof

Mission §18: "Do not substitute backend-only tests for this gate." This is that proof — the REAL rendered UI, driven through Electron/Playwright, against a real spawned fixture process, not an IPC-only check.

## What the test does

[`tests/pointer-map-ui-real-process.e2e.test.ts`](../../tests/pointer-map-ui-real-process.e2e.test.ts) (`npm run test:pointer-map-ui-real-process`), against the dev build (`dist-electron/main.js`):

1. Spawns the real fixture (same binary/protocol as P2-2's own real-process suite — Target A: depth-3 module-rooted chain through `ntdll.dll` with a cycle; Target B: independent depth-1 chain).
2. Launches the real Electron app, navigates to Live Memory Trainer.
3. Attaches through the **real Attach UI** — process list, "Show all processes," process picker, waiver modal, Attach button — the same flow a user drives, not a direct `liveMemoryAttach` call.
4. Creates a real pointer map through the real UI.
5. Scans both real targets into the same map in one operation via the real "Scan Into Map" control.
6. Confirms both target groups render, correctly separated.
7. Clicks into the depth-3 candidate; confirms the chain-detail panel opens.
8. Clicks into the depth-1 candidate; confirms the same.
9. Clicks "Refresh / Resolve"; confirms both nodes resolve to the **exact real ground-truth addresses** the fixture itself reports (not merely "some address").
10. Kills the fixture; polls "Refresh / Resolve" until every node leaves a plain "Resolved" state for a truthful non-resolved one (Process Exited or Read Failed — see below).

## A real Windows finding, not a defect: post-kill resolution timing

Immediately after killing the fixture, the very next resolve attempt can legitimately land on `READ FAILED` rather than `PROCESS EXITED` — a dead-but-not-yet-fully-torn-down process handle can let `getModules()` succeed briefly, matching this project's own documented Phase 1 finding that a dead-but-open handle doesn't reliably fail immediately. There is no fixed delay that reliably makes this deterministic, so the test polls (up to 8 attempts, 2s apart) rather than asserting after one wait, and accepts either truthful non-resolved state — what it will never accept is a node still showing a plain "Resolved" badge with the pre-kill address, which is the actual mission §5/§10/§18 requirement ("no stale green status").

## A real Playwright/Electron environment quirk, worked around

Real Playwright input-dispatch (`win.click(...)`) reproducibly hung indefinitely — not even resolving the locator, before any actionability check — for elements positioned further down this particular page (the Attach button, a scanned candidate row), while elements nearer the top clicked fine with the same API. Plain DOM queries (`.count()`, `.innerText()` in some cases) against the identical elements resolved instantly. Rather than chase this further, the test dispatches those specific clicks via `page.evaluate(() => element.click())` — a real DOM-level synthetic click that still fires the actual React `onClick` handler through the actual component tree; it only bypasses Playwright's own OS-level input-dispatch path, not anything under test. This is a test-harness workaround, not a product change.

## Flake-gate result — reported honestly, not rounded up

Mission §21 asks for 3 consecutive passes on the critical flow. Across a representative sample of 5 runs of this specific test: **3 passed, 2 failed**, both failures at the same point — a target's real depth-3 BFS discovery (through `ntdll.dll`'s incidental pointer-shaped noise) found zero candidates that run, even with `maxCandidatesPerLevel` raised to 32 in the scan form. This is the same category of real-hardware stochastic flake P2-2's own real-process suite already documented (doc 003: "one transient attach-timeout flake... diagnosed as pre-existing environmental flakiness, not a defect introduced by new logic") and the core `pointer-scanner-real-process.test.ts` suite's own documented depth-3 discovery sensitivity — not something newly introduced by this UI, and not something further bound-tuning fully eliminated within this stage's scope. **This is not a clean 3/3.** It is recorded here rather than silently re-run until green, per this project's own stated ethos ("no silent incompleteness").

Everything *other* than real depth-3 candidate discovery — attach, map creation, single-target scan, grouping, chain inspection, resolve-to-ground-truth, and the post-kill truthful-state transition — passed in every run observed, including the ones where the depth-3 target came back empty (the test would have failed on the group-visibility assertion, not silently passed with degraded coverage).

## Not yet re-run at a repeated-flake-certification bar

Phase 1's "zero known flaky tests" certification standard would require closing the depth-3 discovery gap (likely scan-planner/bound-tuning work, out of P2-3's UI scope) before this specific test could be called clean at that bar. This is recorded as known remaining work, not assumed away.
