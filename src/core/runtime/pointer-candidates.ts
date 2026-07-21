import type { RuntimeModuleInfo } from './module-inspection.js';

export interface PointerCandidate {
  moduleName: string;
  baseOffset: string;
  targetAddress: string;
  distance: number;
  confidence: 'low' | 'medium';
  evidence: string[];
}

export function analyzePointerCandidates(input: {
  modules: RuntimeModuleInfo[];
  observedAddress: bigint;
  maxDistance?: number;
}): PointerCandidate[] {
  const maxDistance = BigInt(input.maxDistance ?? 0x10_0000);
  const candidates: PointerCandidate[] = [];

  for (const module of input.modules) {
    const start = module.baseAddress;
    const end = module.baseAddress + BigInt(module.size);
    if (input.observedAddress < start || input.observedAddress >= end + maxDistance) continue;
    const distance = input.observedAddress - start;
    if (distance < 0n || distance > BigInt(Number.MAX_SAFE_INTEGER)) continue;
    const inModule = input.observedAddress < end;
    candidates.push({
      moduleName: module.name,
      baseOffset: `0x${distance.toString(16)}`,
      targetAddress: `0x${input.observedAddress.toString(16)}`,
      distance: Number(distance),
      confidence: inModule ? 'medium' : 'low',
      evidence: [
        inModule
          ? 'Observed address falls inside module range.'
          : 'Observed address is near module range but outside the module boundary.',
      ],
    });
  }

  return candidates.sort((a, b) => a.distance - b.distance);
}
