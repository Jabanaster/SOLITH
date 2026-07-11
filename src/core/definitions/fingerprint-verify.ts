/**
 * Definition fingerprint verification for executable drift detection.
 *
 * Compares the running process executable hash against definition fingerprints.
 * Prefix matching uses `systemHash.startsWith(prefix)` on lowercase SHA-256 hex.
 */

export interface FingerprintVerifyInput {
  executableHashSHA256: string | null | undefined;
  executableHashPrefixes?: string[];
  targetSHA256?: string;
}

export type FingerprintVerifyStatus = 'match' | 'prefix_match' | 'mismatch' | 'skipped';

export interface FingerprintVerifyResult {
  status: FingerprintVerifyStatus;
  warning?: string;
  expectedPrefixes?: string[];
  actualHash?: string | null;
}

function normalizeHash(hash: string): string {
  return hash.toLowerCase();
}

/**
 * Verify a running executable hash against definition fingerprint fields.
 * Returns `skipped` when no hash is available or no fingerprint constraints exist.
 */
export function verifyDefinitionFingerprint(input: FingerprintVerifyInput): FingerprintVerifyResult {
  const prefixes = (input.executableHashPrefixes ?? []).map(normalizeHash);
  const target = input.targetSHA256 ? normalizeHash(input.targetSHA256) : undefined;
  const actual = input.executableHashSHA256 ? normalizeHash(input.executableHashSHA256) : null;

  if (!actual) {
    if (prefixes.length === 0 && !target) {
      return { status: 'skipped' };
    }
    return {
      status: 'skipped',
      warning: 'Executable hash unavailable — fingerprint check skipped.',
      expectedPrefixes: prefixes.length > 0 ? prefixes : undefined,
      actualHash: null,
    };
  }

  if (target) {
    if (actual !== target) {
      return {
        status: 'mismatch',
        warning: 'Executable mismatch detected (full hash differs). Patch Day Drift — proceed with caution.',
        actualHash: actual,
      };
    }
    return { status: 'match', actualHash: actual };
  }

  if (prefixes.length > 0) {
    const matched = prefixes.some((prefix) => actual.startsWith(prefix));
    if (!matched) {
      return {
        status: 'mismatch',
        warning: 'Executable mismatch detected (hash prefix drift). Patch Day Drift — proceed with caution.',
        expectedPrefixes: prefixes,
        actualHash: actual,
      };
    }
    return { status: 'prefix_match', actualHash: actual };
  }

  return { status: 'skipped', actualHash: actual };
}

export function fingerprintBlocksAttach(
  result: FingerprintVerifyResult,
  driftAcknowledged: boolean | undefined,
): boolean {
  return result.status === 'mismatch' && !driftAcknowledged;
}
