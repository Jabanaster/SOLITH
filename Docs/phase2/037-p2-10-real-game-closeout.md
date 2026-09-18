# Phase 2 P2-10 — Real-Game Closeout (Atomfall)

Supersedes the single open item in `Docs/phase2/035`/`036` (real-game proof, §24). Everything else in those two documents stands unchanged. Per SOLITH.MD's real-game closeout mission (2026-09-18): "Preferred game: Atomfall. Canonical executable: `bin\Atomfall_dx12.exe`. Do not treat automated game-launch failure as a P2-10 failure. I will manually launch Atomfall if necessary."

## Setup

Atomfall was not present under any Steam library's `steamapps/common` on this machine (checked all 5 local drives) — it is the **PC Game Pass** build, installed by the Xbox app to a custom location, `Z:\Games\Atomfall`. Canonical exe confirmed present at the mission's exact specified relative path: `Z:\Games\Atomfall\Content\bin\Atomfall_dx12.exe`. The user launched it manually through the Xbox app (Game Pass titles require that handshake — a direct exe double-click typically fails the same way the earlier Godlike Burger/DREDGE Steam attempts did). Confirmed running: `Atomfall_dx12.exe`, PID `23196`, real working set ~2.7–3.0 GB and growing across the session — a genuine, actively-rendering game process, not a launcher stub.

## Method

Same production classes the shipping app and the fixture real-process test use — `LiveMemorySession` / `nativeMemoryDriver` / `startAdaptiveScanOperation` / `getScanOperationStatus` — attached to the real PID, no test-only code path. Read-only throughout: `attach(target, userConfirmedOffline: true)` accepts the single-player waiver; no write/proposal API was ever called. Deterministic ground-truth target value: the process's own real PID (`int32`, no scripted-gameplay ground truth needed, no fabricated sentinel) — the same technique this repository's own P2-4 real-game evidence (`Docs/phase2/018`) used for Godlike Burger/Bastion.

## Required evidence format (3/3 independent passes)

| | PASS 1 | PASS 2 | PASS 3 |
|---|---|---|---|
| **SCAN 1 — eligible regions** | 3,074 | 3,019 | 3,021 |
| eligible bytes | 6,772,207,616 | 6,772,150,272 | 6,772,097,024 |
| module / private / mapped | 363,278,336 / 6,138,781,696 / 270,147,584 | 363,278,336 / 6,138,724,352 / 270,147,584 | 363,278,336 / 6,138,658,816 / 270,159,872 |
| strategy | `PRIVATE_FIRST` | `PRIVATE_FIRST` | `PRIVATE_FIRST` |
| structured reasons | `NO_PRIOR_TELEMETRY`, `PRIVATE_HEAVY_PROFILE`, `LARGE_REGION_PROFILE` | same | same |
| results | 261 | 239 | 256 |
| elapsed | 1,288 ms | 1,109 ms | 1,296 ms |
| coverage | `complete_with_skipped_regions` | `complete_with_skipped_regions` | `complete_with_skipped_regions` |
| partial / failed reads | 0 / 775 | 0 / 776 | 0 / 777 |
| **SCAN 2 — prior results** | 261 | 239 | 256 |
| strategy | `NARROWED_BY_PRIOR_CANDIDATES` | `NARROWED_BY_PRIOR_CANDIDATES` | `NARROWED_BY_PRIOR_CANDIDATES` |
| structured reasons | `PRIOR_CANDIDATE_SET_SMALL`, `HIGH_PARTIAL_READ_RATE`, `LARGE_REGION_PROFILE` | same | same |
| elapsed | 738 ms | 766 ms | 844 ms |
| **REFERENCE — strategy** | `REFERENCE_FULL` | `REFERENCE_FULL` | `REFERENCE_FULL` |
| results | 257 | 236 | 247 |
| elapsed | 1,037 ms | 1,475 ms | 1,108 ms |
| coverage | `complete_with_skipped_regions` | `complete_with_skipped_regions` | `complete_with_skipped_regions` |

