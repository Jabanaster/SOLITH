# P3-1 — Catalog Identity-Matching Window Closure (D07, partial)

**Branch.** `feature/solith-parallel-phase3-catalog-identity`, forked from certified `feature/solith-phase1-scanner-reconstruction` @ `455f9cd` (does not include, depend on, or touch any commit from `feature/solith-phase2-pointer-engineering` or `feature/solith-phase2-pointer-stability`).

**Scope of this note.** Status/evidence for one bounded slice of Phase 3 (ROADMAP.md §9, PHASE 3 — Game Identity, Executable Detection & Catalog). Does not change Phase 3's Mandatory Work, Exit Gate, or Prohibited Shortcut, and does not mark Phase 3 or D07 fully CERTIFIED.

## What D07 actually was in this codebase

Audit 2's cited symptom ("200-row/500-row hardcoded lookup windows") maps to four concrete call sites, all found by direct code read (not guessed):

| Site | Old window | Effect |
|---|---|---|
| `electron/catalog-process-watch.ts:29` | `searchCatalog('', 200, 0)` | Live-process auto-detection (`pollCatalogProcesses`) only ever considered the first 200 catalog rows (ordered verified-tier-first, then alphabetical). A running game whose row sorted past that could never be auto-detected, no matter how long it ran. |
| `src/core/install-discovery/index.ts:271` | `searchCatalog('', 5000, 0)` | Install-discovery preview matching (`runInstallDiscoveryScan`) silently dropped any catalog row past position 5000 from identity matching. |
| `src/core/install-discovery/index.ts:350` | `searchCatalog('', 5000, 0)` | Same defect on the commit path (`commitInstallDiscoveryRecords`). |
| `electron/artwork-cache-ipc.ts:55` | `searchCatalog('', POPULAR_TRAINER_LIMIT /* 500 */, 0, {})` | Latent variant: when the renderer requested artwork for explicit, currently-visible `catalogGameIds`, those ids were filtered out of an already-capped 500-row Popular window instead of being looked up directly — a visible card outside that window silently never got an artwork job queued. |

The fourth site was found during this stage, not pre-listed in the roadmap's D07 description, and is the same defect class (a fixed-size page substituted for full-population lookup) rather than a new independent defect.

`searchCatalog()` itself is not defective — it is a correctly parameterized, paginated user-facing browse/search query (`LIMIT ? OFFSET ?`, real `total` count). The defect was every call site above using it as if it were an unbounded "give me the whole catalog" accessor.

## Fix (architectural, not a bigger constant)

Added two dedicated, unbounded accessors to `src/core/trainer-catalog/store.ts` — no `LIMIT`/`OFFSET` clause at all, not a larger fixed number:

- `getFullCatalogForMatching(filters?)` — full `TrainerCatalogEntry[]`, same `WHERE`/eligibility-filtering logic `searchCatalog` already uses, for install-discovery's identity matcher which needs full entry shape (steamAppId, executables, etc.).
- `listCatalogExecutableIndex()` — minimal `{catalogGameId, displayName, executables}[]` projection, for the process-watch poll loop which runs every 15s against the whole catalog and should not pull artwork/verification/search columns on every tick.

Call sites updated to use these instead of a capped `searchCatalog(...)` call:
- `electron/catalog-process-watch.ts` — also switched from `matchCatalogProcess` (first-hit-only) to `matchAllCatalogProcesses` (new function, `src/core/live-memory/process-watcher.ts`), so a second concurrently-running catalog game is no longer silently ignored. Added per-game active-detection tracking (`activeDetections` map) with a `catalog-process-cleared` broadcast when a previously-detected game's process exits. **Not yet wired to a renderer consumer** — the broadcast fires but no UI subscribes to `catalog-process-cleared` yet; `getLastProcessDetection()`/`catalog-process-detected` (existing, unchanged shape) remain the certified path or a genuinely-multi-game UI is a follow-up, not claimed complete here.
- `src/core/install-discovery/index.ts` — both call sites switched to `getFullCatalogForMatching()`.
- `electron/artwork-cache-ipc.ts` — explicit-`catalogGameIds` path now looks up each id directly via `getCatalogEntry` (still passed through the same `filterEligibleForTrainerLibrary` gate `searchCatalog` already applied) instead of filtering a capped Popular-projection window. The no-explicit-ids fallback intentionally keeps the bounded `POPULAR_TRAINER_LIMIT` window — that one is by-design scope (ROADMAP §4.5), not a defect.
- `src/core/live-memory/process-watcher.ts` — added `matchAllCatalogProcesses` (hashmap-based, O(processes + catalog) instead of the old O(processes × catalog) linear `.find` scan — matters now that callers pass the full catalog, not a 200-row page). `matchCatalogProcess` kept as a thin `[0] ?? null` wrapper for any other caller.

## Verification

- New regression tests: `tests/trainer-catalog-full-window.test.ts` (seeds 221 rows with the target placed past the old 200-row window; asserts both new accessors return every row), `tests/live-memory/process-watch-multi-match.test.ts` (catalog-position independence + multi-game detection + back-compat single-match + no-match + duplicate-executable dedup). Both wired into `test:trainer-catalog` / `test:live-memory` and the root `test` script, not left un-run.
- `npm run test:trainer-catalog`: 168/169 pass. The 1 failure (`trainer-library-persistence-lifecycle.test.ts`, header-URL-clearing assertion) is **pre-existing on the certified `feature/solith-phase1-scanner-reconstruction` baseline** — reproduced identically with this stage's changes `git stash`-ed out. Not introduced by this stage; not fixed here (out of D07 scope, would be scope creep). Flagged separately.
- `npm run test:install-discovery`: 22/22 pass.
- `npx tsx --test` targeted artwork-cache suites (rights/fetch-policy/cache-writer/fetch-executor/queue/store/ipc-validation): 70/70 pass.
- `npx tsc --noEmit` (root) and `npx tsc -p tsconfig.electron.json --noEmit`: both clean, exit 0.

## Not done in this stage (explicitly out of scope, not silently skipped)

Phase 3's full Mandatory Work is far larger than D07's window defect: LIEF (replaces `pe-analyzer.ts`), BLAKE3/xxHash hash architecture, nested-executable/launcher/edition/version fingerprinting, provider normalization, the preserved `preserve/catalog-process-detection-fix-2026-09-12` branch's artwork-backfill hunk (a related but distinct defect — remote-synced catalog rows missing Steam artwork — not part of D07 itself), and re-derivation of that preserved branch's authority-bridge/consent-dialog/trainer-deck hunks (out of Phase 3's scope entirely; several look superseded by later work and were correctly left untouched here). Phase 3 overall status: **NOT_COMPLETE**. This note only closes the catalog-window-ceiling half of D07's identity-matching impact.

## Phase 2 files touched

`NONE`. Confirmed by diff against both `feature/solith-phase2-pointer-engineering` and the live `feature/solith-phase2-pointer-stability` worktree's dirty file list before starting; every file this stage touched (`electron/catalog-process-watch.ts`, `electron/artwork-cache-ipc.ts`, `src/core/install-discovery/index.ts`, `src/core/live-memory/process-watcher.ts`, `src/core/live-memory/index.ts`, `src/core/trainer-catalog/store.ts`, `package.json`, plus 2 new test files) is absent from both Phase 2 branches' changed-file lists except `package.json` (additive script-list edit only, trivially mergeable) and `src/core/live-memory/index.ts` (both branches add independent export lines to the same `export {...} from './process-watcher.js'` block — a textual interleave, not a semantic conflict).
