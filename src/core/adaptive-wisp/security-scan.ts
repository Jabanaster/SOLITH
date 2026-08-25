import { issue, type WispProfileValidationIssue } from './errors.js';

/**
 * Shared executable-metadata field-name blocklist scan (Increment 1 Section
 * 13). Extracted from validation.ts in Increment 2 so user-state-schema.ts
 * can reuse the identical check instead of duplicating it — pure extraction,
 * no behavior change (see tests/adaptive-wisp-schema.test.ts, unmodified and
 * still passing).
 */
const EXECUTABLE_METADATA_KEY_BLOCKLIST = new Set([
  'script',
  'javascript',
  'js',
  'command',
  'shell',
  'powershell',
  'exec',
  'eval',
  'rawaddress',
  'address',
  'pointeraddress',
  'ipcchannel',
  'processid',
  'nativecode',
  'binarypayload',
]);

const MAX_SCAN_DEPTH = 8;

export function scanForExecutableMetadata(value: unknown, path: string, depth = 0): WispProfileValidationIssue | null {
  if (depth > MAX_SCAN_DEPTH || value === null || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = scanForExecutableMetadata(value[i], `${path}[${i}]`, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (EXECUTABLE_METADATA_KEY_BLOCKLIST.has(key.toLowerCase())) {
      return issue('WISP_PROFILE_EXECUTABLE_METADATA_REJECTED', `field "${key}" is not permitted in declarative Adaptive Wisp data`, `${path}.${key}`);
    }
    const found = scanForExecutableMetadata(child, `${path}.${key}`, depth + 1);
    if (found) return found;
  }
  return null;
}
