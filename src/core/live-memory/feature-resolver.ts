import type { MemoryFeatureV1 } from '../definitions/schema.v1.js';
import { memoryDataTypeToLiveValue } from '../definitions/schema.v1.js';
import { scanAobInProcess } from './aob-resolver.js';
import { resolvePointerPath } from './pointer-resolver.js';
import type { LiveMemoryAddress, LiveProcessHandle, MemoryDriver } from './types.js';

/**
 * Stage 7.4 §5-§6 — an async AOB lookup bound to a real backend (native by
 * default, legacy only under explicit rollback). When supplied,
 * `resolveMemoryFeatureAddress` routes its AOB step through this instead of
 * calling `scanAobInProcess` directly, which is what closes the AOB shipping
 * defect for this caller: `LiveMemorySession.createAobResolver()` is the
 * production implementation, always dispatching through the router.
 * `isAuthoritativeAbsence` distinguishes "genuinely not present" (a complete
 * scan found nothing) from "scan was incomplete" (mission's own "incomplete
 * zero-match MUST NOT become authoritative not-found" rule) — a caller that
 * only checks `address === null` still behaves correctly either way, since
 * both cases correctly fall through to the pointer-path fallback below.
 */
export interface AobResolverFn {
  (signature: string, moduleName: string | undefined): Promise<{
    address: bigint | null;
    isAuthoritativeAbsence: boolean;
  }>;
}

/**
 * Per-session address cache for AOB / pointer resolution results.
 * Cleared on LiveMemorySession.detach() — never shared across sessions.
 */
export class SessionAddressCache {
  private readonly entries = new Map<string, bigint>();

  get(featureId: string): bigint | undefined {
    return this.entries.get(featureId);
  }

  set(featureId: string, address: bigint): void {
    this.entries.set(featureId, address);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

export function parseHexOffset(hex: string | undefined): number {
  if (!hex) return 0;
  const normalized = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
  const value = Number.parseInt(normalized, 16);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid hex offset: ${hex}`);
  }
  return value;
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

function resolveViaPointerPath(
  driver: MemoryDriver,
  handle: LiveProcessHandle,
  feature: MemoryFeatureV1,
): bigint {
  const { resolution } = feature;
  if (!resolution.baseOffset) {
    throw new Error(`Feature "${feature.id}" has no AOB signature and no baseOffset for pointer resolution.`);
  }
  return resolvePointerPath(driver, handle, {
    moduleName: resolution.moduleName,
    moduleOffset: parseHexOffset(resolution.baseOffset),
    offsets: resolution.pointerChain ?? [],
  });
}

/**
 * Resolve a memory feature to a concrete address for the attached process.
 *
 * Resolution order:
 * 1. Session cache hit
 * 2. AOB signature scan (when present), then baseOffset + pointer chain
 * 3. Static module base + pointer chain via resolvePointerPath
 *
 * `scan_first` / `scan_unknown` features cannot be resolved upfront — they require
 * the Discovery Lab scan workflow.
 */
export async function resolveMemoryFeatureAddress(
  driver: MemoryDriver,
  handle: LiveProcessHandle,
  feature: MemoryFeatureV1,
  cache: SessionAddressCache,
  aobResolver?: AobResolverFn,
): Promise<LiveMemoryAddress> {
  if (feature.type === 'scan_first' || feature.type === 'scan_unknown') {
    throw new Error(`Feature "${feature.id}" (${feature.type}) requires discovery scanning before resolution.`);
  }

  const cached = cache.get(feature.id);
  if (cached !== undefined) {
    return {
      address: cached,
      dataType: memoryDataTypeToLiveValue(feature.dataType),
      moduleName: feature.resolution.moduleName,
    };
  }

  const { resolution } = feature;
  let address: bigint;

  if (resolution.signature) {
    // Stage 7.4 §5-§6 — routed through the real backend contract when a
    // resolver is bound (every production caller now binds one); falls back
    // to the direct legacy call only for callers that genuinely have no
    // session/router to bind to (e.g. a unit test exercising this function
    // in isolation against a `FakeMemoryDriver`).
    const match = aobResolver
      ? (await aobResolver(resolution.signature, resolution.moduleName)).address
      : scanAobInProcess(driver, handle, resolution.signature, { moduleName: resolution.moduleName }).address;

    if (match !== null) {
      const anchor = match + BigInt(parseHexOffset(resolution.baseOffset));
      address =
        resolution.pointerChain && resolution.pointerChain.length > 0
          ? applyPointerChain(driver, handle, anchor, resolution.pointerChain)
          : anchor;
    } else if (resolution.baseOffset) {
      address = resolveViaPointerPath(driver, handle, feature);
    } else {
      throw new Error(`AOB signature not found for feature "${feature.id}" and no pointer fallback is configured.`);
    }
  } else {
    address = resolveViaPointerPath(driver, handle, feature);
  }

  cache.set(feature.id, address);
  return {
    address,
    dataType: memoryDataTypeToLiveValue(feature.dataType),
    moduleName: resolution.moduleName,
  };
}
