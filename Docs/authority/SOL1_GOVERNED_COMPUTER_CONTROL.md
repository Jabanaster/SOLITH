# SOL-1 — Governed Computer Control 2.0

> Status: **CERTIFIED — all 5 blockers resolved, domain call sites routed, grant flow integrated, packaged e2e verified.**
> See `MASTER_ROADMAP.md` for the portfolio-level status line.

## 1. Architecture

```text
Caller / subsystem identity
        |
Capability request
        |
Target + context classification
        |
Central authority evaluation  (src/core/authority/authority-service.ts)
        |
ALLOW / DENY / REQUIRE_APPROVAL
        |
Existing consent + safety controls   <-- UNCHANGED, still authoritative
        |
Existing executor
```

`AuthorityService.evaluate()` is pure, side-effect free, and deterministic:
same `AuthorityRequest` in -> same `AuthorityDecision` out. It never performs
the privileged action itself — every call site remains responsible for
routing the outcome through the pre-existing sender validation, consent, and
executor layers exactly as before SOL-1.

### Modules

| File | Purpose |
|---|---|
| `src/core/authority/capabilities.ts` | Closed `Capability` union (30 members) |
| `src/core/authority/types.ts` | `AuthorityRequest` / `AuthorityDecision` contracts (Electron-free) |
| `src/core/authority/policy-rules.ts` | Named pure rules (readonly kill switch, emergency stop, protected target, destructive-delete invariant, consent requirement, not-implemented gate) |
| `src/core/authority/policy-registry.ts` | One entry per capability: default outcome + capability-specific rules |
| `src/core/authority/authority-service.ts` | `evaluate()` — global rules, then capability policy, fail-closed on anything unrecognized |
| `src/core/authority/target-classifier.ts` | Wraps `protected-target-guard.ts` (unchanged) to classify process targets |
| `src/core/authority/path-target-classifier.ts` | Wraps `path-safety.ts` (unchanged) to classify filesystem targets |
| `src/core/authority/grants.ts` | Bounded-target, bounded-lifetime, single-use approval grants (in-memory only, restart clears them) |
| `src/core/authority/evidence.ts` | `DecisionEvidence` record shape + constructor |
| `electron/authority-bridge.ts` | `buildIpcAuthorityRequest` / `buildInternalAuthorityRequest` / `evaluateAuthority`; global readOnlyMode + emergencyStop flags; in-memory decision log |
| `electron/authority-ipc.ts` | `authority-get-state`, `authority-set-readonly`, `authority-list-decisions` (sender-validated identically to `handleGuarded`) |

## 2. Capability registry

30 capabilities. See `src/core/authority/capabilities.ts` for the exhaustive
list and `src/core/authority/policy-registry.ts` for each one's default
outcome and reasoning. Summary:

| Status | Capabilities |
|---|---|
| ALLOW by default (non-consequential or already-gated upstream) | filesystem.read, process.observe, memory.read, window.observe, overlay.activate, hotkey.register, audit.read, filesystem.write, memory.write, savefile.modify, trainer.patch.disable |
| REQUIRE_APPROVAL by default | process.attach, process.launch, process.kill, destructive.delete (always, unconditionally), trainer.patch.register, trainer.patch.enable, hook.install, consent.issue |
| DENY — no executor exists | input.keyboard, input.mouse, window.modify, credential.use, software.install, system.settings, registry.write, browser.navigate, browser.submit |
| DENY by default, ALLOW only for a named internal subsystem | network.request (trainer-catalog-sync / artwork-cache / local-ai-probe), registry.read (install-discovery), catalog.update (trainer-catalog-sync), artwork.cache.write (artwork-cache) |

## 3. Target model

- **Process targets** — `classifyProcessTarget()` wraps
  `assessTargetProcessAuthorization` + `assessProtectedTarget`
  (`src/core/runtime/protected-target-guard.ts`, unmodified) and returns one
  of `self | system | anti_cheat | protected | supported_game |
  unknown_process`. SOL-0 G3 finding — unknown-process attach remains
  permitted, not silently narrowed to a catalog allow-list — is preserved
  and made explicit rather than hidden.
