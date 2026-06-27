/**
 * Lifecycle ownership and cleanup wiring for the V2 Session Monitor.
 *
 * This module contains pure logic with no Electron imports. All Electron
 * objects (app, BrowserWindow, webContents) are injected as duck-typed
 * interfaces so the module can be exercised in Node tests without launching
 * Electron.
 *
 * OWNERSHIP MODEL
 * ───────────────
 * ownerWebContentsId is the ID of the renderer that successfully started the
 * current monitoring session. It is derived exclusively from event.sender.id
 * in the IPC handler — never from a renderer-supplied payload value.
 *
 *   - Only the owning renderer may stop an active session via IPC.
 *   - A failed start does not change the owner.
 *   - App shutdown, window close, and webContents destruction stop the session
 *     regardless of ownership (main-process authority).
 *   - Destruction of an unrelated renderer leaves the session untouched.
 *   - Cleanup (safeStop) is idempotent: repeated calls are safe even when
 *     window-close, webContents-destroyed, and before-quit all fire together.
 */

// ── Injectable interfaces ─────────────────────────────────────────────────────

export interface StartConfig {
  gameId: string;
  executableName: string;
  markerFilePath?: string;
  pollIntervalMs?: number;
}

/** Minimal monitor interface — satisfied by SessionMonitorService. */
export interface MonitorHandle {
  start(config: StartConfig): { success: boolean; error?: string };
  stop(reason?: string): void;
  getStatus(): { isRunning: boolean };
}

/** Minimal webContents interface. */
export interface WebContentsLike {
  readonly id: number;
  isDestroyed(): boolean;
  once(event: 'destroyed', listener: () => void): unknown;
}

/** Minimal BrowserWindow interface. */
export interface BrowserWindowLike {
  webContents: WebContentsLike;
  on(event: 'closed', listener: () => void): unknown;
  removeListener(event: 'closed', listener: () => void): unknown;
}

/** Minimal app interface. */
export interface AppLike {
  on(event: 'before-quit', listener: () => void): unknown;
  removeListener(event: 'before-quit', listener: () => void): unknown;
}

// ── Public wiring interface ───────────────────────────────────────────────────

export interface LifecycleWiring {
  /**
   * Handle an IPC 'v2-monitor-start' request.
   *
   * senderId MUST be event.sender.id — never a renderer-supplied value.
   * Returns a normalized result safe to send back to the renderer.
   */
  handleStart(
    senderId: number,
    config: StartConfig,
    opts: {
      /** Value of the v2SessionMonitorEnabled setting at call time. */
      featureEnabled: boolean;
      /** False when event.sender.isDestroyed() is true at call time. */
      senderValid: boolean;
    },
  ): { success: boolean; error?: string };

  /**
   * Handle an IPC 'v2-monitor-stop' request.
   *
   * Only the owning renderer may stop an owned session.
   * Unrelated renderers receive { success: false } and the session is left running.
   * When there is no owner (already stopped), any caller succeeds.
   */
  handleStop(senderId: number): { success: boolean };

  /** WebContents ID of the renderer that owns the current session, or null. */
  readonly ownerWebContentsId: number | null;

  /**
   * Wire a BrowserWindow's per-window lifecycle events.
   * Idempotent — calling twice for the same window object is a no-op.
   * Call once per newly created BrowserWindow.
   */
  wireWindow(win: BrowserWindowLike): void;

  /**
   * Notify the wiring that the v2SessionMonitorEnabled feature flag changed.
   * If enabled is false and a session is active it is stopped immediately.
   */
  notifyFeatureChanged(enabled: boolean): void;

  /**
   * Remove the app-level 'before-quit' listener.
   * Call in tests after each case, or during app teardown.
   * Safe to call multiple times.
   */
  dispose(): void;
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createLifecycleWiring(
  monitor: MonitorHandle,
  app: AppLike,
): LifecycleWiring {
  let ownerWebContentsId: number | null = null;

  // WeakSet prevents duplicate wiring per window and does not prevent GC.
  const wiredWindows = new WeakSet<object>();

  /**
   * Idempotent stop. Checks isRunning so that close + destroyed + before-quit
   * firing in a single shutdown sequence only calls monitor.stop() once.
   * Always clears ownership regardless of whether the monitor was running.
   */
  function safeStop(reason: string): void {
    ownerWebContentsId = null;
    if (monitor.getStatus().isRunning) {
      monitor.stop(reason);
    }
  }

  // App-level listener — installed exactly once per wiring instance.
  const onBeforeQuit = (): void => safeStop('app_quit');
  app.on('before-quit', onBeforeQuit);

  // ── Public methods ──────────────────────────────────────────────────────────

  function handleStart(
    senderId: number,
    config: StartConfig,
    opts: { featureEnabled: boolean; senderValid: boolean },
  ): { success: boolean; error?: string } {
    if (!opts.senderValid) {
      return { success: false, error: 'sender_invalid' };
    }
    if (!opts.featureEnabled) {
      return { success: false, error: 'V2 session monitor is disabled.' };
    }

    const result = monitor.start(config);
    if (result.success) {
      // Record the owner only after a confirmed successful start.
      ownerWebContentsId = senderId;
    }
    return result;
  }

  function handleStop(senderId: number): { success: boolean } {
    if (ownerWebContentsId !== null && ownerWebContentsId !== senderId) {
      // Unrelated renderer cannot stop an owned session.
      return { success: false };
    }
    safeStop('user_stopped');
    return { success: true };
  }

  function wireWindow(win: BrowserWindowLike): void {
    // Guard: do not register duplicate listeners if the same window is wired twice.
    if (wiredWindows.has(win as object)) return;
    wiredWindows.add(win as object);

    // Window-close fires when the OS window is destroyed.
    // The monitor must stop regardless of which renderer was the owner.
    win.on('closed', () => safeStop('window_closed'));

    // webContents destroyed: only stop if this renderer was the session owner.
    // This prevents an unrelated renderer's destruction from killing a
    // separate renderer's active session.
    const wc = win.webContents;
    wc.once('destroyed', () => {
      if (ownerWebContentsId === wc.id) {
        safeStop('renderer_destroyed');
      }
    });
  }

  function notifyFeatureChanged(enabled: boolean): void {
    if (!enabled) safeStop('feature_disabled');
  }

  function dispose(): void {
    app.removeListener('before-quit', onBeforeQuit);
  }

  return {
    get ownerWebContentsId() { return ownerWebContentsId; },
    handleStart,
    handleStop,
    wireWindow,
    notifyFeatureChanged,
    dispose,
  };
}
