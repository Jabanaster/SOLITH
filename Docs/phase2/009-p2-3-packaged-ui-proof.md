# Phase 2 P2-3 — Packaged UI Proof

Mission §19's minimum bar: page loads, preload API present, create/load map, pointer data renders, no dev-only import/path dependency, native addon loads from packaged path.

## Build used

`npm run build:vite && npm run build:electron && npx electron-builder --dir --win --x64` — a real, fresh `dist/win-unpacked/Solith.exe` built from this stage's actual source (including the `maxCandidatesPerLevel` IPC fix and the zero-result-group fix), not a stale artifact from an earlier session. `build:electron`'s own 33-point output verifier passed 33/33 (no `.ts` leakage, no bare relative imports, contextIsolation/nodeIntegration correct, native addon present and in size bounds).

## What the test does

[`tests/pointer-map-ui-packaged.e2e.test.ts`](../../tests/pointer-map-ui-packaged.e2e.test.ts) (`npm run test:pointer-map-ui-packaged`), launched against `dist/win-unpacked/Solith.exe` directly (`_electron.launch({ executablePath: ... })`, the same pattern as the pre-existing `gate2-2a1-packaged-real-process-write-proof.e2e.test.ts`):

1. Page loads from packaged resources (`app.asar`).
2. `window.electronAPI.pointerMapCreate` is present — the preload contract survived packaging.
3. Attaches to a real spawned fixture through the real UI — this exercises the **native scanner addon from its packaged `app.asar.unpacked` path**, the strongest possible proof it resolved correctly (a stub or missing addon would fail attach outright, not silently succeed).
4. Creates a map, scans one real target (single-target, depth-1 — the harder two-target/depth-3 case is already proven against the dev build in doc 008; re-running it packaged would only re-test Electron packaging, not add new pointer-map coverage, and depth-1 discovery has not shown the depth-3 noise problem).
5. Confirms the target group and candidate render from the real scan response.
6. Saves the map (schema-versioned SQLite persistence at the packaged database path) and confirms it reappears in the "Saved maps" list — a real round trip through the packaged app's own data directory, not the dev one.

## Why attach is required here, not optional

The P2-2 pointer-map IPC layer ties its in-memory map registry to `requireSession`, which throws `not_attached` unless the session is attached (`requireBundle`'s `!bundle.session.isAttached()` check) — this is existing P2-2 architecture (one live session's map registry, tied to session lifecycle), not something P2-3 introduced or is trying to route around. A packaged proof that only checked "the page renders" without ever attaching would not actually exercise map create/save/load at all, undercutting mission §19's own "create/load map" requirement.

## A real bug found while writing this test

The first attempt used a generic substring-matching click helper (`el.textContent.includes('Save')`) to find the Save button. It matched the sidebar's "Save Locations" navigation link first (found earlier in DOM order), silently navigating away from the page entirely instead of saving the map — a real test-authoring bug, not a product defect, but worth recording: short, common button labels ("Save", "Attach") need exact-text matching in a page with many other "Save"-adjacent labels, not substring matching. Fixed by adding an `exact` match mode to the click helper and using it for both.

## Result

3/3 consecutive clean passes. Single-target/depth-1 discovery through the real native addon has not shown the depth-3 noise sensitivity documented in doc 008 — this packaged proof is genuinely at a clean flake-gate bar for the scope it covers.
