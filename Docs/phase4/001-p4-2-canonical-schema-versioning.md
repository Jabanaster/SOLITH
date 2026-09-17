# P4-2 — Canonical Schema Versioning & Migration Foundation

**Roadmap track:** external roadmap Phase 4 (trainer-model convergence), stage P4-2.

**Naming note:** `Docs/Reports/PHASE_4_CLOSEOUT.md` is an unrelated, internal
"Phase 4" (artwork identity/cache/legal sourcing) from a different numbering
scheme used inside the schema.v1 dual-read migration effort. It has nothing
to do with this roadmap track. This document lives under `Docs/phase4/`
specifically to avoid perpetuating that collision — see the Phase 4 baseline
audit's own findings for the full explanation.

## Scope

Audit-authorized implementation of P4-2 only: a real schema-version
architecture, a deterministic migration pipeline, and two data-integrity
fixes (PD-05, PD-06) identified by the P4 baseline audit. No broader Phase 4
runtime, no Phase 2/3/5/6 work.

## Version architecture

- `SolithDefinitionV1`'s own schema (`src/core/definitions/schema.v1.ts`) is
  unchanged in its version literal (`schemaVersion: z.literal(1)`) — it still
  correctly validates "is this a well-formed v1 object". What was missing was
  the layer *around* it: routing raw input to the right validator before
  reaching that schema, and a home for future migrations.
- New module: `src/core/definitions/migrations/`
  (`version-detect.ts`, `legacy-unversioned-migration.ts`,
  `migrate-trainer-definition.ts`, `types.ts`, `index.ts`).
- Pipeline: `RawInput → Version Detection → Version-Specific Schema
  Validation (reused schema.v1) → Migration Chain → Current Canonical
  Schema → Current Canonical Validation`, exactly as specified.
- Three lanes out of detection: `legacy_unversioned` (no `schemaVersion`
  field at all — the historical ModPack shape), `versioned` (a supported
  version, currently only `1`), `unknown_future_version` / `malformed`
  (both fail closed — rejected, never guessed/stripped/downgraded).
- `LEGACY_UNVERSIONED` is an explicit string label, not a fabricated
  version `0` — no historical object was ever actually persisted with a
  `schemaVersion: 0` field, so the pipeline does not pretend one was.
- Entry point: `migrateTrainerDefinition(input): MigrationOutcome`, returning
  `{ success, definition, sourceVersion, targetVersion, migrationsApplied,
  warnings }` on success, or `{ success: false, reason, sourceVersion,
  errors }` on failure. Deterministic, side-effect free (never mutates its
  input), and the migrated object is always re-validated against the
  current canonical schema before being returned.
- `isSolithDefinitionPayload` (`mod-pack-adapter.ts`) now delegates to the
  centralized `detectTrainerDefinitionVersion` instead of re-implementing
  the `schemaVersion` check ad hoc — one source of truth for version
  detection, per the audit's explicit requirement.
- Extending this to a real `v1 → v2` step later means adding one migration
  step and one detection branch, not restructuring the pipeline.

## PD-05 — comment/evidence loss

Two independent paths silently destroyed comment/evidence data on import;
both are fixed, not just reported:

1. **YAML** (`compile-yaml.v1.ts`): previously stripped every `#` line from
   the raw text *before* parsing. The `yaml` package already ignores
   comments per spec, so this pre-strip was pure destruction with no parsing
   benefit. Fixed by parsing the original text directly and, in parallel,
   extracting non-boilerplate comment lines into a new optional
   `SolithDefinitionV1.provenanceNotes: string[]` field (schema.v1.ts). The
   three fixed banner lines emitted by every export are recognized and
   excluded so repeated round trips don't accumulate duplicate boilerplate.
   `export-yaml.v1.ts` now re-emits `provenanceNotes` as comments, so a full
   export → import → export cycle preserves genuine evidence (discovery
   notes, session-address warnings, custom header lines) losslessly.
