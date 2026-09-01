PHASE 2C LAUNCHER IDENTITY COVERAGE IMPLEMENTED — REVIEW REQUIRED

# Phase 2C — Complete Launcher Identity Coverage + Phase 2 Exit-Gate Recheck

1. **Branch:** `review/gate2-5-doc-audit`
2. **Starting HEAD:** `8d5ee0f6594f0807d591a5aa7ebc5e9c3c3d3e05`
3. **Node version:** v22.23.2
4. **Pre-existing dirty baseline count:** 61 (unchanged from Phase 2B closeout)

5. **Existing launcher enum/model found:**
   - `InstallPlatform` (`src/core/install-discovery/types.ts:1`) only covered `steam | epic | gog | xbox | manual` — no representation for Ubisoft Connect, EA app, or Battle.net anywhere.
   - The legacy `games` table (manual-add flow) had no `launcher` column at all. Its manual-add form had a free-text "Launcher / Source" field, but it wrote into the unrelated `engine` column and was never read by any canonical/dedupe/rendering code — effectively decorative.
   - `Settings → Launchers & Accounts` already listed Ubisoft/EA/Battle.net rows, but with no `platformKey`, so they always showed "Not detected" / 0 games found regardless of reality.

6. **Exact launcher values added:** `ubisoft`, `ea`, `battlenet` — added to `InstallPlatform` (`src/core/install-discovery/types.ts`) and the new `GameLauncherIdentity` type (`src/shared/types/index.ts`). Full representable set is now `steam | epic | gog | xbox | ubisoft | ea | battlenet | manual`, matching all 8 roadmap-declared identities (`manual` = Standalone).

7. **Manual-add launcher behavior:** the existing "Launcher / Source" free-text field in the Add/Edit Game modal (`src/app/routes/GameLibrary.tsx`) was converted to a real `<select>` bound to a new `launcher` field, offering all 8 identities. It no longer writes into `engine` (that field is untouched and reserved for real engine detection, as it always was elsewhere in the codebase). Default is `manual` (Standalone); existing games with no stored value default the same way. No password/account credential input was added anywhere.

8. **Standalone/manual-source behavior:** unchanged and preserved as a real distinct identity. `manual` (Standalone) is chosen explicitly, never inferred just because a game was added by hand — a manually-added Ubisoft game persists `launcher=ubisoft`, not `manual`.

9. **Canonical migration behavior:** `buildEvidenceFromLegacyGame` (`src/core/canonical-games/migration.ts`) now uses `game.launcher ?? 'manual'` instead of a hardcoded `'manual'`. Migration remains idempotent (re-verified by test); existing Steam/GOG/Epic/Xbox/manual `installed_games`-sourced evidence is untouched (no changes to `buildEvidenceFromInstalledGame`).

10. **Deduplication behavior:** unchanged. `computeIdentityKey` (`src/core/canonical-games/identity.ts`) never reads `evidence.platform` for trust — trust comes only from `steamAppId`, `catalogGameId`, or executable-basename + title corroboration. New launcher values flow through this logic with zero special-casing, so they inherit the exact same trust tiers as Steam/GOG/Epic/Xbox always had.

11. **False-merge protections:** verified directly — two games sharing a title on Ubisoft and EA with distinct executables stay as two separate canonical games (trusted tier-3, distinct); a third title-only entry (Battle.net, no executable) that matches two distinct trusted buckets correctly routes to manual review rather than guessing. No launcher-specific product-ID trust was fabricated — Ubisoft/EA/Battle.net entries have no `launcherAppId`/`steamAppId` semantics implemented, so they only ever reach tier-3 (exe+title) or tier-4 (title-only) evidence, same as any other launcher without a real store-ID integration.

12. **Game Library representation:** `LAUNCHER_LABELS` and the installation-badge rendering in `GameLibrary.tsx` now cover all 8 identities ("Ubisoft Connect", "EA app", "Battle.net"). Verified via rendered E2E: a manually-added Ubisoft game shows the correct badge on its canonical card, with no duplicate cards and no fake Connected/Owned state.

13. **Launchers & Accounts representation:** `LaunchersAccountsSection.tsx` rewritten to source real per-launcher counts from `listGameLibrary({view:'all'})` (which merges auto-detected and manually-known installations) in addition to the existing `installDiscoveryList()` scan data. Ubisoft/EA/Battle.net now show "Known (manually added)" when a manually-added installation exists, "Games found" reflects the real count, and "Last scanned" honestly shows "Not applicable — no scanner exists" for the three launchers with no scanner, instead of a fabricated timestamp. No launcher shows a fake "Connected" state; no password field exists anywhere in the table.

14. **Auto-detection:** intentionally **not** added for Ubisoft/EA/Battle.net, per Step 11 — no registry/filesystem scanner was implemented for these launchers. They are representable, persistable, manually assignable, canonicalizable, renderable, and truthfully counted, which is the full Phase 2C scope.

