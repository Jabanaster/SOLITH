POST-PHASE-2 ROADMAP RECONCILED — NEXT PHASE IDENTIFIED

# Post-Phase-2 Roadmap Reconciliation Report

## 1. Branch
`review/gate2-5-doc-audit`

## 2. HEAD
`bae5473eff9dc80a734191853b36e447251bec51`

## 3. Dirty baseline
62 = 61 pre-existing baseline + 1 (`Docs/Reports/PHASE_2C_COMMIT_AND_PHASE_2_CLOSEOUT.md`, created untracked by the immediately prior authorization and never staged, per that authorization's own "DO NOT COMMIT OR PUSH" instruction). No anomaly — confirmed by diffing current `git status --short` against the known 61-file baseline set.

## 4. Active roadmap file reviewed
`ROADMAP.md` (full file read this turn, not a cached/stale copy).

## 5. Phase 1 current status
`ROADMAP.md`'s own header for Phase 1 still literally reads `**Status: PROPOSED**` (line 175) — the file has not been edited to reflect closure. This is a documentation lag, not evidence Phase 1 is actually open: per the roadmap's own authority model ("current repository code, current git state, and reproducible runtime/test evidence outrank stale roadmap claims"), the label text is not the source of truth.

Spot-checked current repository evidence against Phase 1's concrete requirements:
- 1.1/1.2 shell — sidebar collapse control present (`src/app/App.tsx`, `.sidebar-settings-btn` wiring confirmed).
- 1.3 Settings foundation — `src/app/pages/settings/settingsCategories.ts` contains exactly the 12 roadmap-listed categories (General, Appearance, Navigation, Game Library, Trainer Library, Launchers & Accounts, Catalog Updates, Artwork & Cache, Notifications, Privacy & Network, Advanced, About), each routed to its own section component via `SettingsPage.tsx` — matches "no single giant settings page."
- 1.4 Notification center — `src/app/components/NotificationBell.tsx` and `src/app/components/NotificationCenter.tsx` exist and are wired into `App.tsx`.

This is a reconciliation pass, not a full re-verification of every Phase 1 subsection (1.5 banner, 1.6 grid, 1.7 title hygiene were not individually re-tested this turn) — but the spot-checked evidence is consistent with the authorization's asserted prior verified closure, and no regression was found.

## 6. Phase 1 exit-gate assessment
Exit gate ("UI shell is stable, Settings exists, notifications work, banner/grid are responsive, and new malformed titles cannot be introduced") — consistent with CLOSED based on spot-checked evidence plus the authorization's asserted prior verification. No contradicting evidence found in this pass.

## 7. Any genuinely unfinished Phase 1 requirement
None identified in this pass. Phase 1 remains CLOSED.

## 8. Phase 2 current status
`ROADMAP.md`'s Phase 2 header also still literally reads `**Status: PROPOSED / EXTEND EXISTING SYSTEMS**` — same documentation-lag situation as Phase 1. Current code and the Phase 2C closeout report (`Docs/Reports/PHASE_2C_COMMIT_AND_PHASE_2_CLOSEOUT.md`, committed at `bae5473`) are the operative evidence.

## 9. §§2.1–2.6 classification
| Section | Classification | Basis |
|---|---|---|
| 2.1 Canonical identity | completed requirement | All 8 launcher-release identities first-class; dedup logic launcher-agnostic |
| 2.2 Canonical game record | non-blocking limitation | `developer`/`publisher`/`releaseDate` unpopulated — no trusted source exists yet; `ROADMAP.md` assigns trustworthy ranking/catalog sourcing to Phase 5, not Phase 2 |
| 2.3 Launcher release record | completed requirement | All listed fields present in `GameInstallation` schema |
| 2.4 Installed game record | completed requirement | detection source, manually-added flag, save locations all present |
| 2.5 Game Library UX | completed requirement | Installed-first hub behavior confirmed |
| 2.6 Launcher settings | non-blocking limitation | Detected/Connected/Games found/Last scanned present and truthful, no password field; per-row Rescan/Disconnect/Privacy-details controls absent — see item 11 |

## 10. Phase 2 exit-gate assessment
Roadmap's literal Phase 2 exit gate: "canonical identities prevent launcher duplicates and the Game Library behaves like a real installed-game hub." Both conditions are met. **SATISFIED** — reaffirmed, not overturned.

## 11. Treatment of §2.6 partial state
Classified as **non-blocking remaining polish / later work**, not an exit-gate blocker, because:
- The roadmap's Phase 2 exit-gate sentence (item 10) does not reference per-launcher Rescan/Disconnect/Privacy-details controls specifically — it references canonical-identity dedup and Game-Library-as-installed-hub behavior, both of which are satisfied.
- Disconnect is not meaningfully implementable today without violating the standing "do not build launcher OAuth" constraint (no launcher supports account connection yet, so there is nothing to disconnect).
- Rescan and per-row Privacy details are genuine, addressable gaps but are UI-completeness polish, not correctness, safety, or truthfulness defects — the table already avoids fabricating a "Connected" state and correctly distinguishes "Known (manually added)" from "Detected locally."
No explicit roadmap text elevates these to blockers, so the Phase 2 exit decision is not overturned.

## 12. Whether Phase 1 should be reopened
No. Remains CLOSED.

## 13. Whether Phase 2 should be reopened
No. Remains CLOSED — exit gate SATISFIED, reaffirmed this turn.

## 14. Next roadmap phase number
**Phase 3**

## 15. Next roadmap phase title
**Trainer Library: Popular, All Games, sorting, filters, support states**

## 16. Next phase exit gate
"Trainer Library discovery is useful by default and still supports full-catalog exploration."

## 17. Exact first unfinished subsection
**3.1 Support states** (immediately followed by 3.2 Catalog exclusion rules, which is a direct prerequisite input to 3.1's classification and to every later subsection). Confirmed via direct repository check: `src/app/pages/TrainerLibraryPage.tsx` currently contains no `Popular`, filter, or sort implementation — Phase 3 has no existing scaffolding to build on. This is a genuinely unstarted phase, not a partially-complete one.

## 18. Recommended bounded first implementation slice
**3.1 Support states + 3.2 Catalog exclusion rules — the classification foundation.**

Rationale for this exact slice (not a larger one):
- 3.3 (Default Popular view + ranking priority), 3.4 (All Games), 3.5 (Sorting), and 3.6 (Filters) all reference support-state and eligibility/exclusion values as inputs (e.g., "Verified SOLITH support" ranking tier, "Verified"/"Community/unverified" filter options, "Excluded" catalog state) — none of them can be correctly built without this classification existing first.
- It has a clear, independently testable acceptance boundary: every catalog game can be queried for its support state (Eligible/Listed/Community-Unverified/Verified/Unsupported/Excluded) and every excluded category (MMOs, competitive-online-only, cloud-only, demos, soundtracks, editors/tools, DLC-only, delisted) is correctly flagged.
- It does not depend on any later Phase 3 subsection, Phase 4, or Phase 5 work.
- It preserves all existing verified Phase 1/2 behavior — it only adds a new classification dimension to catalog data, it does not touch Game Library, canonical identity, or launcher code.

Do not bundle 3.3 Popular/ranking or 3.6 Filters UI into this same slice — those are separate, larger UI-facing pieces that should be authorized as their own bounded steps once the classification foundation is in place and verified.

## 19. Dependencies/blockers
None blocking the recommended slice. Downstream dependents: 3.3, 3.4, 3.5, 3.6 all depend on 3.1/3.2 being in place first — confirming the recommended ordering.

## 20. Carry-forward non-blocking backlog
| Item | Classification | Notes |
|---|---|---|
| Wisp overlay can obstruct Settings → Advanced action buttons | non-blocking backlog | UI layering/z-index issue; no assigned roadmap phase; does not block any current or next-phase exit gate |
| install-discovery lacks uninstall/prune signaling | non-blocking backlog | Future roadmap owner: Phase 6 (V1 core trainer/save/discovery gap audit — 6.1–6.6 scope covers discovery-accuracy verification) |
| canonical-only games may not enter legacy save-editor route | non-blocking backlog | Future roadmap owner: Phase 6.4 (save/resource workflow verification explicitly covers scanner/fingerprint/save-detection end-to-end) |
| ownership has no trustworthy evidence source | non-blocking backlog | No current roadmap owner; §2.5 already treats "ownership when actually proven" as conditional, so absence of an evidence source is a known, accepted gap rather than a defect |
| React component-test harness absent | non-blocking backlog | General engineering-quality debt; no specific roadmap phase owns test-infrastructure investment today |
| Phase 2.6 per-launcher Rescan/Disconnect/Privacy controls incomplete | non-blocking backlog | Already-disclosed Phase 2 residual (item 11); no assigned future phase — candidate for a small dedicated settings-polish authorization, not required before Phase 3 |

No regression-blocker or already-superseded items were found among the inspected set.

## 21. Exact recommended next action
Author and execute a new SOLITH.MD authorization scoped narrowly to **Phase 3.1 (Support states) + 3.2 (Catalog exclusion rules)** — the classification foundation only. Do not authorize 3.3 Popular/ranking, 3.4 All Games, 3.5 Sorting, or 3.6 Filters in the same pass; those are separate bounded slices to follow once 3.1/3.2 are implemented and verified.
