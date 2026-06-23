import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import type { CompatibilityProfile } from './schema.js';

/**
 * Fingerprint System for Drift Detection
 *
 * Captures the "shape" of a game at the time of profile creation/validation.
 * Later, when running recipes, we re-compute the fingerprint and compare to
 * the stored one. If drift is detected (executable changed, save structure
 * different, adapter version mismatched), we mark recipes STALE or NEEDS_RESCAN.
 *
 * Fingerprints are deterministic — same game version at the same time always
 * produces the same fingerprint.
 */

export interface GameFingerprint {
  executableHashSHA256?: string;
  saveStructureSignature?: string;
  saveFormatVersion?: string;
  adapterVersions?: Record<string, string>;
  markerValues?: Record<string, unknown>;
}

interface DriftDetectionResult {
  drifted: boolean;
  reasons: string[];
}

/**
 * Compute SHA-256 hash of a file
 * - Streams large files (cap at scanSizeLimitMB to avoid memory)
 * - Returns hex string
 */
export function hashFile(filePath: string, maxSizeMB: number = 100): string {
  try {
    const stat = statSync(filePath);
    if (stat.size > maxSizeMB * 1024 * 1024) {
      // File too large; hash the size + metadata as a proxy
      return createHash('sha256')
        .update(JSON.stringify({ size: stat.size, mtime: stat.mtime.toISOString() }))
        .digest('hex');
    }

    const content = readFileSync(filePath);
    return createHash('sha256').update(content).digest('hex');
  } catch (err) {
    return `error-${createHash('sha256').update(filePath).digest('hex')}`;
  }
}

/**
 * Compute profile fingerprint from game metadata
 * Captures: executable hash, save structure, format version, adapter versions
 */
export function computeProfileFingerprint(
  executablePath: string | undefined,
  saveStructureHint: string = 'unknown',
  saveFormatVersion: string | undefined = undefined,
  adapterVersions: Record<string, string> = {},
  markerValues: Record<string, unknown> = {}
): GameFingerprint {
  const fp: GameFingerprint = {
    saveStructureSignature: createHash('sha256').update(saveStructureHint).digest('hex'),
    saveFormatVersion,
    adapterVersions,
    markerValues,
  };

  if (executablePath) {
    fp.executableHashSHA256 = hashFile(executablePath);
  }

  return fp;
}

/**
 * Detect drift between current state and a stored profile fingerprint
 *
 * Drift means:
 * - Executable was replaced or version-bumped (hash different)
 * - Save structure changed (signature different) — usually indicates engine update
 * - Format version changed — adapter may need revalidation
 * - Adapter library versions changed — recipes may break
 *
 * Returns:
 * - drifted: boolean indicating whether any drift was detected
 * - reasons: human-readable list of what drifted (for UI display)
 */
export function detectDrift(
  profile: CompatibilityProfile,
  currentFingerprint: GameFingerprint
): DriftDetectionResult {
  const reasons: string[] = [];

  // Check executable hash
  if (profile.fingerprint?.executableHashSHA256 && currentFingerprint.executableHashSHA256) {
    if (profile.fingerprint.executableHashSHA256 !== currentFingerprint.executableHashSHA256) {
      reasons.push('Executable was replaced or updated');
    }
  }

  // Check save structure
  if (profile.fingerprint?.saveStructureSignature && currentFingerprint.saveStructureSignature) {
    if (profile.fingerprint.saveStructureSignature !== currentFingerprint.saveStructureSignature) {
      reasons.push('Save structure changed (possible engine/format update)');
    }
  }

  // Check save format version
  if (profile.fingerprint?.saveFormatVersion && currentFingerprint.saveFormatVersion) {
    if (profile.fingerprint.saveFormatVersion !== currentFingerprint.saveFormatVersion) {
      reasons.push(`Save format version changed (${profile.fingerprint.saveFormatVersion} → ${currentFingerprint.saveFormatVersion})`);
    }
  }

  // Check adapter versions
  const currentAdapters = currentFingerprint.adapterVersions || {};
  const storedAdapters = profile.fingerprint?.adapterVersions || {};
  for (const [adapterName, storedVersion] of Object.entries(storedAdapters)) {
    const currentVersion = currentAdapters[adapterName];
    if (currentVersion && storedVersion !== currentVersion) {
      reasons.push(`Adapter version changed: ${adapterName} (${storedVersion} → ${currentVersion})`);
    }
  }

  return {
    drifted: reasons.length > 0,
    reasons,
  };
}

/**
 * Fingerprint compatibility check
 *
 * Used by recipes to determine if they can still apply safely.
 * A recipe with a stored fingerprint can only apply if:
 * - No drift detected (executable + save structure unchanged), OR
 * - User has approved re-validation despite drift
 */
export function isCompatibleFingerprint(
  storedFingerprint: GameFingerprint | undefined,
  currentFingerprint: GameFingerprint
): boolean {
  if (!storedFingerprint) return true; // No stored fingerprint = always try

  // For now, any drift = incompatible. Later phases can add user approval override.
  const result = detectDrift({ fingerprint: storedFingerprint } as CompatibilityProfile, currentFingerprint);
  return !result.drifted;
}
