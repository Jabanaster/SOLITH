# Cleanup Design

The cleanup boundary is `runCleanup` in `src/core/live-memory/cleanup-coordinator.ts`. It returns `CleanupResult` with completed steps and sanitized failed-step codes. It never propagates raw cleanup exceptions.

Order: mark revoking; block future writes/ticks; revoke consent; revoke pending proposals; stop schedulers; detach memory; clear rollback; clear process selections; remove trusted-window ownership; record final audit.

`LiveMemorySession.beginCleanupRevocation` invalidates the freeze generation and blocks confirm, rollback, and freeze start before any fallible step. Renderer cleanup is keyed only by `webContents.id`. `render-process-gone` cleans that owner; `will-quit` cleans every session and clears all global authorization registries. Audit entries use only `cleanup_started`, `cleanup_completed`, or `cleanup_failed` and sanitized failed step names/codes.

Feature disable clears pending write/freeze proposals, revokes owner consent tokens, stops with `feature_disabled`, and never restarts on re-enable.

Process selections are reusable within five minutes, session/window-scoped, not single-use, and not operation-specific. The main process stores PID, name, path, creation time, and available file identity, then re-queries identity before worker execution. `selectedByUser: false` remains a legacy worker protocol field; authorization is decided before the worker from the authoritative selection record, never from that field.

Rollback comparison uses exact integer comparison for byte/int32/uint32, safe-integer-only int64, float32-normalized `Object.is` for float, and `Object.is` for double. NaN equals NaN within a type policy, signed zeros differ, infinity sign must match. Ambiguous/unsupported comparisons fail closed. Raw byte comparison is unavailable in the current driver interface.
