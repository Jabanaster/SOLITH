import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { validateIpcSender } from './sender-validation.js';
import { requireAuthorizedSessionForExecution } from './live-memory-ipc.js';
import {
  TrainerBindRuntimeSchema,
  TrainerConfirmFreezeFeatureSchema,
  TrainerConfirmWriteFeatureSchema,
  TrainerDeactivateFeatureSchema,
  TrainerExecuteCompositeSchema,
  TrainerIssueFreezeConsentSchema,
  TrainerIssueWriteConsentSchema,
  TrainerProposeFreezeFeatureSchema,
  TrainerProposeWriteFeatureSchema,
  TrainerRollbackFeatureSchema,
  TrainerTransactionIdSchema,
  TrainerUnbindRuntimeSchema,
  TrainerGetRuntimeStateSchema,
} from './ipc-validation.js';
import type { WriteConsentBinding } from '../src/core/consent/write-consent.js';
import { LiveMemoryCapabilities } from '../src/core/trainer-runtime/capabilities.js';
import { TrainerRuntime } from '../src/core/trainer-runtime/runtime.js';
import { CompositeTransactionRuntime, type CompositeTransactionPlan, type TransactionAction } from '../src/core/trainer-runtime/transaction.js';
import type { RuntimeError } from '../src/core/trainer-runtime/errors.js';
import type { RuntimeResult } from '../src/core/trainer-runtime/types.js';
import { trainerApplicationService } from '../src/core/trainer-application/service.js';
import { MAX_FREEZE_DURATION_MS, type LiveMemorySession } from '../src/core/live-memory/live-memory-session.js';

/**
 * P4-10: canonical trainer execution IPC. Routes write/freeze/rollback/
 * composite-transaction execution through TrainerApplicationService ->
 * TrainerRuntime/CompositeTransactionRuntime, reusing the SAME per-sender
 * live-memory session `electron/live-memory-ipc.ts` already authorized
 * (`requireAuthorizedSessionForExecution`) instead of performing a second
 * attach — the fix for the P4-9 blocker. Does not touch, redirect, or
 * duplicate the Phase 2 research/scanner/watchlist/memory-map/typed-view
 * surfaces in `electron/live-memory-ipc.ts`, which remain fully independent.
 *
 * Consent (mission §16): write/freeze confirmation requires a real
 * proposalId + consent token pair, obtained through the same
 * propose -> issue-consent -> confirm shape `electron/live-memory-ipc.ts`
 * already uses for raw-address writes (see
 * `src/core/trainer-runtime/action-executor.ts`'s propose/confirm split).
 * No transaction-wide or session-wide consent bypass exists — a composite
 * plan's actions each carry their own already-obtained proposalId + token,
 * cross-checked against the feature's actual pending proposal before the
 * token is trusted.
 */

interface ExecutionEntry {
  runtime: TrainerRuntime;
  transactionRuntime: CompositeTransactionRuntime;
}

/**
 * Keyed by session object identity, not sender id: a fresh `live-memory-attach`
 * always constructs a brand-new `LiveMemorySession` instance for that sender
 * (see live-memory-ipc.ts's `bindSessionBundle`), so a disposed-and-reattached
 * session naturally misses this cache — no stale runtime survives reattach
 * (mission §22), with no extra disposal-listener plumbing needed.
 */
const executionEntries = new WeakMap<LiveMemorySession, ExecutionEntry>();

function requireTrustedSender(event: IpcMainInvokeEvent): { ok: true } | { ok: false; reason: string } {
  const result = validateIpcSender(event, ['main']);
  if (!result.ok) return { ok: false, reason: result.reason ?? 'unknown' };
  return { ok: true };
}

function errorResult(reason: RuntimeError['reason'], message: string) {
  return { success: false as const, error: { reason, message } };
}

function serializeRuntimeResult<T>(result: RuntimeResult<T>) {
  if (result.success === false) return errorResult(result.error.reason, result.error.message);
  return { success: true as const, value: result.value };
}

function catchMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requireExecutionEntry(event: IpcMainInvokeEvent): { session: LiveMemorySession; entry: ExecutionEntry } {
  const { session } = requireAuthorizedSessionForExecution(event);
  const entry = executionEntries.get(session);
  if (!entry) throw new Error('trainer_runtime_not_bound');
  return { session, entry };
}

