# Phase 1 / Stage 7.3 §4-§9/§20/§21 — Shipping Defect Final Disposition

## Owner authorization changes the baseline, not the discipline

Stage 7.3 authorizes closing shipping defects now that production routing default is NATIVE. `NATIVE_PATH_FIXED != PRODUCT_DEFECT_CLOSED` no longer applies for its original reason (routing default WAS the blocker; it no longer is) — but the discipline itself (close only what evidence actually supports, leave the rest open) is unchanged and is applied below exactly as strictly as every prior stage.

## 1 MiB coverage defect (§4)

**Full production-path test, zero override**: `scanner-backend-native-default-defect-closure.test.ts` — real attach, real `live-memory-scanner-routing-mode-get` confirms `NATIVE` with no prior mode-set call, real `live-memory-scan-first` finds `U32_VALUE` planted in `TYPES_REGION` (4 MiB, beyond `native-memory-driver.ts`'s real 1 MiB `readBuffer` ceiling that blocks LEGACY entirely), `backend: 'native'`. Zero-match case in the same region also proven (a genuinely absent random value correctly reports 0 matches). No fallback occurred (`fellBackToLegacy: false` throughout every test this pass).

**1 MiB NATIVE: `NATIVE_PATH_FIXED`.**
**1 MiB SHIPPING: `PRODUCT_DEFECT_CLOSED`** — for the exact-value scan operation, which is the sole production entry point this defect was ever about (`memory-scanner.ts`'s `readBuffer` cap / native's absence of one, both scoped to exact-value and AOB scan). The default production route no longer exhibits this defect.

## Forced-alignment defect (§5)

**Full production-path test, zero override**, `scanner-backend-native-default-defect-closure.test.ts`:
- u32, unaligned, chunk-boundary-straddling (`BOUNDARY_U32_VALUE`): found via default NATIVE. **PROVEN.**
- i64 (used as the closest available 8-byte integer type to "u64"), unaligned, chunk-boundary-straddling (`BOUNDARY_U64_VALUE`, positive and i64-representable): found via default NATIVE. **PROVEN.**
- u16, unaligned: **NOT PROVEN — genuinely untestable via the real production wire.** `LIVE_VALUE_TYPE` (`electron/ipc-validation.ts`) has no `uint16`/`int16` variant at all; the wire schema itself cannot express a u16 scan request, for any backend, regardless of test effort. This is a real, pre-existing structural gap (unchanged by this pass), not a test that was skipped.

Explicit aligned scanning continues to work when intentionally requested — unchanged, proven throughout every other test in this pass and prior stages (e.g. `U32_VALUE` itself is 4-byte-aligned and found normally).

**ALIGNMENT NATIVE: `NATIVE_PATH_FIXED`** (for the primitive types the wire can express).
**ALIGNMENT SHIPPING: `PRODUCT_DEFECT_NOT_YET_CLOSED`.** Mission §5 explicitly names three required types — u16, u32, u64 — and one of the three (u16) cannot be exercised through the real shipping path at all. Reporting this defect closed would assert something not evidenced for a third of the mission's own required scope. **No forced closure** (mission §21's own instruction).

## AOB false-negative / incomplete-not-found defect (§7)

**The one production AOB entry point that IS migrated** — `live-memory-scan-aob` IPC channel → `LiveMemorySession.scanAobViaBackend` → `ScannerBackendRouter` — now defaults to NATIVE and is proven finding a real far-offset marker with correct `isAuthoritativeAbsence` semantics (`scanner-backend-rollback-matrix.test.ts` cases 2/4, reusing prior-stage evidence from doc 89/91).