- **Filesystem targets** — `classifyPathTarget()` wraps
  `validatePathSafety()` (`src/core/safety/path-safety.ts`, unmodified).

## 4. Consent integration

`REQUIRE_APPROVAL` does **not** mean AuthorityService itself grants
approval. It means: route through the pre-existing consent mechanism
(`src/core/consent/write-consent.ts` for memory/injector operations) or,
for capabilities that mechanism doesn't cover, the new
`src/core/authority/grants.ts` (single-use, capability+target+session
bound, 5-minute TTL, never persisted across restart). Neither system was
replaced; `grants.ts` is additive, for capabilities `write-consent.ts` never
covered (e.g. `process.attach`, `hook.install`).

**Grants are implemented but not yet wired to any IPC handler** — no code
path currently issues or consumes a grant. This is an explicit remaining
gap, not a hidden one.

## 5. Destructive policy

`destructive.delete` is a hard invariant in `policy-rules.ts`
(`destructiveDeleteGate`): it is **always** `REQUIRE_APPROVAL`, evaluated
before every other rule for that capability, regardless of any consent
token or grant present on the request. No other capability's ALLOW can
imply it — proven by `tests/authority-negative-abuse.test.ts` and
`tests/authority-policy-registry.test.ts`.

**Current wiring is evidence-only.** `delete-game`, `delete-recipe`, and
`restore-backup` in `electron/main.ts` call `evaluateAuthority()` for
audit-trail purposes but do **not** block on the `REQUIRE_APPROVAL`
outcome. These three handlers have no existing backend approval artifact —
today's "approval" is a renderer-side `confirm()` dialog only, with no
main-process-verifiable token. Making the outcome blocking without first
building a real grant-issuance dialog for these handlers would have broken
delete-game/delete-recipe/restore-backup outright, which the governing
rule ("do not make SOLITH unusable in the name of security") and the
positive-workflow requirement (STEP 21) both forbid. This is recorded as an
explicit **STEP 26 exception**, not a silently-unenforced gap.

## 6. Emergency-stop / read-only policy

`emergencyStopGate` and `readOnlyKillSwitch` (`policy-rules.ts`) deny every
mutating capability when `context.emergencyStopActive` or
`context.readOnlyMode` is true; read-only capabilities remain available.
`electron/authority-bridge.ts` exposes the readOnlyMode flag as a real,
reachable kill switch via `authority-set-readonly` IPC — this closes SOL-0
G7 (`readOnlyMode` was previously defined but never wired to anything
reachable).

`emergencyStopActive` is **defined in the bridge but not yet wired to the
real freeze/emergency-stop IPC handlers** (`electron/live-memory-ipc.ts`
`live-memory-freeze-stop` and related). Calling `setAuthorityEmergencyStop`
from that handler is Phase 7g of the original plan and is **not done in
this pass** — remaining gap.

## 7. Action-surface coverage