function buildWriteConsentBinding(
  event: IpcMainInvokeEvent,
  identity: NonNullable<ReturnType<LiveMemorySession['getAttachedIdentity']>>,
  proposal: { proposalId: string; target: { address: bigint; dataType: string }; currentValue: number; requestedValue: number },
): WriteConsentBinding {
  return {
    operation: 'trainer_confirm_write_feature',
    sessionKey: String(event.sender.id),
    proposalId: proposal.proposalId,
    attachedPid: identity.pid,
    attachedExecutableName: identity.executableName,
    executablePath: identity.executablePath,
    processStartTime: identity.startTime,
    volumeSerialNumber: identity.volumeSerialNumber,
    fileIndex: identity.fileIndex,
    attachedExeSha256: identity.exeSha256,
    address: proposal.target.address.toString(),
    dataType: proposal.target.dataType,
    currentValue: proposal.currentValue,
    requestedValue: proposal.requestedValue,
    windowId: event.sender.id,
  };
}

function buildFreezeConsentBinding(
  event: IpcMainInvokeEvent,
  identity: NonNullable<ReturnType<LiveMemorySession['getAttachedIdentity']>>,
  proposal: { proposalId: string; target: { address: bigint; dataType: string }; value: number; intervalMs: number },
): WriteConsentBinding {
  return {
    operation: 'trainer_confirm_freeze_feature',
    sessionKey: String(event.sender.id),
    proposalId: proposal.proposalId,
    attachedPid: identity.pid,
    attachedExecutableName: identity.executableName,
    executablePath: identity.executablePath,
    processStartTime: identity.startTime,
    volumeSerialNumber: identity.volumeSerialNumber,
    fileIndex: identity.fileIndex,
    attachedExeSha256: identity.exeSha256,
    address: proposal.target.address.toString(),
    dataType: proposal.target.dataType,
    freezeValue: proposal.value,
    freezeIntervalMs: proposal.intervalMs,
    freezeMaxDurationMs: MAX_FREEZE_DURATION_MS,
    windowId: event.sender.id,
  };
}

/**
 * Reconstructs one composite-plan action's real `WriteApproval`, requiring
 * the same already-issued proposalId/consentToken pair a single-action
 * caller would have obtained via propose -> issue-consent first. Never
 * trusts a renderer-supplied consentBinding directly (mirrors every other
 * confirm handler in this file and in live-memory-ipc.ts).
 */
function buildTransactionAction(
  event: IpcMainInvokeEvent,
  session: LiveMemorySession,
  runtime: TrainerRuntime,
  identity: NonNullable<ReturnType<LiveMemorySession['getAttachedIdentity']>>,
  action: { kind: 'write' | 'freeze'; featureId: string; requestedValue?: number; value?: number; proposalId: string; consentToken: string; reason?: string; intervalMs?: number },
): { ok: true; action: TransactionAction } | { ok: false; error: RuntimeError } {
  const feature = runtime.getFeatureState(action.featureId);
  if (!feature || feature.activation.proposalId !== action.proposalId) {
    return {
      ok: false,
      error: { reason: 'INVALID_STATE_TRANSITION', message: `Proposal for feature "${action.featureId}" does not match its current pending proposal.` },
    };
  }

  if (action.kind === 'write') {
    const proposal = session.getPendingWriteProposal(action.proposalId);
    if (!proposal) return { ok: false, error: { reason: 'CAPABILITY_UNAVAILABLE', message: 'Unknown or already-consumed write proposal.' } };
    return {
      ok: true,
      action: {
        kind: 'write',
        featureId: action.featureId,
        requestedValue: action.requestedValue!,
        approval: { kind: 'token', consentToken: action.consentToken, consentBinding: buildWriteConsentBinding(event, identity, proposal) },
        reason: action.reason,
      },
    };
  }

  const proposal = session.getPendingFreezeProposal(action.proposalId);
  if (!proposal) return { ok: false, error: { reason: 'CAPABILITY_UNAVAILABLE', message: 'Unknown or already-consumed freeze proposal.' } };
  return {
    ok: true,
    action: {
      kind: 'freeze',
      featureId: action.featureId,
      value: action.value!,
      approval: { consentToken: action.consentToken, consentBinding: buildFreezeConsentBinding(event, identity, proposal) },
      intervalMs: action.intervalMs,
    },
  };
}

