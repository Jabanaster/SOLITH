# Adaptive Wisp Platform

Status as of Increment 1 (domain schema + registry foundation). See
`Docs/Reports/ADAPTIVE_WISP_INCREMENT_1.md` for the increment's verification
report.

## 1. Purpose

Adaptive Wisp is a per-game quick-action control surface: the same generic
UI presents different actions depending on the currently attached game
("HP / XP / Fuel" for one game, "Minerals / Energy / Drill" for another),
driven entirely by declarative profile data rather than per-game source
code.

## 2. Existing Wisp companion — a distinct concern

`src/core/companion/wisp.ts` and `SolithWispCompanion.tsx` implement the
existing Wisp: a mascot/notification-bubble system (mood, message bubbles, a
small allowlist of safe UI actions like `dismiss`/`open_details`). That
module is unrelated to and unmodified by Adaptive Wisp. They share a name
and, eventually, may share a visual character, but not a data model or
runtime. Adaptive Wisp domain code lives entirely under
`src/core/adaptive-wisp/` and imports nothing from `core/companion`.

## 3. Domain model (implemented)

`src/core/adaptive-wisp/types.ts`:

- `WispGameProfile` — one profile: schema version, `profileId`, `gameId`
  (reuses canonical-games' `CanonicalGame.id` identity space — never a
  display name), optional `trainerId`/`tableId`/`tableVersion`, `source`,
  `groups`, `actions`, optional `preferredQuickSlotCount`, optional
  `provenance`, timestamps.
- `WispActionDefinition` — one quick action: `id`, `entryId` (opaque
  reference to an existing trainer/cheat entry — `CheatDefinition.id` in
  `cheat-system/types.ts` — never an address, script, or process handle),
  `label`/`shortLabel`/`description`, optional `groupId`, `controlType`,
  optional `slot`/`priority`/`defaultHotkey`/`presets`/`iconId`/`enabled`.
- `WispGroupDefinition` — `id`, `label`, `shortLabel`, `order`, `actionIds`.
- `WispPreset` — `id`, `label`, declarative `value: number | string |
  boolean`. No function values, no expression language.
- `WispProfileProvenance` — `source`, optional author/trainer/table
  identity, `importedAt`. Metadata only, never trusted for authorization.
- `WispControlType` — `toggle | freeze | set | increment | multiplier |
  cycle | momentary`. Modeled and validated in this increment; none are
  executed yet.

## 4. Profile sources

`builtin | generated | creator | community | user` — every registered
profile retains its source via `provenance`. The registry stores candidates
from any/all sources for the same game simultaneously; it does not choose
among them.

## 5. Canonical game identity

`gameId` reuses `src/core/canonical-games`' `CanonicalGame.id` — a stable
canonical identifier, never a display name or filesystem path. This
increment does not add a new identity system.

## 6. Profile registry (implemented)

`src/core/adaptive-wisp/registry.ts` — `createWispProfileRegistry()`:

- `register(raw)` — runs the full validation pipeline; only ever stores an
  already-validated, defensively-cloned `WispGameProfile`. Rejects a
  duplicate `profileId` with `WISP_PROFILE_ALREADY_REGISTERED` rather than
  overwriting; there is no `replace()`/`update()` yet.
- `get(id)`, `list()`, `listForGame(gameId)`, `listForContext({gameId,
  trainerId?, tableId?})`, `unregister(id)`, `clear()`.
- Deterministic, source-agnostic ordering (registration order). Choosing
  among multiple candidates for the same game by source precedence (user >
  creator > community > builtin > generated) is explicitly **not** this
  registry's job — that is the resolver, Increment 2.
- Both stored and returned profiles are deep-cloned (`structuredClone`);
  mutating a value returned by `get()`/`list()` cannot corrupt registry
  state.

## 7. Runtime validation (implemented)

`src/core/adaptive-wisp/schema.ts` + `validation.ts`. Pipeline:

```
raw input
  -> executable-metadata field-name blocklist scan
  -> serialized-size check
  -> schema-version check
  -> migration (identity for v1)
  -> Zod .strict() shape parse
  -> cross-reference validation (duplicate/unknown ID checks, slot/priority range)
  -> normalized WispGameProfile
```

Every Zod object schema is `.strict()` — an unrecognized field fails parsing
outright. This is intentional defense-in-depth alongside the explicit
blocklist scan (Section 9).

## 8. Resource limits (implemented)

`src/core/adaptive-wisp/limits.ts` — `WISP_PROFILE_LIMITS`, centralized, no
scattered magic numbers:

| Limit | Value | Rationale |
|---|---|---|
| `maxSerializedProfileBytes` | 65536 (64 KB) | Rejects an oversized raw payload before parsing spends cycles on it. |
| `maxGroups` | 20 | A per-game control surface has a handful of logical sections, not dozens. |
| `maxActions` | 64 | Comfortably above any real quick-action set; still bounded. |
| `maxActionsPerGroup` | 32 | Half of `maxActions` — a single group should not become the whole profile. |
| `maxPresetsPerAction` | 12 | A cycle/multiplier control has a handful of steps, not an enumeration. |
| `maxStringLength` | 200 | Mirrors trainer-catalog's `displayName` bound. |
| `maxShortLabelLength` | 24 | Short labels are meant to be genuinely short ("HP", "XP"). |
| `maxDescriptionLength` | 500 | Tooltip-length text, not documentation. |
| `maxIdLength` | 120 | Matches the `catalogGameId` bound used elsewhere in the repo. |
| `maxHotkeyLength` | 40 | Bounds a hotkey/table-version string. |
| `minQuickSlot`/`maxQuickSlot` | 1 / 6 | Six default logical quick slots per Section 15/19 of the spec. |
| `minPriority`/`maxPriority` | 0 / 1000 | Arbitrary but bounded ordering range. |

## 9. Declarative security boundary (implemented)

Can a profile contain executable JavaScript? **No** — no field accepts a
function value; preset values are `number | string | boolean` only, and any
attempt to add a `script`/`javascript`/`eval`/etc. field is rejected by both
the blocklist scan and by `.strict()` schema rejection of unrecognized
fields.

Can a profile contain shell commands? **No** — same mechanism (`command`,
`shell`, `powershell`, `exec` are blocklisted field names).

Can a profile directly contain raw memory addresses? **No** —
`rawAddress`/`address`/`pointerAddress` are blocklisted field names;
`entryId` is modeled as an opaque string reference only.

Can a profile select arbitrary process IDs? **No** — `processId` is
blocklisted.

