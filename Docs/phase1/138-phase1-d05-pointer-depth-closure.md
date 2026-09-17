# Phase 1 — D05 Pointer Depth and Truncation Closure

Audit 2 recorded a pointer scan reporting `levelsSearched: 1` against a requested `maxDepth: 3`, with `truncated: false`. Every Stage 7.x pass left it untouched by explicit instruction. Doc 136 established that it **cannot** be forward-assigned: ROADMAP line 165 assigns D05 to Phase 1, line 116 splits pointer scanning as "1 (truth-reporting), 2 (feature)", and line 96 lists pointer-depth among the defects that "remain open and are Phase 1 scope". This document closes the truth-reporting half. The feature work stays in Phase 2, where the roadmap puts it.

## §6 — The current implementation, before editing

Traced end to end:

```
Advanced Scan Mode / Script Research Analyzer  (renderer)
  -> preload.liveMemoryPointerScan
  -> ipcMain 'live-memory-pointer-scan' / 'research:pointer-analyze'
  -> LiveMemorySession.pointerScan
  -> scanForPointerPath            (pointer-scanner.ts)
  -> findPointersNear              per frontier item, per level
  -> driver.getRegions / driver.readBuffer
  -> PointerScanResult
```

Breadth-first, working **backward** from the target: at each level, scan committed memory for 8-byte values landing within `maxOffsetPerLevel` before the current frontier address. A hit whose own address is inside a loaded module is a stable path root; a hit that is itself heap becomes next level's frontier.

| Aspect | State at entry |
|---|---|
| `maxDepth` | default 3, hard-capped at 6 |
| levels actually searched | `levelsSearched`, set to the current depth on entry |
| termination conditions | loop ends on depth, empty frontier, or `candidates.length >= MAX_RESULTS` |
| region / read failures | `catch { continue; }` — invisible |
| candidate limits | `maxCandidatesPerLevel` (3) — silently dropped surplus |
| result limits | `MAX_RESULTS` (20) — silently ended the run |
| cycle handling | **none** |
| process exit | none — `getModules` threw straight out of the function |
| cancellation | none |
| truncation reporting | one boolean, set only by the scan budget and per-scan byte budget |

## §7 — Reproducing the original defect

The reported shape has two entirely different causes, and the old result could not tell them apart:

1. The frontier genuinely ran out — nothing deeper exists to follow. Legitimately complete.
2. The search was cut off — a cap, a budget, a read failure. Not complete.

Both ended with `truncated: false`. `tests/live-memory/pointer-scanner.test.ts` contained a case demonstrating exactly this: a two-edge chain searched at `maxDepth: 1`, asserting only `candidates.length === 0` and `levelsSearched === 1`. An empty result for a target whose path provably exists, reported as if it were an answer.

Deterministic reproduction of every mission §7 case is in `tests/live-memory/pointer-scanner-depth-truth.test.ts` (18 cases): depth 1/2/3, requested depth beyond the chain, branching, broken link, unreadable intermediate, candidate cap, result cap, scan budget, cycle, cancellation, process exit.

## §8 — The completeness contract

| Field | Meaning |
|---|---|
| `requestedDepth` | the depth actually searched for, after clamping to the hard cap — reported so `levelsSearched` reads against the real request |
| `levelsSearched` | how many levels the traversal entered |
| `deepestLevelCompleted` | the deepest level whose **entire** frontier was examined |
| `candidatesExplored` | heap addresses expanded into a next level |
| `candidatesDropped` | heap addresses dropped at a per-level cap |
| `scansPerformed` | `findPointersNear` calls |
| `termination` | why it stopped (below) |
| `skippedRegions` | regions whose pointer slots were never examined |
| `completeness` | canonical, same vocabulary as the scanner backend |
| `isAuthoritativeAbsence` | zero candidates **and** genuinely complete |
| `truncated` | the boolean summary: `completeness.state !== 'complete'` |

`deepestLevelCompleted` is the field that resolves the original ambiguity. `levelsSearched: 3` says three levels were entered; `deepestLevelCompleted: 0` says none of them was finished. Plain `levelsSearched` could not express the difference.

### NO_MORE_POINTERS vs SEARCH_STOPPED_EARLY

| `termination` | Complete? | Meaning |
|---|---|---|
| `frontier_exhausted` | **yes** | every reachable path was followed to a module root or a dead end |
| `depth_limit_reached` | **no** | the requested depth was searched in full, and heap candidates still remained beyond it |
| `result_limit_reached` | no | the result cap ended it |
| `candidate_limit_reached` | no | candidates were dropped at a per-level cap |
| `scan_budget_exhausted` | no | the global scan budget or a per-scan byte budget ended it |
| `cancelled` | no | the caller asked it to stop |
| `process_exited` | no | the target is gone |
| `module_enumeration_failed` | no | modules could not be listed at all |

`depth_limit_reached` is deliberately **not** complete. The caller asked for N levels and got N levels — complete with respect to the request — but heap candidates were still waiting, so reporting zero results as an authoritative absence would be the same claim D05 was filed against.

`frontier_exhausted` is downgraded to `candidate_limit_reached` when any candidate was dropped: a frontier that only *looks* exhausted because the surplus was discarded is not an exhaustive search.

## §9 — Depth semantics

`maxDepth = N` means exactly N pointer edge levels, no off-by-one. Proved against a chain built to order:

| Requested | Chain | Result |
|---|---|---|
| 1 | 1 edge | depth-1 candidate, `offsets: [16]`, `frontier_exhausted`, complete |
| 2 | 2 edges | depth-2 candidate, `offsets: [0, 16]`, complete |
| 3 | 3 edges | depth-3 candidate, `offsets: [0, 0, 16]`, complete |
| 3 | 1 edge | `levelsSearched: 1`, `frontier_exhausted`, **complete** — stopping short is correct here |
| 2 | 3 edges | `levelsSearched: 2`, `depth_limit_reached`, **not** complete, not an absence |

