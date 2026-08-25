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

## 18. Planned next layers (PLANNED — not implemented)

None of the following exist yet:

- **Increment 4 (next):** action execution adapter that revalidates a
  binding immediately before use and routes operations through SOLITH's
  existing trainer authorization/consent/freeze systems.
- Hotkey manager wiring quick slots to physical keys (reusing
  `cheat-system/trainer-hotkey-*`) — Increment 5.
- Generic Wisp renderer / collapsed-expanded UI / group navigation.
- User customization editor, reset/restore flows.
- Creator metadata tooling and validation UI.
- Community profile download/import and update-conflict UI.
- Automatic profile generator (ranking eligible trainer entries into a
  default layout).
- Any new Electron IPC or preload surface.

None of the above is implied to exist by this document — only the sections
above marked "(implemented)" are real.