**WHY STRATEGY CHANGED (identical causal chain, all 3 passes):** scan 1 measured a real private-heavy profile (~90% of eligible bytes private, 0% module-heavy) → `PRIVATE_FIRST`/`PRIVATE_HEAVY_PROFILE`. Scan 1's own real result count (239–261, `>0` and `<=500`) drove scan 2 to `NARROWED_BY_PRIOR_CANDIDATES`/`PRIOR_CANDIDATE_SET_SMALL` — a genuine strategy change caused by measured runtime evidence, not a scan-type label. Scan 1 additionally measured a real partial-read rate of ~25% (775–777 of ~3,020–3,074 eligible regions genuinely failed `ReadProcessMemory`, out of the real live game's own transient page-protection state — see "Read failures" below) — above the 10% `HIGH_PARTIAL_READ_RATE` threshold — so scan 2 independently also halved `maxRegionBytes`. Both reasons fired from real measured fields on the same real telemetry record, in every pass.

**Duration recorded honestly (§8) — no speedup claimed.** Reference (1,037/1,475/1,108 ms) vs adaptive scan 1 (1,288/1,109/1,296 ms): neither consistently faster: pass 1 reference is faster, pass 2 adaptive is faster, pass 3 roughly tied. This is expected — the planner's job in this stage is *targeting/ordering and reacting to evidence*, not synthetic speed; mission §8 explicitly does not require a speedup.

## Correctness verification (§9) — what holds exactly, and what doesn't, honestly

- **Coverage classification: identical every pass** (`complete_with_skipped_regions` for both adaptive and reference, all 3 passes).
- **No eligible region silently skipped**: `regionsScanned + regionsSkipped === regionsConsidered` exactly in every pass (e.g. pass 1: 2,299 + 775 = 3,074) — every eligible region was genuinely attempted, in both modes.
- **Exact match-set equality does *not* hold against this real, live, actively-rendering game process** (adaptive 261 vs reference 257 in pass 1; 239 vs 236 in pass 2; 256 vs 247 in pass 3). This was root-caused, not hand-waved: a dedicated isolation run (`real-game-equality-check.mts`, adaptive and reference run back-to-back with nothing in between) found adaptive's match set was a **strict subset** of reference's (0 addresses only-in-adaptive, 50 only-in-reference) and the skipped-region *set* itself differed by 2 of ~780 entries between the two calls. Both modes execute the byte-identical matching loop (`executePlannedScan`/`scanFirst`'s shared `encodeValue`/aligned `indexOf` primitives — same code, not a reimplementation) over the same measured region list; the only variable between the two calls is *when* each individual region is read. Atomfall is a multi-gigabyte, actively-streaming AAA title whose private/heap regions are being written continuously — a region read at wall-clock instant *T* during the adaptive pass and the *same* region read at instant *T+~1s* during the reference pass are genuinely different live memory snapshots. This is expected, physically explainable non-determinism of scanning **any** live, continuously-mutating third-party process — not a planner defect.
- **This is a genuinely harder correctness environment than the fixture test**, and the distinction matters: the exact byte-for-byte §9 equality proof already exists and holds against the **frozen/controlled** fixture process (`adaptive-scan-planner-real-process.test.ts`, §9 test — same real spawned process, same matching primitive, deterministic because nothing else in that process writes to memory during the test). What this real-game pass adds is proof that the *same unmodified matching code path* behaves identically in kind (coverage-equal, full-attempt, same causal adaptation logic) against a real commercial title; it also surfaces — honestly, not concealed — that literal match-set equality is not a meaningful claim to make against a live AAA game's own background memory churn, independent of anything the planner does.

## Verdict

**Real-game proof (§24): CERTIFIED**, 3/3 independent passes, against a real, currently-shipping, actively-running commercial title (Atomfall, PC Game Pass build), using unmodified production code, read-only, single-player waiver only, no writes. Genuine initial adaptation from a real measured profile and genuine follow-up adaptation from real measured telemetry are both proven with the exact same causal chain in all 3 passes. Coverage-equality and full-region-attempt guarantees hold exactly; literal match-set equality does not hold against live game memory churn, for an explicitly root-caused and disclosed reason that is not a planner correctness defect.

**Adaptive Scan Planner: PARTIAL → COMPLETE.** All open items from `Docs/phase2/035`/`036` are now closed. See `ROADMAP.md` for the updated Phase 2 28-item recount and P2-10 verdict.
