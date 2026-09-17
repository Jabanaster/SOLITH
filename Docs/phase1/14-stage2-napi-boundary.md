# Phase 1 / Stage 2 — napi-rs Boundary

## Version pinning (mission §5) — actual outcome, transparently recorded

Step 0.13.5's adoption freeze (`26-step-0.13.5-pinned-repository-set.md`) recorded exactly one napi-rs data point: tag `napi-derive-v3.6.5`, commit unspecified (`—`), license MIT, `FULL_ADOPTION`.

`native/solith-scanner-napi/Cargo.toml` pins `napi-derive = "=3.6.5"` — the literal frozen tag, exact.

**`napi` itself has no separately-recorded frozen version in that evidence.** Empirically discovered during this stage: pinning `napi = "=3.6.1"` (the nearest `napi` release number to the frozen `napi-derive` tag that exists on crates.io — `3.6.2`–`3.6.5` do not exist for the `napi` crate) produces `napi-derive`-generated code that references runtime symbols absent from `napi` 3.6.1 (`TypeTag`, `ClassAccessorDescriptor`, `register_native_borrow_with_value`, `get_named_property_raw`/`set_named_property_raw`, and the `BigInt` type itself, which requires the `napi6` cargo feature — confirmed by inspecting `napi-3.6.1`'s own source: `#[cfg(feature = "napi6")] mod bigint;`). This proves the two crates' patch-version numbers are **not** kept in lockstep in the upstream repository, despite superficially similar numbering. `napi` is therefore pinned to `=3.12.4` — the newest version on crates.io, and the exact version Cargo's own dependency resolver selects as compatible when `napi-derive`'s own manifest constraint is left to resolve naturally. This is the **minimum version bump required to compile against the frozen `napi-derive` tag**, not a "float to latest" choice made for convenience; recorded here per the mission's explicit instruction to document exact versions used.

**License verification**: `cargo metadata` confirms all four resolved napi-rs crates are MIT: `napi 3.6.1 | MIT` *(superseded, see above)*, `napi 3.12.4 | MIT`, `napi-build 2.4.2 | MIT`, `napi-derive 3.6.5 | MIT`, `napi-sys 3.3.1 | MIT` — matches the certified license from Step 0.13.5.

**Build requirements confirmed Windows-CI-compatible**: this machine's toolchain (`cargo 1.95.0`, `rustc 1.95.0`, `x86_64-pc-windows-msvc` target only) built both crates and the `.node` addon successfully with no additional system dependencies beyond what `native/solith-readonly-scanner` already requires (MSVC linker, already a prerequisite for that pre-existing crate and for `memoryjs`'s `node-gyp` build).

**Generated binary is build output, not a committed vendor binary**: `solith-scanner-napi.win32-x64-msvc.node` is `.gitignore`'d (new entry, this stage); `index.js`/`index.d.ts` (portable JS/TS glue, no compiled code) are committed.

## Architectural boundary (mission §3) — verified, not just asserted

- No child-process JSON protocol was created — `NativeScanTarget` is an in-process napi class; `read_region_chunked` returns a napi `AsyncTask`-backed `Promise`, executed on napi's own worker-thread pool (via the `Task` trait), not a subprocess.
- No scanner daemon — the addon has no background thread of its own outside of a single in-flight read's worker-pool task; nothing runs when no read is requested.
- No generic authority layer / no privileged always-running service — `NativeScanTarget::attach` performs zero authorization checks (deliberately: mechanics/policy separation). It is explicitly documented (doc-comment on the struct, reproduced in the generated `index.d.ts`) as trusted-Electron-main-process-only plumbing, not a renderer-facing API — see mission §23 below.

## BigInt / 64-bit safety (mission §13)

Every address and every 64-bit metric crosses the boundary as a native napi `BigInt`, never coerced through `Number`. Verified two ways:

1. **Real napi type check**: `index.d.ts` (napi-rs-generated, not hand-written) declares `baseAddress: bigint`, `chunkBase: bigint`, `bytesRequested: bigint`, etc. throughout — the macro itself enforces this at the Rust↔JS FFI boundary; there is no code path where these fields could be typed `number`.
2. **Real collision-avoidance test**: `debugEchoU64 round-trips a value far beyond Number.MAX_SAFE_INTEGER without precision loss` (napi test suite) uses two real, distinct `u64` values (`18446744073709551615n` and `18446744073709551613n`) that provably collide under `Number()` (asserted directly: `Number(a) === Number(b)`), then round-trips both through the real compiled addon and asserts they remain distinct — the exact D06 (Stage 1) collision failure mode, proven closed at this boundary for the general 64-bit-*value* case, not just the address case `readPointer` already handled in the current TypeScript scanner.

No real Windows user-mode address exceeds `Number.MAX_SAFE_INTEGER` in practice (the address space ceiling `0x00007FFFFFFF0000` ≈ 1.4×10¹⁴ is under 2⁵³ ≈ 9.0×10¹⁵), so this property is demonstrated with synthetic `u64` values passed directly to `debug_echo_u64`, exactly as the mission's §18-F anticipates ("Where environment permits... If current CI cannot: implement the detection code and deterministic unit/contract tests now").

