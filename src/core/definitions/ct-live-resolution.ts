export type CtLiveResolutionQuality = 'resolvable' | 'absolute_only' | 'incomplete';

/**
 * Classify how far a CT pointer entry can go in Solith live (no AA/scripts).
 * - resolvable: module + baseOffset -> Promote + freeze eligible
 * - absolute_only: raw absolute / unknown module; watch/read only, never freeze
 * - incomplete: missing pieces for live resolution
 */
export function classifyCtLiveResolution(input: {
  moduleName: string;
  baseOffset?: string;
  pointerChain?: number[];
  rawAddress?: string;
}): CtLiveResolutionQuality {
  const moduleName = input.moduleName.trim();
  const hasRealModule = moduleName.length > 0 && moduleName.toLowerCase() !== 'unknown-module.exe';
  const hasOffset = Boolean(input.baseOffset && /^0x[0-9a-f]+$/i.test(input.baseOffset));
  if (hasRealModule && hasOffset) return 'resolvable';
  const raw = (input.rawAddress ?? '').trim();
  if (/^0x[0-9a-f]+$/i.test(raw) || (!hasRealModule && !hasOffset)) {
    return 'absolute_only';
  }
  return 'incomplete';
}

export function featureTypeForCtLiveResolution(
  quality: CtLiveResolutionQuality,
  hasPointerOrOffset: boolean,
): 'freeze' | 'scan_unknown' {
  // absolute_only never freezes; session-only absolute addresses are unsafe to lock.
  if (quality === 'resolvable' && hasPointerOrOffset) return 'freeze';
  return 'scan_unknown';
}
