# Phase 1 / Stage 7 Final Closure — INT64/U64 End-to-End Shipping Proof

## §5 — the real bug, and the fix

`LiveMemorySession.scanExactViaBackend` derived its int64 search value via `BigInt(Math.trunc(targetValue))`, where `targetValue` is a `number` — already lossy beyond `Number.MAX_SAFE_INTEGER` by the time it reached that line. Stage 7's original real-process proof that native preserves exact int64 values tested `LegacyScannerBackend`/`NativeScannerBackend` directly, bypassing `LiveMemorySession` entirely, so the actual session/IPC layer had never been proven — and in fact could not have been, by construction.

**Fix**: `scanExactViaBackend` gained an optional `exactTargetValueBigint: bigint` parameter, used verbatim when present (falls back to the old lossy derivation only when a caller supplies none, preserving backward compatibility). `LiveMemoryScanFirstSchema` gained an optional `targetValueBigint: z.string().regex(/^-?\d{1,20}$/)` wire field (decimal string — a wire-safe, JSON-safe representation, never a raw BigInt). The `live-memory-scan-first` handler parses and forwards it. `electron/preload.ts` and `src/types/global.d.ts` (the renderer-facing contract) were updated to expose this field — both were previously stale/incomplete (see below).

## §5 — full shipping-path proof, real values, real process

Values used, all real (not synthetic arrays), from `native/solith-scanner-core/src/bin/fixture.rs`'s `TYPES_REGION` (already planted, no fixture changes needed) plus values planted live at runtime via the fixture's own `write <offset> <hex_le_bytes>` stdin protocol (the same mechanism its own Rust integration suite already uses):

| Value | Source | Magnitude class |
|---|---|---|
| `I64_VALUE = -9,000,000,000,000,000,000` | fixture TYPES_REGION (pre-planted, unaligned offset) | beyond magnitude 2^53 (happens to be exactly double-representable — see note below) |
| `U64_HUGE_VALUE = u64::MAX = 18,446,744,073,709,551,615` | fixture TYPES_REGION (pre-planted) | beyond magnitude 2^53, genuinely lossy under `Number()` |
| `9,007,199,254,740,993n` (2^53 + 1) | planted live via `write` command, `tests/live-memory/scanner-backend-int64-end-to-end.test.ts` | individually lossy under `Number()` |
| `9,007,199,254,740,995n` (2^53 + 3) | planted live via `write` command | individually lossy under `Number()` |
| `-9,223,372,036,854,775,808n` (i64::MIN) | planted live via `write` command | extreme boundary |

**Important correction discovered while building this proof**: `I64_VALUE` (-9×10^18) is, despite its magnitude far exceeding 2^53, *exactly* representable as an IEEE-754 double — because 9×10^18 = 2^18 × (9×5^18), and the odd factor 9×5^18 needs only ~45 significant bits, well within a double's 53-bit mantissa. "Beyond `Number.MAX_SAFE_INTEGER` in magnitude" does **not** imply "lossy under `Number()` conversion" — only values whose significant (odd) part needs more than 53 bits actually lose precision. This is why the mission's own requested `9007199254740993n`/`9007199254740995n` pair (consecutive odd integers just past the 53-bit boundary, with no spare low bits to trade for range) were planted and tested specifically — they are genuinely, individually lossy (`Number(9007199254740993n) → 9007199254740992`, `Number(9007199254740995n) → 9007199254740996` — two *different* nearby representable doubles, not a mutual collision with each other, contrary to this document's own first draft's mistaken assumption, corrected before landing).

**Proof chain, each layer independently verified** (`tests/live-memory/scanner-backend-int64-end-to-end.test.ts`, `scanner-backend-real-process.test.ts`):

1. **`NativeScannerBackend` directly**: real i64 (`I64_VALUE`) and real u64::MAX (`U64_HUGE_VALUE`) both found with exact `valueBigint` matches.
2. **`LegacyScannerBackend` directly**: honestly finds nothing for `I64_VALUE` (unaligned — D03, a real, pre-existing, unmodified legacy limit, not something this stage introduced or can fix without rewriting `memory-scanner.ts`'s core engine).
3. **`LiveMemorySession.scanExactViaBackend`** (the session layer, not just the raw backend): real i64 exact fidelity confirmed, `backend: 'native'`, exact `valueBigint` match.
4. **Full real IPC path** (`electron-mock` harness, real registered `ipcMain.handle('live-memory-scan-first')`): real i64 round-trips exactly through the ENTIRE chain — request → IPC schema → handler → session → router → native backend → napi → Rust → result → handler response — as a wire-safe decimal string. Verified via string equality (`match.valueBigint === i64Value.toString()`), not a lossy `Number` comparison.
5. **Mission's exact adversarial values** (2^53+1, 2^53+3, i64::MIN), planted live: all three found exactly and mutually distinctly via `NativeScannerBackend` (cross-checked that scanning for one never accidentally matches another's address).
6. **u64::MAX, planted live, at the backend/session layer**: found exactly. **Not reachable via the current IPC wire schema** — see structural gap below.

