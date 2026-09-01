import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { validateIpcSender } from './sender-validation.js';
import { testAIConnection } from '../src/core/ai/index.js';

function requireTrustedSender(event: IpcMainInvokeEvent): { ok: true } | { ok: false; reason: string } {
  const result = validateIpcSender(event, ['main']);
  if (!result.ok) return { ok: false, reason: result.reason ?? 'unknown' };
  return { ok: true };
}

function sanitize(error: unknown): string {
  return error instanceof Error ? error.message : 'ai_config_error';
}

const TestAIConnectionSchema = z.object({
  provider: z.enum(['None', 'Ollama', 'LM Studio']),
  endpoint: z.string().max(2000).optional().default(''),
  model: z.string().max(200).optional().default(''),
  timeout: z.number().int().min(1000).max(120000).optional().default(60000),
});

/**
 * ROADMAP §6.5 Local AI — "test connection". Provider/endpoint/model
 * selection itself is stored via the existing generic settings mechanism
 * (Settings.aiProvider/aiEndpoint/aiModel, already wired through
 * setSetting/getSettings — see src/app/pages/settings/sections/LocalAiSection.tsx).
 * This channel exists only for the one piece that mechanism can't do: an
 * async local HTTP probe. src/core/ai/index.ts has no process-write or
 * memory-access calls at all, so there is nothing here that could grant AI
 * output any privileged capability beyond a read-only local HTTP request a
 * user could run themselves.
 */
export function registerAIConfigIpc(): void {
  ipcMain.handle('ai-config-test-connection', async (event, payload: unknown) => {
    const senderCheck = requireTrustedSender(event);
    if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
    try {
      const parsed = TestAIConnectionSchema.parse(payload);
      const result = await testAIConnection(parsed);
      return { success: true, result };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });
}
