/**
 * Renderer-window lifecycle cleanup for live-memory sessions.
 *
 * Kept dependency-free (no Electron import) so it can be unit tested without
 * a real Electron runtime — electron/live-memory-ipc.ts wires this against
 * the real WebContents 'destroyed' event.
 */

/** Minimal shape needed from Electron's WebContents — trivially fakeable in tests. */
export interface DestroyableEmitter {
  once(event: 'destroyed', listener: () => void): unknown;
}

/** WebContents we've already wired a cleanup listener on — avoids stacking duplicate listeners across repeated attach/detach cycles on the same window. */
const destroyedListenerWired = new WeakSet<object>();

/**
 * Ensures `onDestroyed` runs exactly once when `emitter` fires 'destroyed',
 * so an active session (and any freeze it's running) is torn down even if
 * the owning renderer window closes without ever calling live-memory-detach.
 * Safe to call repeatedly for the same emitter — only the first call wires a
 * listener.
 */
export function wireSessionCleanupOnDestroy(emitter: DestroyableEmitter, onDestroyed: () => void): void {
  if (destroyedListenerWired.has(emitter)) return;
  destroyedListenerWired.add(emitter);
  emitter.once('destroyed', onDestroyed);
}

/** Minimal shape needed for navigation cleanup — separate from DestroyableEmitter since 'did-navigate' has a different listener signature. */
export interface NavigableEmitter {
  on(event: 'did-navigate', listener: (event: unknown, url: string) => void): unknown;
}

/** WebContents we've already wired a navigation-cleanup listener on. */
const navigateListenerWired = new WeakSet<object>();

/**
 * Runs `onNavigated` every time `emitter` fires 'did-navigate' (Batch B1.1)
 * — a full-page navigation or reload of the main frame. Electron does NOT
 * fire this for in-page (hash-based SPA) navigation, so normal in-app
 * routing does not trigger this. A session surviving a reload with its
 * ledger/freeze intact (while the renderer's own JS state is wiped) is the
 * gap this closes: without it, an active freeze or a stale rollback
 * ledger would silently keep running/remaining valid across a reload with
 * no UI able to reference it.
 */
export function wireSessionCleanupOnNavigate(emitter: NavigableEmitter, onNavigated: () => void): void {
  if (navigateListenerWired.has(emitter)) return;
  navigateListenerWired.add(emitter);
  emitter.on('did-navigate', () => onNavigated());
}
