import db from '../database';
import { AIConfig } from '../../shared/types';

export function getAIConfig(): AIConfig {
  const provider = 'Ollama'; // Default
  const endpoint = '';
  const model = '';
  const timeout = 60000;
  
  const ollamaRow = db.prepare('SELECT endpoint, model, timeout FROM ai_config WHERE provider = ?').get('Ollama');
  const lmStudioRow = db.prepare('SELECT endpoint, model, timeout FROM ai_config WHERE provider = ?').get('LM Studio');
  
  if (ollamaRow) {
    return {
      provider: 'Ollama',
      endpoint: ollamaRow.endpoint || '',
      model: ollamaRow.model || '',
      timeout: ollamaRow.timeout || 60000
    };
  }
  
  if (lmStudioRow) {
    return {
      provider: 'LM Studio',
      endpoint: lmStudioRow.endpoint || '',
      model: lmStudioRow.model || '',
      timeout: lmStudioRow.timeout || 60000
    };
  }
  
  return { provider, endpoint, model, timeout };
}

export function setAIConfig(provider: 'Ollama' | 'LM Studio', config: Partial<AIConfig>): void {
  // ai_config's real key is `id` (PRIMARY KEY), not `provider` — the default
  // seed rows use id === provider name (see initDatabase's defaultAIConfig),
  // so that's the conflict target here too.
  const stmt = db.prepare(`
    INSERT INTO ai_config (id, provider, endpoint, model, timeout)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      provider = excluded.provider,
      endpoint = excluded.endpoint,
      model = excluded.model,
      timeout = excluded.timeout
  `);
  stmt.run(provider, provider, config.endpoint || '', config.model || '', config.timeout || 60000);
}

export function testAIConnection(config: AIConfig): Promise<{ success: boolean; message: string }> {
  return new Promise((resolve) => {
    if (config.provider === 'None') {
      resolve({ success: true, message: 'Using rule-based explanations (no AI configured)' });
      return;
    }

    const endpoint = (config.endpoint || '').trim();
    if (!endpoint) {
      resolve({
        success: false,
        message: `${config.provider} endpoint is empty. Configure a local endpoint before testing.`,
      });
      return;
    }

    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      resolve({ success: false, message: `Invalid ${config.provider} endpoint URL.` });
      return;
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      resolve({ success: false, message: `${config.provider} endpoint must be http(s).` });
      return;
    }

    const timeoutMs = Math.max(1_000, Math.min(config.timeout || 60_000, 60_000));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    // Ollama exposes /api/tags; LM Studio OpenAI-compatible servers expose /v1/models.
    const probePath = config.provider === 'LM Studio' ? '/v1/models' : '/api/tags';
    const probeUrl = new URL(probePath, url).toString();

    fetch(probeUrl, { method: 'GET', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          resolve({
            success: false,
            message: `${config.provider} responded HTTP ${response.status} at ${probePath}.`,
          });
          return;
        }
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          resolve({
            success: false,
            message: `${config.provider} returned non-JSON at ${probePath}.`,
          });
          return;
        }
        if (config.provider === 'LM Studio') {
          const data = (body as { data?: unknown })?.data;
          if (!Array.isArray(data)) {
            resolve({
              success: false,
              message: `${config.provider} /v1/models response missing a data array.`,
            });
            return;
          }
        } else {
          const models = (body as { models?: unknown })?.models;
          if (!Array.isArray(models)) {
            resolve({
              success: false,
              message: `${config.provider} /api/tags response missing a models array.`,
            });
            return;
          }
        }
        resolve({ success: true, message: `Connection to ${config.provider} verified at ${probePath}.` });
      })
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error);
        resolve({
          success: false,
          message: `Connection to ${config.provider} failed: ${detail}`,
        });
      })
      .finally(() => clearTimeout(timer));
  });
}

export function explainValue(path: string, oldValue: any, newValue: any): string {
  const lowerPath = path.toLowerCase();
  const lowerOld = String(oldValue).toLowerCase();
  const lowerNew = String(newValue).toLowerCase();
  
  // Rule-based explanations
  if (lowerPath.includes('gold') || lowerPath.includes('money') || lowerPath.includes('currency')) {
    return `This value controls the player's currency (${String(oldValue)} → ${String(newValue)}). It is considered safe because it is a numeric gameplay value that does not match ID, hash, checksum, or quest dependency patterns.`;
  }
  
  if (lowerPath.includes('health') || lowerPath.includes('hp')) {
    return `This value controls the player's health (${String(oldValue)} → ${String(newValue)}). It is considered safe because it is a numeric gameplay stat.`;
  }
  
  if (lowerPath.includes('level') || lowerPath.includes('xp') || lowerPath.includes('experience')) {
    return `This value controls the player's level or experience (${String(oldValue)} → ${String(newValue)}). It is considered safe because it is a numeric progression stat.`;
  }
  
  if (lowerPath.includes('damage') || lowerPath.includes('defense')) {
    return `This value controls combat stats (${String(oldValue)} → ${String(newValue)}). It is considered safe because it is a numeric gameplay value.`;
  }
  
  if (lowerPath.includes('id') || lowerPath.includes('guid') || lowerPath.includes('uuid')) {
    return `This value is an identifier (${String(oldValue)} → ${String(newValue)}). Exercise caution when modifying identifiers.`;
  }
  
  if (lowerPath.includes('quest') || lowerPath.includes('stage')) {
    return `This value controls quest progression (${String(oldValue)} → ${String(newValue)}). Modifying quest values may have unintended consequences.`;
  }
  
  return `This value changed from ${String(oldValue)} to ${String(newValue)}. It is located at path "${path}". Use with caution.`;
}

export function classifyCategory(path: string): string {
  const lowerPath = path.toLowerCase();
  
  if (lowerPath.includes('gold') || lowerPath.includes('money') || lowerPath.includes('currency') || 
      lowerPath.includes('item') || lowerPath.includes('inventory')) {
    return 'INVENTORY';
  }
  
  if (lowerPath.includes('health') || lowerPath.includes('stamina') || lowerPath.includes('mana') || 
      lowerPath.includes('level') || lowerPath.includes('xp') || lowerPath.includes('experience')) {
    return 'PLAYER';
  }
  
  if (lowerPath.includes('damage') || lowerPath.includes('defense') || lowerPath.includes('strength')) {
    return 'STATS';
  }
  
  if (lowerPath.includes('time') || lowerPath.includes('day') || lowerPath.includes('speed')) {
    return 'GAME';
  }
  
  return 'DISCOVERY';
}

export function generateTrainerName(path: string, oldValue: any, newValue: any): string {
  const lowerPath = path.toLowerCase();
  
  if (lowerPath.includes('gold') || lowerPath.includes('money') || lowerPath.includes('currency')) {
    return 'Set Gold';
  }
  
  if (lowerPath.includes('health') || lowerPath.includes('hp')) {
    return 'Set Max Health';
  }
  
  if (lowerPath.includes('level') || lowerPath.includes('xp') || lowerPath.includes('experience')) {
    return 'Set Level';
  }
  
  if (lowerPath.includes('damage')) {
    return 'Set Damage';
  }
  
  if (lowerPath.includes('stamina') || lowerPath.includes('mana')) {
    return 'Set Stamina';
  }
  
  return 'Modify Value';
}
