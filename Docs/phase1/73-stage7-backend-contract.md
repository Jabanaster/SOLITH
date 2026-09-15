# Phase 1 / Stage 7 — Production Scanner Backend Contract

## §7.3 — one canonical contract

New module `src/core/live-memory/scanner-backend.ts` defines `ScannerBackend`, the one interface both backends implement:

```ts
interface ScannerBackend {
  readonly kind: 'legacy' | 'native';
  attach(pid: number): Promise<void>;
  detach(): Promise<void>;
  exactScan(primitiveType, valueNumber, valueBigint, bounds, control?): Promise<CanonicalExactScanOutcome>;
  aobScan(pattern, moduleName, bounds, control?): Promise<CanonicalPatternScanOutcome>;
}
```

This is drawn at `LiveMemorySession`'s own level (the seam the §7.2 map identified — see doc 72), not at the lower `MemoryDriver` level, because the native backend has no synchronous `readBuffer`/`getRegions` primitives at all, only whole-operation async scans; forcing it into `MemoryDriver`'s shape would misrepresent the behavior SOLITH actually needs (mission §7.3's explicit instruction).

**Migration scope this stage**: exact-value scan and AOB scan — the two operations directly behind three of the four named shipping defects (1 MiB, alignment, int64 via exact scan; AOB via AOB scan). Range/comparison next-scan, unknown-initial-value scan, and pointer scanning remain legacy-only, explicitly and non-silently — see doc 83 for the full caller-by-caller accounting of why.

`ScanControl` (`{ signal?: AbortSignal; onProgress?: (metrics) => void }`) gives every routed call real cancellation/progress plumbing: native wires it to a real `ScanCancellationHandle`/`ScanProgressHandle` (the same objects Stage 1-6 already proved deterministic); legacy honors only a pre-flight abort check, since its scan loop has no chunk-level interruption point — a real, documented asymmetry, not hidden.

## §7.4 — canonical result model

`CanonicalExactScanOutcome`/`CanonicalPatternScanOutcome` carry: `backend`, `matches` (address always `bigint`; value as `valueNumber` OR, for i64/u64, exact `valueBigint` — never down-converted), `completeness` (a 6-state canonical mirror of the native core's `ScanCompleteness`, generalized so the legacy backend can also report `complete_with_skipped_regions` honestly — see doc 75/85 for how this closes part of the D01 truth-reporting gap even on the legacy path), `isAuthoritativeAbsence` (Stage 6 §6.3's rule, generalized), and `metrics` (BigInt-safe byte/region counters).

At the real IPC boundary (`electron/live-memory-ipc.ts`'s `live-memory-scan-first` handler), the existing response shape is preserved byte-for-byte (`matches[].address`/`.value`, `regionsScanned`, `bytesScanned`, `truncated`) — Stage 7 only ADDS fields (`backend`, `isAuthoritativeAbsence`, and, for int64 matches only, a string-serialized `valueBigint`). No existing renderer code needed to change; no BigInt is ever truncated to `Number` in the new field, satisfying mission §7.4's explicit "do not truncate BigInt to Number" for the value half of the D06 fix (address BigInt-safety was already handled pre-Stage-7 via string serialization).

## Backends

- `LegacyScannerBackend` (`scanner-backend-legacy.ts`) — a pure adapter over the unmodified `memory-scanner.ts`/`aob-resolver.ts` functions. Proven byte-for-byte behavior-preserving by `tests/live-memory/scanner-backend-legacy.test.ts` (7 tests): identical matches/addresses to calling the legacy functions directly, honest `complete_with_skipped_regions` reporting (computed independently via a second `getRegions()` call, since `scanFirst`'s own `truncated` flag never reflects a region-read-failure skip — a real, newly-confirmed instance of D01), the documented int64 lossy-search limitation (D06) reproduced exactly (not papered over), and a documented, newly-discovered real defect: an int64 target value whose `Number` narrowing rounds up to or past 2^63 causes `encodeValue`'s `writeBigInt64LE` to throw uncaught inside `scanFirst` itself — this adapter catches it and surfaces a typed `ScannerBackendError` instead of crashing the caller (see doc 85).
- `NativeScannerBackend` (`scanner-backend-native.ts`) — wraps `NativeScanTarget`/`scanExact`/`scanAob` from the certified Stage 1-6 native addon. Loads the addon via a real `node_modules/solith-scanner-napi` dependency (`file:native/solith-scanner-napi`, added this stage — see doc 78/79) with a documented, tested fallback to the packaged app's `extraResources` copy. Never throws a raw/uncaught error — every failure is a typed `ScannerBackendError` (`native_addon_missing`, `native_addon_load_failed`, `attach_failed`, ...), satisfying mission §7.26's "clear error, no crash."

## §7.5 — routing

`ScannerBackendRouter` (`scanner-backend-router.ts`) owns exactly one of `LEGACY | NATIVE | SHADOW_COMPARE` per attached `LiveMemorySession`, defaulting to `LEGACY` (zero behavior change for every existing caller/test). `LiveMemorySession.getScannerRoutingMode()`/`setScannerRoutingMode()` and the new `live-memory-scanner-routing-mode-get`/`-set` IPC channels make the current mode observable and explicitly settable — never silently applied to an in-flight scan, never a hidden fallback: `NATIVE` mode rethrows a native failure by default (`tests/live-memory/scanner-backend-router.test.ts`, "no hidden fallback"); a canary-only `allowFallbackToLegacyOnNativeFailure` escape hatch exists and, when used, records BOTH the failure and the fact that a fallback occurred in the router's diagnostics (never just one or the other silently).