export function registerTrainerExecutionIpc(): void {
  ipcMain.handle('trainer-bind-runtime', async (event, payload: unknown) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return errorResult('AUTHORIZATION_FAILED', `sender_rejected:${senderCheck.reason}`);
      const parsed = TrainerBindRuntimeSchema.parse(payload);
      const { session, manager } = requireAuthorizedSessionForExecution(event);

      const identity = session.getAttachedIdentity();
      if (!identity) return errorResult('CAPABILITY_UNAVAILABLE', 'Attached session has no complete process identity.');
      if (identity.pid !== parsed.pid || identity.executableName.toLowerCase() !== parsed.executableName.toLowerCase()) {
        return errorResult('AUTHORIZATION_FAILED', 'Requested bind target does not match the session actually attached for this sender.');
      }

      const record = trainerApplicationService.getTrainer(parsed.catalogGameId);
      if (record.success === false) return errorResult('CAPABILITY_UNAVAILABLE', record.error.message);

      let entry = executionEntries.get(session);
      if (entry && entry.runtime.getDefinition()?.id === parsed.catalogGameId) {
        const state = entry.runtime.getState();
        if (state === 'BOUND' || state === 'READY' || state === 'ACTIVE') {
          return { success: true, value: trainerApplicationService.getRuntimeState(entry.runtime) };
        }
        if (state === 'DEGRADED') {
          const compatInput = {
            pid: identity.pid,
            executableName: identity.executableName,
            executablePath: identity.executablePath,
            executableHashSHA256: identity.exeSha256 ?? parsed.executableHashSHA256,
            driftAcknowledged: parsed.driftAcknowledged,
          };
          const recheck = entry.runtime.recheckCompatibilityAfterLoss(compatInput);
          if (recheck.success === false) return serializeRuntimeResult(recheck);
          const rebind = await entry.runtime.bindExisting({ pid: identity.pid, executableName: identity.executableName });
          if (rebind.success === false) return serializeRuntimeResult(rebind);
          return { success: true, value: trainerApplicationService.getRuntimeState(entry.runtime) };
        }
        // FAILED/DISPOSED/UNLOADED: fall through and rebuild a fresh runtime below.
      }

      if (entry) entry.runtime.dispose(); // BORROWED-safe: never touches the shared session.
      const capabilities = new LiveMemoryCapabilities(session, manager);
      const runtime = new TrainerRuntime(capabilities);
      const transactionRuntime = new CompositeTransactionRuntime(runtime, capabilities);
      entry = { runtime, transactionRuntime };
      executionEntries.set(session, entry);

      const compatInput = {
        pid: identity.pid,
        executableName: identity.executableName,
        executablePath: identity.executablePath,
        executableHashSHA256: identity.exeSha256 ?? parsed.executableHashSHA256,
        driftAcknowledged: parsed.driftAcknowledged,
      };
      const prepared = trainerApplicationService.prepareRuntime(runtime, record.value.definition, compatInput);
      if (prepared.success === false) return serializeRuntimeResult(prepared);

      const bound = await trainerApplicationService.bindRuntime(
        runtime,
        { pid: identity.pid, executableName: identity.executableName },
        { mode: 'borrow' },
      );
      if (bound.success === false) return serializeRuntimeResult(bound);

      return { success: true, value: trainerApplicationService.getRuntimeState(runtime) };
    } catch (error) {
      return errorResult('CAPABILITY_UNAVAILABLE', catchMessage(error));
    }
  });

  ipcMain.handle('trainer-unbind-runtime', async (event, payload: unknown) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return errorResult('AUTHORIZATION_FAILED', `sender_rejected:${senderCheck.reason}`);
      TrainerUnbindRuntimeSchema.parse(payload);
      const { session } = requireAuthorizedSessionForExecution(event);
      const entry = executionEntries.get(session);
      if (entry) {
        entry.runtime.dispose(); // BORROWED-safe: never touches the shared session.
        executionEntries.delete(session);
      }
      return { success: true, value: undefined };
    } catch (error) {
      return errorResult('CAPABILITY_UNAVAILABLE', catchMessage(error));
    }
  });

  ipcMain.handle('trainer-get-runtime-state', async (event, payload: unknown) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return errorResult('AUTHORIZATION_FAILED', `sender_rejected:${senderCheck.reason}`);
      TrainerGetRuntimeStateSchema.parse(payload);
      const { entry } = requireExecutionEntry(event);
      const state = entry.runtime.getState();
      if (state === 'BOUND' || state === 'READY' || state === 'ACTIVE') {
        entry.runtime.verifyProcessStillBound();
      }
      return { success: true, value: trainerApplicationService.getRuntimeState(entry.runtime) };
    } catch (error) {
      return errorResult('CAPABILITY_UNAVAILABLE', catchMessage(error));
    }
  });

  ipcMain.handle('trainer-propose-write-feature', async (event, payload: unknown) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return errorResult('AUTHORIZATION_FAILED', `sender_rejected:${senderCheck.reason}`);
      const parsed = TrainerProposeWriteFeatureSchema.parse(payload);
      const { entry } = requireExecutionEntry(event);
      const result = await trainerApplicationService.proposeWriteFeature(entry.runtime, parsed.featureId, parsed.requestedValue, 'ipc_propose');
      if (result.success === false) return errorResult(result.error.reason, result.error.message);
      return {
        success: true,
        value: {
          proposalId: result.value.proposalId,
          address: result.value.target.address.toString(),
          dataType: result.value.target.dataType,
          currentValue: result.value.currentValue,
          requestedValue: result.value.requestedValue,
        },
      };
    } catch (error) {
      return errorResult('CAPABILITY_UNAVAILABLE', catchMessage(error));
    }
  });

  ipcMain.handle('trainer-issue-write-consent', async (event, payload: unknown) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return errorResult('AUTHORIZATION_FAILED', `sender_rejected:${senderCheck.reason}`);
      const parsed = TrainerIssueWriteConsentSchema.parse(payload);
      const { session, entry } = requireExecutionEntry(event);
      const feature = entry.runtime.getFeatureState(parsed.featureId);
      if (!feature || feature.activation.proposalId !== parsed.proposalId) {
        return errorResult('INVALID_STATE_TRANSITION', `Proposal does not match the pending proposal for feature "${parsed.featureId}".`);
      }
      const identityError = session.verifyAttachedProcessIdentity();
      if (identityError) return errorResult('PROCESS_LOST', identityError);
      const proposal = session.getPendingWriteProposal(parsed.proposalId);
      if (!proposal) return errorResult('CAPABILITY_UNAVAILABLE', 'Unknown or already-consumed write proposal.');
      const identity = session.getAttachedIdentity();
      if (!identity) return errorResult('CAPABILITY_UNAVAILABLE', 'incomplete_process_identity');

      const { requestPrivilegedWriteConsent, formatMemoryWriteConsentLines, parentWindowFromEvent } = await import('./privileged-consent-dialog.js');
      const trainerTitle = entry.runtime.getDefinition()?.title ?? entry.runtime.getDefinition()?.id ?? 'trainer';
      const result = await requestPrivilegedWriteConsent(parentWindowFromEvent(event), {
        title: `Approve trainer write: ${trainerTitle} — ${parsed.featureId}`,
        lines: formatMemoryWriteConsentLines({
          attachedExecutableName: identity.executableName,
          attachedPid: identity.pid,
          executablePath: identity.executablePath,
          address: proposal.target.address.toString(),
          dataType: proposal.target.dataType,
          currentValue: proposal.currentValue,
          requestedValue: proposal.requestedValue,
          proposalId: proposal.proposalId,
        }),
        binding: buildWriteConsentBinding(event, identity, proposal),
      });
      if (result.approved === false) return errorResult('CONSENT_REQUIRED', result.reason);
      return { success: true, value: { consentToken: result.consent.tokenId } };
    } catch (error) {
      return errorResult('CAPABILITY_UNAVAILABLE', catchMessage(error));
    }
  });

  ipcMain.handle('trainer-confirm-write-feature', async (event, payload: unknown) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return errorResult('AUTHORIZATION_FAILED', `sender_rejected:${senderCheck.reason}`);
      const parsed = TrainerConfirmWriteFeatureSchema.parse(payload);
      const { session, entry } = requireExecutionEntry(event);
      const proposal = session.getPendingWriteProposal(parsed.proposalId);
      if (!proposal) return errorResult('CAPABILITY_UNAVAILABLE', 'Unknown or already-consumed write proposal.');
      const identity = session.getAttachedIdentity();
      if (!identity) return errorResult('CAPABILITY_UNAVAILABLE', 'incomplete_process_identity');
      const consentBinding = buildWriteConsentBinding(event, identity, proposal);
      const result = await trainerApplicationService.confirmWriteFeature(
        entry.runtime,
        parsed.featureId,
        parsed.proposalId,
        { kind: 'token', consentToken: parsed.consentToken, consentBinding },
        'ipc_confirm',
      );
      return serializeRuntimeResult(result);
    } catch (error) {
      return errorResult('CAPABILITY_UNAVAILABLE', catchMessage(error));
    }
  });

  ipcMain.handle('trainer-propose-freeze-feature', async (event, payload: unknown) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return errorResult('AUTHORIZATION_FAILED', `sender_rejected:${senderCheck.reason}`);
      const parsed = TrainerProposeFreezeFeatureSchema.parse(payload);
      const { entry } = requireExecutionEntry(event);
      const result = await trainerApplicationService.proposeFreezeFeature(entry.runtime, parsed.featureId, parsed.value, parsed.intervalMs);
      if (result.success === false) return errorResult(result.error.reason, result.error.message);
      return {
        success: true,
        value: {
          proposalId: result.value.proposalId,
          address: result.value.target.address.toString(),
          dataType: result.value.target.dataType,
          value: result.value.value,
          intervalMs: result.value.intervalMs,
        },
      };
    } catch (error) {
      return errorResult('CAPABILITY_UNAVAILABLE', catchMessage(error));
    }
  });

  ipcMain.handle('trainer-issue-freeze-consent', async (event, payload: unknown) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return errorResult('AUTHORIZATION_FAILED', `sender_rejected:${senderCheck.reason}`);
      const parsed = TrainerIssueFreezeConsentSchema.parse(payload);
      const { session, entry } = requireExecutionEntry(event);
      const feature = entry.runtime.getFeatureState(parsed.featureId);
      if (!feature || feature.activation.proposalId !== parsed.proposalId) {
        return errorResult('INVALID_STATE_TRANSITION', `Proposal does not match the pending proposal for feature "${parsed.featureId}".`);
      }
      const identityError = session.verifyAttachedProcessIdentity();
      if (identityError) return errorResult('PROCESS_LOST', identityError);
      const proposal = session.getPendingFreezeProposal(parsed.proposalId);
      if (!proposal) return errorResult('CAPABILITY_UNAVAILABLE', 'Unknown or already-consumed freeze proposal.');
      const identity = session.getAttachedIdentity();
      if (!identity) return errorResult('CAPABILITY_UNAVAILABLE', 'incomplete_process_identity');

      const { requestPrivilegedWriteConsent, formatFreezeConsentLines, parentWindowFromEvent } = await import('./privileged-consent-dialog.js');
      const trainerTitle = entry.runtime.getDefinition()?.title ?? entry.runtime.getDefinition()?.id ?? 'trainer';
      const result = await requestPrivilegedWriteConsent(parentWindowFromEvent(event), {
        title: `Approve trainer freeze: ${trainerTitle} — ${parsed.featureId}`,
        lines: formatFreezeConsentLines({
          attachedExecutableName: identity.executableName,
          attachedPid: identity.pid,
          executablePath: identity.executablePath,
          address: proposal.target.address.toString(),
          dataType: proposal.target.dataType,
          value: proposal.value,
          intervalMs: proposal.intervalMs,
          maxDurationMs: MAX_FREEZE_DURATION_MS,
          proposalId: proposal.proposalId,
        }),
        binding: buildFreezeConsentBinding(event, identity, proposal),
      });
      if (result.approved === false) return errorResult('CONSENT_REQUIRED', result.reason);
      return { success: true, value: { consentToken: result.consent.tokenId } };
    } catch (error) {
      return errorResult('CAPABILITY_UNAVAILABLE', catchMessage(error));
    }
  });

  ipcMain.handle('trainer-confirm-freeze-feature', async (event, payload: unknown) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return errorResult('AUTHORIZATION_FAILED', `sender_rejected:${senderCheck.reason}`);
      const parsed = TrainerConfirmFreezeFeatureSchema.parse(payload);
      const { session, entry } = requireExecutionEntry(event);
      const proposal = session.getPendingFreezeProposal(parsed.proposalId);
      if (!proposal) return errorResult('CAPABILITY_UNAVAILABLE', 'Unknown or already-consumed freeze proposal.');
      const identity = session.getAttachedIdentity();
      if (!identity) return errorResult('CAPABILITY_UNAVAILABLE', 'incomplete_process_identity');
      const consentBinding = buildFreezeConsentBinding(event, identity, proposal);
      const result = await trainerApplicationService.confirmFreezeFeature(entry.runtime, parsed.featureId, parsed.proposalId, {
        consentToken: parsed.consentToken,
        consentBinding,
      });
      return serializeRuntimeResult(result);
    } catch (error) {
      return errorResult('CAPABILITY_UNAVAILABLE', catchMessage(error));
    }
  });

  ipcMain.handle('trainer-deactivate-feature', async (event, payload: unknown) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return errorResult('AUTHORIZATION_FAILED', `sender_rejected:${senderCheck.reason}`);
      const parsed = TrainerDeactivateFeatureSchema.parse(payload);
      const { entry } = requireExecutionEntry(event);
      const result = trainerApplicationService.deactivateFeature(entry.runtime, parsed.featureId);
      return serializeRuntimeResult(result);
    } catch (error) {
      return errorResult('CAPABILITY_UNAVAILABLE', catchMessage(error));
    }
  });

  ipcMain.handle('trainer-rollback-feature', async (event, payload: unknown) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return errorResult('AUTHORIZATION_FAILED', `sender_rejected:${senderCheck.reason}`);
      const parsed = TrainerRollbackFeatureSchema.parse(payload);
      const { entry } = requireExecutionEntry(event);
      const result = await trainerApplicationService.rollbackFeature(entry.runtime, parsed.featureId, parsed.proposalId);
      return serializeRuntimeResult(result);
    } catch (error) {
      return errorResult('CAPABILITY_UNAVAILABLE', catchMessage(error));
    }
  });

  ipcMain.handle('trainer-execute-composite', async (event, payload: unknown) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return errorResult('AUTHORIZATION_FAILED', `sender_rejected:${senderCheck.reason}`);
      const parsed = TrainerExecuteCompositeSchema.parse(payload);
      const { session, entry } = requireExecutionEntry(event);
      const identity = session.getAttachedIdentity();
      if (!identity) return errorResult('CAPABILITY_UNAVAILABLE', 'incomplete_process_identity');

      const actions: TransactionAction[] = [];
      for (const raw of parsed.actions) {
        const built = buildTransactionAction(event, session, entry.runtime, identity, raw);
        if (built.ok === false) return errorResult(built.error.reason, built.error.message);
        actions.push(built.action);
      }

      const plan: CompositeTransactionPlan = { id: parsed.id, actions, mode: 'ATOMIC' };
      const result = await trainerApplicationService.executeComposite(entry.transactionRuntime, plan);
      return serializeRuntimeResult(result);
    } catch (error) {
      return errorResult('CAPABILITY_UNAVAILABLE', catchMessage(error));
    }
  });

  ipcMain.handle('trainer-cancel-composite', async (event, payload: unknown) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return errorResult('AUTHORIZATION_FAILED', `sender_rejected:${senderCheck.reason}`);
      const parsed = TrainerTransactionIdSchema.parse(payload);
      const { entry } = requireExecutionEntry(event);
      const result = trainerApplicationService.cancelComposite(entry.transactionRuntime, parsed.transactionId);
      return serializeRuntimeResult(result);
    } catch (error) {
      return errorResult('CAPABILITY_UNAVAILABLE', catchMessage(error));
    }
  });

  ipcMain.handle('trainer-get-transaction-state', async (event, payload: unknown) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return errorResult('AUTHORIZATION_FAILED', `sender_rejected:${senderCheck.reason}`);
      const parsed = TrainerTransactionIdSchema.parse(payload);
      const { entry } = requireExecutionEntry(event);
      const state = trainerApplicationService.getTransactionState(entry.transactionRuntime, parsed.transactionId);
      if (!state) return errorResult('TRANSACTION_VALIDATION_FAILED', `Unknown transaction id "${parsed.transactionId}".`);
      return { success: true, value: state };
    } catch (error) {
      return errorResult('CAPABILITY_UNAVAILABLE', catchMessage(error));
    }
  });
}

/** Test-only: evict a session's cached execution entry without disposing it (crash-simulation seams). */
export function __testEvictExecutionEntryForSession(session: LiveMemorySession): void {
  if (process.env.SOLITH_TEST_BUILD !== '1') {
    throw new Error('__testEvictExecutionEntryForSession is only available when SOLITH_TEST_BUILD=1.');
  }
  executionEntries.delete(session);
}