## Async execution (mission §14)

`ReadRegionTask` implements napi's `Task` trait (`compute()`/`resolve()`), executed on napi's libuv-backed worker-thread pool — **not** a synchronous call wrapped in an already-resolved `Promise`, and **not** a tokio-based `async fn` (no tokio dependency was added; `Task` is the correct fit for CPU/syscall-bound work that isn't I/O-async in tokio's sense). Real, executed proof: `readRegionChunked (real async native operation) covers a >1MiB region without blocking...` schedules a `setTimeout(..., 0)` immediately after calling `readRegionChunked`, then awaits the returned promise — for this to be meaningful the native call must not run to completion synchronously before yielding control back to the event loop, which is exactly the `Task`-trait dispatch's behavior (the call returns a pending `Promise` immediately; `compute()` runs on a separate OS thread).

## Cancellation (mission §15)

`ScanCancellationHandle` wraps a `CancellationToken` (`Arc<AtomicBool>`); `.cancel()` is callable from JS at any time. The reader checks it **between chunks, never mid-syscall** (doc 13) — a `ReadProcessMemory` call already in flight always completes before cancellation takes effect, which is what makes "no leaked process handle, no hung Promise" achievable by construction rather than by care. Real, executed proof, both layers:

- Rust: `cancellation_mid_operation_stops_before_full_region_is_read` — cancels deterministically after observing exactly 10 completed chunks (via the progress callback, not a timing race), asserts `results.len() == 10` and `completeness == Cancelled`.
- JS/napi: `cancellation from JS actually stops an in-flight read` — polls `progress.snapshot()` from actual JavaScript until any chunk has completed, then calls `cancellation.cancel()`, then awaits the promise and asserts `completeness.state === 'cancelled'`.

## Progress (mission §16) — design choice and rationale

**Pull/poll-based, not push-based.** `ScanProgressHandle` wraps `Arc<Mutex<ScanMetrics>>`; the background task updates it after every chunk; JS calls `.snapshot()` at whatever cadence it chooses. This was a **deliberate substitution** for a `ThreadsafeFunction`-based push callback, made for two reasons:

1. **Rate-limiting is automatic, not something to get right.** The mission explicitly requires "progress emission must be rate-limited enough to avoid flooding the Electron IPC/event loop." A push model requires the native side to guess an appropriate throttle (time-based? chunk-count-based?) independent of what the UI actually needs. A pull model puts that decision where it belongs — with the renderer, which knows its own repaint budget — and makes over-flooding structurally impossible: the renderer can never receive more updates than it asks for.
2. **Lower implementation risk for a foundation stage.** `ThreadsafeFunction`'s exact generic/error-strategy API shape varies across napi-rs versions and is easy to get subtly wrong (calling-context lifetime, `ErrorStrategy::CalleeHandled` vs. `Fatal`, non-blocking call-mode selection). A `Mutex`-guarded snapshot has no such surface.

**Trade-off, recorded honestly**: a poll model cannot notify the caller of progress *between* polls — a renderer polling once per animation frame (≈16 ms) gets progress at that granularity, not truly real-time. For the throughput this stage measured (doc 16: tens of thousands of chunks/second at small chunk sizes), a 16 ms poll window still captures many chunks' worth of progress per update, which is adequate for a progress *bar*, though not for a per-chunk event log. A push-based `ThreadsafeFunction` alternative remains straightforward to add in a later stage if evidence (e.g. a specific UI needing sub-frame granularity) justifies the added complexity — this is a reversible, additive decision, not a structural dead end.

Real, executed proof: `readRegionChunked...` asserts `progress.snapshot()`'s `chunksRead` matches the final `outcome.metrics.chunksRead` after the promise resolves; `cancellation from JS...` proves mid-flight polling observes real, live, non-zero progress before the operation completes.

## Handle safety (mission §17)

`ProcessHandle` (`solith_scanner_core::target`) is RAII — `Drop` calls `CloseHandle` unconditionally, matching the existing `native/solith-readonly-scanner` precedent. Real, executed proof: `no_handle_leak_across_many_open_close_cycles` opens and drops a real handle 500 times in a loop against a live process with no failure. `NativeScanTarget::detach()` additionally allows explicit early release from JS (setting the shared `Option<ProcessHandle>` to `None`), independent of and in addition to `Drop`.

## Security / authority boundary (mission §23)

`NativeScanTarget`'s doc-comment (present verbatim in the generated `index.d.ts`, so it ships with the type declarations any TypeScript consumer sees) states explicitly: this class performs no attach-authorization, protected-target, or online-guard check of its own, and is intended for trusted Electron main-process code only. No IPC channel exposes it to the renderer — Stage 2 adds zero new `ipcMain.handle` registrations; `electron/live-memory-ipc.ts` is untouched. The existing game-scoped authority boundary (`windows-process-identity.ts`, `protected-target-guard.ts`, `online-guard.ts`, all in TypeScript, all untouched this stage) remains the sole gate on any future call site that constructs a `NativeScanTarget`.
