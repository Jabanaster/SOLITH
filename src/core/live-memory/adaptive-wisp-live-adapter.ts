/**
 * Adaptive Wisp Increment 4B — production `WispTrainerExecutionAdapter`.
 *
 * Lives outside src/core/adaptive-wisp/ deliberately: that directory's static
 * boundary test (tests/adaptive-wisp-boundary-static.test.ts) forbids any
 * import containing "live-memory" or "freeze", since the pure executor must
 * never see raw memory/session internals directly. This file IS the seam —
 * it implements the WispTrainerExecutionAdapter contract (defined in
 * src/core/adaptive-wisp/trainer-execution-adapter.ts) by delegating every
 * operation to the real MemoryManager / LiveMemorySession / write-consent
 * services. It performs no memory I/O of its own: every read, write, and
 * freeze call is a pass-through to an existing canonical method.
 *
 * Address resolution note (audit finding, Increment 4B): cheat-system's
 * GameConfig.cheats[] (game-registry.ts) carries no memory address/pointer
 * data at all — it is a display/discovery catalog only. The catalog that
 * actually resolves an entry to a LiveMemoryAddress is schema.v1
 * (trainer-catalog memoryFeatures, resolved via resolveLiveControlFromSchema
 * + LiveMemorySession.resolveControl), keyed by catalogGameId — the SAME
 * field CanonicalGame already carries (`catalogGameId`, canonical-games/
 * types.ts) to bridge to trainer_catalog_games. So the identity bridge this
 * adapter needs is CanonicalGameId -> catalogGameId, which already exists as
 * real data (see catalog-game-identity-bridge.ts) — no fuzzy/guessed mapping
 * required, and no separate mapping table to populate.
 */
import type { CanonicalGameId, CanonicalTrainerEntryId, WispControlType } from '../adaptive-wisp/types.js';
import type { WispSafeDisplayValue } from '../adaptive-wisp/execution-types.js';
import type {
  WispCanonicalProposal,
  WispCanonicalWriteOutcome,
  WispTrainerEntryState,
  WispTrainerExecutionAdapter,
} from '../adaptive-wisp/trainer-execution-adapter.js';
import type { WispGameIdentityBridge } from '../adaptive-wisp/game-identity-bridge.js';
import type { MemoryManager } from './memory-manager.js';
import { MAX_FREEZE_DURATION_MS, type LiveMemorySession } from './live-memory-session.js';
import type { LiveMemoryAddress, LiveValueType } from './types.js';
import { resolveLiveControlFromSchema } from './dual-read-controls.js';
import { consumeWriteConsent, type WriteConsentBinding } from '../consent/write-consent.js';

export interface LiveMemoryWispSessionBundle {
  manager: MemoryManager;
  session: LiveMemorySession;
}

/**
 * Returns the single current authorized session/manager pair, or null when
 * nothing is attached. Injected — this file never decides "which session is
 * current" itself; that remains SOLITH's existing runtime/session authority
 * (Section 8/9 of the Increment 4B spec). No pid/exe/handle is ever accepted
 * from Adaptive Wisp as authoritative selection.
 */
export type LiveMemoryWispSessionAccessor = () => LiveMemoryWispSessionBundle | null;

/**
 * Fixed sessionKey used for every consent binding this adapter builds.
 * Consent tokens are never minted here (Section 12) — whatever future caller
 * issues consent for an Adaptive-Wisp-routed proposal must use this same
 * sessionKey so the binding hash this adapter reconstructs at confirm time
 * matches what was hashed at issuance. This is the one piece of the binding
 * that identity evidence alone cannot supply; documenting it as a fixed
 * constant is the deliberate "mapping lifecycle" decision (Section 32-style)
 * for this seam, not a value Wisp invents per call.
 */
export const ADAPTIVE_WISP_CONSENT_SESSION_KEY = 'adaptive-wisp';

const ALL_CONTROL_TYPES: WispControlType[] = [
  'toggle',
  'freeze',
  'set',
  'increment',
  'multiplier',
  'cycle',
  'momentary',
];

interface ResolvedControl {
  address: LiveMemoryAddress;
  dataType: LiveValueType;
}

