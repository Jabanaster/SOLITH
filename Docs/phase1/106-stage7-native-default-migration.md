# Phase 1 / Stage 7.3 §2/§3/§8/§10 — Native Default Migration

## Owner-authorized scope change

Stage 7.3's SOLITH.MD explicitly authorizes what Stage 7/7.1/7.2 explicitly forbade: switching the production scanner default from LEGACY to NATIVE. This document records exactly what changed, where, and why it is safe.

## The exact default-selection code (mission §2's explicit requirement)

Two places, both real production code, both changed:

1. **`src/core/live-memory/scanner-backend-router.ts`, constructor**:
   ```ts
   this.mode = options.mode ?? 'NATIVE'; // was: options.mode ?? 'LEGACY'
   ```
   A `ScannerBackendRouter` constructed with no explicit `mode` option now defaults to NATIVE.

2. **`src/core/live-memory/live-memory-session.ts`, field default**:
   ```ts
   private scannerRoutingMode: ScannerRoutingMode = 'NATIVE'; // was: 'LEGACY'
   ```
   Every `LiveMemorySession` — the one class the real IPC layer (`electron/live-memory-ipc.ts`) constructs per attached session — now starts in NATIVE mode. This is the actual production entry point; the router-level default above is defense-in-depth for any other constructor call site.

No environment variable, config flag, or feature flag gates this. A fresh attach, in the real packaged application, with zero renderer-side interaction beyond a normal attach, reaches `NativeScannerBackend`.

## Real proof (not just code inspection)

- **Unit level** (`scanner-backend-router.test.ts`, new test): `new ScannerBackendRouter(legacy, native)` with no `mode` option, asserted `router.getMode() === 'NATIVE'`, and a routed exact scan through it returns `backend: 'native'`.
- **Real IPC level** (`scanner-backend-ipc-real-path.test.ts`, updated assertion): the existing "full production IPC path" test's `live-memory-scanner-routing-mode-get` call, issued immediately after a real attach with zero prior mode-set calls, now asserts `mode === 'NATIVE'` (was `'LEGACY'`, mission Stage 7.3 §2's explicit requirement superseding the old assertion).
- **Real production defect tests** (`scanner-backend-native-default-defect-closure.test.ts`, new): every test in this file explicitly re-checks `live-memory-scanner-routing-mode-get` returns `NATIVE` before proceeding, then scans with **zero** `live-memory-scanner-routing-mode-set` call anywhere in the test — the only way these tests can pass is if the real production default is genuinely NATIVE.
- **Real running commercial game** (Bastion, PID captured via a real `Start-Process`, real `LiveMemorySession`/`nativeMemoryDriver` attach, zero mode override): `DEFAULT_MODE: NATIVE`, `SCAN_BACKEND: native`, `fellBackToLegacy: false` — see doc 108.

## No silent fallback (mission §3)

`ScannerBackendRouter`'s `allowFallback` option remains `false` by default (unchanged this pass) — a NATIVE-mode failure is rethrown as a structured `ScannerBackendError`, never silently resolved as a legacy success. This was not re-tested from scratch this pass (already proven in `scanner-backend-router.test.ts`'s existing "NATIVE mode with a native failure and no fallback allowed rethrows" test, which continues to pass unmodified under the new default) — carried forward, not re-derived.

**NO SILENT FALLBACK: confirmed, unchanged.**

## Legacy status

`LegacyScannerBackend` is untouched code-wise. It is now reached only via an explicit `setScannerRoutingMode('LEGACY')` call — proven functioning identically to before in every rollback-matrix case (doc 103). Per mission §10, this makes LEGACY's real production role **ROLLBACK_ONLY** for the two operations routed through `ScannerBackendRouter` (exact-value scan, AOB scan via `scanAobViaBackend`) — not deleted, not degraded, fully available on demand.

**LEGACY STATUS: ROLLBACK_ONLY** (for the migrated operations only — see doc 107 for the operations NOT yet migrated, where legacy remains the unconditional production path).
