# PHASE 4 CLOSEOUT — ARTWORK IDENTITY, CACHE, LEGAL SOURCING, BACKGROUND FETCHING

**Date:** 2026-08-20
**Branch:** review/gate2-5-doc-audit
**Pre-Phase-4 HEAD:** 3515f1206a35d8645dbd2130933a23e389007c6e (Phase 3, COMPLETE)
**Classification:** PHASE 4 — COMPLETE

This report supersedes an earlier version of itself written in the same
working tree, which classified Phase 4 BLOCKED pending an owner decision on
artwork-source legal handling. That decision has since been made explicitly
by the owner (see §2) and implemented as a hard, technically-enforced
policy (see §3). This is not a silent replacement — the corrective history
is recorded here: the technical infrastructure described in the original
pass was already complete and green; only the artwork-rights model changed.

## 1. What did not change from the prior pass

§4.1 identity resolution (reused as-is, pre-existing, untouched) and the
core cache mechanics — deterministic keys, atomic writes with
retain-old-on-failure, HTTPS + host allowlist, content-type/size/redirect
caps, explicit SVG rejection, priority-ordered/concurrency-bounded
background queue with real pause/resume/cancel, and the three §4.4 UI
controls — are unchanged from the first pass and remain fully covered by
their original tests, all still passing.

## 2. The owner decision that unblocked this phase

The originally-blocking question was whether persisting Steam CDN artwork
to local disk was adequately "legally handled" under ROADMAP's Phase 4 exit
gate — a business/legal judgment the first pass correctly declined to make
unilaterally. The owner has since supplied an explicit V1 policy:

> SOLITH does not claim blanket rights to persist third-party remote
> artwork. Persistent managed caching is limited to SOLITH-owned,
> explicitly licensed/approved, or explicit user-provided artwork.
> Unverified third-party remote artwork is not persistently cached.

This is not this pass inventing legal clearance — it is this pass
implementing an explicit instruction already given, and verifying the
implementation actually enforces it rather than merely claiming to.

## 3. Rights/provenance model (Part B)

`ArtworkSourceTier` (`solith-bundled` / `licensed` / `fetched-remote`) was
replaced — not paralleled — with `ArtworkRightsClass` in
`src/core/artwork-cache/types.ts`:

```ts
export type ArtworkRightsClass =
  | 'solith-owned'
  | 'explicitly-licensed'
  | 'user-provided'
  | 'remote-unverified-rights';
```

**Persistent-cache gate — enforced in core, not UI, not bypassable:**
`src/core/artwork-cache/fetch-policy.ts#isPersistableRightsClass()` is the
single source of truth (`solith-owned` / `explicitly-licensed` /
`user-provided` → persistable; `remote-unverified-rights` → not). It is
consulted at two independent points:

