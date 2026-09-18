# P4-12R — Final Whole-Phase Re-Certification

Status: **PHASE 4 — CLOSED — CERTIFIED**, pending remote CI on this closeout PR (see §CI below).

Baseline: `origin/master` @ `e1c9fbf4e0725c084065d978e8be9ff15723ba8f` (PR #59, P4-13 canonical execution convergence). Audit worktree: `feature/solith-phase4-trainer-model` at that same SHA.

This mission independently re-audited the entire Phase 4 scope from current code (not from prior reports), using eight parallel read-only research passes plus direct execution of the full regression suite, both TypeScript configs, and the Vite/Electron builds. Three real, narrow, Phase-4-owned gaps were found and fixed. No PHASE4_BLOCKER remains.

## Representation authority — final state

| Representation | Definition authority? | Execution authority? | Final disposition |
|---|---:|---:|---|
| `SolithDefinitionV1` (schema.v1.ts) | YES — sole | — | CANONICAL_DOMAIN |
| Trainer-storage repository | — | — (persistence) | CANONICAL_PERSISTENCE |
| `TrainerApplicationService` / `TrainerRuntime` / `CompositeTransactionRuntime` | — | YES — sole | CANONICAL_RUNTIME |
| `GameConfig` / `CheatDefinition` (cheat-system) | NO (curated catalog metadata only) | NO — confirmed zero raw live-memory write/freeze calls in `useGameCheatSession.ts`; all mutation routes through canonical `trainer*` IPC | VIEW_MODEL / CATALOG_SOURCE (one-way seed adapter into canonical `MemoryFeatureV1` at build time) |
| `Recipe` | NO | NO — `saves/editor.ts` treats `recipeId` as an opaque provenance tag only, never branches on it | COMPATIBILITY_ONLY / AUTHORING_ONLY |
| ModPack | NO (import/export shape only) | NO | ADAPTER_ONLY / EXTERNAL_FORMAT |
| CT (Cheat Engine table) import | NO | NO — output is a full canonical definition before persistence | IMPORT_ONLY |
| `saves/editor.ts` | NO | Save-execution only, canonical-save-field-dispatched | BACKEND_ONLY |
| `TrainerHost` | NO | Save-execution RPC backend only, memory features cannot route through it | BACKEND_ONLY |
| Phase 2 live-memory IPC / `LiveMemoryTrainerPage.tsx` | — | Manual research tool, address-oriented by design | REFERENCE_ONLY (explicitly out of Phase 4 scope per mission §35) |

No row is ambiguous. No competing trainer-definition or trainer-execution authority exists.

## What was re-verified true (no code change needed)

- **Canonical definition authority** — persistence and runtime layers consume `SolithDefinitionV1` exclusively; no format-branching (`if ModPack ... else if Recipe`) in business/runtime code.
- **Schema versioning (P4-2)** — centralized detector, centralized migration entrypoint, unknown-future-version and malformed input both fail closed, migration deterministic/non-mutating/revalidated. Live-run `tests/definitions-migrations.test.ts` passes.
- **Persistence authority (P4-8)** — transaction-wrapped, validated pre-write, rollback-on-failure, read-back-verified, provenance-tracked, corrupt-row isolated, unsupported-future-schema fails closed. `tests/trainer-storage.test.ts` 34/34 pass. Two non-hub direct-write call sites exist outside the repository (`ensure-bundled-definitions.ts`, `definition-quarantine.ts`) — both first-party/trust-downgrade-only, not hub/community input, not a bypass of untrusted-data guarantees.
- **Hub/community write path** — both `sync/index.ts` and `hub-client.ts` route exclusively through `persistTrainerDefinition`; no hand-rolled bypass.
- **Certification trust semantics (P4-13 §21 fix)** — reproduced live: `tests/community-trust.test.ts` 6/6 pass, including the "reachability" test proving the pre-fix condition and the "fix" test proving the current ordering prevents it. Remote/community claims cannot self-escalate cert level (server-enforced schema + sanitizer strip on publish).
- **`TrainerApplicationService` / `TrainerRuntime` / session authority (P4-10) / composite transactions (P4-7)** — all re-certified against current code: single orchestration boundary, full lifecycle state machine, one authoritative `LiveMemorySession` per sender (exhaustive grep confirms exactly two construction call sites, both gated by dispose-before-recreate), OWNED/BORROWED explicit, freeze scheduler singular, composite transaction runtime fully implemented with reverse-order rollback/partial-rollback-failure/cancellation — wired end-to-end through IPC and preload but not currently invoked by any shipped renderer UI (acceptable per mission §24: no shipped composite feature currently requires it; documented here).
- **Execution IPC renderer cutover** — real production call sites confirmed in `useGameCheatSession.ts` for every canonical channel; consumed live by `GameSpecificCheatMenu.tsx`.
- **`useGameCheatSession` mutation paths** — 100% canonical (`writeValue`, `startFreeze`, `stopFreeze`, `toggleCheat` off-path rollback all route through `trainer*` IPC). Zero raw live-memory write/freeze calls in this file.
- **Discovery-required features** — `seedDiscoveredFeatureAddress` restricted to `scan_first`/`scan_unknown` kinds only, `0x0` rejected, unseeded fails closed, stale seeds invalidated on process loss, canonical propose/consent/confirm gate still applies after seeding.
- **Hotkeys** — single `globalShortcut` registration path, converges on the exact same `toggleCheat` function as the click path.
- **Consent flow** — server-issued, action-bound, single-use, expiring (5 min TTL), value/identity-hash-bound. The one `{kind:'approved'}` shortcut in `action-executor.ts` is unreachable from any shipped IPC path (confined to test files).
- **Freeze** — single scheduler per session, per-tick process-identity recheck (not just PID match — start-time/volume-serial/file-index), deactivation and process/app exit all stop it, no orphan freeze survives session loss.
- **Toggle-off / rollback** — confirmed writes tracked, toggle-off awaits real rollback, rollback failure surfaced, write-after-toggle-off race compensated via a synchronous generation counter. **Gap**: no executed test exercises this race (no React-hook test harness exists in this repo at all — not a Phase 4-introduced gap, a pre-existing tooling gap). Documented, not fabricated a test for.
- **Recipe final role & identity-space** — confirmed compatibility/authoring-only, zero execution authority, zero definition authority. The `Recipe.gameId` (user-library UUID) vs `catalogGameId` (catalog UUID) split is real and correctly deferred to Phase 6 Trainer Creator territory, not a Phase 4 blocker.
- **`saves/editor.ts`** — read in full: zero `Recipe` imports, zero trainer-definition persistence, `recipeId` is an opaque provenance tag only, backup/recovery preserved.
- **`TrainerHost`** — save-execution backend only, layered RPC validation (IPC schema + independent supervisor re-validation + child-process re-validation), memory features structurally cannot route through it.
- **YAML round-trip** — fingerprint/certification/provenance/feature-identity all survive canonical→YAML→canonical, proven by a dedicated regression test (P4-12's zeroing bug stays fixed).
- **CT boundary** — CT importer output is always a full canonical definition before persistence; no AutoAssembler/script execution triggered by import (`hook-engine.ts` not on the CT import path at all).
- **Injection quarantine** — zero references to `in-process-script`/`hook-engine` in canonical runtime/application/transaction/execution-IPC code; the only integration point is the Phase 2 live-memory IPC surface, by design.
- **Raw memory IPC boundary** — every trainer execution channel keys on `trainerId`/`featureId`/`proposalId`; the one address-carrying channel (`trainer-seed-discovered-feature`) is both schema-scoped and runtime-code-enforced to discovery-required feature kinds only.
- **Security re-audit** — stale PID rejected, PID reuse detected via multi-field identity comparison (not just PID), protected/system/anti-cheat targets blocked, every handler validates sender frame (`requireTrustedSender`), every IPC schema is `.strict()`, malformed payloads rejected.
- **Gitleaks disposition** — all 5 `.gitleaksignore` entries are exact commit-fingerprint suppressions with inline justification; `.gitleaks.toml` is stock/unweakened.

## What was found broken and fixed this session

1. **ModPack conversion-loss warnings were computed but never reached a human.** `modPackConversionLosses()` is correctly computed on every legacy-unversioned read (and does survive reload via provenance), but `CatalogTrainerControlsPage.tsx` never rendered `provenance.conversionWarnings` — fixed by adding the render block (`src/app/pages/CatalogTrainerControlsPage.tsx`). Separately, the community-sync write path computed the same warnings and then discarded them before its own caller could inspect them (`TrainerCatalogSyncReport` had no field for it) — fixed by threading `conversionWarnings` through per-provider into the sync report (`src/core/trainer-catalog/sync/index.ts`). Canonical→ModPack export-direction loss remains undisclosed (only import-direction is covered); not fixed this session — narrow, ModPack export is a secondary/compatibility path, documented here as a known residual gap rather than silently left unmentioned.
2. **A curated cheat was tagged to silently fail.** Stardew Valley's `freeze-time` cheat (`src/core/cheat-system/games.ts`) was tagged `['toggle']` instead of `['command']`, despite `useGameCheatSession.ts`'s own doc comment explicitly listing it as one of the command-executed (non-memory-backed) cheats. It has no matching canonical `MemoryFeatureV1` (Stardew's bundled seed only defines 4 features, not `freeze-time`), so triggering it would fail closed with a confusing "unknown feature" error rather than being honestly presented as unsupported. Fixed by correcting the tag to `['command', 'toggle']`, matching the hook's already-documented intent.

Both fixes verified: both TypeScript configs green, full regression suite unchanged (2183 pass / 0 fail / 87 pre-existing environment-gated skips), Vite build green, Electron build (native scanner + tsup + output verifier) green.

## Explicitly NOT classified as PHASE4_BLOCKER

- **Int64 write exactness is schema-only, not end-to-end.** `TrainerProposeWriteFeatureSchema`/`TrainerProposeFreezeFeatureSchema` validate an exact `requestedValueBigint`/`valueBigint` decimal-string sibling, but the IPC handler never reads/forwards it, `TrainerRuntime.proposeWriteFeature`/`proposeFreezeFeature` take `number` only, and preload does not expose the bigint field to the renderer for writes at all. Traced to the actual root cause: `LiveMemoryDriver.writeMemory(handle, address, dataType, value: number)` (`native-memory-driver.ts:97,287`, `types.ts:92`) is a pre-existing Phase 2 native-driver primitive signature — `number`-only — that Phase 4 did not introduce and does not own. Only the memory **scan** path (a Phase 1/2 concern) is genuinely end-to-end exact. This is a documented boundary per mission §29, not a false certification: **int64 write exactness is NOT certified end-to-end**; roadmap ownership for upgrading `LiveMemoryDriver.writeMemory` to accept exact bigint values belongs to whichever phase next touches the native live-memory driver, not Phase 4.
- **Composite transactions unused in shipped UI** — fully implemented and wired end-to-end (core → IPC → preload), zero renderer call sites. Acceptable per mission §24 since no currently shipped composite feature requires it.
- **Toggle-off race has no executed test** — code inspection shows it's handled correctly (synchronous generation-counter invalidation before any await), but this repo has no React-hook test harness at all (no testing-library/jsdom dependency exists), so nothing exercises it end-to-end. Building new test infrastructure for one hook was judged out of scope for a Phase-4-owned fix pass; flagged as a tooling follow-up.
- **Recipe cross-identity-space auto-conversion** — correctly deferred to Phase 6 Trainer Creator territory per mission §26, already documented in `ROADMAP.md`.

## Defect recount

- P0: 0
- P1: 0
- PHASE4_BLOCKERS: 0
- Acceptable compatibility: composite-transactions-unused-in-UI, int64-write-boundary (documented, not silently claimed)
- Phase 5 deferrals: none newly identified
- Phase 6 deferrals: Recipe identity-space auto-conversion (pre-existing, reconfirmed)
- Tooling follow-up (not a certification gate): React-hook test harness for `useGameCheatSession` race coverage; ModPack canonical→export loss disclosure

## Regression / build evidence (this session, this exact worktree)

- `npx tsc --noEmit` — PASS (0 errors), before and after fixes.
- `npx tsc -p tsconfig.electron.json --noEmit` — PASS (0 errors), before and after fixes.
- `npm test` — 2260 + 10 tests, 2183 pass, 0 fail, 87 skipped (all pre-existing environment-gated: native fixture binary/process not available in this dev environment), before and after fixes — identical counts, no regression.
- `npm run build:vite` — PASS.
- `npm run build:electron` (native scanner + `build-scanner-napi-release` + `tsup` + `verify-electron-output.mjs`) — PASS.
- Full `electron-builder` packaging and the packaged real-process proof (§38-39 of the mission) were **not** rerun this session — none of the three fixes touch the canonical execution runtime/IPC surface that proof exercises (UI rendering, sync-report shape, and one cheat's catalog tag are all outside that path). Existing evidence in `009-p4-13-canonical-execution-convergence.md` stands. Recommend rerunning the packaged proof before the next release build as routine practice, not as a Phase 4 reopening.

## CI

This closeout will be pushed as a dedicated PR against `master`. Per mission instruction, do not merge on stale or local-only evidence — final certification is contingent on that PR's required checks (TypeScript/architecture, Windows native + Electron, Gitleaks, Semgrep/security, OSV/dependencies, verify) passing at its own head SHA. See the PR for live status.
