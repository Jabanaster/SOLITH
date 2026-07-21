/**
 * Phase 2 — promote CT / research pointer paths into live watch / toggle cards.
 * Freeze is only allowed for `resolvable` quality (module-rooted).
 */

import type { MemoryDataType, MemoryFeatureV1 } from '../definitions/schema.v1.js';
import type { CtImportEntry, CtLiveResolutionQuality } from '../definitions/ct-import.js';
import { classifyCtLiveResolution } from '../definitions/ct-import.js';

export interface CtPromoteCandidate {
  id: string;
  label: string;
  dataType: MemoryDataType;
  moduleName: string;
  baseOffset?: string;
  pointerChain: number[];
  liveResolution: CtLiveResolutionQuality;
  defaultValue: number;
  source: 'ct-import' | 'research';
}

export interface LiveToggleCard {
  id: string;
  label: string;
  dataType: MemoryDataType;
  /** Module-rooted path — required for freeze. */
  moduleName: string;
  baseOffset: string;
  pointerChain: number[];
  defaultValue: number;
  /** absolute_only cards are watch-only. */
  freezeEligible: boolean;
  liveResolution: CtLiveResolutionQuality;
}

export function promoteCandidateFromCtEntry(entry: CtImportEntry): CtPromoteCandidate {
  const quality = entry.liveResolution ?? classifyCtLiveResolution(entry);
  return {
    id: entry.id,
    label: entry.name,
    dataType: entry.dataType,
    moduleName: entry.moduleName,
    baseOffset: entry.baseOffset,
    pointerChain: entry.pointerChain,
    liveResolution: quality,
    defaultValue: entry.dataType === 'float' || entry.dataType === 'double' ? 100 : 9999,
    source: 'ct-import',
  };
}

export function promoteCandidateFromFeature(feature: MemoryFeatureV1): CtPromoteCandidate {
  const liveResolution = classifyCtLiveResolution({
    moduleName: feature.resolution.moduleName,
    baseOffset: feature.resolution.baseOffset,
    pointerChain: feature.resolution.pointerChain,
  });
  return {
    id: feature.id,
    label: feature.name,
    dataType: feature.dataType,
    moduleName: feature.resolution.moduleName,
    baseOffset: feature.resolution.baseOffset,
    pointerChain: feature.resolution.pointerChain ?? [],
    liveResolution,
    defaultValue:
      typeof feature.defaultValue === 'number'
        ? feature.defaultValue
        : feature.dataType === 'float' || feature.dataType === 'double'
          ? 100
          : 9999,
    source: 'ct-import',
  };
}

/** Build WeMod-style toggle cards — freeze only when resolvable. */
export function buildLiveToggleCards(candidates: CtPromoteCandidate[]): LiveToggleCard[] {
  return candidates
    .filter((c) => c.liveResolution !== 'incomplete')
    .map((c) => {
      const freezeEligible =
        c.liveResolution === 'resolvable' && Boolean(c.baseOffset) && c.moduleName !== 'unknown-module.exe';
      return {
        id: c.id,
        label: c.label,
        dataType: c.dataType,
        moduleName: c.moduleName,
        baseOffset: c.baseOffset ?? '0x0',
        pointerChain: c.pointerChain,
        defaultValue: c.defaultValue,
        freezeEligible,
        liveResolution: c.liveResolution,
      };
    });
}

/** LocalStorage / event payload when promoting into Research Lab seed address. */
export interface ResearchPromoteSeed {
  addressHint?: string;
  moduleName?: string;
  baseOffset?: string;
  pointerChain?: number[];
  label?: string;
  liveResolution?: CtLiveResolutionQuality;
}

export const RESEARCH_PROMOTE_SEED_KEY = 'solith.research.promoteSeed';
