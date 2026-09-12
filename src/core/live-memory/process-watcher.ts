/**
 * ProcessWatcher — Zero-Input orchestration: detect → fingerprint → profile plan.
 *
 * Does not open process handles itself; callers attach via LiveMemorySession
 * using the returned plan. Reuses catalog name matching + fingerprint-verify.
 */

import {
  fingerprintBlocksAttach,
  verifyDefinitionFingerprint,
  type FingerprintVerifyResult,
} from '../definitions/fingerprint-verify.js';
import type { MemoryFeatureV1, SolithDefinitionV1 } from '../definitions/schema.v1.js';
import { evaluateWriteConsent } from './write-consent.js';
import type { LiveProcessListEntry } from './native-memory-driver.js';
import type { OnlineGuardInput, OnlineGuardResult } from './types.js';
import { resolveSignature, type FuzzyScanOptions, type SignatureMatch } from './signature-engine.js';
import {
  parseHexOffset,
  resolveMemoryFeatureAddress,
  SessionAddressCache,
} from './feature-resolver.js';
import type { LiveProcessHandle, MemoryDriver } from './types.js';

export interface CatalogExecutableEntry {
  catalogGameId: string;
  displayName: string;
  executables: string[];
}

export interface ProcessWatchDetection {
  catalogGameId: string;
  displayName: string;
  pid: number;
  executable: string;
}

export interface ZeroInputAttachPlan {
  catalogGameId: string;
  displayName: string;
  pid: number;
  executable: string;
  definition: SolithDefinitionV1 | null;
  fingerprint: FingerprintVerifyResult;
  guard: OnlineGuardResult;
  /** True when attach should proceed (guard + fingerprint + definition). */
  allowed: boolean;
  blockReason?: string;
}

export interface ResolvedFeatureAddress {
  featureId: string;
  address: bigint;
  resolution: 'cache' | 'exact_aob' | 'fuzzy_aob' | 'pointer' | 'failed';
  signatureDistance?: number;
  error?: string;
}

/**
 * Match running processes against catalog executables (first match wins per poll).
 */
export function matchCatalogProcess(
  processes: LiveProcessListEntry[],
  catalog: CatalogExecutableEntry[],
): ProcessWatchDetection | null {
  return matchAllCatalogProcesses(processes, catalog)[0] ?? null;
}

/**
 * Match every running process against catalog executables (not just the
 * first hit). One detection per matched catalogGameId; if multiple processes
 * map to the same game the first live match wins for that game.
 */
export function matchAllCatalogProcesses(
  processes: LiveProcessListEntry[],
  catalog: CatalogExecutableEntry[],
): ProcessWatchDetection[] {
  const byExecutable = new Map<string, CatalogExecutableEntry>();
  for (const entry of catalog) {
    for (const exe of entry.executables) {
      const key = exe.toLowerCase();
      if (!byExecutable.has(key)) byExecutable.set(key, entry);
    }
  }
  const seenGameIds = new Set<string>();
  const detections: ProcessWatchDetection[] = [];
  for (const proc of processes) {
    const match = byExecutable.get(proc.name.toLowerCase());
    if (!match || seenGameIds.has(match.catalogGameId)) continue;
    seenGameIds.add(match.catalogGameId);
    detections.push({
      catalogGameId: match.catalogGameId,
      displayName: match.displayName,
      pid: proc.pid,
      executable: proc.name,
    });
  }
  return detections;
}

export interface BuildAttachPlanInput {
  detection: ProcessWatchDetection;
  definition: SolithDefinitionV1 | null;
  executableHashSHA256?: string | null;
  userConfirmedOffline: boolean;
  remoteConnections: OnlineGuardInput['remoteConnections'];
  driftAcknowledged?: boolean;
}

/**
 * Build a Zero-Input attach plan: load definition, fingerprint, online guard.
 */
