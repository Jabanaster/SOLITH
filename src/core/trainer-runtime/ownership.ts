/**
 * P4-10: whether a `TrainerRuntime` owns the underlying live-memory session
 * (and may therefore detach/dispose it) or is merely borrowing one that
 * another owner (the per-sender session bundle in
 * `electron/live-memory-ipc.ts`) is responsible for. No implicit ownership —
 * every bind path sets this explicitly (see `TrainerRuntime.bind`/
 * `bindExisting`).
 */
export type SessionOwnership =
  /** This runtime performed its own attach() and may detach/dispose the session on `dispose()`. */
  | 'OWNED'
  /** This runtime reused an already-attached session it does not own; `dispose()` must never detach it. */
  | 'BORROWED';