15. **Persistence/schema changes:** one additive column, `launcher TEXT`, added to the `games` table via the existing `optionalGameColumns` / `ALTER TABLE ... ADD COLUMN` idempotent-migration pattern already used for `executablePath`/`coverPath`/etc (`src/core/database/index.ts`). No table was rebuilt or wiped. `game_installations.launcher` (canonical store) was already a plain `TEXT` column with no `CHECK` constraint — no schema change needed there. Old rows with `launcher IS NULL` are normalized to `'manual'` at read time (`normalizeLauncher()` in `src/core/games/index.ts`), so pre-existing manually-added records remain valid and unaffected.

16. **IPC/validation changes:** `AddGameSchema` and `UpdateGameSchema` (`electron/ipc-validation.ts`) gained an optional `launcher: z.enum([...8 values])` field — invalid/arbitrary strings are rejected by Zod as before. `update-game`'s handler in `electron/main.ts` now threads `parsed.launcher` through to `updateGame()`. No IPC schema was loosened or made permissive beyond this one additive field.

17. **Exact files modified:**
    - `electron/ipc-validation.ts`
    - `electron/main.ts`
    - `src/app/pages/settings/sections/LaunchersAccountsSection.tsx`
    - `src/app/routes/GameLibrary.tsx`
    - `src/core/canonical-games/migration.ts`
    - `src/core/database/index.ts`
    - `src/core/games/index.ts`
    - `src/core/install-discovery/index.ts`
    - `src/core/install-discovery/types.ts`
    - `src/shared/types/index.ts`
    - `src/types/global.d.ts`
    - `tests/game-library-render-model.test.ts`

18. **New files created:**
    - `tests/game-library-launcher-identity.e2e.test.ts`

19. **Focused launcher tests:** 8 new tests added to the existing `game library render model — launcher identity (Phase 2C)` suite in `tests/game-library-render-model.test.ts` (22/22 total in the file, up from 14/14 in Phase 2B):
    - manually-added Ubisoft/EA/Battle.net installations retain their real launcher, not `manual` (3 tests)
    - a pre-Phase-2C record with no stored launcher value defaults safely to `manual`
    - Steam + Ubisoft trusted corroboration merges to one canonical game, two installations
    - two distinct-executable same-title Ubisoft/EA entries stay separate (false-merge protection)
    - a title-only entry matching two distinct trusted buckets routes to manual review
    - repeated migration with new launcher identities remains idempotent

20. **Canonical/dedupe tests:** covered by items 19's corroboration, false-merge, and ambiguous-review tests — all pass.

21. **Manual-add tests:** covered by item 19's launcher round-trip tests (Ubisoft/EA/Battle.net) — all pass.

22. **Settings tests:** no automated component-test harness exists in this repo (unchanged from the Phase 2B report) — verified instead via `tsc` (both configs clean) and the new rendered E2E test, which asserts all 8 launcher labels appear in the Launchers & Accounts table and that zero `input[type="password"]` elements exist.