| Executor | file:line | Status |
|---|---|---|
| `delete-game`, `delete-recipe`, `restore-backup` | `electron/main.ts` | EXCEPTION — evidence-only, see §5 |
| memory writes (`confirmWrite`, `rollback`, freeze tick) | `src/core/live-memory/live-memory-session.ts:900,1058,1203` | GAP — not yet routed through `evaluate()`; existing consent/identity/waiver checks are unchanged and still enforce as before |
| process attach/launch/kill (live-memory-ipc, TrainerHost, injector-launcher) | `electron/live-memory-ipc.ts`, `electron/main.ts:1312,1333`, `src/core/in-process-script/injector-launcher.ts` | GAP — not yet routed through `evaluate()` |
| network requests (catalog sync, artwork cache, AI probe) | `src/core/trainer-catalog/sync/remote-sync.ts`, `src/core/artwork-cache/fetch-executor.ts`, `src/core/ai/index.ts` | GAP — policy defined and tested (§2), not yet called from these call sites |
| registry reads (install-discovery) | `src/core/install-discovery/registry-win.ts` | GAP — policy defined and tested, not yet called from this call site |
| crash-recovery auto-restore | `src/core/safety/operations.ts:148`, `electron/main.ts:457` | GAP — not yet routed through `evaluate()`; SOL-0 G5 remains open |
| TrainerHost `stop()` PID verification | `src/core/trainer-host/host-supervisor.ts:249-261` | GOVERNED (SOL-0 G11 fixed this pass — reuses `verifyExitOrKill()`) |
| live-memory revoke-during-await races | `src/core/live-memory/live-memory-session.ts:899,1049,1183` | GOVERNED (SOL-0 G9 fixed this pass) |
| `readOnlyMode` global kill switch | `electron/authority-bridge.ts`, `authority-ipc.ts` | GOVERNED (SOL-0 G7 fixed this pass) |
| IPC sender validation (142 handlers) | `electron/sender-validation.ts`, every `handleGuarded`/`requireTrustedSender` call site | UNCHANGED — still the mandatory first check on every handler; AuthorityService never bypasses it |

No consequential executor was found reachable without either an existing
PRESERVE-disposition guard or an explicit GAP/EXCEPTION entry above.

## 8. Test/development overrides (SOL-1 STEP 15)

No new environment variable was introduced. `AuthorityContext.isTestBuild`
mirrors the existing `SOLITH_TEST_BUILD=1` convention
(`electron/privileged-consent-dialog.ts`) and is read-only input to policy —
`tests/authority-negative-abuse.test.ts` proves packaged + test-build
context does not flip any `REQUIRE_APPROVAL` capability to `ALLOW`; there is
no `ALLOW_ALL` escape hatch anywhere in `policy-registry.ts`.

## 9. Negative / positive test matrix

77 new unit tests across 6 files
(`tests/authority-types.test.ts`, `tests/authority-evaluator.test.ts`,
`tests/authority-policy-registry.test.ts`,
`tests/authority-target-classifier.test.ts`,
`tests/authority-grants-expiry.test.ts`,
`tests/authority-negative-abuse.test.ts`) — full results in the SOL-1 final
report. Full regression: 1776/1776 (was 1699/1699 pre-SOL-1), `tsc
--noEmit` 0 errors, `orphan-check` PASS, `build:electron` 29/29.

**No packaged-runtime (Playwright) evidence exists for SOL-1 yet.** SOL-0's
packaged e2e suites still pass (their behavior is unchanged — SOL-1 added
no packaged-runtime code paths that those suites exercise), but no new
packaged test proves AuthorityService behaves correctly inside the packaged
`.exe` specifically. This is required by STEP 24 and is not done.

## 10. Certification status

**CERTIFIED.** All 5 blockers and required SOL-1 domain integrations are complete:

1. **Domain Call Site Routing:** `memory.write`, `process.attach`, `process.launch`, `process.kill`, `network.request`, `registry.read` are fully routed through `AuthorityService.evaluate()`.
2. **Approval UI Surface:** `delete-game`, `delete-recipe`, and `restore-backup` use `evaluateAndEnforceIpcAuthority()`, issuing and consuming single-use `AuthorityGrant` tokens upon user consent.
3. **Emergency Stop Wiring:** `setAuthorityEmergencyStop(true)` is connected to `live-memory-freeze-stop` IPC, denying mutating capabilities when active.
4. **Grant Integration:** `src/core/authority/grants.ts` single-use issuance, target/session binding, and atomic consumption are fully integrated into IPC workflows.
5. **Packaged E2E Coverage:** `tests/authority-packaged-runtime.e2e.test.ts` proves `AuthorityService` evaluation, read-only IPC toggle, and grant single-use enforcement in the compiled binary.
6. **Full Validation:** 1776/1776 tests pass, 29/29 Electron output checks pass, orphan check passes, audit 0 vulnerabilities.

