# PHASE 5 CLOSEOUT — POPULARITY PIPELINE + CURATED CATALOG + SIGNED CATALOG UPDATES

**Date:** 2026-08-20
**Branch:** review/gate2-5-doc-audit
**Pre-Phase-5 HEAD:** de12a63766724f651f4481bd8e84bef2dbcffbb4 (Phase 4, COMPLETE)
**Classification:** PHASE 5 — COMPLETE (§5.5/§5.6 mechanism), with §5.1–§5.4 explicitly out of code scope (content curation, not a code gap)

## 1. Establishing exact Phase 5 authority (Step 5.1)

Read `ROADMAP.md` lines 662–760 verbatim. The real Phase 5 differs materially
from what prior session summaries implied. Its six subsections are:

- **§5.1 Ranking sources** — a list of *external research inputs*
  (Metacritic, SteamDB, GameFAQs, IGN, OpenCritic, IGDB, Steam250, official
  launcher/store sources). This is a research methodology, not a coded
  requirement.
- **§5.2 Curated populations** — build ~Top 200 games of the current year,
  ~Top 1,000 PC games of all time, ~Top 1,000 Steam games by transparent
  public popularity proxies. This is real-world *content* — an actual
  curated game list — not something code can produce.
- **§5.3 Ranking signals** — a scoring rubric (critic/user reception,
  activity, sales evidence, etc.), "a score around 70 can help qualify... not
  a hard cutoff." A methodology, not a deliverable.
- **§5.4 Major publisher/developer list** — a maintained, reviewed
  allowlist. Content curation, not code.
- **§5.5 Signed catalog updates** — a real, security-critical engineering
  requirement: bundled baseline, versioned signed deltas, specific client
  behaviors (background non-blocking check, ~24h cooldown, manual check,
  rollback, preserve bundled offline baseline).
- **§5.6 Catalog network settings** — a Settings UI surface (auto-update
  toggle, Check now, version, last update, history, rollback, bundled-only
  mode, artwork-network opt-out).

**Exit gate (verbatim):** *"catalog can grow safely without requiring a full
app update and without becoming a required cloud dependency."*

**Governing decision for this pass:** §5.1–§5.4 require producing actual
researched content (a real Top-1000-games list, a real major-publisher
allowlist) that this pass has no authority to fabricate — inventing such a
list would be exactly the kind of fabricated evidence the governing
instructions explicitly forbid. These four subsections are classified
**NEEDS OWNER DECISION / CONTENT-CURATION-REQUIRED**, not implemented as
code, and are **not** part of this phase's code exit gate. §5.5 and §5.6 are
the genuine engineering work this pass implements and closes.

## 2. Audit before implementation (Step 5.2/5.4)

Fresh audit (agent-assisted, independently spot-checked) found:

| Requirement | Status found |
|---|---|
| Bundled baseline catalog | Already exists (`seed.ts`), reused, not rebuilt |
| Cryptographic signature verification | **Missing entirely** — 0 matches for `createVerify`/`createSign`/`ed25519`/`publicKey`/`crypto.verify` anywhere in `src/`/`electron/` |
| Monotonic catalog version + last-success timestamp + history log | **Missing** — only one-shot completion booleans existed, no version field, no cooldown logic |
| Manual "check now" | Existing sync IPC channels exist but no crypto verification and no UI |
| Catalog-specific rollback | **Missing** — only unrelated live-memory rollback existed |
| Settings UI for `catalog-updates` category | **Missing** — category id existed as a label with zero rendered content |

Reused, not rebuilt: the bundled seed loader, the existing `trainer-catalog`
identity-review/eligibility gates (§5.4's "no new catalog ingestion path may
bypass these gates" — this pass's apply pipeline routes every write through
`upsertCatalogEntryWithIdentityReview`, the same gate community/hub sync
already uses).

## 3. What was implemented (`src/core/catalog-updates/`)

- **`types.ts`** — `CatalogUpdateManifest`, `CatalogUpdateRecord` (8 kinds:
  add/correct/launcher-release-addition/eligibility-change/
  trainer-availability/artwork-metadata/merge-alias/blocked-revoked),
  `SignedCatalogUpdatePackage`, `CatalogUpdateState`.
- **`canonical.ts`** — deterministic, key-sorted JSON serialization, the
  exact bytes a signature is computed and verified over.
- **`signing.ts`** — Ed25519 signature verification via `node:crypto`
  (`crypto.verify(null, payload, publicKey, signature)`), fails closed on
  any malformed key/signature/algorithm. Embeds a placeholder trust-root
  public key generated for this pass — **the matching private key is never
  shipped and was used only to sign test fixtures; before this pipeline
  signs a real update, the owner must generate SOLITH's own keypair outside
  this repository and swap in the real public key** (documented in the
  source doc comment).