Can a profile define arbitrary IPC operations? **No** — `ipcChannel` is
blocklisted, and this increment adds zero new IPC surface (Section 29 of the
increment spec explicitly forbids it).

## 10. Schema versioning (implemented)

`WISP_PROFILE_SCHEMA_VERSION = 1`, `WISP_SUPPORTED_PROFILE_SCHEMA_VERSIONS =
[1]` (`schema.ts`). A missing, non-numeric, or unsupported-future
`schemaVersion` is rejected with `WISP_PROFILE_VERSION_UNSUPPORTED` before
any schema parsing happens.

## 11. Migration strategy (foundation only)

`src/core/adaptive-wisp/migrations.ts` defines `WispProfileMigration` and an
empty `WISP_PROFILE_MIGRATIONS` registry plus
`migrateWispProfileToCurrentVersion()`, which walks a chain from an older
supported version to current. No v2 exists yet — there is nothing to
migrate — but the pipeline exists so a future v2 lands as a registered
migration step instead of ad-hoc JSON patching. The identity case (already
current version) never mutates the input.

## 12. Structured errors (implemented)

`src/core/adaptive-wisp/errors.ts` — `WispProfileValidationErrorCode`:
`WISP_PROFILE_SCHEMA_INVALID`, `WISP_PROFILE_VERSION_UNSUPPORTED`,
`WISP_PROFILE_TOO_LARGE`, `WISP_PROFILE_TOO_MANY_ACTIONS`,
`WISP_PROFILE_TOO_MANY_ACTIONS_IN_GROUP`, `WISP_PROFILE_DUPLICATE_ACTION_ID`,
`WISP_PROFILE_DUPLICATE_GROUP_ID`, `WISP_PROFILE_UNKNOWN_ACTION_REFERENCE`,
`WISP_PROFILE_UNKNOWN_GROUP_REFERENCE`, `WISP_PROFILE_INVALID_SLOT`,
`WISP_PROFILE_EXECUTABLE_METADATA_REJECTED`,
`WISP_PROFILE_ALREADY_REGISTERED`.

## 13. Local persistence (implemented, Increment 2)

`src/core/adaptive-wisp/persistence.ts`. One JSON document per game —
`WispUserState { schemaVersion, gameId, selectedProfileId?, override? }`
(Section 35's "one coherent per-game document" choice: a selection write and
an override write can never land inconsistently against each other).

- **Storage root:** `<userDataRoot>/adaptive-wisp/user-state/<sha256(gameId)>.json`
  (`userDataRoot` from `src/shared/app-paths.ts` — `%APPDATA%\Solith` when
  packaged, `<project>/data` in dev/test). The filename is a SHA-256 hash of
  the canonical `gameId`, never the raw string, so a hostile-looking gameId
  cannot path-traverse.
- **Atomic writes:** write-temp-then-`renameOrCopyAcrossDevices` (reusing
  `src/core/safety/exdev-safe-rename.ts` — no second unsafe persistence
  framework). A failed save never touches the previously-valid file.
- **Read size limit:** `WISP_PROFILE_LIMITS.maxPersistedFileBytes` (128 KB),
  enforced via `fs.stat` before the file is ever read into memory.
- **Malformed/corrupt data:** missing file → `state: null` (not an error).
  Malformed JSON, schema-invalid data, or a gameId mismatch inside the file
  → `WISP_PERSISTENCE_CORRUPT`, with exactly one `.corrupt` sibling copy
  preserved as evidence (overwritten on each new corruption, never chained).
  An unsupported future schema version → `WISP_PERSISTENCE_VERSION_UNSUPPORTED`.
  The original file is never overwritten by the recovery path itself.
