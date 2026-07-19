/**
 * Opt-in Solith Definition Hub sync lifecycle (Electron main process).
 *
 * Disabled = no timer, no Hub network traffic.
 * Enabled = immediate delta sync + non-overlapping 15-minute interval.
 */

import { getSetting } from '../src/core/settings/index.js';
import {
  syncCommunityDefinitions,
  type CommunitySyncOptions,
  type CommunitySyncResult,
} from '../src/core/trainer-catalog/sync/hub-client.js';

export const COMMUNITY_SYNC_INTERVAL_MS = 15 * 60 * 1000;

export interface CommunitySyncOrchestratorDeps {
  isEnabled?: () => boolean;
  sync?: (options?: CommunitySyncOptions) => Promise<CommunitySyncResult>;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  now?: () => number;
  log?: (message: string, detail?: unknown) => void;
}

let timer: ReturnType<typeof setInterval> | null = null;
let inFlight: Promise<CommunitySyncResult> | null = null;
let deps: Required<CommunitySyncOrchestratorDeps> = defaultDeps();

function defaultDeps(): Required<CommunitySyncOrchestratorDeps> {
  return {
    isEnabled: () => getSetting('communitySyncEnabled') === true,
    sync: (options) => syncCommunityDefinitions(options),
    setIntervalFn: setInterval,
    clearIntervalFn: clearInterval,
    now: () => Date.now(),
    log: (message, detail) => {
      if (detail !== undefined) {
        console.info(`[community-sync] ${message}`, detail);
      } else {
        console.info(`[community-sync] ${message}`);
      }
    },
  };
}

/** Test-only dependency injection. */
export function configureCommunitySyncOrchestrator(
  overrides: CommunitySyncOrchestratorDeps = {},
): void {
  deps = { ...defaultDeps(), ...overrides };
}

export function resetCommunitySyncOrchestratorForTests(): void {
  stopCommunitySyncPolling();
  deps = defaultDeps();
}

export function isCommunitySyncPollingActive(): boolean {
  return timer != null;
}

export function stopCommunitySyncPolling(): void {
  if (timer) {
    deps.clearIntervalFn(timer as unknown as NodeJS.Timeout);
    timer = null;
  }
}

async function runSyncTick(reason: string): Promise<CommunitySyncResult | null> {
  if (!deps.isEnabled()) {
    stopCommunitySyncPolling();
    return null;
  }
  if (inFlight) {
    deps.log(`skip overlapping sync (${reason})`);
    return inFlight;
  }

  inFlight = deps.sync().finally(() => {
    inFlight = null;
  });

  try {
    const result = await inFlight;
    deps.log(`tick ${reason}`, {
      status: result.status,
      imported: result.imported,
      skippedUserDefinitions: result.skippedUserDefinitions,
      rejected: result.rejected,
      pages: result.pages,
    });
    return result;
  } catch (error) {
    deps.log(`tick ${reason} failed`, error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * Start polling only when community sync is enabled.
 * Creates no timer and performs no Hub fetch while disabled.
 */
export async function startCommunitySyncPolling(): Promise<CommunitySyncResult | null> {
  if (!deps.isEnabled()) {
    stopCommunitySyncPolling();
    return null;
  }

  if (!timer) {
    timer = deps.setIntervalFn(() => {
      void runSyncTick('interval');
    }, COMMUNITY_SYNC_INTERVAL_MS);
  }

  return runSyncTick('start');
}

/**
 * Reconcile polling with the current setting value.
 * Call after bootstrap and whenever communitySyncEnabled changes.
 */
export async function reconcileCommunitySyncPolling(): Promise<CommunitySyncResult | null> {
  if (!deps.isEnabled()) {
    stopCommunitySyncPolling();
    deps.log('disabled — timer cleared, zero Hub network');
    return null;
  }
  return startCommunitySyncPolling();
}