The fourth and fifth rows are the pair that matters. Both stop with `levelsSearched < requestedDepth`; exactly one of them is complete. A test asserts they never report the same thing.

Each candidate is also resolved forward through `resolvePointerPath` back to the original target — a path that cannot be followed forward is a coincidence, not a result.

## §10 — Truncation rules

Marked incomplete on: result cap, candidate cap, scan budget, per-scan byte budget, read failure, region skipped for exceeding `maxRegionBytes`, process exit, cancellation, module-enumeration failure, and depth exhausted with candidates remaining.

Not marked incomplete on: the requested depth completed with an empty frontier, and cycle de-duplication.

## §11 — Cycle handling

There was none. A heap object graph routinely contains `A -> B -> A` and self-references; without detection the traversal re-expands the same addresses at every level, producing duplicate paths and repeating the work. The depth cap bounded the damage but did not prevent it.

A `visited` set now spans the whole run, seeded with the target address so a chain cannot loop back onto the very address being searched for. An already-visited address is valid de-duplication — the path through it has been or is being explored — so suppressing it loses nothing and is explicitly **not** counted as truncation.

| Shape | Result |
|---|---|
| `A -> A` | terminates, `frontier_exhausted`, complete |
| `A -> B -> A` | at most 2 heap nodes expanded, `candidatesDropped: 0`, complete |
| `A -> B -> C -> B` | at most 3 heap nodes expanded, complete |

## §12 — Resource bounds

Candidates per level, total scans, results and per-scan bytes are all bounded, and every bound now produces `resource_limit` rather than completion. `maxResults` and `maxTotalScans` became caller-overridable so a test can exercise the bound deterministically instead of relying on the default happening to be reached.

## §13 — Real-process proof

`tests/live-memory/pointer-scanner-real-process.test.ts`, 8 cases against a real spawned Windows process.

The fixture now builds a genuine module-rooted chain:

```
POINTER_ROOT  (an AtomicU64 in the fixture binary's own .data — inside the module image)
  -> NODE1 -> NODE2 -> NODE3 -> the target value at +16
```

Each node is a separate `VirtualAlloc` region, so the reverse traversal crosses three real region boundaries. A real pointer cycle (`NODE1 <-> NODE2`) is planted alongside it.

`POINTER_ROOT` has to live in the image rather than in a `VirtualAlloc` region: the scanner only calls a hit a stable path root when the address holding the pointer falls inside a loaded module, which is the entire point of the "module + offset chain" output.

| Case | Result |
|---|---|
| ground truth — the chain really is in the process | PASS (read directly, independent of any scan) |
| `maxDepth 1` searches exactly one level, no depth-3 claim | PASS |
| `maxDepth 2` reaches level 2, never claims depth-3 completion | PASS |
| `maxDepth 3` finds the module-rooted path, resolves back to the target | PASS |
| real cycle terminates without unbounded expansion | PASS |
| unreadable page → incomplete, never absent | PASS |
| result cap → `resource_limit` | PASS |
| process exits mid-traversal → not an absence | PASS |

3/3 consecutive passes in isolation and in three consecutive full live-memory runs.

### Two defects this proof found

Neither was in the brief; both were found only because the test ran against a real process.

1. **`getModules` threw straight out of `scanForPointerPath`.** A pointer scan against a process that had exited raised a raw driver error, which the IPC boundary turned into a generic `pointer_scan_failed`. The caller learned that something went wrong but not that the answer was "unknown, the process is gone" — precisely the distinction D05 exists to preserve. Module enumeration failure is now a structured terminal state, splitting a dead process from any other enumeration failure rather than guessing.

2. **The fixture's first cycle placement created a real shortcut.** The cycle was initially `NODE1 -> NODE3`, which is a genuine two-edge path from the module root to the target — so the nominal depth-3 chain was no longer the shortest, and the depth-3 assertion failed correctly. The fixture was wrong, not the scanner. Moved to `NODE1 <-> NODE2`, between adjacent links.

### One test-design defect

The real-process depth-3 case passed 3/3 in isolation and failed once under full-suite load. The cause was the **default** `maxTotalScans` of 25, close enough to what this chain actually needs (~7 scans measured) that a different allocator layout can exhaust it before level 3. That is a legitimate `scan_budget_exhausted` result — but it made a *discovery* assertion depend on allocator luck. The budget is now explicit in the test, and the test additionally asserts the run did **not** end on the budget, so a future shortfall is visible rather than silent. Diagnosed rather than retried; doc 128 records the previous instance of this same class.

## §14 — Product closure

**D05: `PRODUCT_DEFECT_CLOSED`.**

| Requirement | Status |
|---|---|
| `maxDepth` semantics correct | MET — §9, deterministic and real-process |
| `levelsSearched` truthful | MET — plus `deepestLevelCompleted` |
| early termination truthful | MET — eight distinct terminal states |
| truncation truthful | MET — §10 |
| resource limit truthful | MET — §12 |
| cycle behavior safe | MET — §11, three shapes plus a live cycle |
| real fixture passes | MET — §13, 8/8, 3 consecutive |
| production path uses corrected behavior | MET — `session.pointerScan` is unchanged as a call; both IPC handlers carry the new fields |

Not forward-assigned.

## Scope boundary

This closes pointer-depth **truth reporting**, which is what ROADMAP line 116 places in Phase 1. Pointer *features* — structure discovery, the adaptive scan planner, restart-stability campaigns — remain Phase 2 by the same line. Nothing here anticipates them.
