# Phase 1 / Stage 5 — napi Pattern-Scan Contract

## Three methods on `NativeScanTarget` (mission §5.15)

`native/solith-scanner-napi/src/lib.rs` adds `scanBytes`, `scanString`, `scanAob` — all async (`AsyncTask<PatternScanTask>`, napi's libuv worker-pool `Task` trait, same pattern as `scanExact`/session's `createUnknownInitial`/`refine`), all `Promise<JsPatternScanOutcome>`-returning, all accepting a single `JsRegion` (matching `scanExact`'s own one-region-per-call convention — Rust-core multi-region orchestration is proven directly in Rust tests; a JS caller loops per-region if it needs multiple, exactly as it already would for `scanExact`).

```ts
scanBytes(region, bytes: Buffer, chunkSizeBytes: bigint, maxResults: bigint | null, firstMatchOnly: boolean | null, cancellation, progress): Promise<JsPatternScanOutcome>
scanString(region, text: string, encoding: "utf8" | "utf16le", caseSensitive: boolean, nullTerminator: "none" | "required", chunkSizeBytes: bigint, maxResults: bigint | null, firstMatchOnly: boolean | null, cancellation, progress): Promise<JsPatternScanOutcome>
scanAob(region, pattern: string, chunkSizeBytes: bigint, maxResults: bigint | null, firstMatchOnly: boolean | null, cancellation, progress): Promise<JsPatternScanOutcome>
```

## Why `readable_any()`, not `default_writable_value_scan()`

`scanExact` defaults to `RegionSelectionPolicy::default_writable_value_scan()` (writable regions only — correct for a numeric value scan). Pattern scans default to `RegionSelectionPolicy::readable_any()` instead: an AOB signature or a UI string commonly lives in read-only or executable image regions (code, string tables), not writable heap/stack — defaulting to writable-only would silently miss exactly the regions this feature exists to search.

## BigInt-safe addresses (mission §5.15)

`JsPatternMatch.address` is `BigInt`, matching every other address-carrying shape in this crate (`JsRegion.baseAddress`, `JsScanMatch.address`, session candidates) — never a lossy `Number`, consistent with the crate-wide int64/address contract Stage 1-4 already established.

## Cancellation / progress (mission §5.15)

Both reuse the *same* `ScanCancellationHandle`/`ScanProgressHandle` classes every earlier stage already exports — no new cancellation/progress type. Proven from real JS: `pattern: cancellation stops the scan before full coverage`, `pattern: progress reflects real work done during the scan`.

## Completeness (mission §5.15)

`JsPatternScanOutcome.completeness` is the exact same `JsCompleteness` shape (`state`/`atByte`/`skipped`/`failedReason`) every earlier stage already produces — no new completeness vocabulary. `state` values a pattern scan can produce: `"complete"`, `"complete_with_skipped_regions"`, `"cancelled"`, `"process_exited"`, `"resource_limit"` — covering mission §5.11's truthful not-found contract (`"complete"` + zero matches = authoritative; anything else + zero matches = not authoritative).

## Parse errors (mission §5.15)

`scanAob` validates the pattern grammar (doc 38) **synchronously**, before any `AsyncTask`/`Promise` is constructed — matching the exact synchronous-validation-then-async-work convention `NativeScanSession::refine`'s pre-flight checks already established (Stage 4 doc 31), including the same "wrap in `assert.rejects(async () => ...)`" gotcha for a JS caller testing the rejection path (documented explicitly here, again, so a future reader hits it in the docs before hitting it in a failing test — exactly what happened once already in Stage 4 and once again while writing this stage's own `pattern.test.js`, see doc 42's test-authoring note). The thrown error's message is the stable `"<kind>: <detail>"` string doc 38 defines (`invalid_hex_token:`, `malformed_wildcard:`, `empty_pattern:`, `unsupported_token:`, `invalid_separator:`).

## Scope/range options (mission §5.15)

Mission §5.15 lists "scope/range options" among the required napi surface fields. Stage 5 exposes this the same way Stage 3 already does: the caller passes a specific `JsRegion` (obtained from `enumerateRegions()`, or a caller-narrowed subset of it) rather than the napi call taking a separate module/range parameter — matching mission §5.9's own instruction to "keep the scanner API range-based" and leave module-name resolution to Phase 2/3. The Rust-core `RegionSelectionPolicy::address_range` hook (doc 40/mission §5.9) is available to a Rust caller today; it is not yet threaded through the napi boundary as a distinct parameter, since the current one-region-per-call napi shape already lets a TypeScript caller narrow scope itself before calling.

## No Rust/internal handles leaked (mission §5.15's carried-over §4.14 discipline)

`PatternScanTask` never exposes `Pattern`, `ProcessHandle`, or any other Rust-internal type to JS — every method returns a plain-data `JsPatternScanOutcome`/`JsPatternMatch`, or throws a stable-prefixed error, exactly like every other napi surface in this crate.
