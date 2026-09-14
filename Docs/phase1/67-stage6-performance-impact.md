# Phase 1 / Stage 6 — Performance Impact and napi Hardening

## §6.25 — performance impact, measured honestly

**No hot-path scanning logic changed this mission.** Stage 6's additions are:

- `is_authoritative_absence()` — a single `bool`/`usize` comparison computed once, after a scan already has its final `matches`/`completeness`, not inside the per-chunk loop.
- Region-enumeration cancellation — one `AtomicBool` load per `VirtualQueryEx` iteration, and only when a caller opts in via `enumerate_regions_with_cancellation`; the default `enumerate_regions` every existing caller uses is unaffected.
- Session-snapshot code — entirely outside the scan/read hot path; it runs only when a caller explicitly exports/saves/loads a snapshot, never during a scan.

Given this, no regression is expected on structural grounds alone. Real numbers, gathered this mission via the existing Stage 2/5 benchmark binaries (`bench_exact_scan`, `bench_pattern`) against real spawned processes, real memory, unchanged from their historical shape:

| Scan kind | Size | Representative throughput |
|---|---|---|
| Exact scan (u8/u32/u64/f32/f64, various densities) | 16 MiB–256 MiB | ≈ 550–710 MB/s |
| Raw bytes (short/medium/long patterns) | 16 MiB–256 MiB | ≈ 1,270–4,820 MB/s |
| AOB (wildcard) | 16 MiB–256 MiB | ≈ 2,970–3,320 MB/s |
| UTF-8 / UTF-16LE | 16 MiB–256 MiB | ≈ 3,200–4,600 MB/s |

These figures are consistent with the throughput ranges already recorded in Stage 2/5's own benchmark evidence — no new slowdown is observed, and none was expected, since the matching engine's own code (`Pattern::matches_at`, `scan_pattern`'s/`scan_exact`'s per-chunk loop) was not touched this mission. Correctness was never sacrificed for benchmark numbers, and none of the new hardening features (authoritative-absence, cancellation checks, session persistence) were made lighter-weight at the cost of the truthfulness guarantees documented in docs 59-63.

## §6.20 — napi hardening, with real misuse tests

All of the mission's required properties are proven, not assumed:

| Property | Test |
|---|---|
| Reject invalid input predictably | `NativeScanTarget: scanExact rejects an unrecognized primitiveType/alignment before any scan starts`; `session: close is idempotent and double-init/invalid-mode misuse is rejected predictably` (unrecognized refine mode) |
| Cannot double-close unsafely | `NativeScanTarget: detach is idempotent...` (double `detach()`); `session: close is idempotent...` (triple `close()`) |
| Cannot use session/target after close | Both tests above additionally prove a synchronous method throws and an async method's Promise rejects, cleanly, after detach/close — never a crash or hang |
| Cannot access stale target | Covered by doc 62's process-exit tests, all of which access a target after its process has exited and receive a clean typed error |
| Do not block Node event loop | All scan/refine operations run via `AsyncTask` on napi's worker-thread pool (unchanged Stage 2-5 design); `enumerateRegions()`/`detach()`/`close()` remain the deliberately-synchronous exceptions (doc 61 explains why enumeration specifically is evidence-justified as synchronous) |
| Return typed terminal status | Every scan outcome carries a `JsCompleteness` object with a stable `state` string, never a bare boolean or untyped value |

A session closed and re-initialized (`createUnknownInitial` called again after `close()`) was verified to produce a genuinely fresh session (`generation: 0`, real new candidate capture) rather than silently reusing or half-releasing the prior state.

## §6.21 — JS GC/lifetime, honestly scoped

See doc 65's Resource Cleanup section for the full writeup: a best-effort forced-GC test exists, correctly skips when `--expose-gc` is unavailable (the default for `npm test`), and passes when the flag is supplied. The guarantee this crate actually relies on for correctness is explicit `close()` + RAII, which is unconditionally proven by every handle-leak test in doc 65/66 regardless of GC timing.