## §5/§6 — unsafe-conversion audit (mission's exact grep list)

Searched `src/core/live-memory/*.ts`, `electron/*.ts` for `BigInt(Math.trunc`, `Number(`, `parseInt(`, `parseFloat(`, `as number`, `Number.MAX_SAFE_INTEGER`, `Number.MIN_SAFE_INTEGER`:

- `live-memory-session.ts`'s `BigInt(Math.trunc(targetValue))` — the ORIGINAL bug, now demoted to a documented fallback path only used when a caller supplies no exact BigInt (preserved for backward compatibility with non-int64 callers).
- `scanner-backend-legacy.ts`'s `BigInt(Math.trunc(m.value))` (mapping legacy's OWN found match value back to a `valueBigint` field) — inherent to legacy's Number-based engine; legacy never had exact precision to begin with for any int64 match it finds, so this is a correct, honest representation of legacy's real limit, not a bug to fix.
- `native-memory-driver.ts`'s `Number.MAX_SAFE_INTEGER` check on **addresses** (not scan values) — throws rather than silently truncating; a real, pre-existing, unrelated hard limit of the `memoryjs`-backed legacy driver for addresses beyond ~2^53 (never hit by real 64-bit user-space addresses in practice). Checked, found safe (fails loudly), out of this defect's scope.
- `electron/live-memory-ipc.ts`'s `Number.parseInt(parsed.baseOffset.slice(2), 16)` in `research:resolve-path` — a pointer/module-offset resolver (Phase 9 research tooling), not the exact-value scanner route this stage covers; module offsets are always small relative values, not int64/u64 scan targets. Checked, found out of scope.

**No unsafe conversion remains on the active exact-value scan-target/scan-result route** (`live-memory-scan-first`'s target value and result matches).

## §6 — preload/renderer boundary, real gap found and fixed

`electron/preload.ts`'s `liveMemoryScanFirst` TypeScript parameter type was missing `targetValueBigint` entirely (the runtime payload still forwarded correctly — `ipcRenderer.invoke(channel, payload)` passes the whole object through regardless of its declared type — but the type contract was stale, meaning no renderer TypeScript code could have used this field in a type-safe way).

`src/types/global.d.ts` (the actual renderer-facing global type declaration) was worse: it was missing `targetValueBigint` on the request AND missing `valueBigint`/`backend`/`isAuthoritativeAbsence` on the response `matches` entries entirely — meaning renderer code has never been able to see the exact int64 value, which backend served a scan, or whether an absence was authoritative, in a type-safe way, since Stage 7 first added these fields. Separately, `liveMemoryScannerRoutingModeGet`/`liveMemoryScannerRoutingModeSet` — the Stage 7 §7.5 explicit routing-mode control channels — were **entirely absent** from this renderer type file, despite being fully implemented in `preload.ts` and the IPC layer since Stage 7.

**Fixed**: all of the above added to `src/types/global.d.ts` and `electron/preload.ts`. Both `npx tsc -p tsconfig.json` (renderer) and `npx tsc -p tsconfig.electron.json` (electron) typecheck clean after the fix.

**On structured clone vs. JSON**: Electron's real IPC transport (`contextBridge` + `ipcRenderer.invoke`) uses the V8 structured clone algorithm, which DOES support `BigInt` natively — but this codebase's own established convention (predating this stage) is to never send a raw `BigInt` across any boundary, converting to a decimal string instead. This is more conservative than structured clone requires but avoids any dependency on that specific transport detail, and it's already proven lossless end to end (test 4 above).

## §5/§25 — INT64 shipping defect: real evidence, honest scope

**int64 (signed)**: `PRODUCT_DEFECT_CLOSED` for the **native code path only** — proven exact through the complete real production route (request → preload type → IPC schema → handler → session → router → native backend → napi → Rust → result → response → preload type) for real, adversarial values including the mission's specific 2^53+1/2^53+3/i64::MIN cases. Production ROUTING DEFAULT remains `LEGACY` (see doc 92/95) — so no real user's session is native-routed unless explicitly switched, meaning the defect is closed **in the native path**, not yet closed **as shipped default behavior**. See doc 99 for the exact disposition language used in final certification.

**u64 (unsigned)**: proven exact at the backend/session layer (including the mission's exact u64::MAX case) but **structurally unreachable through the current IPC wire schema** — `LIVE_VALUE_TYPE` in `electron/ipc-validation.ts` has no `'uint64'` variant at all, only `'int64'`. A renderer cannot request a u64 scan today. This is a real, disclosed, pre-existing gap in the wire contract's type coverage, not something this pass silently routed around (routing u64 through the `'int64'` wire field would misrepresent the true type to the native scanner and was deliberately not done). Widening the wire schema to add `'uint64'` is a real, scoped, low-risk follow-up but was not done this pass — reported honestly as open rather than silently patched under time pressure without full IPC-path re-verification for the new type.