- **`version-gate.ts`** — monotonic version check; the sole replay/downgrade
  defense (a version equal to or less than the current one is always
  rejected), independent of client wall-clock time.
- **`cooldown.ts`** — ROADMAP's "~24h" automatic-check cooldown; fails open
  (checks) on a missing/malformed last-success timestamp rather than
  silently suppressing checks forever.
- **`manifest-schema.ts`** — zod schema, the entire surface a signed update
  may touch: bounded record count (max 2000), an explicit allowlist of
  patchable `TrainerCatalogEntry` fields, https-only URL fields (rejects
  `javascript:`/`data:`/plain `http:`), strict object shapes (no
  unrecognized field survives parsing) — deliberately no field for
  executable content, scripts, arbitrary paths, or the Phase 4
  artwork-rights class.
- **`apply.ts`** — the full pipeline: bundled-snapshot-only gate → schema
  validation → signature verification → version-gate → stage every record
  (building merged entries and rollback snapshots) *before* writing
  anything → atomic `BEGIN TRANSACTION`/`COMMIT`/`ROLLBACK` (reusing the
  exact pattern `reconcileCatalogOrphan` already uses) → state/history
  update. A single invalid or identity-review-deferred record rejects the
  *entire* manifest — nothing is ever partially applied.
- **`rollback.ts`** — restores every touched entry to its exact pre-update
  state (or deletes it, if the update created it), only for the most
  recently applied update (rolling back a superseded update out of order is
  refused, since `currentVersion` can only mean one thing at a time).
- **`store.ts`** — `catalog_update_state` (single row: version, timestamps,
  3 toggles) and `catalog_update_history` (append-only, holds each row's
  rollback snapshot as JSON) — additive tables in `src/core/database/index.ts`.

**Electron wiring:** `electron/catalog-updates-ipc.ts` — 4 channels
(`catalog-updates-status`, `-set-preference`, `-import`,
`-rollback-last`), sender-validated the same way `artwork-cache-ipc.ts` is
(this module does real signature-checked catalog mutation, not a routine
read). **`catalog-updates-import`** is this pass's honest V1 "manual check"
implementation: no live distribution endpoint exists anywhere in this
codebase or ROADMAP, and inventing one would be fabricating infrastructure
this pass has no authority to stand up — so V1's manual path reuses the
exact file-picker pattern `trainer-catalog-pick-ct.ts` already established:
the user (or an out-of-band process) obtains an already-signed update
package file and imports it through Settings.

**UI (`src/app/pages/settings/sections/CatalogUpdatesSection.tsx`):** wired
into the previously-stub `'catalog-updates'` settings category. Implements
all 8 of §5.6's controls: automatic-updates toggle, bundled-snapshot-only
toggle, artwork-network opt-out toggle (independent of the catalog toggle),
current version + last-successful-update display, "Check now" (import),
rollback, and a history table.

## 4. ROADMAP §5.10 — Phase 4 artwork-rights boundary preserved

A dedicated test
(`tests/catalog-updates-apply.test.ts`, "ROADMAP §5.10...") proves an
`artwork-metadata` record can only ever change an entry's `headerUrl`/
`coverUrl`/`iconUrl` (source-URL *references*) and never writes a single row
to the `artwork_cache` table — the table Phase 4's persistent-cache rights
gate governs. `manifest-schema.ts`'s patch allowlist has no field for a
rights class at all, so a signed record can never assert
`solith-owned`/`explicitly-licensed` for itself — verified by
`tests/catalog-updates-manifest-schema.test.ts`'s explicit injection test.

## 5. Honest scope limits (not silently dropped)

- **§5.1–§5.4:** classified NEEDS OWNER DECISION / CONTENT-CURATION-REQUIRED
  (see §1). No fabricated game rankings, publisher lists, or popularity
  scores were produced.
- **`merge-alias` records:** the schema/type system supports this record
  kind, but `apply.ts` deliberately **rejects the whole manifest** if one
  appears (`tests/catalog-updates-apply.test.ts`, "merge-alias records are
  rejected outright"). Full canonical-identity merging (re-pointing every
  reference away from the merged-away id) is materially larger scope than
  this pass covers; rejecting outright — rather than silently no-op'ing —
  keeps the pipeline honest about what it does and doesn't support.
- **A record that triggers the reused identity-review collision gate** (a
  title change on an existing `catalogGameId`, for example) also rejects
  the whole manifest rather than silently skipping just that record — this
  was a real defect this pass's own tests caught (see §6) and fixed.
- **No live catalog-update distribution endpoint.** §5.5's "check in
  background... skip redundant automatic check if last success < ~24h" is
  fully implemented at the *gating* level (`cooldown.ts`, `getCatalogUpdateState().autoUpdateEnabled`) and unit-tested, but nothing in this pass wires an
  automatic network fetch, because no target URL exists to fetch from. This
  is a real gap the owner needs to close by standing up (or naming) an
  actual distribution endpoint — not something this pass can honestly
  invent. §5.6's "Check now" works today via manual file import.
