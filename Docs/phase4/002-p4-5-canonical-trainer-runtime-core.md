# P4-5 — Canonical Trainer Runtime Core

**Roadmap track:** external roadmap Phase 4 (trainer-model convergence), stage P4-5. Builds directly on [001-p4-2-canonical-schema-versioning.md](001-p4-2-canonical-schema-versioning.md).

## Scope

A thin orchestration layer (`src/core/trainer-runtime/`) that composes the
real, already-production `LiveMemorySession`/`MemoryManager` runtime through
an explicit lifecycle and typed results. No new memory scanning, pointer
resolution, AOB matching, or write/freeze implementation — every operation
that touches a process delegates to the existing live-memory layer.

## Stale audit note corrected

An earlier audit pass referenced a `checkExecutableRoleApplicability` Phase 3
API as the intended executable-role compatibility gate. **It does not exist
anywhere in this repository** (confirmed by exhaustive grep before writing
any code). The real, already-production mechanism for rejecting a
launcher/system/self/anti-cheat-protected process as a trainer target is
`assessTargetProcessAuthorization` + `assessProtectedTarget`
(`src/core/runtime/protected-target-guard.ts`), already invoked internally by
`LiveMemorySession.attach()`. `src/core/trainer-runtime/compatibility.ts`
composes the same exported functions for a pre-bind decision rather than
duplicating their logic or inventing new Phase 3 surface; `runtime.ts`'s
`bind()` step gets the module-scan-dependent protected-target enforcement for
free by calling the real `attach()` and classifying its result.

## Architecture

```
Canonical Trainer Definition (SolithDefinitionV1, via P4-2 migration pipeline)
  -> TrainerRuntime (state machine, feature bookkeeping)
  -> compatibility.ts (pre-bind: target authorization + fingerprint)
  -> action-executor.ts (dispatch: resolve / write / freeze / rollback)
  -> TrainerRuntimeCapabilities (interface)
  -> LiveMemoryCapabilities (thin adapter, ~20 lines, zero new logic)
  -> LiveMemorySession / MemoryManager (real, unmodified)
```

## Lifecycle

`UNLOADED -> LOADED -> VALIDATED -> COMPATIBILITY_CHECKED -> BOUND -> READY
<-> ACTIVE`, with `DEGRADED` (process loss, re-enters at `VALIDATED` for a
rebind) and `FAILED`/`DISPOSED` as terminal-ish states. No equivalent state
enum exists in `LiveMemorySession` itself (it tracks attach state via
nullable fields, not a named enum) — this is new, Phase-4-owned surface, not
a duplication of anything in live-memory. Transitions are validated by an
explicit table (`state.ts`); structural (lifecycle) failures move the whole
runtime to `FAILED`, while a single operation failing (one write, one
freeze-start) does not — the runtime can remain `READY`/`ACTIVE` for other
features, matching how `MemoryManager` itself never tears a session down
over one failed write.

## Migration integration

`TrainerRuntime.load()` always calls `migrateTrainerDefinition()` (P4-2) —
never a raw `parseSolithDefinitionV1`. Unknown future schema versions and
malformed input both fail closed into `FAILED` with a typed
`INVALID_SCHEMA`/`MIGRATION_FAILED` reason.

## Compatibility

- **Target authorization** (self/system/invalid-PID): `assessTargetProcessAuthorization`, pre-bind, no process handle needed.
- **Executable fingerprint** (full hash / hash-prefix): `verifyDefinitionFingerprint` + `fingerprintBlocksAttach`, pre-bind.
- **Executable role / protected-target** (anti-cheat, protected-online-runtime, DRM): `assessProtectedTarget`, inherently bind-time-only (needs the loaded module list) — enforced by calling the real `attach()` and classifying its result.
- **Ambiguity**: a declared fingerprint constraint that cannot be verified (no live hash available) is `'unsupported'`/fails closed — never silently treated as compatible. A definition with no fingerprint constraint declared at all is `'compatible'` (nothing to violate).

## Capability boundary

`TrainerRuntimeCapabilities` (`capabilities.ts`) mirrors
`LiveMemorySession`/`MemoryManager`'s own method names/signatures almost 1:1
— `attach`, `detach`, `verifyIdentity`, `resolveFeature`, `read`,
`proposeWrite`, `confirmWrite`, `rollback`, `proposeFreeze`, `freezeStart`,
`stopFreeze`, `getFreezeStatus`. The real adapter (`LiveMemoryCapabilities`)
is a pure pass-through. A fully deterministic test fake
(`tests/fixtures/fake-trainer-runtime-capabilities.ts`) implements the same
interface for precise failure-injection tests (capability-unavailable,
write/freeze/rollback failure) that would be awkward to force through the
real session's own state machinery.

## Action dispatch

