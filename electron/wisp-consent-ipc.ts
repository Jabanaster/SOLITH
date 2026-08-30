import { ipcMain, BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { validateIpcSender } from './sender-validation.js';
import { getAdaptiveWispConsentService } from './adaptive-wisp-hotkey-composition.js';
import { WispConsentProposalIdSchema as ProposalIdSchema, WispConsentEmptyPayloadSchema as EmptyPayloadSchema } from './ipc-validation.js';
import type { WispConsentProposalView } from '../src/core/adaptive-wisp/consent/proposal-types.js';

/**
 * Adaptive Wisp Phase 1 — secure IPC boundary for the consent-completion
 * workflow (Section 14).
 *
 * Every handler validates the sender first, then the payload shape via zod
 * with `.strict()` (rejects unknown fields — Section 14's "reject unknown
 * fields" requirement), before touching the consent service. No handler ever
 * accepts a value, address, game, or action identity from the renderer —
 * every payload is just a `proposalId` string; all the security-relevant
 * data was already fixed at proposal-creation time inside the main process
 * (see consent-service.ts's `handlePendingConsent`).
 */

function requireTrustedSender(event: IpcMainInvokeEvent): { ok: true } | { ok: false; reason: string } {
  const result = validateIpcSender(event, ['main']);
  if (!result.ok) return { ok: false, reason: result.reason ?? 'unknown' };
  return { ok: true };
}

function sanitizeIpcError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 300) : 'unknown_error';
}

export function registerWispConsentIpc(): void {
  ipcMain.handle('wisp:consent:list-pending', async (event) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
      EmptyPayloadSchema.parse({});
      const proposals = getAdaptiveWispConsentService().listPending();
      return { success: true, proposals };
    } catch (error) {
      return { success: false, error: sanitizeIpcError(error) };
    }
  });

  ipcMain.handle('wisp:consent:get', async (event, payload: unknown) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
      const parsed = ProposalIdSchema.parse(payload);
      const proposal = getAdaptiveWispConsentService().get(parsed.proposalId);
      if (!proposal) return { success: false, error: 'not_found' };
      return { success: true, proposal };
    } catch (error) {
      return { success: false, error: sanitizeIpcError(error) };
    }
  });

  ipcMain.handle('wisp:consent:approve', async (event, payload: unknown) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
      const parsed = ProposalIdSchema.parse(payload);
      const result = await getAdaptiveWispConsentService().approve(parsed.proposalId);
      if (result.ok === false) return { success: false, error: result.diagnostic.code, message: result.diagnostic.message };
      broadcastWispConsentProposalUpdated(result.proposal);
      return { success: true, proposal: result.proposal, executionStatus: result.execution?.executionStatus };
    } catch (error) {
      return { success: false, error: sanitizeIpcError(error) };
    }
  });

  ipcMain.handle('wisp:consent:reject', async (event, payload: unknown) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
      const parsed = ProposalIdSchema.parse(payload);
      const result = getAdaptiveWispConsentService().reject(parsed.proposalId);
      if (result.ok === false) return { success: false, error: result.diagnostic.code, message: result.diagnostic.message };
      broadcastWispConsentProposalUpdated(result.proposal);
      return { success: true, proposal: result.proposal };
    } catch (error) {
      return { success: false, error: sanitizeIpcError(error) };
    }
  });

  ipcMain.handle('wisp:consent:cancel', async (event, payload: unknown) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
      const parsed = ProposalIdSchema.parse(payload);
      const result = getAdaptiveWispConsentService().cancel(parsed.proposalId);
      if (result.ok === false) return { success: false, error: result.diagnostic.code, message: result.diagnostic.message };
      broadcastWispConsentProposalUpdated(result.proposal);
      return { success: true, proposal: result.proposal };
    } catch (error) {
      return { success: false, error: sanitizeIpcError(error) };
    }
  });
}

/**
 * Real defect found during Phase 2's lifecycle-evidence closeout (SOLITH.MD
 * Section 5.6, "Shutdown with a pending proposal"): `BrowserWindow.isDestroyed()`
 * can still report `false` for a brief window after its own `webContents`
 * has already been destroyed during app shutdown (they are torn down by
 * Electron slightly out of sync) — `win.webContents.send(...)` then throws
 * "Object has been destroyed" as an UNCAUGHT main-process exception. That
 * crash surfaces as a native error dialog that blocks the entire shutdown
 * sequence (reproduced live: `will-quit` -> disposeAllLiveMemorySessions ->
 * disposeAdaptiveWispQuickSlotController -> resetPresentationState ->
 * broadcastWispConsentQueueChanged -> WebContents.send throws). The same
 * broadcast is also reachable from a live, non-shutdown detach, where the
 * crash dialog silently blocks the renderer's queue-changed push instead.
 * Checking `webContents.isDestroyed()` directly, in addition to the
 * `BrowserWindow`'s own flag, closes the race; the try/catch is defense in
 * depth so a push notification can never crash the main process outright.
 */
function sendToLiveWindows(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
    try {
      win.webContents.send(channel, ...args);
    } catch {
      // Best-effort push — a destroyed/closing webContents must never crash
      // the main process or block app shutdown.
    }
  }
}

/** Push channel — a new proposal appeared, or the whole queue was invalidated (Section 17 "renderer resynchronization"). Broadcasts to every window, matching notifications-ipc.ts's existing broadcast pattern; the renderer re-fetches list-pending on receipt rather than trusting any payload on this event. */
export function broadcastWispConsentQueueChanged(_reason: unknown): void {
  sendToLiveWindows('wisp:consent:queue-changed');
}

export function broadcastWispConsentProposalUpdated(proposal: WispConsentProposalView): void {
  sendToLiveWindows('wisp:consent:proposal-updated', proposal);
}