export function buildZeroInputAttachPlan(input: BuildAttachPlanInput): ZeroInputAttachPlan {
  const { detection, definition } = input;

  if (!definition) {
    return {
      catalogGameId: detection.catalogGameId,
      displayName: detection.displayName,
      pid: detection.pid,
      executable: detection.executable,
      definition: null,
      fingerprint: { status: 'skipped' },
      guard: { allowed: false, reason: 'No definition loaded for catalog game.' },
      allowed: false,
      blockReason: 'No definition loaded for catalog game.',
    };
  }

  const fingerprint = verifyDefinitionFingerprint({
    executableHashSHA256: input.executableHashSHA256,
    executableHashPrefixes: definition.executableHashPrefixes,
    targetSHA256: definition.targetSHA256,
  });

  if (fingerprintBlocksAttach(fingerprint, input.driftAcknowledged)) {
    return {
      catalogGameId: detection.catalogGameId,
      displayName: detection.displayName,
      pid: detection.pid,
      executable: detection.executable,
      definition,
      fingerprint,
      guard: { allowed: false, reason: fingerprint.warning ?? 'Executable fingerprint mismatch.' },
      allowed: false,
      blockReason: fingerprint.warning ?? 'Executable fingerprint mismatch.',
    };
  }

  const guard = evaluateWriteConsent({
    userConfirmedOffline: input.userConfirmedOffline,
    remoteConnections: input.remoteConnections,
  });

  if (!guard.allowed) {
    return {
      catalogGameId: detection.catalogGameId,
      displayName: detection.displayName,
      pid: detection.pid,
      executable: detection.executable,
      definition,
      fingerprint,
      guard,
      allowed: false,
      blockReason: guard.reason,
    };
  }

  return {
    catalogGameId: detection.catalogGameId,
    displayName: detection.displayName,
    pid: detection.pid,
    executable: detection.executable,
    definition,
    fingerprint,
    guard,
    allowed: true,
  };
}

function applyPointerChain(
  driver: MemoryDriver,
  handle: LiveProcessHandle,
  startAddress: bigint,
  offsets: number[],
): bigint {
  let address = startAddress;
  for (const offset of offsets) {
    const pointerValue = driver.readPointer(handle, address);
    address = pointerValue + BigInt(offset);
  }
  return address;
}

/**
 * Resolve all memory features for Zero-Input apply.
 * Order per feature: session cache → exact/fuzzy AOB → static pointer path.
 */
export function resolveDefinitionFeatures(
  driver: MemoryDriver,
  handle: LiveProcessHandle,
  features: MemoryFeatureV1[],
  cache: SessionAddressCache,
  fuzzyOptions: FuzzyScanOptions = {},
  /** Prior match addresses per featureId — used as SignatureEngine hint windows. */
  featureHints?: Map<string, bigint>,
): ResolvedFeatureAddress[] {
  const results: ResolvedFeatureAddress[] = [];

  for (const feature of features) {
    if (feature.type === 'scan_first' || feature.type === 'scan_unknown') {
      results.push({
        featureId: feature.id,
        address: 0n,
        resolution: 'failed',
        error: 'Feature requires Discovery Lab scan workflow.',
      });
      continue;
    }

    const cached = cache.get(feature.id);
    if (cached !== undefined) {
      results.push({ featureId: feature.id, address: cached, resolution: 'cache' });
      continue;
    }

    const { resolution } = feature;
    try {
      if (resolution.signature) {
        const hintAddress = featureHints?.get(feature.id);
        const match: SignatureMatch | null = resolveSignature(
          driver,
          handle,
          resolution.signature,
          {
            moduleName: resolution.moduleName,
            ...fuzzyOptions,
            ...(hintAddress != null ? { hintAddress } : {}),
          },
        );
        if (match) {
          const baseOffset = parseHexOffset(resolution.baseOffset);
          let address = match.address + BigInt(baseOffset);
          if (resolution.pointerChain && resolution.pointerChain.length > 0) {
            address = applyPointerChain(driver, handle, address, resolution.pointerChain);
          }
          cache.set(feature.id, address);
          results.push({
            featureId: feature.id,
            address,
            resolution: match.mode === 'exact' ? 'exact_aob' : 'fuzzy_aob',
            signatureDistance: match.distance,
          });
          continue;
        }
      }

      // Exact/fuzzy AOB missed (or no signature) — fall back to static pointer path.
      const liveAddr = resolveMemoryFeatureAddress(driver, handle, feature, cache);
      results.push({ featureId: feature.id, address: liveAddr.address, resolution: 'pointer' });
    } catch (err) {
      results.push({
        featureId: feature.id,
        address: 0n,
        resolution: 'failed',
        error: String(err),
      });
    }
  }

  return results;
}