23. **Populated fixture results:** isolated temp-DB dry run (`SOLITH_TEST_USER_DATA_PATH`, deleted afterward) seeded Steam, GOG, Ubisoft (manual), EA (manual), Battle.net (manual), Standalone (manual), a Steam+Ubisoft trusted-corroboration pair, and an ambiguous same-title Ubisoft+EA+Battle.net trio. Result: `CANONICAL_COUNT=10, INSTALLATION_COUNT=11, PENDING_REVIEW_COUNT=1, LAUNCHER_VALUES_SEEN=battlenet,ea,gog,manual,steam,ubisoft, CORROBORATED_INSTALL_COUNT=2 (steam+ubisoft), AMBIGUOUS_TITLE_ONLY_REVIEWED=true`. (The 10th canonical game / 11th installation is the pre-existing seeded "Demo RPG Quest" fixture, consistent with Phase 2B's dry run.) All counts confirm correct behavior.

24. **Narrow rendered result (1024×768):** PASS — Ubisoft Connect badge visible on the seeded game's canonical card, all 8 launcher labels present in Launchers & Accounts, no horizontal overflow, zero password inputs.

25. **Standard rendered result (1440×900):** PASS — same checks.

26. **Maximized rendered result (1920×1080):** PASS — same checks.

27. **`npm audit`:** 0 vulnerabilities.

28. **Full `npm test`:** 1170/1170 + 10/10 (SQL suite) = 1180/1180 pass, 0 fail.

29. **`test:live-memory`:** 257/257 pass.

30. **Main TypeScript:** clean, 0 errors.

31. **Electron TypeScript:** clean, 0 errors.

32. **Vite build:** succeeded.

33. **Electron build:** succeeded.

34. **Electron output verifier:** 29/29 passed.

35. **Packaged smoke:** rebuilt `dist/win-unpacked` (IPC schema/DB column changed) and ran — 23/23 pass, 0 renderer/main errors.

36. **Accessibility E2E:** 8/8 pass.

37. **Walkthrough E2E:** 3/3 pass.

38. **Game Library/Electron E2E:** `test:electron-e2e` 4/4 pass (Gate 13 hash-verified repeatability); `game-library-responsive.e2e.test.ts` 3/3 pass; new `game-library-launcher-identity.e2e.test.ts` 3/3 pass.

39. **`git diff --check`:** PASS — only pre-existing benign LF/CRLF advisories, no conflict markers.

40. **Final dirty-tree count:** 74 (61 pre-existing baseline + 13 Phase 2C paths).

41. **Phase 2C-only changed-file list:** the 12 modified + 1 new file listed in items 17–18. (The remaining ~13 entries visible in `git status --short` beyond the 61 pre-existing baseline — `README.md`, `electron/trainer-research-ipc.ts`, `src/core/adapters/drill-core-settings.ts`, `src/core/companion/wisp.ts`, `tests/companion-wisp.test.ts`, `tests/gate2-5-frame-devtools-overlay-lifecycle.e2e.test.ts`, several `Docs/Security/Evidence/BatchB1_1_Closeout/Gate2_5/*` files, and `tests/fixtures/gate2-2-memory-fixture/{bin,obj}/` — were never touched by any tool call this turn and are confirmed to be additional entries within the same pre-existing stale baseline, not Phase 2C output.)

42. **Confirmation no Phase 3 work implemented:** confirmed — no Trainer Library ranking/Popular/All-Games/filter files were touched; no artwork pipeline, Wisp, live-memory, or security-roadmap files were touched.

43. **§2.2 metadata-source assessment (Step 17, inspection-only unless trivial/lossless):**
    - `developer`: **no trusted source exists today.** No field for this exists anywhere in the trainer catalog or any other data source in this repo. Planned later roadmap owner: Phase 5 (popularity/ranking pipeline research sources — Metacritic, IGDB, SteamDB, etc).
    - `publisher`: same as `developer` — no trusted source exists today. Same later roadmap owner (Phase 5).
    - `releaseDate`: no trusted source exists today. Same later roadmap owner (Phase 5).
    - `popularityMetadata`: **a trusted source already exists and was trivial/lossless to wire** — `src/core/catalog-demand/store.ts` (`getCatalogDemand`) already tracks real local `notifyCount`/`verificationRequests` per catalog game, in the exact shape `CanonicalGamePopularityMetadata` expects. Wired into `buildCanonicalGameForGroup` (`src/core/canonical-games/migration.ts`) — when a canonical game has a `catalogGameId` link, its real local demand counts now populate automatically. This is the one field from Step 17's list that met the "already present and trivial and lossless" bar; the other three did not, and no new pipeline was built for them.

44. **Remaining limitations:**
    a. `developer`, `publisher`, `releaseDate` remain unpopulated — no trusted source exists in this repo (Phase 5 territory, not a Phase 2C gap).
    b. `aliases` on `CanonicalGame` remains unpopulated by migration (carried over from Phase 2A/2B, unchanged).
    c. Ubisoft Connect, EA app, and Battle.net still have no auto-detection scanner — they are representable and truthfully counted, but only ever populated by manual add, exactly as scoped by Step 11.
    d. Games on Ubisoft/EA/Battle.net still cannot open the legacy per-game save-editor/trainer-detail route unless they're legacy-`games`-table-sourced (same pre-existing routing constraint from Phase 2B, unaffected by this phase).
    e. No React component-test harness exists for Settings UI — verified via `tsc` + rendered E2E instead, same approach as Phase 2B.
    f. install-discovery remains upsert-only with no prune/uninstall signal (unchanged from Phase 2B) — irrelevant to the new launchers since they have no scanner to begin with.

45. **Phase 2 exit-gate re-evaluation:**

    | Item | Status |
    |---|---|
    | 2.1 Canonical identity | **COMPLETE** — all 8 roadmap launcher identities are now representable, persistable, canonicalizable, and deduplicate safely. |
    | 2.2 Canonical game record | PARTIALLY COMPLETE — `genres` and `popularityMetadata` are populated where a trusted source exists; `developer`/`publisher`/`releaseDate` have no trusted source yet (Phase 5 territory). |
    | 2.3 Launcher release record | COMPLETE (unchanged from Phase 2B). |
    | 2.4 Installed game record | COMPLETE (unchanged from Phase 2B). |
    | 2.5 Game Library UX | COMPLETE (unchanged from Phase 2B). |
    | 2.6 Launcher settings | COMPLETE — all 8 launchers now show truthful Detected/Known/Connected/Games-found/Last-scanned state. |

    **PHASE 2 EXIT GATE SATISFIED.** The roadmap's literal exit-gate wording — "canonical identities prevent launcher duplicates and the Game Library behaves like a real installed-game hub" — is now fully met. The remaining §2.2 metadata gap (`developer`/`publisher`/`releaseDate`) does not block this wording; it belongs to Phase 5's ranking/popularity pipeline, which already owns the trusted external research sources needed to populate those fields correctly.

46. **Exact recommended next action:**

```text
Authorize commit/push of Phase 2C and close Phase 2, then begin the next
highest-priority unfinished roadmap phase.
```