**However, three other real production AOB call sites remain wired directly to the legacy `scanAobInProcess`, unchanged by this pass** (confirmed by direct grep this pass, doc 97's inventory reconfirmed):
- `src/core/live-memory/feature-resolver.ts:105` — feature/definition resolution, `STILL_PRODUCTION_REQUIRED`.
- `src/core/in-process-script/hook-engine.ts:43` — code-injection hook targeting, a distinct subsystem per doc 97/98's own prior disposition (not intended for this migration's scope).
- `src/core/live-memory/live-memory-session.ts:1104` (`scanAobSignature` method) — explicitly `LEGACY_ROLLBACK_ONLY`, still directly callable outside the router.
- `src/core/live-memory/signature-engine.ts` — an independent AOB-shaped implementation calling `driver.readBuffer` directly, never routed through `aob-resolver.ts` or the router at all (doc 97/99's "second instance of the same defect mechanism").

Migrating `feature-resolver.ts` and `signature-engine.ts` to the routed backend contract is real, non-trivial application-logic surgery (feature resolution has its own error-handling and fallback semantics built around the legacy call's synchronous, exception-based shape) that was not attempted this pass, given the size of the rest of this mission's required scope. Attempting it hastily, without dedicated test coverage for feature-resolution correctness, would risk a real regression in a currently-working subsystem — not a risk taken lightly given this operation's standing discipline against untested changes to production code paths.

**AOB NATIVE: `NATIVE_PATH_FIXED`** (for the migrated `scanAobViaBackend` entry point only).
**AOB SHIPPING: `PRODUCT_DEFECT_NOT_YET_CLOSED`.** The defect mechanism (a silent try/catch/continue over an unreadable/oversized region reported as "not found") remains live in real, still-legacy, still-production-required call sites. Closing this defect while `feature-resolver.ts` and `signature-engine.ts` still exhibit it would be exactly the kind of blanket assertion mission §20 explicitly forbids ("No blanket assertion... if an untouched legacy production path remains, keep that specific defect open").

## int64/u64 precision/support defect (§6)

**Full production-path test, zero override**, `scanner-backend-native-default-defect-closure.test.ts`, mission's own 5 required values:

| Value | Result |
|---|---|
| `9007199254740993n` (2^53+1) | **Found exactly**, default NATIVE, zero override |
| `9007199254740995n` (2^53+3) | **Found exactly**, default NATIVE, zero override |
| `9223372036854775807n` (i64::MAX) | **Found exactly**, default NATIVE, zero override |
| `-9223372036854775808n` (i64::MIN) | **Found exactly**, default NATIVE, zero override |
| `18446744073709551615n` (u64::MAX) | **NOT PROVEN via IPC — genuinely untestable.** `LIVE_VALUE_TYPE` has no `uint64` variant (doc 93's pre-existing, disclosed structural gap, unchanged this pass); it remains provable only at the raw backend layer (`NativeScannerBackend.exactScan('u64', ...)` directly), never through the real shipping wire. |

Static audit of active default-route code (mission §12's exact search list — `Number(`, `Math.trunc(`, `parseInt(`, `parseFloat(`, `as number`, `BigInt(Math.trunc`, `BigInt(Number`) around `scanExactViaBackend`, the IPC handler, and the router: the only lossy derivation remaining is `scanExactViaBackend`'s own documented fallback (`BigInt(Math.trunc(targetValue))`), used **only** when a caller omits `exactTargetValueBigint` — every real production caller (the IPC handler) always supplies it when `dataType === 'int64'` and a wire value is present, so the lossy path is dead code on the active default route, not silently active. `ACTIVE_NATIVE_INT64_UNSAFE_CONVERSIONS = 0` on the paths this pass exercised.

**INT64 NATIVE: `NATIVE_PATH_FIXED`** for i64; u64 remains backend-only, unreachable via IPC.
**INT64 SHIPPING: `PRODUCT_DEFECT_NOT_YET_CLOSED`.** Mission §6 frames this as one combined "int64/u64" defect and explicitly requires proving `18446744073709551615n` (u64::MAX) through the full shipping boundary — that value has zero real path to the production wire today. Reporting the combined defect closed while one of its two named types has no live path at all would overstate what was proven. The i64-only sub-scope is fully closed; the defect as mission §6 literally names it is not.

## Pointer depth (§9, untouched)

Not touched by this pass, as required. **POINTER DEPTH: `PRODUCT_DEFECT_NOT_YET_CLOSED`**, unconditionally, regardless of the routing default.

## Truth-reporting defect closure (§20)

For the ONE migrated exact-scan entry point (`scanExactViaBackend`, now NATIVE by default): the prior legacy silent-skip mechanism (`memory-scanner.ts`'s try/catch/continue over an oversized region) is no longer on the default path for that operation — `truncated`/`isAuthoritativeAbsence` are now derived from native's own honest `CanonicalCompleteness` state. For every OTHER caller still on the legacy path (`scanFirstAutoMatrix`, `scanNext`, `scanFirstUnknown`, range/comparison scans, and every AOB call site listed above) the same silent-skip mechanism remains exactly as it was — **kept open, not blanket-closed**, per mission §20's explicit instruction.

## Summary table (mission §21's exact requested shape)

| Defect | Native | Shipping |
|---|---|---|
| 1 MiB | `NATIVE_PATH_FIXED` | **`PRODUCT_DEFECT_CLOSED`** |
| Alignment | `NATIVE_PATH_FIXED` (u32/i64 only; u16 untestable) | `PRODUCT_DEFECT_NOT_YET_CLOSED` |
| AOB | `NATIVE_PATH_FIXED` (migrated entry point only) | `PRODUCT_DEFECT_NOT_YET_CLOSED` |
| int64/u64 | `NATIVE_PATH_FIXED` (i64 only; u64 untestable via IPC) | `PRODUCT_DEFECT_NOT_YET_CLOSED` |
| Pointer depth | untouched | `PRODUCT_DEFECT_NOT_YET_CLOSED` |

One of four named shipping defects is closed this pass. The other three have real, substantial, evidenced native-path progress but are honestly reported as not yet closed for the specific, named reasons above — each reason is a real structural gap or an unmigrated real production call site, not a hedge.
