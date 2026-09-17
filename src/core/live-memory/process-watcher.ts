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
import { classifyExecutableRoles, type ExecutableRole } from '../install-discovery/executable-role.js';
import type { MemoryFeatureV1, SolithDefinitionV1 } from '../definitions/schema.v1.js';
import { evaluateWriteConsent } from './write-consent.js';
import type { LiveProcessListEntry } from './native-memory-driver.js';
import type { OnlineGuardInput, OnlineGuardResult } from './types.js';
import {
  resolveSignatureWithCoverage,
  type FuzzyAobResolverFn,
  type FuzzyScanOptions,
  type SignatureMatch,
} from './signature-engine.js';
import {
  parseHexOffset,
  resolveMemoryFeatureAddress,
  SessionAddressCache,
  type AobResolverFn,
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
  /**
   * Stage 7.5 - which backend actually served the drift-tolerant sub-path,
   * when it ran. Present only for a backend-routed fuzzy resolution.
   */
  fuzzyBackend?: 'legacy' | 'native';
  /**
   * Stage 7.5 - the canonical completeness label of the fuzzy search, when it
   * ran. `'unknown'` marks the unbound legacy fallback, which genuinely has no
   * coverage signal. This exists so a zero-match fuzzy result can never again
   * be read as a confident absence when the search never covered the address
   * space it claimed to (D03).
   */
  signatureCoverage?: string;
}

/**
 * Match running processes against catalog executables. Returns the first
 * detection only — kept for callers that genuinely want a single result;
 * prefer matchAllCatalogProcesses() for anything that should not silently
 * ignore a second concurrently-running catalog game.
 */
export function matchCatalogProcess(
  processes: LiveProcessListEntry[],
  catalog: CatalogExecutableEntry[],
): ProcessWatchDetection | null {
  return matchAllCatalogProcesses(processes, catalog)[0] ?? null;
}

interface LiveCatalogMatch {
  proc: LiveProcessListEntry;
  entry: CatalogExecutableEntry;
}

/**
 * Among 2+ concurrently-live processes that all match the same catalog
 * entry's declared executables (e.g. a Xbox/GDK title's launcher stub plus
 * its real engine binary, both alive at once — ROADMAP.md Phase 3 P3-8.1),
 * pick the canonical one by executable role rather than by incidental OS
 * process-list ordering. `classifyExecutableRoles` ranks a recognized
 * engine/build-suffixed binary (PRIMARY_GAME) above an unsuffixed sibling
 * (ALTERNATE_GAME); when role evidence cannot distinguish them (both
 * UNKNOWN — no title-specific rule is added here), the earliest live match
 * wins, preserving prior behavior exactly for every catalog entry that never
 * has 2+ concurrently-live matches in the first place.
 */
function pickCanonicalLiveMatch(matches: LiveCatalogMatch[]): LiveCatalogMatch {
  if (matches.length === 1) return matches[0];
  const roles = classifyExecutableRoles(matches.map((m) => m.proc.name));
  const rank = (role: ExecutableRole | undefined): number => {
    if (role === 'PRIMARY_GAME') return 0;
    if (role === 'ALTERNATE_GAME') return 1;
    return 2;
  };
  let best = matches[0];
  let bestRank = rank(roles.get(matches[0].proc.name));
  for (const candidate of matches.slice(1)) {
    const candidateRank = rank(roles.get(candidate.proc.name));
    if (candidateRank < bestRank) {
      best = candidate;
      bestRank = candidateRank;
    }
  }
  return best;
}

/**
 * Match every running process against catalog executables (not just the
 * first hit). One detection per matched catalogGameId. Every live process
 * matching that game's declared executables is collected first — not just
 * the first one encountered — so that when 2+ are alive concurrently,
 * `pickCanonicalLiveMatch` can prefer the real engine binary over a
 * launcher/wrapper stub by role instead of by OS process-list ordering
 * (D-P3-8.1: matching used to stop at the first live hit, which bound Xbox
 * titles like Atomfall to their launcher process whenever it happened to be
 * enumerated before the engine). Builds an executable->entry index once so
 * this stays O(processes + catalog) rather than O(processes * catalog) —
 * matters now that callers pass the full, unbounded catalog (see D07 fix)
 * rather than a fixed-size page.
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

  const liveByGame = new Map<string, LiveCatalogMatch[]>();
  for (const proc of processes) {
    const match = byExecutable.get(proc.name.toLowerCase());
    if (!match) continue;
    const bucket = liveByGame.get(match.catalogGameId);
    if (bucket) bucket.push({ proc, entry: match });
    else liveByGame.set(match.catalogGameId, [{ proc, entry: match }]);
  }

  const detections: ProcessWatchDetection[] = [];
  for (const matches of liveByGame.values()) {
    const chosen = pickCanonicalLiveMatch(matches);
    detections.push({
      catalogGameId: chosen.entry.catalogGameId,
      displayName: chosen.entry.displayName,
      pid: chosen.proc.pid,
      executable: chosen.proc.name,
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
 *
 * Stage 7.4 §5-§7 / Stage 7.5 — `exactAobResolver` routes the exact-AOB
 * sub-path and `resolveMemoryFeatureAddress`'s own AOB step through the real
 * backend contract; `fuzzyAobResolver` now routes the drift-tolerant sub-path
 * the same way. Both are bound by every production caller, so no shipping
 * signature resolution reaches `MemoryDriver` directly any more. The earlier
 * claim recorded here — that the fuzzy path must always stay legacy because
 * no native equivalent exists — was corrected in Stage 7.5: drift tolerance is
 * a pure buffer computation, not a scan primitive, and the primitives it does
 * need (region enumeration, chunked completeness-reporting reads) were already
 * native and already certified.
 */
export async function resolveDefinitionFeatures(
  driver: MemoryDriver,
  handle: LiveProcessHandle,
  features: MemoryFeatureV1[],
  cache: SessionAddressCache,
  fuzzyOptions: FuzzyScanOptions = {},
  /** Prior match addresses per featureId — used as SignatureEngine hint windows. */
  featureHints?: Map<string, bigint>,
  exactAobResolver?: AobResolverFn,
  fuzzyAobResolver?: FuzzyAobResolverFn,
): Promise<ResolvedFeatureAddress[]> {
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
    let signatureCoverageForFeature: string | null = null;
    try {
      if (resolution.signature) {
        const hintAddress = featureHints?.get(feature.id);
        const resolved = await resolveSignatureWithCoverage(
          driver,
          handle,
          resolution.signature,
          {
            moduleName: resolution.moduleName,
            ...fuzzyOptions,
            ...(hintAddress != null ? { hintAddress } : {}),
          },
          exactAobResolver,
          fuzzyAobResolver,
        );
        const match: SignatureMatch | null = resolved.match;
        const signatureCoverage = resolved.completeness?.state ?? 'unknown';
        signatureCoverageForFeature = signatureCoverage;
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
            ...(resolved.fuzzyBackend ? { fuzzyBackend: resolved.fuzzyBackend } : {}),
            signatureCoverage,
          });
          continue;
        }
      }

      // Exact/fuzzy AOB missed (or no signature) — fall back to static pointer path.
      const liveAddr = await resolveMemoryFeatureAddress(driver, handle, feature, cache, exactAobResolver);
      results.push({
        featureId: feature.id,
        address: liveAddr.address,
        resolution: 'pointer',
        ...(signatureCoverageForFeature !== null ? { signatureCoverage: signatureCoverageForFeature } : {}),
      });
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
