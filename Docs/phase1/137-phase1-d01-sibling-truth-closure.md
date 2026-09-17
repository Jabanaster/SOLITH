# Phase 1 — D01 Sibling Truth-Reporting Closure

ROADMAP **D01** (this document set's D06): *"set `truncated = true` at each remaining `catch{continue}` site, one regression test per site."*

Doc 136 left this open, and was right to. Phase 1 built a native scanner whose completeness contract makes silent skipping structurally impossible and routed production to it, which closes the defect for every routed path — but not for the value-scan paths that were never routed, which are reachable from live IPC handlers. The roadmap's prohibited-shortcut clause is explicit: *"Do not mark D01 closed by fixing only a subset of the five sibling functions."*

## §1 — The audit

Every site in the scanner surface where a read failure could be swallowed. Re-derived from the current source, not from doc 136's line numbers.

| # | Function | File | Current behavior at entry | Failure mode | Completeness signal at entry | Fix |
|---|---|---|---|---|---|---|
| 1 | `scanFirst` | `memory-scanner.ts` | `catch { continue; }` | region unreadable → skipped silently | none | records skipped range; `truncated`, `completeness`, `isAuthoritativeAbsence` |
| 2 | `scanNext` | `memory-scanner.ts` | `catch { continue; }` | candidate unreadable → dropped, indistinguishable from "did not match" | **no completeness field at all** — returned bare `ScanMatch[]` | returns `NextScanResult` with `candidatesConsidered` / `candidatesUnreadable` + coverage |
| 3 | `scanFirstUnknown` | `memory-scanner.ts` | `catch { continue; }` | region missing from baseline → every later narrowing round blind to it | none | records skipped range; snapshot carries the gap forward |
| 4 | `scanNextFromSnapshot` | `memory-scanner.ts` | `catch { continue; }` | region gone since snapshot → unevaluated | none, **and discarded the snapshot's own** | records skipped range **and inherits** upstream coverage |
| 5 | `scanNextFromSnapshotMultiType` | `memory-scanner.ts` | `catch { continue; }` | as above | as above | as above |
| 6 | `scanFirstByComparison` | `memory-scanner.ts` | `catch { continue; }` | region unreadable → skipped silently | none | records skipped range + coverage (surfaced through every auto-matrix bucket) |
| 7 | `findPointersNear` | `pointer-scanner.ts` | `catch { continue; }` | region unreadable → pointer slots never examined | none | records skipped range; feeds D05's completeness (doc 138) |
| 8 | `scanAobInProcess` | `aob-resolver.ts` | `catch { continue; }`, returns `bigint \| null` | read failure → bare `null`, identical to a genuine miss | none | returns `AobScanOutcome` with skipped ranges + `isAuthoritativeAbsence` |
| 9 | `scanExactSignature` | `signature-engine.ts` | `catch { continue; }`, returns `SignatureMatch \| null` | as above | none | returns `SignatureScanOutcome` |
| 10 | `scanFuzzySignature` | `signature-engine.ts` | `catch { continue; }`, returns `SignatureMatch \| null` | as above | none | returns `SignatureScanOutcome` |

**Ten sites, not six.** Doc 136 counted the six in `memory-scanner.ts` because that is what ROADMAP D01 names; the four outside it are the same defect in the same shape and are closed here rather than left for a later stage to rediscover.

### Four further truth gaps found during the repair

None of these were in the brief. All are the same defect, one line earlier or one layer up.

1. **`scanFirstRange` aborted the sweep on a skip.** It was repaired long ago by P0-SCAN-001 and *did* set `truncated = true` on an unreadable region — but then hit a shared `if (truncated) break` at the end of the loop body. One unreadable region therefore silently ended the scan after the next successfully-read region, and every region behind it was reported as simply absent. The repair separates the two events: a skip continues, only a stop breaks.

2. **`maxRegionBytes` filtering was invisible.** Regions excluded for exceeding the size bound were dropped by a `.filter()` *before* the `try`, so no `catch` could ever see them. These are eligible, writable regions the caller asked about, excluded for cost — not evidence that they hold nothing. `tests/live-memory/memory-scanner.test.ts` even contained a case where the excluded region demonstrably *did* contain the sought value, asserting only that the result was empty.

3. **Derived scans could out-claim their source.** `scanNextFromSnapshot` and its multi-type sibling reported only their own `truncated` and discarded the snapshot's, so narrowing an incomplete baseline could report `complete`.

4. **`scanNext` had no completeness field at all.** Its return type was `ScanMatch[]`. An unreadable candidate may still hold the value the user is hunting, so narrowing to zero survivors after an unreadable candidate is not "the value is gone".

## §2 — One shared rule, not six patches

`ScanCoverageTracker` in `memory-scanner.ts`. Two events are tracked separately, because conflating them is what made the old single `truncated` boolean ambiguous:

- **`recordSkippedRegion`** — an eligible region could not be examined. Coverage is no longer complete; the sweep continues.
- **`recordStop`** — the scan stopped before covering the requested space (byte budget, match cap). The caller breaks out.

Plus `inherit(upstream)`, so a derived scan can never be more complete than its source, and `recordReadFailure`, which promotes a failure to a terminal `process_exited` stop when the driver says the process is gone — a single unreadable region leaves a scan worth continuing, whereas a dead process invalidates every remaining region.

The states are the **canonical** ones (`CanonicalCompleteness`, from `scanner-backend.ts`), not a new vocabulary. A legacy scan result and a backend scan outcome now answer "was this complete?" identically. Mission §2's "do not create another parallel truth model" is satisfied structurally, not by intention.

`ScanBounds` gained an optional `signal`, so a cancelled sweep reports `cancelled` rather than looking like a short complete one.

## §3 — Backward compatibility

`truncated` keeps its exact meaning and position on every result that had it. `completeness`, `skippedRegions` and `isAuthoritativeAbsence` are additive. At the IPC boundary every existing field keeps its shape — `matches` is still `matches` — and the new fields are appended, serialized BigInt-safely as decimal strings like every other address on that wire.

Two return types genuinely changed, because there was no field to widen:

| Function | Was | Now |
|---|---|---|
| `scanNext` | `ScanMatch[]` | `NextScanResult` (`matches` + coverage) |
| `scanAobInProcess` | `bigint \| null` | `AobScanOutcome` (`address` + coverage) |
| `scanExactSignature` / `scanFuzzySignature` | `SignatureMatch \| null` | `SignatureScanOutcome` (`match` + coverage) |

Every caller in the repository is updated. `LegacyScannerBackend.aobScan` is the interesting one: it previously had to report a blanket `complete_with_skipped_regions` with an **empty** skip list for every result, because the legacy scan gave it no signal at all. It now passes the real answer through — so a legacy miss over fully-read regions is allowed to be a genuine authoritative absence, which it never could be before.

## §4 — The test matrix

`tests/live-memory/memory-scanner-truth-matrix.test.ts`, 43 cases. Mission §4's seven cases run against **every** function that sweeps regions, driven from one table rather than six near-copies that could drift apart again.

| Case | Requirement | Result |
|---|---|---|
| A | fully readable → complete, `truncated: false` | PASS ×6 |
| B | one unreadable eligible region → incomplete | PASS ×6 |
| C | zero matches + unreadable region → not authoritative | PASS ×6 |
| D | matches before the unreadable region preserved | PASS ×6 |
| E | regions after the unreadable one still scanned | PASS ×6 |
| F | process exit → `process_exited`, not complete | PASS ×6 |
| G | cancellation → `cancelled`, not complete | PASS ×6 |

Case E is the one that catches defect 1 above: the unreadable region is seeded **first**, so a sweep that aborts on a skip cannot reach the two matches behind it. It asserts on result *addresses* rather than a count, because a `unchanged` narrowing legitimately matches every aligned cell and a count would have been asserting on arithmetic rather than on behavior.

`scanNext` is additionally covered in `memory-scanner.test.ts` (cases A and C explicitly, since it takes a candidate list rather than bounds and has no cancellation surface).

## §5 — Product closure

**D01: `PRODUCT_DEFECT_CLOSED`.**

Evidence:

- **Repo-wide search shows no remaining silent sibling skip.** Asserted mechanically, not by inspection: the matrix's final case strips comments from `memory-scanner.ts`, `pointer-scanner.ts`, `aob-resolver.ts` and `signature-engine.ts` and fails if a bare `catch { continue; }` reappears. Comments are stripped because these files deliberately *describe* the old shape, and that prose is evidence of the repair rather than an instance of the defect.
- **All affected tests pass.** 1979/1979 root, 478/478 live-memory, three consecutive full live-memory runs.
- **Production callers receive truthful incompleteness.** `live-memory-scan-next`, `live-memory-scan-first-unknown`, `live-memory-scan-next-from-unknown` and `live-memory-scan-first-auto-matrix` all carry `completeness` and `isAuthoritativeAbsence` on the wire.
- **No hidden catch/continue site remains** in the scanner surface.

## What this changes about an earlier conclusion

Doc 136 stated that D01's remaining work was "mechanical". It was not. Four additional defects were found in the course of doing it, one of them in a function a previous phase had already certified as repaired, and the total site count was ten rather than six. Recording that is the point: a defect described as mechanical that turns out to have four unlisted siblings is exactly the kind of estimate that should be corrected in writing rather than quietly absorbed.
