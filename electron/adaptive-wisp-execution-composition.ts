/**
 * Adaptive Wisp Increment 4B — production adapter factory (Section 36).
 *
 * One well-defined construction point for the real WispTrainerExecutionAdapter,
 * so no future caller creates its own competing instance. NOT registered with
 * ipcMain, imported by no preload script, and reachable from no renderer —
 * this file exists purely so the composition already has a single home before
 * a real caller (hotkey/IPC — a later, separately-authorized increment) needs
 * one.
 */
import { getActiveLiveMemorySessionBundle } from './live-memory-ipc.js';
import {
  createLiveMemoryWispTrainerExecutionAdapter,
  resolveAdaptiveWispConsentBinding,
  releaseAdaptiveWispConsentAuthority,
  type LiveMemoryWispSessionBundle,
} from '../src/core/live-memory/adaptive-wisp-live-adapter.js';
import { issueWriteConsent } from '../src/core/consent/write-consent.js';
import { createCatalogGameIdentityBridge } from '../src/core/adaptive-wisp/catalog-game-identity-bridge.js';
import type { WispTrainerExecutionAdapter } from '../src/core/adaptive-wisp/trainer-execution-adapter.js';

let cached: WispTrainerExecutionAdapter | null = null;

/** Returns the single production Adaptive Wisp execution adapter instance. */
export function getAdaptiveWispExecutionAdapter(): WispTrainerExecutionAdapter {
  if (!cached) {
    cached = createLiveMemoryWispTrainerExecutionAdapter(
      (): LiveMemoryWispSessionBundle | null => getActiveLiveMemorySessionBundle(),
      createCatalogGameIdentityBridge(),
    );
  }
  return cached;
}

/**
 * Phase 1 consent completion — the ONE place a one-use write-consent token
 * is minted for a Wisp-routed proposal. Lives here, not in
 * electron/adaptive-wisp-hotkey-composition.ts, because that file is
 * statically forbidden from importing write-consent.ts/live-memory
 * internals directly (tests/adaptive-wisp-hotkey-boundary-static.test.ts) —
 * this file is already the established Increment 4B seam for exactly that
 * boundary, so minting a token here (rather than a new competing seam) keeps
 * there being exactly one place that reads live-memory internals to build a
 * `WriteConsentBinding` for Adaptive Wisp.
 */
export function mintAdaptiveWispConsentToken(input: { lowLevelProposalId: string; operationType: 'write' | 'freeze' }): { tokenId: string; expiresAt: string } | null {
  const operation = input.operationType === 'freeze' ? ('live_memory_freeze_start' as const) : ('live_memory_confirm_write' as const);
  const binding = resolveAdaptiveWispConsentBinding(() => getActiveLiveMemorySessionBundle(), operation, input.lowLevelProposalId);
  if (!binding) return null;
  const artifact = issueWriteConsent(binding);
  return { tokenId: artifact.tokenId, expiresAt: artifact.expiresAt };
}

/**
 * Phase 2 remediation — the release counterpart to `mintAdaptiveWispConsentToken`.
 * Called by the consent service whenever a Wisp proposal terminates without a
 * successful confirm, so the staged low-level write/freeze proposal does not
 * outlive the high-level decision that ended it (Section 9 cleanup).
 */
export function releaseAdaptiveWispConsentToken(input: { lowLevelProposalId: string; operationType: 'write' | 'freeze' }): void {
  const operation = input.operationType === 'freeze' ? ('live_memory_freeze_start' as const) : ('live_memory_confirm_write' as const);
  releaseAdaptiveWispConsentAuthority(() => getActiveLiveMemorySessionBundle(), operation, input.lowLevelProposalId);
}