function resolveEntryAddress(
  bundle: LiveMemoryWispSessionBundle,
  identityBridge: WispGameIdentityBridge,
  gameId: CanonicalGameId,
  entryId: CanonicalTrainerEntryId,
): ResolvedControl | null {
  const catalogGameId = identityBridge.resolveCheatSystemGameId(gameId);
  if (!catalogGameId) return null;

  // schema.v1 control ids are always "<catalogGameId>:<featureId>" (see
  // dual-read-controls.ts's memoryFeatureToLiveControl) — CanonicalTrainerEntryId
  // carries only the bare featureId, so the composite id must be built here.
  const executableName = bundle.session.getAttachedExecutableName() ?? undefined;
  const controlId = `${catalogGameId}:${entryId}`;
  const resolved = resolveLiveControlFromSchema(controlId, { catalogGameId, executableName });
  if (!resolved.control) return null;

  try {
    const address = bundle.session.resolveControl(resolved.control);
    return { address, dataType: resolved.control.dataType };
  } catch {
    return null;
  }
}

function buildConsentBinding(
  operation: WriteConsentBinding['operation'],
  bundle: LiveMemoryWispSessionBundle,
  proposalId: string,
  extra: Partial<WriteConsentBinding> = {},
): WriteConsentBinding | null {
  const identity = bundle.session.getAttachedIdentity();
  if (!identity) return null;
  return {
    operation,
    sessionKey: ADAPTIVE_WISP_CONSENT_SESSION_KEY,
    proposalId,
    attachedPid: identity.pid,
    attachedExecutableName: identity.executableName,
    executablePath: identity.executablePath,
    processStartTime: identity.startTime,
    volumeSerialNumber: identity.volumeSerialNumber,
    fileIndex: identity.fileIndex,
    attachedExeSha256: identity.exeSha256,
    ...extra,
  };
}

function isFrozenTarget(session: LiveMemorySession, address: LiveMemoryAddress): boolean {
  const status = session.getFreezeStatus();
  return (
    status.active === true &&
    status.target !== null &&
    status.target.address.address === address.address &&
    status.target.address.dataType === address.dataType
  );
}

/**
 * Constructs the production adapter. `getSession` and `identityBridge` are
 * both injected (Section 6) — this function performs no global lookups and
 * owns no session state of its own.
 */