2. **JSON adapter** (`src/core/adapters/json.ts`, save-file editing, not the
   trainer-definition schema): `stripJSONComments` deleted `//` and `/* */`
   comments before parsing, and the file is always rewritten from the parsed
   object — so any comment in a JSONC-style save file was gone the moment a
   value was edited, with nothing reported. The canonical-schema
   "provenance field" approach doesn't apply here (this is generic save-file
   JSON, not a trainer definition), so the acceptable-interim fix applies
   instead: `stripJSONComments` now returns the discarded comment text, and
   `ReadValueResult`/`BuildOutputResult` (`adapters/contract.ts`, both fields
   additive/optional) carry a `warnings` array when comments were discarded.
   `parseAndNormalize` reports the same via its existing `diagnostics` array.

## PD-06 — CT registry dead computation

`compile-ct-registry.ts` computed `aobIdsBySourceScript` (script index → AOB
signature IDs extracted from that script) and then never used it —
`entries[].linked_aob_ids`/`linked_script_ids` were hardcoded to `[]`
regardless.

Verified against current source: under the current CT importer
(`ct-import.ts`), a `CheatEntry` carrying a script child is rejected
wholesale before it can become an accepted pointer entry — so no accepted
pointer entry can ever have a genuine script or AOB correlation. Wiring the
dead map into `entries[]` would have fabricated a link the data does not
support, which the audit explicitly prohibits. Instead, the real correlation
— which script each AOB signature was extracted from — is exposed where it
actually belongs: `script_catalog_refs[].linked_aob_ids`. `entries[]`
correctly stays `[]`, now with a code comment explaining why, instead of
looking like an unfinished feature.

## Tests

| Command | Tests | Result |
|---|---|---|
| `npx tsc --noEmit` | — | PASS (0 errors) |
| `npx tsc -p tsconfig.electron.json --noEmit` | — | PASS (0 errors) |
| `npm run test:definitions` | 124 | 124/124 pass |
| `npm run test:trainer-catalog` | 204 | 204/204 pass |
| `npm run test:trainer-schema` | 36 | 36/36 pass |
| `npm run test:v2-lifecycle` | 56 | 56/56 pass |
| `npm run test:registry` | 37 | 37/37 pass |
| `npm run test:cheat-toggle` | 27 | 27/27 pass |
| `npm run test:lifecycle-wiring` | 22 | 22/22 pass |
| `npm run test:command-runner` | 14 | 14/14 pass |
| `npm run test:in-process` | 9 | 9/9 pass |
| `npm run test:game-profile` | 49 | 49/49 pass |
| `npm run test:v1` | 210 | 210/210 pass |
| `npm run verify:schema-v1-boundaries` | — | PASS |
| `npm run test:trainer-host` | — | **NOT RUN** — `pretest:trainer-host` requires a full native `build:electron`; untouched by this mission's scope, not exercised |

New coverage added: `tests/definitions-migrations.test.ts` (version
detection, migration determinism/non-mutation/step-reporting, bundled
definitions still migrate cleanly, ModPack round trip documents its known
loss); new cases in `tests/definitions-compile.v1.test.ts` (PD-05 YAML),
`tests/parsers.test.ts` (PD-05 JSON adapter), `tests/ct-registry.test.ts`
(PD-06).

## Compatibility

- Every bundled definition (`bundledDefinitionsForTests()`, 50 games) passes
  through `migrateTrainerDefinition` with zero migration steps applied
  (already current) — proven by test, not assumed.
- `mod-pack-adapter.ts`'s public functions and `isSolithDefinitionPayload`'s
  observable behavior are unchanged for all existing inputs; only its
  internal implementation now shares the centralized detector.
- `SolithDefinitionV1.provenanceNotes` is optional and additive — no
  existing consumer of the 36-file dependency fan-out is affected.
- `BuildOutputResult`/`ReadValueResult`'s new `warnings` field is optional
  and only set when non-empty — no existing adapter or caller is affected.

## Scope contamination check

- Phase 2 implementation modified: NO
- Phase 3 reopened: NO
- Phase 5 implementation started: NO
- Phase 6 started: NO
- Files touched are limited to: `src/core/definitions/**`,
  `src/core/adapters/contract.ts` + `json.ts`,
  `src/core/registry/compile-ct-registry.ts`, `package.json` (test wiring),
  matching tests, and this document.