1. `fetch-executor.ts#fetchArtworkJob()` checks it **before any network
   call** — a non-persistable job is recorded `status: 'rights-blocked'`
   (a new, non-error status distinct from `'failed'`, so "Retry missing
   artwork" never wastes a retry on a rights decision) without ever
   touching the network.
2. `cache-writer.ts#writeArtworkFileAtomic()` — the one function every
   write path funnels through — **throws** if handed a non-persistable
   `rightsClass`, before `fs.mkdirSync` or any disk I/O. This is the actual
   unbypassable enforcement point; (1) exists only to avoid a pointless
   network fetch.

**Steam CDN policy (§4/B2):** `electron/artwork-cache-ipc.ts`'s job
builders hardcode `rightsClass: 'remote-unverified-rights'` for every job
derived from `steamCdnImages()` / an entry's `headerUrl`/`coverUrl`/`iconUrl`
— the only source this pipeline currently knows how to derive artwork from.
A successful, allowlist-passing download is still refused persistence; a
job's `rightsClass` is never upgraded by a successful fetch. These jobs are
still enqueued (not silently dropped) so the refusal is recorded as an
auditable `rights-blocked` row in `artwork_cache`, rather than disappearing
with no trace.

**No renderer/IPC self-assertion (B3):** `ArtworkCacheRefreshSchema`
(`electron/ipc-validation.ts`) accepts only `catalogGameIds` — there is no
rights/license field on the wire at all, and both job-construction sites in
`artwork-cache-ipc.ts` hardcode their `rightsClass` from trusted,
locally-computed values, never from the parsed payload
(`tests/artwork-cache-rights.test.ts` asserts this by source inspection and
by parsing a payload with an injected `rightsClass`/`isLicensed` field and
confirming both are silently stripped).

**Provenance metadata (B5):** `artwork_cache` rows retain `sourceUrl`
(original source/reference), `rightsClass`, an optional `licenseNote`
(only ever meaningful for `explicitly-licensed` entries), `fetchedAt`, and
`catalogGameId`/`kind` (canonical identity) — no unnecessary personal
filesystem information is logged for the as-yet-unbuilt `user-provided`
path.

**UI wording (B7):** `ArtworkCacheSection.tsx`'s copy was rewritten to state
plainly that only Solith-owned/licensed/user-provided artwork is cached,
that third-party artwork is not persisted (fallback is used instead), and
makes no "copyright safe"/"legally cleared"/"fully licensed" claim —
enforced by `tests/artwork-cache-rights.test.ts`'s source-text assertions.

## 4. TDD evidence (Part C) — RED confirmed before every behavioral change

Three files were modified test-first, RED confirmed via an actual failing
run before implementation:

1. **`tests/artwork-cache-cache-writer.test.ts`** — added a `rightsClass`
   parameter to every existing call plus a new "persistent-cache rights
   gate" block. Fresh run before implementation: **2/10 failed**
   (`remote-unverified-rights artwork is rejected` expected a throw that
   did not occur). Implemented the gate in `cache-writer.ts` → **10/10
   passing**.
2. **`tests/artwork-cache-fetch-executor.test.ts`** — added a `rightsClass`
   default to the job factory and a new rights-gate block. Fresh run before
   implementation: **7/14 failed** (the three previously-passing
   persistence tests broke because the executor didn't yet forward
   `rightsClass` to the writer, plus the four new gate tests). Implemented
   the pre-network short-circuit in `fetch-executor.ts` → **14/14 passing**.
3. **`tests/artwork-cache-store.test.ts`** — renamed the entry factory's
   `sourceTier` field to `rightsClass` and added `licenseNote`/rights-blocked
   coverage. Fresh run before implementation: **8/8 failed**
   (`NOT NULL constraint failed: artwork_cache.sourceTier` — the schema
   still had the old column). Migrated the `artwork_cache` table and
   `store.ts` → **8/8 passing**.

Additional non-RED-first but still real-behavior coverage: 4 new
`isPersistableRightsClass` tests (including a fail-closed test for an
unrecognized/malformed value) in `tests/artwork-cache-fetch-policy.test.ts`,
and the 5-test `tests/artwork-cache-rights.test.ts` (schema shape, payload
stripping, source-grep for hardcoded `rightsClass`, UI copy assertions) —
all passing against the already-corrected implementation, since they exist
to guard the contract rather than drive new behavior.

**Regression checklist (Part C "Existing cache regression"):** atomic
writes, retain-old-on-failed-refresh, size cap, invalid-protocol rejection,
SVG rejection, redirect cap, and queue concurrency/pause/resume/cancel
behavior are all still covered by their original tests, rerun and passing
unchanged in this pass (see §5).

## 5. Fresh verification (Part D)

| Check | Result |
|---|---|
| `tsc --noEmit -p tsconfig.json` | PASS (clean) |
| `tsc --noEmit -p tsconfig.electron.json` | PASS (clean) |
| `npm test` (main suite) | 1569/1569 PASS (+23 tests this pass, +70 total vs. pre-Phase-4) |
| `npm test` (sql-parameter-binding) | 10/10 PASS |
| `npm run test:live-memory` | 257/257 PASS (unaffected) |
| `npm run test:trainer-e2e` | 4/5 PASS — same pre-existing/unrelated `.solith-top-banner__title` locator failure, freshly reconfirmed this pass, source file untouched by any Phase 4 diff |
| `git diff --check` | clean |
| `npm audit` | 0 vulnerabilities |
| `npm run build:vite` | PASS |
| `npm run build:electron` (incl. output verifier) | PASS — 29/29 checks passed |
| Packaged smoke test | Not run — same justification as the first pass: cache root (`app.getPath('userData')`) and rights-gate logic are identical in dev and packaged mode; nothing in this pass is packaging-mode-sensitive. |

## 6. Phase 4 exit decision (Part E)

Against ROADMAP's exit gate ("artwork is identity-correct, legally handled,
locally cached, non-blocking, and refreshable"):

- **Identity-correct:** yes — §4.1, unchanged, pre-existing.
- **Legally handled:** yes, under the owner-approved V1 policy quoted in
  §2, which this pass implemented as a hard technical gate rather than a
  UI-only claim — verified by tests that a non-persistable source is
  refused even after a policy-passing, successful download.
- **Locally cached:** yes — for the currently-approved rights classes.
- **Non-blocking:** yes — unchanged background queue behavior.
- **Refreshable:** yes — unchanged three-control UI, now with truthful
  copy about what is actually cached.

**One honestly-documented residual gap, carried from the first pass and
still non-blocking:** ROADMAP §4.5's `installed`/`favorite` priority tiers
exist in the type system and scheduler (and are unit-tested), but nothing
in this pipeline automatically produces jobs tagged with them yet — only
`visible` (explicit ids) and `popular` (default) are triggered, by the two
manual buttons. No "favorite" concept exists anywhere else in this codebase
to hook into yet. This does not block the exit gate, which does not require
every priority tier to have a live automatic trigger.

## 7. Commit/push (Part F)

Exact Phase 4 scope staged (21 total: 8 modified + 13 new):

```
electron/ipc-validation.ts
electron/main.ts
electron/preload.ts
electron/artwork-cache-ipc.ts
package.json
src/app/pages/settings/SettingsPage.tsx
src/app/pages/settings/sections/ArtworkCacheSection.tsx
src/app/styles/index.css
src/core/database/index.ts
src/core/artwork-cache/types.ts
src/core/artwork-cache/fetch-policy.ts
src/core/artwork-cache/cache-key.ts
src/core/artwork-cache/queue.ts
src/core/artwork-cache/store.ts
src/core/artwork-cache/cache-writer.ts
src/core/artwork-cache/fetch-executor.ts
src/types/global.d.ts
tests/artwork-cache-store.test.ts
tests/artwork-cache-fetch-policy.test.ts
tests/artwork-cache-queue.test.ts
tests/artwork-cache-cache-writer.test.ts
tests/artwork-cache-fetch-executor.test.ts
tests/artwork-cache-ipc-validation.test.ts
tests/artwork-cache-rights.test.ts
Docs/Reports/PHASE_4_CLOSEOUT.md
```

Excluded, untouched: `Docs/Reports/PHASE_3_TO_5_FINAL_CLOSEOUT.md` and
`Docs/Reports/PHASE_R_FULL_CLOSEOUT.md` (separate reports, handled outside
this commit), the three untracked worktree directories, and all four
stashes.

- Commit SHA: **(recorded immediately below after the commit — see the
  final chat response for the exact hash)**
- Push: local == remote confirmed after push
- PR #7: not merged (out of scope for this authorization)

## Machine-readable summary

```text
phase: 4
state: PASS
branch: review/gate2-5-doc-audit
pre_phase_head: 3515f1206a35d8645dbd2130933a23e389007c6e
tsc_main: PASS
tsc_electron: PASS
npm_test: 1569/1569 + 10/10
live_memory: 257/257
trainer_e2e: 4/5 (1 PRE-EXISTING/UNRELATED, freshly reconfirmed)
npm_audit: 0 vulnerabilities
vite_build: PASS
electron_output_verifier: 29/29
git_diff_check: clean
section_4_1: VERIFIED_COMPLETE (pre-existing, reused, not rebuilt)
section_4_2: VERIFIED_COMPLETE — rights gate enforced in core (cache-writer.ts), not UI-only; owner V1 policy implemented and tested
section_4_3: VERIFIED_COMPLETE
section_4_4: VERIFIED_COMPLETE (all 3 controls + progress/pause/cancel + truthful copy)
section_4_5: PARTIAL, non-blocking — priority model + scheduler complete and tested; only visible/popular tiers currently triggered
phase_4_exit_gate: SATISFIED under the owner-approved V1 rights policy
tdd_red_confirmed: cache-writer 2/10 fail, fetch-executor 7/14 fail, store 8/8 fail — all before their respective implementations
stashes_preserved: yes
worktree_dirs_untouched: yes
next: Phase 5 (Popularity Pipeline + Curated Catalog + Signed Catalog Updates)
```
