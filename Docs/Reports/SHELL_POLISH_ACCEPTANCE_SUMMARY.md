# Shell polish acceptance summary — `v2.1-shell-polish` candidate

**Status:** Evidence for tag candidate — **gates PASS** at `620e76d`; artifacts on `master` tip including this summary · **do not tag** until user says **TAG IT**  
**Date:** 2026-07-15  
**Remote `master` tip (local):** evidence commits atop `a9483f6`

---

## Accepted offline scope

| Area | Evidence |
|------|----------|
| Banner / shell branding | `405dcc6` … `a9483f6` asset + `SolithTopBanner` / prepare:branding |
| Sidebar compact + icons | `b21856b`, `c56711b`, module artwork mapping |
| Accessibility | `0a655d3` axe gate + contrast |
| Catalog seed 1000 | `e25b896` |
| Binary save research stubs | `56b8487` |
| Research Lab (Milestone L) | `v1-milestone-l-research-lab-accepted` @ `cdd8c51` |
| In-process pilot (Milestone M) | `v1-milestone-m-in-process-pilot-accepted` @ `97326d7` |
| Adoption AA–AF | Install discovery, deck, health, process toast, demand — on `master` |
| UI hierarchy | `Docs/SOLITH_UI_HIERARCHY.md` |

## Out of scope for this tag

- Live connection baselines (Milestone S)
- L3/L4 certification with in-game evidence (Milestone U live)
- Commercial binary `canWrite` promotion (Milestone X)
- Managed runtime (Milestone Z)
- Adoption **AG** polish (packaged-smoke title/`parseSave` alignment)

## Known waivers

- Packaged-smoke points that expect window title `ResourceForge` while product displays `Solith` — document as product rename; fix under AG.
- `git clone --local` on Windows may fail commit-graph links; `npm ci` on clean tree is the accepted reproducibility substitute when documented.

## Related artifacts

- `Docs/Reports/RELEASE_EVIDENCE_PACK_PROPOSAL.md`
- `Docs/Reports/FRESH_CLONE_VERIFICATION_2026-07-12.md` (re-gate required at current HEAD)
- `Docs/Reports/GATE_OUTPUT_2026-07-12.txt`
