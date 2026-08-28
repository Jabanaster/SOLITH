import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { validateIpcSender } from './sender-validation.js';
import { getAdaptiveWispQuickSlotController } from './adaptive-wisp-hotkey-composition.js';
import { isWispQuickSlot } from '../src/core/adaptive-wisp/hotkey-types.js';
import { __setE2EControlledAddress } from './adaptive-wisp-e2e-controlled-fixture.js';
import { z } from 'zod';

/**
 * Phase 2 remediation, Gap A — the Wisp consent E2E's ONLY test-only IPC
 * surface (SOLITH.MD Section 7). Registered from main.ts ONLY when
 * `SOLITH_TEST_BUILD=1`; `registerWispE2ETestIpc` itself also throws if
 * called without that flag, so a code path calling it by mistake fails
 * closed rather than silently registering in production.
 *
 * Two channels, both narrower than the production Wisp surface itself:
 *   - wisp:e2e:test-activate-slot — calls the exact same
 *     WispQuickSlotController.activate(slot) a real hotkey press calls
 *     (electron/trainer-hotkeys.ts). It cannot create a proposal directly,
 *     cannot pick a value, cannot mint a token, cannot approve — activate()
 *     itself does none of those things in production either.
 *   - wisp:e2e:test-set-controlled-address — the ONLY way the controlled
 *     address seam (adaptive-wisp-e2e-controlled-fixture.ts) is ever set from
 *     outside the main process. Takes a decimal address string (not a raw
 *     pointer object) for a fixed int32 entry only.
 *
 * Neither channel accepts a gameId, profileId, action identity, arbitrary
 * process/pid, or write value — those stay exactly as production-derived as
 * they are on the real hotkey path.
 */

const IS_TEST_BUILD = process.env.SOLITH_TEST_BUILD === '1';

const ActivateSlotSchema = z.object({ slot: z.number().int() }).strict();
const SetControlledAddressSchema = z.object({ addressDecimal: z.string().min(1).max(32).regex(/^[0-9]+$/) }).strict();

function requireTrustedSender(event: IpcMainInvokeEvent): { ok: true } | { ok: false; reason: string } {
  const result = validateIpcSender(event, ['main']);
  if (!result.ok) return { ok: false, reason: result.reason ?? 'unknown' };
  return { ok: true };
}

function sanitizeIpcError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 300) : 'unknown_error';
}

export function registerWispE2ETestIpc(): void {
  if (!IS_TEST_BUILD) {
    throw new Error('registerWispE2ETestIpc is only available when SOLITH_TEST_BUILD=1.');
  }

  ipcMain.handle('wisp:e2e:test-activate-slot', async (event, payload: unknown) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
      const parsed = ActivateSlotSchema.parse(payload);
      if (!isWispQuickSlot(parsed.slot)) return { success: false, error: 'invalid_slot' };
      const result = await getAdaptiveWispQuickSlotController().activate(parsed.slot);
      return { success: true, result };
    } catch (error) {
      return { success: false, error: sanitizeIpcError(error) };
    }
  });

  ipcMain.handle('wisp:e2e:test-set-controlled-address', async (event, payload: unknown) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
      const parsed = SetControlledAddressSchema.parse(payload);
      __setE2EControlledAddress({ address: BigInt(parsed.addressDecimal), dataType: 'int32' });
      return { success: true };
    } catch (error) {
      return { success: false, error: sanitizeIpcError(error) };
    }
  });
}
