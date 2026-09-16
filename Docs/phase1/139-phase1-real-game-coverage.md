# Phase 1 — Real-Game Scan Coverage

## §15 — What the roadmap actually requires

ROADMAP line 281, verbatim:

> real-game scan coverage measured against **at least one of the 7 curated titles** (Phase 12's roster) with a recorded, honest coverage percentage — not a synthetic-fixture-only claim

So the requirement is **not** Stardew-specific. It is "at least one of the 7". The curated roster (line 558) is Stardew Valley, Palworld, DREDGE, Crimson Desert, Baldur's Gate 3, Starfield, Atomfall.

Doc 136 recorded this requirement as unmet and forward-assigned it (FA-8), on the basis that Stardew Valley was "confirmed not installed" (docs 80, 91).

**That was wrong, and it is worth being precise about why.** The earlier searches covered `C:\Program Files (x86)\Steam` and `G:\SteamLibrary`. This machine has four Steam libraries. Reading `libraryfolders.vdf` rather than guessing at paths shows appid 413150 — Stardew Valley — on `Z:\SteamLibrary`, and `Z:\SteamLibrary\steamapps\common\Stardew Valley\Stardew Valley.exe` exists.

Installed curated titles, verified on disk:

| Title | Installed | Location |
|---|---|---|
| **Stardew Valley** | **yes** | `Z:\SteamLibrary` |
| **DREDGE** | **yes** | `Z:\SteamLibrary`, also `D:\SteamLibrary` |
| Palworld | yes | `Z:\SteamLibrary` |
| Crimson Desert | yes | `Z:\SteamLibrary` |
| Baldur's Gate 3 | yes | `D:\SteamLibrary` |
| Starfield | yes | `C:\`, also `D:\SteamLibrary` |
| Atomfall | no | — |

Six of the seven are present. The requirement is satisfiable **exactly as written**, against the very title doc 10's exit gate names, with no substitution and no waiver. §15's question A-or-B does not need answering: the answer is A, and A is available.

## §15/§17 — Method

`scripts/phase1-real-game-coverage.mts`. Launch the real installed executable, wait 25s for it to stabilize, attach read-only through the production `LiveMemorySession`, run a real exact scan.

**Zero routing override.** The script never calls `setScannerRoutingMode`; every measurement below is the shipping default, and `backend: native` in the output is the backend actually chosen, not one forced.

**Read-only throughout.** No writes at any point. Every launched process is killed afterwards and verified gone.

### The denominator, stated rather than assumed

Two percentages are reported, because collapsing them is how a scanner ends up claiming 100% of a process it barely read:

```
process coverage % = metrics.bytesRead / eligibleBytes      * 100
attempted read   % = metrics.bytesRead / metrics.bytesRequested * 100
```

`eligibleBytes` is the total size of every region in the target that **the scanner's own eligibility predicate** accepts — readable, not a guard page, not `PAGE_NOACCESS` — read through the same `enumerateRegions()` the native backend uses. The denominator is therefore the scanner's definition of eligible, not a second opinion invented here. It is also the denominator Audit 2 used ("42.1 MB of 893 MiB", 4.5%, on this same title), so the numbers are directly comparable.

`bytesRequested` counts only what the scan attempted **after** the native core applied its own per-region policy exclusions, so the attempted read rate can legitimately be 100% while process coverage is not.

## §16 — Coverage truth, checked rather than described

The script enforces the consistency rules mechanically and fails the run on a violation:

- full process coverage **and** skipped eligible bytes → violation
- full process coverage **and** a non-`complete` completeness state → violation
- partial coverage **and** a bare `Complete` claim → violation
- bytes read or attempted exceeding eligible → violation
- `regionsRead + regionsSkipped != regionsConsidered` → violation

That check earned its place immediately. **The first run reported Stardew Valley at 100.00% next to `CompleteWithSkippedRegions(1 [...policy_excluded])` and the check failed it.** The cause was this script measuring against `bytesRequested` — post-exclusion — rather than against the eligible address space. A scanner defect was not the cause, but the check is what surfaced the question.

**The second run then found a real one.** With the denominator corrected, Stardew showed 375 MiB of eligible memory unread while the completeness signal listed exactly **one** skipped range of 53 KiB. `scanner-backend-native.ts` scans one region per native call and was overwriting its per-region completeness (`worstCompleteness = outcome.completeness`) instead of accumulating it, so only the last non-complete region's skipped ranges survived — and every policy-excluded region was still counted under `regionsRead`. Fixed by a `CompletenessAccumulator` that keeps every skipped range and takes region counts from the native metrics rather than incrementing blindly. Stardew now reports 723 skipped regions, which is the truth.

## §17 — The 3+2-game coverage report

Measured at `8cb2ad9`, backend NATIVE by default, read-only.

| Game | EXE | Arch | Curated | Eligible regions | Eligible bytes | Read bytes | Skipped bytes | Coverage % | Completeness | Duration | Backend |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Stardew Valley** | `Stardew Valley.exe` | x64 | **YES** | 1555 | 1 229 443 072 (1172.5 MiB) | 838 M (799.6 MiB) | 375.2 MiB | **68.22 %** | CompleteWithSkippedRegions(723) | 3.1 s | native |
| **DREDGE** | `DREDGE.exe` | x64 | **YES** | 1450 | 820 629 504 (782.6 MiB) | 514.3 MiB | 268.3 MiB | **63.84 %** | CompleteWithSkippedRegions(788) | 1.5 s | native |
| Godlike Burger | `Godlike Burger.exe` | x64 | no | 1535 | 2 729 721 856 (2603.3 MiB) | 1951.0 MiB | 652.3 MiB | **74.94 %** | CompleteWithSkippedRegions(1420) | 7.4 s | native |
| Bastion | `Bastion.exe` | x64 | no | 1059 | 463 314 944 (441.9 MiB) | 211.8 MiB | 230.0 MiB | **47.94 %** | CompleteWithSkippedRegions(410) | 0.8 s | native |
| Aegis Defenders | `AegisDefenders.exe` | x64 | no | 1258 | 521 224 192 (497.1 MiB) | 232.4 MiB | 264.7 MiB | **46.75 %** | CompleteWithSkippedRegions(484) | 0.7 s | native |

Coverage-truth violations: **0 of 5**. All five processes closed and verified closed.

### Against Audit 2

| | Audit 2 | Now |
|---|---|---|
| Title | Stardew Valley | Stardew Valley |
| Eligible | 893 MiB | 1172.5 MiB |
| Read | 42.1 MB | 799.6 MiB |
| **Coverage** | **4.5 %** | **68.22 %** |
| Honest about the gap? | the scan reported `truncated: false` | 723 skipped regions listed, `isAuthoritativeAbsence: false` |

A little over fifteen times the coverage, on the exact title the roadmap names. The second row matters as much as the first: the old scanner did not merely read 4.5% of the process, it reported that 4.5% as a complete answer.

### Why coverage is not 100%

Every skipped region in all five runs carries `policy_excluded` — the native core's own region-selection policy declining a mapping, not a read failure and not the 1 MiB ceiling (D01/D02, closed). 46-75% is therefore the honest figure for *"how much of this process does a default production scan read"*, and it is reported as such rather than rounded up to the attempted-read rate, which is 95-100% on every title.

Whether the selection policy should admit more of a real game's address space is a **scan-strategy** question, and ROADMAP line 116 places adaptive scan planning in Phase 2 (D13). It is recorded here as a measurement, not smuggled in as a defect: nothing in Phase 1's scope says the policy is wrong, only that whatever it excludes must be visible. It now is.

## Requirement status

**ROADMAP line 281: SATISFIED.** Two curated flagship titles measured with recorded, honest coverage percentages, from real running processes, on the default production backend, with zero coverage-truth violations.

Doc 136's FA-8 is closed, not carried forward.
