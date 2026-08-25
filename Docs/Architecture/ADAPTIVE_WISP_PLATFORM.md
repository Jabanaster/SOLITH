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

## 13. Planned next layers (PLANNED — not implemented)

None of the following exist yet:

- **Increment 2 (next):** versioned local profile persistence; deterministic
  profile resolver (user > creator > community > builtin > generated
  precedence).
- Runtime trainer-entry binding (resolving `entryId` against a live attached
  session, with stale/session-generation rejection).
- Action execution / control-type adapters actually invoking anything.
- Hotkey manager wiring quick slots to physical keys (reusing
  `cheat-system/trainer-hotkey-*`).
- Generic Wisp renderer / collapsed-expanded UI / group navigation.
- User customization editor, reset/restore flows.
- Creator metadata tooling and validation UI.
- Community profile download/import and update-conflict UI.
- Automatic profile generator (ranking eligible trainer entries into a
  default layout).
- Any new Electron IPC or preload surface.

None of the above is implied to exist by this document — only the sections
above marked "(implemented)" are real.