export function createLiveMemoryWispTrainerExecutionAdapter(
  getSession: LiveMemoryWispSessionAccessor,
  identityBridge: WispGameIdentityBridge,
): WispTrainerExecutionAdapter {
  return {
    getCurrentState(gameId, entryId): WispTrainerEntryState | null {
      const bundle = getSession();
      if (!bundle) return null;
      if (bundle.session.verifyAttachedProcessIdentity()) return null;

      const resolved = resolveEntryAddress(bundle, identityBridge, gameId, entryId);
      if (!resolved) return null;

      let currentValue: WispSafeDisplayValue | undefined;
      try {
        currentValue = bundle.session.readValue(resolved.address);
      } catch {
        currentValue = undefined;
      }

      return {
        frozen: isFrozenTarget(bundle.session, resolved.address),
        currentValue,
        dataType: resolved.dataType,
        supportsControls: ALL_CONTROL_TYPES,
      };
    },

    proposeWrite(gameId, entryId, requestedValue): WispCanonicalProposal | null {
      const bundle = getSession();
      if (!bundle) return null;
      if (bundle.session.verifyAttachedProcessIdentity()) return null;
      if (typeof requestedValue !== 'number' || !Number.isFinite(requestedValue)) return null;

      const resolved = resolveEntryAddress(bundle, identityBridge, gameId, entryId);
      if (!resolved) return null;

      try {
        const proposal = bundle.manager.proposeWrite(resolved.address, requestedValue, {
          reason: 'adaptive_wisp_propose',
        });
        return { proposalId: proposal.proposalId };
      } catch {
        return null;
      }
    },

    // NOTE (Increment 4B finding — see ADAPTIVE_WISP_PLATFORM.md): the canonical
    // confirm path (MemoryManager.confirmWrite / LiveMemorySession.confirmWrite)
    // is async — it performs a real native write plus an awaited snapshot-listener
    // hook. WispTrainerExecutionAdapter.confirmWrite/confirmFreeze are SYNCHRONOUS
    // by contract (executeWispAction calls them without await). This adapter will
    // not fake synchronicity (blocking-wait shims are unsafe and were explicitly
    // ruled out — Section 69's "no unsafe shortcuts" applies here). Consent
    // consumption itself IS synchronous and is proven for real below (replay,
    // expiry, wrong-session, wrong-token all correctly reject before the async
    // boundary), but the actual confirmed write cannot complete through this
    // synchronous interface. Closing this requires widening
    // WispTrainerExecutionAdapter.confirmWrite/confirmFreeze (and executeWispAction)
    // to async — out of this pass's scope (no unrelated executor changes authorized)
    // and reported as the single highest-priority remaining Increment 4 blocker.
    confirmWrite(proposalId, consentToken): WispCanonicalWriteOutcome {
      const bundle = getSession();
      if (!bundle) return { ok: false, status: 'rejected', reason: 'no_active_session' };
      const identityError = bundle.session.verifyAttachedProcessIdentity();
      if (identityError) return { ok: false, status: 'rejected', reason: identityError };

      const pending = bundle.session.getPendingWriteProposal(proposalId);
      if (!pending) return { ok: false, status: 'rejected', reason: 'unknown_or_consumed_proposal' };

      const consentBinding = buildConsentBinding('live_memory_confirm_write', bundle, proposalId, {
        address: pending.target.address.toString(),
        dataType: pending.target.dataType,
        currentValue: pending.currentValue,
        requestedValue: pending.requestedValue,
      });
      if (!consentBinding) return { ok: false, status: 'rejected', reason: 'incomplete_process_identity' };

      const consumed = consumeWriteConsent(consentToken, consentBinding);
      if (consumed.ok === false) {
        return { ok: false, status: 'rejected', reason: `consent_denied:${consumed.reason}` };
      }

      return {
        ok: false,
        status: 'failed',
        reason: 'async_confirmation_not_yet_wired: canonical confirmWrite is async; WispTrainerExecutionAdapter.confirmWrite must become async before this can complete a real write',
      };
    },

    proposeFreeze(gameId, entryId, value, intervalMs): WispCanonicalProposal | null {
      const bundle = getSession();
      if (!bundle) return null;
      if (bundle.session.verifyAttachedProcessIdentity()) return null;
      if (typeof value !== 'number' || !Number.isFinite(value)) return null;

      const resolved = resolveEntryAddress(bundle, identityBridge, gameId, entryId);
      if (!resolved) return null;

      try {
        const proposal = bundle.session.proposeFreeze(resolved.address, value, intervalMs);
        return { proposalId: proposal.proposalId };
      } catch {
        return null;
      }
    },

    // Same async-boundary finding as confirmWrite above — see note there.
    confirmFreeze(proposalId, consentToken): WispCanonicalWriteOutcome {
      const bundle = getSession();
      if (!bundle) return { ok: false, status: 'rejected', reason: 'no_active_session' };
      const identityError = bundle.session.verifyAttachedProcessIdentity();
      if (identityError) return { ok: false, status: 'rejected', reason: identityError };

      const pending = bundle.session.getPendingFreezeProposal(proposalId);
      if (!pending) return { ok: false, status: 'rejected', reason: 'unknown_or_consumed_proposal' };

      const consentBinding = buildConsentBinding('live_memory_freeze_start', bundle, proposalId, {
        address: pending.target.address.toString(),
        dataType: pending.target.dataType,
        freezeValue: pending.value,
        freezeIntervalMs: pending.intervalMs,
        freezeMaxDurationMs: MAX_FREEZE_DURATION_MS,
      });
      if (!consentBinding) return { ok: false, status: 'rejected', reason: 'incomplete_process_identity' };

      const consumed = consumeWriteConsent(consentToken, consentBinding);
      if (consumed.ok === false) {
        return { ok: false, status: 'rejected', reason: `consent_denied:${consumed.reason}` };
      }

      return {
        ok: false,
        status: 'failed',
        reason: 'async_confirmation_not_yet_wired: canonical freeze start goes through MemoryManager.freezeStart (async); WispTrainerExecutionAdapter.confirmFreeze must become async before a real freeze can start',
      };
    },

    stopFreeze(gameId, entryId): WispCanonicalWriteOutcome {
      const bundle = getSession();
      if (!bundle) return { ok: false, status: 'rejected', reason: 'no_active_session' };
      if (bundle.session.verifyAttachedProcessIdentity()) {
        return { ok: false, status: 'rejected', reason: 'identity_mismatch' };
      }
      bundle.session.stopFreeze();
      return { ok: true, status: 'unfrozen', currentValue: undefined };
    },
  };
}