Only the 5 real `MEMORY_FEATURE_TYPES` — `toggle`, `write_once`, `freeze`,
`scan_first`, `scan_unknown`. The latter two are never dispatched directly
(they require the Discovery Lab scan workflow, exactly matching
`feature-resolver.ts`'s own behavior) — attempting to resolve one returns a
typed `TARGET_RESOLUTION_FAILED`, not a crash. No composite/conditional/NOP
actions were invented; the canonical schema does not define them.
`SaveFieldFeatureV1` (save-file editing) is out of scope for this stage —
that subsystem (`trainer-host`) is not live-memory-backed and is not
composed into this runtime in P4-5.

## Target resolution

Delegates entirely to `LiveMemorySession.resolveMemoryFeature()` /
`feature-resolver.ts`'s existing module-relative, pointer-chain, and AOB
resolution. No new resolution logic. P2-5 structure-derived targets are not
wired in — no stable consumption contract exists yet from Phase 2 for them
(confirmed unconsumed by any trainer path in the P4 baseline audit).

## Transaction / write

`resolve -> propose -> confirm` exactly, with the confirm step accepting
either a legacy `userApproved` bypass (library/test callers) or a real
`consentToken`/`consentBinding` pair (obtained by a caller with access to the
native consent dialog — out of this module's scope). The underlying write
stays entirely owned by `MemoryManager`/`LiveMemorySession`; no direct
native-memory call exists in `trainer-runtime/`.

## Freeze

`proposeFreeze -> freezeStart`, through the real single-freeze-per-session
API. Freeze has **no legacy-approval bypass** — `MemoryManager.freezeStart`
always requires a real consent token, and `activateFreezeFeature`'s
signature reflects that (no `WriteApproval` union, token-only).

## Rollback

Thin pass-through to `MemoryManager.rollback()`, which itself only restores
a write the same session actually confirmed (looked up server-side, never
caller-supplied). Stale/unknown proposal IDs and expected-value mismatches
surface as typed `INVALID_STATE_TRANSITION`/`ROLLBACK_FAILED` failures.

## Process loss

`handleProcessLoss()` stops any active freeze, marks every resolved feature
`stale` and every activation `inactive`, and moves the runtime to
`DEGRADED`. `verifyProcessStillBound()` calls the real
`LiveMemorySession.verifyAttachedProcessIdentity()` (the same reactive check
the real system already performs before every write/rollback/freeze-tick) —
no new process-exit watcher was built; none existed to reuse, and inventing
proactive polling was out of scope. Rebind requires
`recheckCompatibilityAfterLoss()` (`DEGRADED -> VALIDATED -> COMPATIBILITY_CHECKED`)
before `bind()` can run again — a stale compatibility decision can never be
silently reused.

## Failure taxonomy

`INVALID_SCHEMA`, `MIGRATION_FAILED`, `SEMANTIC_INVALID`,
`INCOMPATIBLE_GAME`, `INCOMPATIBLE_EXECUTABLE`, `EXECUTABLE_ROLE_REJECTED`,
`IDENTITY_AMBIGUOUS`, `CAPABILITY_UNAVAILABLE`, `TARGET_RESOLUTION_FAILED`,
`CONSENT_REQUIRED`, `AUTHORIZATION_FAILED`, `WRITE_FAILED`, `FREEZE_FAILED`,
`ROLLBACK_FAILED`, `PROCESS_LOST`, `INVALID_STATE_TRANSITION`, `DISPOSED`,
`UNSUPPORTED_ACTION`. `classifyLiveMemoryErrorString()` (`errors.ts`) is the
single source of truth mapping live-memory's free-text error strings onto
these reasons — every call site uses it instead of re-deriving its own
mapping.

## Injection isolation

`action-executor.ts` and `runtime.ts` contain zero references to
`src/core/in-process-script/` (verified by both direct code review during
design and an automated test asserting neither file's source text mentions
`in-process-script`). The quarantined hook/injection subsystem remains
reachable only through its own dedicated Electron IPC channels, unchanged.

## Tests

| Command | Tests | Result |
|---|---|---|
| `npx tsc --noEmit` | — | PASS |
| `npx tsc -p tsconfig.electron.json --noEmit` | — | PASS |
| `npm run test:trainer-runtime` (new) | 32 | 32/32 pass |
| `npm run test:definitions` | 124 | 124/124 pass |
| `npm run test:trainer-catalog` | 204 | 204/204 pass |
| `npm run test:trainer-schema` | 36 | 36/36 pass |
| `npm run test:v2-lifecycle` | 56 | 56/56 pass |
| `npm run test:cheat-toggle` | 27 | 27/27 pass |
| `npm run test:lifecycle-wiring` | 22 | 22/22 pass |
| `npm run test:command-runner` | 14 | 14/14 pass |
| `npm run test:in-process` | 9 | 9/9 pass |
| `npm run test:game-profile` | 49 | 49/49 pass |
| `npm run test:v1` | 210 | 210/210 pass |
| `npm run verify:schema-v1-boundaries` | — | PASS |
| `npm run test:trainer-host` | — | **NOT RUN** — requires native `build:electron`; untouched by this mission's scope |

New coverage (`tests/trainer-runtime.test.ts`, `tests/trainer-runtime-integration.test.ts`)
covers the full required matrix: loading (P4-2 integration, legacy migration,
unknown-version rejection), state-machine legality, semantic validation,
compatibility (accept/role-reject/fingerprint-reject/ambiguous-fail-closed),
capability availability + no-mutation-on-failure, resolution (incl.
scan-type rejection), write propose/confirm/failure/rollback-reference,
freeze start/stop/capability-unavailable, rollback success/stale/failure,
process-loss + stale-action-prevention + rebind-requires-recheck, and
injection isolation — plus one full integration test driving the real
`LiveMemorySession`/`MemoryManager` (backed by the existing `FakeMemoryDriver`
test fixture, not a new fake) through load → bind → write → rollback →
dispose, proving the capability adapter is a genuine composition, not a
parallel implementation.

## Scope contamination check

- Phase 2 implementation modified: NO
- Phase 3 classifier modified: NO (the stale-audit `checkExecutableRoleApplicability` reference was corrected in docs, not "fixed" in code, since it never existed)
- P2-5 structure-discovery internals modified: NO
- CT deep-compatibility (Phase 5) work: NO
- Trainer Creator (Phase 6) work: NO
- P4-4 legacy retirement (ModPack/GameConfig/Recipe/GameProfile): NOT started
- Destructive cleanup: NO
- Files touched: `src/core/trainer-runtime/**` (new), `package.json` (test script wiring), `tests/trainer-runtime.test.ts` / `tests/trainer-runtime-integration.test.ts` / `tests/fixtures/fake-trainer-runtime-capabilities.ts` (new), this document.
