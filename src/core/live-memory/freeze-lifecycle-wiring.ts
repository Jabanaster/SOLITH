export interface FreezeLifecycleWebContents {
  readonly id: number;
  once(event: 'destroyed', listener: () => void): unknown;
  on(event: 'render-process-gone' | 'did-start-navigation' | 'will-navigate', listener: (...args: any[]) => void): unknown;
}

export interface FreezeLifecycleWindow {
  webContents: FreezeLifecycleWebContents;
  on(event: 'closed', listener: () => void): unknown;
}

export interface FreezeLifecycleApp {
  on(event: 'before-quit', listener: () => void): unknown;
}

export interface FreezeLifecycleWiring {
  wireWindow(window: FreezeLifecycleWindow): void;
}

export function createFreezeLifecycleWiring(
  app: FreezeLifecycleApp,
  cleanup: {
    stopByRenderer(rendererId: number, reason: string): void;
    stopAll(reason: string): void;
  },
): FreezeLifecycleWiring {
  const wired = new WeakSet<object>();
  app.on('before-quit', () => cleanup.stopAll('app_quit'));

  return {
    wireWindow(window) {
      if (wired.has(window)) return;
      wired.add(window);
      const rendererId = window.webContents.id;
      const stop = (reason: string) => cleanup.stopByRenderer(rendererId, reason);
      window.webContents.once('destroyed', () => stop('renderer_destroyed'));
      window.webContents.on('render-process-gone', () => stop('renderer_crashed'));
      window.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) stop('navigation_started');
      });
      window.webContents.on('will-navigate', () => stop('will_navigate'));
      window.on('closed', () => stop('window_closed'));
    },
  };
}
