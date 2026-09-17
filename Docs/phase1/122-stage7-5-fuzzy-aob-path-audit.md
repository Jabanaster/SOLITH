# Phase 1 / Stage 7.5 §2 — Fuzzy AOB Path Audit

## Scope

Trace the one remaining legacy-only production scan path — `signature-engine.ts`'s fuzzy / drift-tolerant sub-path — end to end, and answer mission §2's three questions before implementing anything.

## The production call graph, as it stood at 6fcd0c5

| Layer | Location |
|---|---|
| IPC entry | `electron/live-memory-ipc.ts:210` (`live-memory-zero-input-prepare`) → `:233` `prepareZeroInputSession` |
| Orchestration | `src/core/live-memory/zero-input-prepare.ts:191` → `resolveDefinitionFeatures(...)` |
| Feature loop | `src/core/live-memory/process-watcher.ts:220` → `resolveSignature(...)` |
| Signature engine | `src/core/live-memory/signature-engine.ts` — exact sub-path routed via `exactAobResolver` (Stage 7.4); **fuzzy sub-path called `scanFuzzySignature` directly** |
| Legacy memory access | `driver.getRegions()`, `driver.getModules()`, `driver.readBuffer()` on `native-memory-driver.ts` (memoryjs) |

`scanExactSignature` and `scanFuzzySignature` have no production call sites of their own outside the `index.ts` barrel and tests; the only production entry into either is `resolveSignature`, from `process-watcher.ts:220`. There is exactly one wiring point to change.

## A — What "fuzzy" means here

Drift-tolerant AOB matching. Concretely, three mechanisms plus a scoring rule:

1. **Hamming distance** (`aobHammingDistance`) — byte substitutions, bounded by `maxDistance` (default 2). Wildcards cost 0.
2. **Bounded Levenshtein** (`aobBoundedEditDistance`) — insert/delete/substitute, bounded by `maxEdits` (default 1). This is what absorbs byte-shifting drift, where a patch has moved code rather than merely altered it.
3. **Shift window** (`clipSearchWindow`) — an optional `hintAddress ± maxShiftBytes` (default 512) clip, so a re-resolve after a patch searches near the prior match rather than the whole address space.
4. **Candidate ranking** — lowest distance wins; on an equal-cost tie Hamming is preferred over edit.

## B — Which of the listed categories apply

All of them except pure heuristic scoring:

- byte mismatch tolerance — **yes** (Hamming)
- shifted-window matching — **yes** (`hintAddress` / `maxShiftBytes`)
- wildcard tolerance — **yes**, but inherited from the AOB grammar itself, not from fuzziness (a `?` token costs 0 in both exact and fuzzy matching)
- drift tolerance — **yes** (bounded edit distance)
- heuristic scoring — **no**; ranking is exact and deterministic, not heuristic
- multi-candidate ranking — **yes**, by distance then drift kind

So: **a combination** — substitution tolerance, bounded edit drift, an optional spatial window, and deterministic best-candidate selection.

## C — Is fuzzy a scanner primitive, or a higher-level resolver?

**A higher-level resolver, decisively, and the code says so without interpretation.**

`findBestDriftAobInBuffer`, `aobHammingDistance` and `aobBoundedEditDistance` each take a `Buffer` and return an offset. None of them touches a process handle, a region list, or the OS. They are pure computations over bytes that something else has already read.

What `scanFuzzySignature` actually needed from the legacy driver was only three things:

| Need | Legacy call | Is it a scan primitive? |
|---|---|---|
| Which memory exists | `driver.getRegions(handle)` | yes |
| Where a module lives | `driver.getModules(handle)` | no — target metadata |
| The bytes themselves | `driver.readBuffer(handle, base, size)` | yes |

Region enumeration and a region read are genuine primitives. The native scanner has exposed both since Stage 2 — `NativeScanTarget.enumerateRegions()` and `NativeScanTarget.readRegionChunked()`, the latter already chunked, already cancellable, and already reporting per-chunk completeness. Module enumeration is metadata and has no native equivalent.

### Correcting the Stage 7.4 conclusion

Doc 116 and `signature-engine.ts`'s own comment recorded that fuzzy matching had "no native equivalent at all" and must therefore stay legacy-only, permanently. The underlying observation was correct: `native/solith-scanner-core/src/pattern.rs` compiles a mask/value AOB grammar and matches it exactly, with no notion of a substitution or edit budget.

The inference drawn from it was wrong. It treated "the native *pattern engine* cannot do drift" as "the native *scanner* cannot serve the fuzzy path". Those are different claims, because drift tolerance is not something the scanner needs to do — it is something done to bytes the scanner returns. The fuzzy path never needed a native drift matcher; it needed native reads.

## The defect this audit uncovered

Auditing the path turned up a live shipping defect that Stage 7.4 did not record.

`native-memory-driver.ts:361`:

```ts
if (size <= 0 || size > 1048576) {
  throw new Error(...);
}
```

`readBuffer` **throws** for any region larger than 1 MiB. And `scanFuzzySignature`'s region loop was:

```ts
try {
  const buffer = driver.readBuffer(handle, span.baseAddress, span.size);
  ...
} catch {
  continue;
}
```

So on a real game target — where the great majority of mapped memory sits in regions well past 1 MiB — the fuzzy path silently skipped almost everything it claimed to search, and returned `null`. `scanFuzzySignature` returns `SignatureMatch | null` with no completeness channel at all, so no caller could distinguish "not present" from "never looked".

That is **D01 and D03, both live, on the fuzzy path**, for as long as the path has existed. Stage 7.4 closed D03 for exact AOB only (doc 116 scoped its closure explicitly to "the false-negative-from-silent-incompleteness mechanism on exact-match AOB scanning"); the identical mechanism remained open here.

## Conclusion

**FUZZY AOB ARCHITECTURE: SHARED_BACKEND_RESOLVER.**

Keep drift resolution in `signature-engine.ts` as a pure function over buffers. Remove the direct `MemoryDriver` dependency by obtaining regions, modules and bytes through the canonical `ScannerBackend` contract. Build no new native Rust primitive, and port no high-level heuristics to Rust — mission §3's explicit instruction, and in this case the evidence supports it rather than merely permitting it.

Implementation and evidence: doc 124.