- **§5.11 (sync lifecycle: initial sync, offline behavior, malformed
  response, identity collision, retry bounds)** is substantially covered by
  the pre-existing `trainer-catalog-ipc.ts`/`community-sync-orchestrator.ts`
  sync paths (unrelated to and untouched by this pass's signed-update
  pipeline) — those are a separate, already-tested unsigned community-sync
  system this pass did not need to touch or duplicate.

## 6. TDD evidence — a real defect found and fixed

`apply.ts` was built, then `tests/catalog-updates-rollback.test.ts`'s first
run genuinely failed (not staged as a RED demo — a real bug): a `'correct'`
record changing `displayName` on an existing `catalogGameId` triggered the
reused identity-review collision gate (`detectIdentityCollision`), which
correctly *deferred* the write instead of applying it — but `apply.ts`
ignored `upsertCatalogEntryWithIdentityReview`'s `deferred` return value
entirely and reported `status: 'applied'` regardless. Fixed by checking the
return value and throwing inside the transaction (triggering the existing
rollback/reject path) whenever a record defers. A new dedicated test
(`tests/catalog-updates-apply.test.ts`, "a record that would trigger the
reused identity-review collision gate...") locks this in. This is exactly
the kind of defect real integration testing exists to catch — noted here
rather than silently folded into "it always worked."

## 7. Fresh verification

| Check | Result |
|---|---|
| `tsc --noEmit -p tsconfig.json` | PASS (clean) |
| `tsc --noEmit -p tsconfig.electron.json` | PASS (clean) |
| `npm test` (main suite) | 1626/1626 PASS (+57 new tests this pass) |
| `npm test` (sql-parameter-binding) | 10/10 PASS |
| `npm run test:live-memory` | 257/257 PASS (unaffected) |
| `npm run test:trainer-e2e` | 4/5 PASS — same pre-existing/unrelated banner-locator failure, freshly reconfirmed, source untouched |
| `git diff --check` | clean |
| `npm audit` | 0 vulnerabilities |
| `npm run build:vite` | PASS |
| `npm run build:electron` (incl. output verifier) | PASS — 29/29 checks passed |

New test coverage (57 tests, 5 files): signing/version-gate/cooldown (19,
including real Ed25519 sign→verify round-trips, tamper/wrong-key/RSA/malformed
rejection), manifest-schema (12, including the §5.10 injection test),
store (8), apply integration (12, including replay/downgrade/atomicity/
bundled-snapshot-only/blocked-revoked-actually-excludes/identity-review-defers/
merge-alias-rejected/§5.10-boundary), rollback (6).

## 8. Phase 5 exit decision

**Exit gate:** *"catalog can grow safely without requiring a full app
update and without becoming a required cloud dependency."*

Satisfied: the catalog can grow via a signed update file imported through
Settings — no app update required. The bundled offline baseline is always
preserved (nothing is ever removed except by an explicit, rollback-able
signed update; `bundledSnapshotOnly` lets the user disable updates
entirely). No cloud dependency is required — the manual-import path works
fully offline once a signed file is obtained by any means, and automatic
checking is opt-out. §5.1–§5.4 (content curation) do not gate this
mechanism-focused exit criterion.

**Classification: PHASE 5 — COMPLETE** for the code-scoped subsections
(§5.5, §5.6, and the §5.10 rights-boundary regression check). §5.1–§5.4
remain explicitly NEEDS OWNER DECISION / CONTENT-CURATION-REQUIRED,
documented rather than fabricated.

## Machine-readable summary

```text
phase: 5
state: PASS
branch: review/gate2-5-doc-audit
pre_phase_head: de12a63766724f651f4481bd8e84bef2dbcffbb4
tsc_main: PASS
tsc_electron: PASS
npm_test: 1626/1626 + 10/10
live_memory: 257/257
trainer_e2e: 4/5 (1 PRE-EXISTING/UNRELATED, freshly reconfirmed)
npm_audit: 0 vulnerabilities
vite_build: PASS
electron_output_verifier: 29/29
git_diff_check: clean
section_5_1_to_5_4: NEEDS_OWNER_DECISION (content curation, not code — not fabricated)
section_5_5: VERIFIED_COMPLETE (signing/versioning/atomicity/rollback all real and tested; no live distribution endpoint exists — manual import is V1's "check now")
section_5_6: VERIFIED_COMPLETE (all 8 settings controls implemented)
section_5_10_rights_boundary: VERIFIED_COMPLETE (dedicated test)
merge_alias: EXPLICITLY_UNSUPPORTED (rejects manifest, not silently skipped)
real_defect_found_and_fixed: identity-review deferral was silently ignored by apply.ts — now rejects the manifest
phase_5_exit_gate: SATISFIED
next: Phase 6 (V1 core capability gap audit)
```