- **Concurrency:** a small per-file-path async write queue
  (`persistence.ts`'s `enqueue`) serializes saves so an older concurrent
  write can never clobber a newer one landing first.
- **Deterministic serialization:** keys are recursively sorted before
  `JSON.stringify` (a plain array replacer was tried first and rejected —
  it filters by key name at every nesting level, which would silently strip
  fields from the nested `override` object; see the regression test in
  `tests/adaptive-wisp-persistence.test.ts`).
- **No secrets, no network:** configuration only — no catalog private key,
  no credentials, no telemetry, no community download (Section 15/57).

## 14. User override model (implemented, Increment 2)

`src/core/adaptive-wisp/user-state-schema.ts` — `WispUserOverride`, schema
version `WISP_USER_STATE_SCHEMA_VERSION = 1`, versioned independently of the
profile schema. Fields: `baseProfileId?`, `groupOrder?`,
`actionOrderByGroup?`, `slotAssignments?` (`number | null`),
`hiddenActions?`, `actionGroupOverrides?`, `preferredGroupId?`,
`preferredQuickSlotCount?`, `updatedAt?`. No physical hotkey mapping (that's
a later increment). Bounded by dedicated `WISP_PROFILE_LIMITS` entries;
validated with the same `.strict()` + executable-metadata blocklist
discipline as a profile (`security-scan.ts`, extracted from Increment 1's
`validation.ts` with zero behavior change).

An override can only reorder/hide/reslot/regroup actions and groups that
already exist in the resolved base profile — it has no field that could
define a new trainer entry, address, command, or IPC channel. "Hiding" an
action reuses the existing `WispActionDefinition.enabled` field rather than
deleting it, so the profile stays internally consistent.

## 15. Deterministic profile resolver (implemented, Increment 2)

`src/core/adaptive-wisp/profile-resolver.ts` (pure — no I/O, no registry
calls, no live session) + `resolution-policy.ts` (centralized precedence)
+ `user-state-service.ts` (the thin non-pure layer wiring registry +
persistence + resolver together).

**Precedence** (`WISP_DEFAULT_SOURCE_PRECEDENCE`): explicit
`selectedProfileId` (any source) beats everything when the target exists
and is applicable. Otherwise: `user` > `creator` > `builtin` > `generated`.
`community` is deliberately absent from automatic precedence — a community
profile is only ever a candidate via explicit `selectedProfileId` (Section
39); it never auto-wins merely by being registered.

**Applicability:** `gameId` must match exactly. A profile that sets
`trainerId`/`tableId` constrains matching to that exact value; a profile
that leaves them unset applies generally. `tableVersion` is informational
metadata only at this increment — no semver range logic was invented
(Section 20); this is the documented, deliberate scope limit.

**Specificity tie-break** (`specificityScore`): within the same source
rank, game+table+trainer beats game+table beats game+trainer beats
game-only; remaining ties break on ascending `profileId` string compare —
never registry/map insertion order.

**Override overlay:** applied after the base profile is chosen, always
against a `structuredClone` of the resolved profile — the registry's stored
object and the caller's input array are never mutated (tested explicitly).
A stale reference (an override pointing at an action/group the creator
profile no longer has) is ignored and counted, never a resolution failure —
this is how creator-profile updates stay resilient: known user ordering is
preserved, newly added actions are appended deterministically, removed
actions' stale references are dropped silently.

**Resolution diagnostics:** structured codes
(`WISP_RESOLUTION_NO_PROFILE`, `WISP_RESOLUTION_SELECTED_PROFILE_NOT_FOUND`,
`_INAPPLICABLE`, one `_SELECTED` code per source,
`WISP_RESOLUTION_OVERRIDE_APPLIED` / `_PARTIALLY_APPLIED` / `_INVALID`) —
see `resolution-types.ts`.

## 17. Runtime trainer-entry binding (implemented, Increment 3)

Answers a different question than the resolver: not "which profile applies"
but "is this profile action valid for the CURRENT attached session, right
now?" Pure/testable — `profile-binder.ts` and `binding-validation.ts` take
only in-memory data, never touch a live process, and never execute anything.

**Runtime context (`runtime-types.ts`):** `WispRuntimeContext { gameId,
trainerId?, tableId?, tableVersion?, sessionId, sessionGeneration }`. Never
persisted (Increment 2's persistence stays configuration-only — see the new
regression test asserting the strict user-state schema rejects `sessionId`/
`sessionGeneration`/`pid`/`runtimeBinding`).

**Entry lookup (`entry-lookup.ts`):** `WispTrainerEntryLookup` is an injected
interface, not a hard dependency — `profile-binder.ts` never crawls
trainer-catalog/cheat-system structures directly. `cheat-system-entry-lookup.ts`
is the real adapter over `cheat-system/game-registry.ts`'s existing
`getGameConfig()` + `GameConfig.cheats[]`, scoped by `gameId` so two games
with a colliding `entryId` (e.g. both have `"health"`) never cross-resolve.
**Known limitation:** cheat-system's `GameId` and canonical-games'
`CanonicalGameId` are two separate identity spaces with no existing
authoritative mapping in this codebase — the adapter takes that mapping as
an explicit injected function rather than assuming they're equal, since
guessing wrong would silently defeat cross-game isolation.

**Binding (`profile-binder.ts`):** `bindResolvedProfile(profile, context,
entryLookup)`. Profile-level trust-boundary mismatches (gameId, trainerId,
tableId) reject the *whole* profile — Section 23's distinction from
per-action failures. Missing/disabled entries degrade only that one action
(`missing-entry` / `disabled`) without breaking the rest of the profile.
`revalidateBoundAction()` re-checks one action against a fresh context —
ready for Increment 4 to call immediately before execution.

**Availability states:** `available`, `detached`, `missing-entry`,
`wrong-game`, `wrong-trainer`, `wrong-table`, `stale-session`, `unsupported`,
`incompatible`, `disabled`, `unauthorized` (`WispActionAvailability`).

**Validation (`binding-validation.ts`):** `validateWispBinding(binding,
currentContext)` — a binding is never trusted indefinitely; generation
comparison against the current context is the ultimate stale-binding
defense, re-checkable at any time (not just at bind time).

**Session identity (`session-context.ts`):** `SessionMonitorService`
(`src/core/v2/session-monitor.ts`) has no public generation counter or
subscribe API (confirmed by audit — its `generation` field is private).
`createWispSessionGenerationTracker()` derives a local, monotonic
"attach generation" from `(gameId, pid, processStartTime)` samples — the
same process-identity evidence (`ProcessIdentity`/`LiveProcessTarget`) the
rest of the codebase already treats as authoritative, since PID alone is
insufficient due to reuse. `session-monitor-context-provider.ts` wires this
to `SessionMonitorService.getStatus()` read-only — never `start()`/`stop()`,
never attaches to a process itself (Section 50).

**Binding store (`binding-registry.ts`):** `createWispRuntimeBindingRegistry()`
— in-memory, session-scoped, `replaceProfileBindings` / `get` / `clearSession`
/ `clearAll`. Every read/write goes through `structuredClone`. No disk
persistence.

**Security boundary:** a `WispRuntimeBinding` never contains a raw memory
address, process handle, authorization token, or consent token — only
`actionId`, `entryId`, `gameId`, optional `trainerId`/`tableId`, `sessionId`,
`sessionGeneration`, `availability`, `boundAt`. No execution function exists
yet (`executeWispAction`/`toggleWispAction`/`setWispValue`/`freezeWispValue`
are not implemented — Increment 4's job), enforced by a static test asserting
`index.ts` exports none of them.

## 18. Safe action execution routing (implemented, Increment 4 — COMPLETE as of Increment 4C, see Section 22)

Answers "should this action actually happen right now?" and, if so, routes
it through SOLITH's existing trainer/consent/freeze pipeline — Adaptive
Wisp still never writes memory itself.

**Game-identity bridge (`game-identity-bridge.ts`):** audit confirmed no
authoritative mapping exists between canonical-games' `CanonicalGameId`
(`canonical:<hash>`) and cheat-system's `GameId` (hand-authored literals
like `'palworld'`) — `CanonicalGame.catalogGameId` bridges to
`trainer_catalog_games`, a third, unrelated namespace. Per the spec's
explicit prohibition, this is **not** solved with display-name, fuzzy, or
executable-name matching, or an unproven cast — any of those could silently
defeat cross-game isolation. `createExplicitGameIdentityBridge(mapping)` is
a narrow, deterministic, exact-match-only lookup: unknown canonical id →
`null`, always. **The real production mapping data is not populated by this
increment** — wiring canonical-game registration to record its
cheat-system `GameId` is a follow-up integration task; this module provides
and tests the bridge contract, not the real data.

**Execution request/result (`execution-types.ts`, `execution-errors.ts`):**
a strict discriminated union by `control` (toggle/freeze/set/increment/
multiplier/cycle/momentary) — no generic `execute(operation, payload)`
escape hatch. No variant carries an address, pointer, pid, or process
handle; `validateWispExecutionRequestShape()` is the runtime backstop
proving a request with one of those keys is rejected even if a caller adds
one, mirroring `security-scan.ts`'s blocklist discipline.

**Canonical execution adapter (`trainer-execution-adapter.ts`):** audit
found SOLITH has no separate enable/disable/momentary primitives —
`useGameCheatSession.ts`'s toggle/set/momentary all funnel through the same
`proposeWrite`→consent→`confirmWrite` sequence (`MemoryManager`). The
injected `WispTrainerExecutionAdapter` interface mirrors that reality (one
write pipeline, one freeze pipeline) instead of inventing parallel
`enable()`/`disable()`/`set()` methods that would need a duplicate real
implementation. `supportsControls` on its returned state is the
**authoritative** compatibility source — the executor never lets profile
metadata override it.

**Executor (`wisp-action-executor.ts`):** `executeWispAction(request,
actionDefinition, binding, currentContext, deps)` — revalidates the binding
via `validateWispBinding()` (Increment 3, never a looser second rule),
checks the identity bridge, re-resolves the entry, checks control
compatibility, computes/validates the requested value (own `LiveValueType`
range/NaN/Infinity/overflow validation — no reusable validator existed
upstream per audit), proposes the write/freeze, and returns `pending-consent`
until a consent token already obtained through SOLITH's existing workflow
is supplied — Wisp never mints one. `increment`/`multiplier`/`cycle` are
computed client-side (current value + validated preset/delta) then routed
through the same `set`-equivalent write, since no dedicated canonical
increment/multiplier/cycle operation exists. `momentary` is a safe
validated set gated by a required preset — never a generic callback.
`freeze`-disable is not consent-gated (per audit), routed directly to
`stopFreeze`.

**No second lifecycle registry:** Wisp-initiated freeze cleanup on
detach/process-exit/session-generation-change is **not** implemented here —
it relies on the canonical freeze tick's own continuous
`verifyAttachedProcessIdentity()` re-check (confirmed by audit: every tick
re-verifies identity before writing) plus the existing session-cleanup
wiring, rather than a duplicate registry.

## 19. Increment 4 scope limitation — real adapter wiring not included

The pure executor core (control semantics, revalidation, value/preset
validation, consent pass-through) is implemented and fully tested against
injected fake adapters — no real commercial game process required, per the
spec's own test-fixture policy. Increment 4B (Section 21) closes most, but
not all, of this gap — see there for current state.

## 20. Planned next layers (PLANNED — not implemented)

None of the following exist yet:

- Hotkey manager wiring quick slots to physical keys (reusing
  `cheat-system/trainer-hotkey-*`) — Increment 5, gated on an independent
  security review of the full Increment 4 chain (Section 22), not on any
  remaining implementation gap.
- Generic Wisp renderer / collapsed-expanded UI / group navigation.
- User customization editor, reset/restore flows.
- Creator metadata tooling and validation UI.
- Community profile download/import and update-conflict UI.
- Automatic profile generator (ranking eligible trainer entries into a
  default layout).
- Any new Electron IPC or preload surface.

None of the above is implied to exist by this document — only the sections
above marked "(implemented)" are real.

## 21. Increment 4B — production execution adapter + real identity bridge (PARTIAL)

**Real production adapter.** `src/core/live-memory/adaptive-wisp-live-adapter.ts`
implements `WispTrainerExecutionAdapter` for real, delegating every operation
to `MemoryManager` / `LiveMemorySession` / `src/core/consent/write-consent.ts`.
It lives outside `src/core/adaptive-wisp/` deliberately — that directory's
static boundary test forbids any import containing "live-memory" or "freeze",
so this file is the seam, not a boundary violation. No raw memory access,
process attach, or handle ownership occurs in this file or anywhere else in
Adaptive Wisp — every read/write/freeze call is a pass-through to an existing
canonical method (`session.readValue`, `manager.proposeWrite`,
`session.proposeFreeze`, `session.stopFreeze`, `consumeWriteConsent`).

**Address-resolution finding.** Auditing the real write path (not just the
identity question) surfaced that `cheat-system/game-registry.ts`'s
`GameConfig.cheats[]` — the catalog Increment 3's entry lookup binds against —
carries no memory address/pointer data at all; it is display/discovery
metadata only. The catalog that actually resolves an entry to a
`LiveMemoryAddress` is schema.v1 (`trainer-catalog` `memoryFeatures`, via
`resolveLiveControlFromSchema` + `LiveMemorySession.resolveControl`), keyed by
`catalogGameId` — control ids there are always `"<catalogGameId>:<featureId>"`.
Increment 3's binding-time entry lookup and Increment 4B's real
execution-time address resolution therefore use two different catalogs; the
former is fine for degraded-availability/display purposes, but only the
latter can back a real write.

**Real game identity bridge — closed, correctly.** `CanonicalGame` already
carries an authoritative, already-populated field for exactly the namespace
real writes need: `catalogGameId` (bridges to `trainer_catalog_games`). This
is Option A from the Increment 4B spec ("canonical game records already store
the exact catalog ID — use it directly"): `src/core/adaptive-wisp/
catalog-game-identity-bridge.ts`'s `createCatalogGameIdentityBridge()` looks
this up by primary key via `getCanonicalGame()` — exact match only, fail
closed to `null` when absent, zero fuzzy/display-name matching. This
supersedes Increment 4's placeholder `createExplicitGameIdentityBridge`
(still present, still usable for manual-override callers) for real execution.
The cheat-system `GameConfig.cheats[]` namespace named in Increment 4's
original Blocker B remains genuinely unbridged — but per the finding above,
that catalog cannot back a real write regardless, so this is no longer a
blocker for real execution.

**Session authority.** `electron/live-memory-ipc.ts` exports
`getActiveLiveMemorySessionBundle()` — the one seam through which a
main-process, non-IPC caller can reach the currently authorized session.
Fails closed to `null` when zero or more than one session is attached (never
guesses). Not registered with `ipcMain`, not reachable from any preload or
renderer. `electron/adaptive-wisp-execution-composition.ts` is the single
factory point (`getAdaptiveWispExecutionAdapter()`) composing the real
adapter from this accessor plus the real identity bridge — also not
IPC-exposed.

**Remaining blocker: confirmWrite/confirmFreeze are synchronous by contract,
the canonical confirm path is not.** `WispTrainerExecutionAdapter.confirmWrite`
/`confirmFreeze` are synchronous (`executeWispAction` calls them without
`await`). The real canonical confirm path is asynchronous end-to-end
(`MemoryManager.confirmWrite`/`freezeStart` are `async`, involving a real
native write and an awaited snapshot-listener hook). This adapter does not
fake synchronicity with a blocking-wait shim — that is an unsafe shortcut the
spec rules out. Consent consumption itself is real and fully proven
(`consumeWriteConsent` is genuinely synchronous, and replay/wrong-token
rejection is tested end-to-end), but the confirmed write/freeze cannot
complete through this interface: `confirmWrite`/`confirmFreeze` consume the
consent token for real, then return `{ok: false, status: 'failed', reason:
'async_confirmation_not_yet_wired: ...'}` rather than fabricate success.
Closing this requires widening `WispTrainerExecutionAdapter.confirmWrite`/
`confirmFreeze` (and `executeWispAction`) to `async` — a change to the
already-committed Increment 4 executor architecture, out of this pass's
narrow scope (no unrelated executor changes were authorized). **This is the
single highest-priority remaining blocker before Increment 4 can be marked
COMPLETE.**

**Consent binding convention.** Since Wisp never mints consent, whoever
issues consent for a Wisp-originated proposal must reconstruct an identical
binding to what this adapter reconstructs at confirm time. The one field
identity evidence alone can't supply is `sessionKey`; this adapter fixes it
to the constant `ADAPTIVE_WISP_CONSENT_SESSION_KEY = 'adaptive-wisp'`,
documented for whoever wires the future issuing caller.

**Verified for real (against the real fake-driver-backed `MemoryManager`/
`LiveMemorySession`/consent stack, plus a real SQL-backed canonical-games/
trainer-catalog DB for identity/address resolution):** `getCurrentState`,
`proposeWrite` (stages, never writes early), `proposeFreeze`, `stopFreeze`
(delegates to the same canonical freeze, not a second one), consent replay
rejection, wrong-token rejection, cross-game / unmapped-identity fail-closed
rejection, no-active-session fail-closed rejection.

**Not verified in this pass:** an actual completed write or freeze against a
real target process (blocked by the async-boundary finding above), and the
full packaged "HP+10 end-to-end" acceptance scenario from the spec's Final
Acceptance section — both required the confirm-path fix first, which
Increment 4C (Section 22) delivers.

## 22. Increment 4C — async confirmation completion (COMPLETE)

**Async contract.** `WispTrainerExecutionAdapter.confirmWrite`/`confirmFreeze`
now return `Promise<WispCanonicalWriteOutcome>`; `executeWispAction` (and its
internal `handleWrite`/`handleFreeze`) are now `async`, `await`ing both
calls. `getCurrentState`/`proposeWrite`/`proposeFreeze`/`stopFreeze` stayed
synchronous — they were never the blocker (all sync in the canonical layer
too) and widening them would have been scope creep.

**Real production adapter confirm path.** `adaptive-wisp-live-adapter.ts`'s
`confirmWrite` now `await`s `MemoryManager.confirmWrite(proposalId,
{consentToken, consentBinding, reason})` directly — no local
`consumeWriteConsent` call, since `MemoryManager.confirmWrite` consumes the
token itself; calling it twice would race two consumption attempts against
one single-use token. Post-await revalidation is the canonical service's own
job, not duplicated here: `LiveMemorySession.confirmWrite` re-verifies
`verifyAttachedProcessIdentity()` immediately after its own internal await
(a remote-connection re-check), right before writing — that is the real
"session/process may have changed during the await" defense the async
conversion needed, and it already existed. `confirmFreeze` mirrors this via
`MemoryManager.freezeStart`.

**Structural finding, fixed:** `executeWispAction` stages a brand-new
canonical proposal on every call — including a call that already carries a
`consentToken`. Two independent `executeWispAction` invocations (a
propose-only call, then a separate confirm call) therefore produced two
*different* real proposal ids, and a real consent binding hashes in the
exact proposal id — so a token obtained for the first call's proposal could
never validate against the second call's fresh one. This is not an artifact
of async — it would have blocked a real confirmed mutation regardless.
Fixed by adding an optional `proposalId` to `WispActionExecutionRequest` and
to `WispActionExecutionResult` (set on a `pending-consent` result): a caller
that already holds a token bound to a specific proposal echoes that
`proposalId` back on the confirming call, and `handleWrite`/`handleFreeze`
now confirm that exact proposal directly instead of silently re-proposing
and discarding it. No unrelated executor redesign — the propose/pending-
consent/confirm shape is unchanged, just no longer lossy.

**Real Wisp-routed mutation proof (Final Acceptance, met).** A dedicated
integration test drives `executeWispAction` twice through the real
production adapter and a real `MemoryManager`/`LiveMemorySession`/consent
stack (backed by `FakeMemoryDriver` — the same fixture convention used
throughout this codebase's ~2000 other live-memory tests, not a raw-write
shortcut): propose (100, unchanged) → real consent issued for the returned
`proposalId` → confirm (echoing that `proposalId`) → canonical write
actually applies (100 → 200, verified via `driver.readMemory`) → restore
(200 → 100, verified). Same pattern proven for freeze at the adapter level:
propose → consent → awaited confirm → `LiveMemorySession`'s own freeze
becomes active (target address/value verified) → replay of the consumed
consent rejected → `stopFreeze` deactivates the same canonical freeze.
Negative controls, all proven with zero mutation: no confirm, wrong/random
consent token, stale session generation (rejected before the adapter is ever
reached), unmapped canonical game (rejected before the adapter is ever
reached).

**Control support matrix** (domain = executor logic; production = proven via
the real adapter):

| Control | Domain | Production | Evidence |
|---|---|---|---|
| set | implemented | verified | direct fixture mutation + restore test |
| toggle | implemented | verified (shared code path) | same `handleWrite`→`confirmWrite` call proven by `set`; `computeRequestedValue`'s toggle branch separately unit-tested |
| increment | implemented | verified (shared code path) | same as toggle |
| multiplier | implemented | verified (shared code path) | same as toggle |
| cycle | implemented | verified (shared code path) | same as toggle |
| momentary | implemented | verified (shared code path) | same as toggle |
| freeze | implemented | verified | adapter-level propose→consent→confirm→active→stop test |

**Packaged evidence.** No new Adaptive-Wisp-specific packaged proof was
added: Adaptive Wisp still has no IPC/renderer surface (by design, per
Section 21's non-negotiable scope limits), so a packaged Playwright test
cannot reach `getAdaptiveWispExecutionAdapter()` without adding a test-only
IPC bypass — which is explicitly disallowed. What packaged evidence
*does* confirm: the canonical primitives Wisp's real adapter calls into
(`MemoryManager.confirmWrite`, `LiveMemorySession.startFreezeConfirmed`,
consent issuance/consumption) remain correct in a real packaged
Electron + native-driver + .NET fixture-process environment —
`gate2-2a1-packaged-real-process-write-proof.e2e.test.ts` (1/1) and
`gate2-3-freeze-authorization-security.e2e.test.ts` (3/3) both passed against
a freshly built `dist/win-unpacked/Solith.exe`.

**Result: all ten Increment 4 completion-gate criteria are met** — async
confirmWrite/confirmFreeze work against the real canonical service; a real
Wisp-routed mutation succeeds and restores; a real Wisp-routed freeze
starts, is enforced by the canonical session (not a second one), and stops;
stale/cross-game/wrong-consent negatives fail closed; the identity bridge
remains authoritative; no second write or freeze pipeline exists; every
regression suite stayed green. **Adaptive Wisp Increment 4 is COMPLETE.**

Increment 4 subsequently passed an **independent security review**
(`review/adaptive-wisp-increment4-security`, review artifact `4a8ca91`,
verdict `INDEPENDENT INCREMENT 4 SECURITY REVIEW — PASS`) that independently
re-derived and freshly proved same-session reattach safety, PID-reuse safety
(via live process-identity re-query, not the Wisp-layer generation tracker
alone), full Wisp-routed freeze composition through `executeWispAction`, and
proposal/action-swap resistance — closing the three evidence gaps this
section had left open. Security status: `SECURITY-VERIFIED WITH NON-
BLOCKING RESIDUALS` (R1: freeze tick-enforcement/duplicate-confirmation not
separately re-proven through Wisp, but unchanged canonical mechanisms; R2:
`CanonicalGame.catalogGameId` uniqueness is a canonical-games integrity
dependency outside Increment 4's scope). Gate: `INCREMENT 5 AUTHORIZED FROM
SECURITY PERSPECTIVE`.

## 23. Increment 5 — logical quick slots + existing trainer-hotkey integration (COMPLETE)

**Logical slots were not a new concept.** `WispActionDefinition.slot`
(Increment 1) and `WispUserState.slotAssignments` (Increment 2) already
modeled "this action lives in slot N," including user-override precedence
over creator recommendations. Increment 5 adds no second slot system —
`resolveWispQuickSlotAction(boundProfile, slot)` is a one-line lookup against
the already-bound profile's `slot` field, nothing more.

**Physical key ↔ logical slot is genuinely new**, and lives entirely in the
existing trainer-hotkey persistence/registration layer (Increment 5, Section
5/25/91 — no parallel hotkey engine was built): `TrainerHotkeyAction` gained
`wisp_slot_1`..`wisp_slot_6`, stored in the same `trainerHotkeyBindings`
settings key `getTrainerHotkeyBindings`/`setTrainerHotkeyBindings` already
manage, and `getTrainerHotkeyEntries` emits them into the exact same entries
array `cheat_slot_1..12` already flows through, so both families are
registered, conflict-checked, and cleaned up by the one existing engine
(`registerTrainerHotkeyEntries`/`unregisterTrainerHotkeyEntries`). Wisp slots
deliberately have **no default accelerator** — `cheat_slot_1..6` already
default to F1-F6, and shipping the same defaults for Wisp would guarantee an
immediate, silent-feeling out-of-the-box collision; a Wisp slot only
registers once a user (via a future settings surface) explicitly binds a key.

**Discovered finding, mitigated at the caller (not the shared engine):** the
existing registration engine has no cross-entry conflict detection of its
own — given two entries sharing one accelerator in the same registration
call, whichever is processed second silently takes over the first's
registration (correct for the same action's own remap, wrong for two
different actions colliding). This pre-existing characteristic had simply
never been exercised, since no two `cheat_slot_N` defaults ever collided.
Increment 5 adds `filterOutConflictingEntries` (pure, in
`trainer-hotkey-registration.ts`) and calls it in `registerTrainerHotkeys()`
before every registration pass: any accelerator claimed by more than one
action — cheat/cheat, cheat/wisp, or wisp/wisp — registers for **neither**
until a human resolves the conflict. No key is ever silently reassigned,
matching the spec's own "do not silently steal a key" requirement, and this
protects the pre-existing `cheat_slot` family too, not just Wisp.

**Feature flag.** A new `v2AdaptiveWispHotkeysEnabled` capability was added
to `unlock-trainer-capabilities.ts`, deliberately **defaulting to `false`**
— every other `v2*` capability defaults to enabled-unless-disabled, but Wisp
hotkeys are a new privileged-execution surface (activation reaches the
reviewed Increment 4 executor and can stage a real canonical proposal),
unlike the existing overlay/broadcast-only trainer hotkeys, so reusing the
default-on policy would have auto-enabled it without product precedent.

**Activation flow (exact, real code path):**

```
physical key (globalShortcut, via the existing trainer-hotkey engine)
→ getTrainerHotkeyCallback('wisp_slot_N') in electron/trainer-hotkeys.ts
→ getAdaptiveWispQuickSlotController().activate(N)
→ WispActiveProfileProvider.getActiveBoundProfile()   (resolved FRESH every call — Section 8)
    → resolveWispProfileForGame (Increment 2, unchanged)
    → bindResolvedProfile (Increment 3, unchanged)
→ resolveWispQuickSlotAction(boundProfile, N)
→ buildDefaultRequest(...)                             (no arbitrary input — Section 37)
→ executeWispAction(...)                                (Increment 4, unchanged, independently reviewed)
→ existing consent/write/freeze system
```

**Use-time resolution, not registration-time.** The controller re-resolves
the active profile and re-fetches the runtime context on every single
activation — never a cached action object. A game switch between two
activations changes what slot 1 resolves to; a session-generation change
between resolution and the executor call is caught by `executeWispAction`'s
own `validateWispBinding` (proven by a dedicated race test, not merely
assumed).

**Pending-consent policy (Section 34, policy B).** The controller tracks, in
memory only, which actions currently have an outstanding proposal. A second
press on the same pending action is suppressed (`WISP_HOTKEY_EXECUTION_
PENDING_CONSENT`) rather than creating a second independent proposal or
reusing the first's token. The suppression clears once a result is terminal
(applied/rejected/stale/unavailable/failed), so a later legitimate retry is
never permanently blocked. Freeze additionally tracks a per-action discrete
enable/disable intent that flips on every *reached* activation (Section 36
— no keydown/keyup hold semantics).

**Honest, load-bearing limitation — no hotkey confirms yet.** Every hotkey
activation is, structurally, a *first press* (no `consentToken`) — there is
no consent-dialog surface wired to Adaptive Wisp anywhere yet (by design;
Increment 5 explicitly excludes renderer/UI work). This means a hotkey press
today reaches `pending-consent` and stops there; it cannot yet complete a
real mutation end-to-end from a physical key press. This is safe (nothing
mutates without human-granted consent) and exactly matches the letter of the
spec ("no auto-confirm," Section 33), but it should not be read as "hotkeys
fully work" — they safely stage a proposal and nothing more until a future
increment wires a real consent surface to this proposal.

**Second honest limitation — no live "current canonical game" yet.**
Auditing the codebase for this increment surfaced that no production code
anywhere resolves "which canonical game is currently attached" from a live
process — `session-monitor-context-provider.ts`'s `getActiveGameContext`
callback (Increment 3) has never had a real caller, and no other
main-process module tracks a "current canonical game" concept. Building that
resolver here would mean inventing new, unreviewed identity-mapping logic
outside this increment's scope. `electron/adaptive-wisp-hotkey-composition.ts`
wires everything else for real and documents this gap plainly:
`getActiveGameContext` returns "no active game" until a future increment
supplies a real implementation — which the whole reviewed chain already
treats as the safe, harmless "no active session" case. The hotkey/slot layer
itself is fully wired and fully tested against real `bindResolvedProfile`/
`resolveWispProfileForGame` calls; only the "what game is the user in"
bridge is a stand-in.

**No direct write/freeze/attach/consent path.** Static tests
(`adaptive-wisp-hotkey-boundary-static.test.ts`) prove `electron/trainer-
hotkeys.ts` and `electron/adaptive-wisp-hotkey-composition.ts` import none of
`memory-manager`, `live-memory-session`, `write-consent`, `freeze-
concurrency-registry`, `child_process`, or `shell`, and that the domain
hotkey files (`hotkey-errors.ts`, `hotkey-types.ts`, `quick-slot-
resolution.ts`, `active-profile-provider.ts`, `quick-slot-controller.ts`)
import neither `electron`, `ipcMain`, nor `globalShortcut` directly. No new
IPC channel was added (Section 56).

**Residual R1 (carried from the Increment 4 review) — closed at the hotkey
layer.** A dedicated test proves two rapid hotkey presses on the same freeze
action produce exactly one proposal (`calls.proposeFreeze === 1`) and never
reach `confirmFreeze` at all from this layer — the canonical freeze registry
can never be asked to start two workers for one hotkey-triggered action,
because the pending-consent suppression prevents a second proposal from ever
being staged.

**Residual R2 (carried from the Increment 4 review) — unaffected.** The
hotkey layer introduces no alternate identity route; it resolves games
exclusively through `resolveWispProfileForGame`/`bindResolvedProfile`
(Increment 2/3, unchanged) and never touches `CanonicalGame.catalogGameId`
directly.

**Explicitly not implemented:** Wisp renderer, Wisp action buttons, a hotkey
editor UI, user customization UI, creator UI, community networking,
automatic profile generation. Increment 5 is input/runtime infrastructure
only, tested through services/controllers — no UI shipped.

**Superseded by Section 24:** the independent Increment 5 review (below)
found and closed two real defects in this section's design — a cross-game
state-key collision and a missing pending-state lifecycle — plus a reporting
error in this document's own original test-count claim. Section 24 is the
authoritative, corrected account; read it alongside this section rather than
in place of it.

## 24. Increment 5 closeout — independent review findings, pending-state lifecycle, conflict-filtering boundary hardening, and evidence corrections

This section documents the full independent-review-and-remediation pass
performed on top of the Increment 5 implementation frozen at `2ec5593`, in
isolation on `review/adaptive-wisp-increment5-hotkeys`, across two
remediation commits (`14c899d`, then the closeout commit recorded in this
section's final subsection).

### 24.1 Corrected test-count history (replaces the "51 new tests" claim)

The original Increment 5 report claimed "51 new tests across five new files"
plus "two assertions added to an existing test." Independently recounting
during the review found this attribution wrong, though the aggregate total
it fed into was correct:

| Stage | New/changed tests | Running total |
|---|---|---|
| Pre-Increment-5 baseline | — | 1,996 |
| 5 new Increment 5 files (45 tests: 5+5+10+19+6) + 11 new cases in the existing `adaptive-wisp-boundary-static.test.ts` (10 dynamic per-file loop iterations for the 5 new source files + 1 new explicit test) | +56 | 2,052 |
| Review remediation commit `14c899d` (2 cross-game regression tests + 4 `buildTrainerHotkeyRegistrationPlan` tests) | +6 | 2,058 |
| This closeout (Phase A: 10 pending-state lifecycle tests; Phase B: 7 conflict-filtering-boundary adversarial tests; Phase C: 5 lifecycle-integration tests in a new file) | +22 | 2,080 |

The original "51/two assertions" breakdown is superseded by this table; the
1,996→2,052 aggregate delta it was built from was always correct.

### 24.2 Finding 1 (Medium, fixed in `14c899d`) — cross-game `actionId` collision

`pendingProposalByAction`/`freezeEnableIntentByAction` were keyed by bare
`actionId`, which is only unique within one profile. Two different games'
profiles declaring the same `actionId` string could false-suppress or
inherit freeze intent across a game switch. Fixed by keying both maps
`${gameId}:${actionId}`. See Section 23's "Discovered finding" text — that
text describes the *conflict-filtering* finding, not this one; this finding
was not previously documented in Section 23 and is recorded here for the
first time in full.

### 24.3 Finding 2 (Low, fixed in `14c899d`) — untested `registerTrainerHotkeys()` composition

`registerTrainerHotkeys()` composed three decisions (flag gating, entry
building, conflict filtering) that were each unit-tested individually but
never exercised together as the real function calls them. Fixed by
extracting `buildTrainerHotkeyRegistrationPlan(bindings, {wispEnabled})`
(pure, electron-free) into `trainer-hotkey-registration.ts`; the real
function now calls it, and it is directly tested.

### 24.4 Finding 3 (Medium, fixed in this closeout) — pending-state lifecycle gap

Confirmed real defect: after the `14c899d` game-scoping fix, the controller's
`pendingProposalByKey`/`freezeEnableIntentByKey` maps were still never
explicitly cleared on detach, reattach, game switch, session-ID change,
session-generation change, or profile replacement — they only ever grew or
were overwritten by a *matching* key. This was harmless for cross-game
collisions (already isolated by the composite key) but meant a stale entry
for an abandoned game/session/profile persisted in memory indefinitely, and
nothing guaranteed a *late-completing* activation from an old context
couldn't write a stale entry back in after a newer context had already
"moved on."

**Fix — `src/core/adaptive-wisp/quick-slot-controller.ts`:** every
`activate()` call now computes a `contextIdentityKey` (`gameId:sessionId:
sessionGeneration` — deliberately built only from fields the existing
session-monitor/session-context architecture already produces; no new
identity authority was introduced, and no bare PID or executable substring
is used) and a profile-identity key (`bound.profileId`), and resets both
maps whenever either changes since the last activation. An `epoch` counter
increments on every reset; each activation captures the epoch it started
under and refuses to write its result into the maps if the epoch has since
moved on — this closes the late-completion race without adding a second
session authority or any polling: the check runs exactly when the hotkey
layer already reads context (use-time), never on a timer.

**Why not a push-based subscription:** `SessionMonitorService` (the existing
session authority) exposes no event/subscribe API — only a poll-style
`getStatus()` — confirmed by source audit before choosing this design. Per
this closeout's own instruction not to invent a second session authority,
and given the hotkey layer's only interaction with context is already
use-time (on each key press, not continuously), reusing the existing
use-time read as the identity-comparison point is the smallest correct
design; no new lifecycle interface, event emitter, or polling loop was
added.

**`dispose()`** was added to `WispQuickSlotController` for the transitions
that are not naturally observed through an `activate()` call at all —
feature disable and application shutdown. `electron/trainer-hotkeys.ts`'s
`unregisterTrainerHotkeys()` (the single call site for both real app
shutdown, from `main.ts`, and every feature-disable/rebind refresh, via
`refreshTrainerHotkeys()`) now calls
`disposeAdaptiveWispQuickSlotController()` unconditionally, before its own
early-return, so it fires even when Wisp was enabled but nothing was ever
actually registered.

Ten new tests in `tests/adaptive-wisp-quick-slot-controller.test.ts` prove:
pending/freeze-intent state clears on detach; reattach does not inherit
either; repeated detach is idempotent and touches the trainer adapter zero
times; an unchanged context preserves legitimate pending state across
unrelated reads; a session-ID change, a session-generation change, and a
full game-switch-and-back each independently clear state; a profile-identity
change (same game/session) clears state; a late completion from an
abandoned game cannot write a ghost pending entry after a newer game has
already activated; and `dispose()` clears both maps, is idempotent, and
never calls the trainer adapter.

### 24.5 Finding 4 (Low, fixed in this closeout) — conflict filtering was correct but not unavoidable

The prior review found production always calls `filterOutConflictingEntries`
before registration, but the lower-level `registerTrainerHotkeyEntries` was
still exported and callable directly with unfiltered entries — a future
caller could bypass the safety by mistake.

**Fix — `src/core/cheat-system/trainer-hotkey-registration.ts`:**
`registerTrainerHotkeyEntries` now normalizes (trims, drops
blank/whitespace-only) and conflict-filters its input internally,
unconditionally, regardless of what the caller already did — this is now
the single production entry point that reaches `globalShortcut`, and no
unfiltered primitive is exposed. Conflict comparison was also hardened to be
case-insensitive (`f1`/`F1` are the same key for grouping purposes; the
accelerator string actually registered is only trimmed, never case-altered,
so a valid binding is never silently normalized into a different one).

Seven new adversarial tests in `tests/adaptive-wisp-hotkey-registration.test.ts`
prove: a three-way collision is fully excluded even when
`registerTrainerHotkeyEntries` is called directly with raw, unfiltered
input; duplicate accelerators under different action IDs are excluded as a
group; blank/whitespace-only accelerators never reach the shortcut API and
are not reported as active; leading/trailing whitespace is trimmed before
registration; case-variant accelerators collide regardless of input order;
Electron rejecting every accelerator surfaces every entry as failed; and a
registration attempt after disposal behaves identically to a fresh start.

Five new lifecycle-integration tests in the new file
`tests/adaptive-wisp-hotkey-lifecycle-integration.test.ts` drive the real
composed `registerTrainerHotkeys()`/`unregisterTrainerHotkeys()`/
`refreshTrainerHotkeys()` sequences (via `buildTrainerHotkeyRegistrationPlan`
+ `registerTrainerHotkeyEntries` + `unregisterTrainerHotkeyEntries`, in the
exact order the real electron/trainer-hotkeys.ts wrappers use — that file
itself cannot be imported outside a running Electron process, the same
reason `buildTrainerHotkeyRegistrationPlan` exists) end-to-end: a full
disable → refresh → re-enable → refresh cycle leaves exactly one
registration per accelerator and unrelated trainer shortcuts untouched; a
remap across multiple refresh cycles never accumulates callbacks; shutdown
unregisters every owned shortcut, is idempotent, and is structurally
incapable of touching propose/confirm/write/freeze/attach (the fake
shortcut API used has no such methods); a real three-way collision batch
excludes all three regardless of input order; and blank/whitespace Wisp
bindings never reach the shortcut API in the real composed plan.

### 24.6 What remains explicitly out of scope and unproven

Unchanged from Section 23 and the Increment 5 review — restated here
precisely rather than re-labeled as resolved by this closeout:

- **No live canonical-game resolver** — `getActiveGameContext()` in
  `electron/adaptive-wisp-hotkey-composition.ts` still always returns
  `{gameId: null}`. This is Increment 6's objective, not this closeout's.
- **No profile-registry population** — `createWispProfileRegistry()` is
  still always constructed empty in production; nothing bundles a real
  profile into it yet. Also Increment 6's objective.
- **No consent-completion surface** — every hotkey activation is still,
  structurally, a first press with no `consentToken`; it stops at
  `pending-consent`.
- **Real OS-level `globalShortcut.register` for `wisp_slot_N` specifically**
  remains unproven. `registerTrainerHotkeys()` genuinely runs during real
  Electron startup (confirmed: `electron/main.ts` calls it at boot and calls
  `unregisterTrainerHotkeys()` at shutdown), and the Playwright
  `electron-consent-boundary.e2e.test.ts` suite does boot the real compiled
  main process — proving the general hotkey system (which includes the
  unchanged `cheat_slot_1..12`/`toggle_overlay`/`hide_overlay` defaults)
  registers real `globalShortcut` entries. It proves nothing `wisp_slot`
  -specific, because no `wisp_slot` binding exists by default and
  `v2AdaptiveWispHotkeysEnabled` defaults to `false`. No test in this
  repository simulates an actual physical OS key press for any hotkey,
  Wisp or otherwise, and none was added here — per this closeout's own
  instruction against manufacturing passing evidence with a privileged
  test-only bypass.
- **Packaged (`dist:dir`) build evidence** was not re-collected this pass —
  only the dev bundle plus its 29-check verifier and the Playwright suite
  ran. The last packaged-build pass was during the Increment 4 review.
