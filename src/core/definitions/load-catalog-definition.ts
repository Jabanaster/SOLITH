/**
 * Derive schema.v1 capability lanes for UI/IPC read surfaces.
 * Phase 1: additive / advisory only — does not gate execute paths.
 */
import { IN_PROCESS_SCRIPT_MILESTONE } from '../in-process-script/charter.js';
import { getDefinitionPayload, getModPackForGame } from '../trainer-catalog/store.js';
import { modPackToSolithDefinition } from './mod-pack-adapter.js';
import type { MemoryFeatureV1, SolithDefinitionV1 } from './schema.v1.js';

/** Load a schema.v1 definition from catalog storage (native JSON or adapted mod pack). */
export function loadCatalogDefinition(catalogGameId: string): SolithDefinitionV1 | null {
  const payload = getDefinitionPayload(catalogGameId);
  if (payload) return payload;

  const pack = getModPackForGame(catalogGameId);
  if (!pack) return null;
  return modPackToSolithDefinition(pack);
}

export type SaveEditCapability = 'none' | 'metadata' | 'executable';
export type LiveMemoryCapability = 'none' | 'scan-required' | 'executable';
export type InjectionCapability = 'forbidden' | 'reference-only' | 'pilot-gated';

export interface CatalogDefinitionCapabilities {
  catalogGameId: string;
  title: string;
  memoryCheatCount: number;
  saveControlCount: number;
  saveDirectoryHint?: string;
  saveFormat?: string;
  saveExtension?: string;
  /** Phase 1 capability lanes (schema.v1-derived; advisory until Phase 2). */
  saveEdit: SaveEditCapability;
  liveMemory: LiveMemoryCapability;
  injection: InjectionCapability;
}

function featureHasResolvablePath(feature: MemoryFeatureV1): boolean {
  if (feature.type === 'scan_unknown' || feature.type === 'scan_first') return false;
  const r = feature.resolution ?? {};
  return Boolean(
    r.moduleName &&
      (Boolean(r.baseOffset) || Boolean(r.signature) || (r.pointerChain?.length ?? 0) > 0),
  );
}

function deriveSaveEdit(definition: SolithDefinitionV1): SaveEditCapability {
  const fields = definition.saveEditor?.saveFields ?? [];
  if (fields.length === 0) return 'none';
  // Save fields that map to TrainerHost are treated as executable capability
  // (still requires_approval at write time — Phase 1 does not change that gate).
  return 'executable';
}

function deriveLiveMemory(definition: SolithDefinitionV1): LiveMemoryCapability {
  const features = definition.memoryFeatures ?? [];
  if (features.length === 0) return 'none';
  const anyResolvable = features.some(featureHasResolvablePath);
  if (anyResolvable) return 'executable';
  return 'scan-required';
}

function deriveInjection(definition: SolithDefinitionV1): InjectionCapability {
  const exes = (definition.target?.executables ?? []).map((e: string) => e.toLowerCase());
  const pilotHit = IN_PROCESS_SCRIPT_MILESTONE.pilotExecutables.some((p) =>
    exes.includes(p.toLowerCase()),
  );
  if (pilotHit || definition.id === 'crimson-desert') return 'pilot-gated';
  // Schema forbids inject feature types; never claim mainstream injection.
  return 'forbidden';
}

export function catalogDefinitionCapabilities(definition: SolithDefinitionV1): CatalogDefinitionCapabilities {
  const memoryCheatCount = definition.memoryFeatures?.length ?? 0;
  const saveControlCount = definition.saveEditor?.saveFields.length ?? 0;
  return {
    catalogGameId: definition.id,
    title: definition.title,
    memoryCheatCount,
    saveControlCount,
    saveDirectoryHint: definition.saveEditor?.defaultDirectory,
    saveFormat: definition.saveEditor?.format,
    saveExtension: definition.saveEditor?.extension,
    saveEdit: deriveSaveEdit(definition),
    liveMemory: deriveLiveMemory(definition),
    injection: deriveInjection(definition),
  };
}

/** Convenience: capabilities for a catalog id, or null when no definition payload exists. */
export function getCatalogDefinitionCapabilities(
  catalogGameId: string,
): CatalogDefinitionCapabilities | null {
  const definition = loadCatalogDefinition(catalogGameId);
  if (!definition) return null;
  return catalogDefinitionCapabilities(definition);
}

export function describeCapabilityLanes(caps: CatalogDefinitionCapabilities): string {
  const parts: string[] = [];
  if (caps.saveEdit === 'executable') parts.push('Save edit');
  else if (caps.saveEdit === 'metadata') parts.push('Save (metadata)');

  if (caps.liveMemory === 'executable') parts.push('Live memory (resolved)');
  else if (caps.liveMemory === 'scan-required') parts.push('Live memory (Discovery / L0)');

  if (caps.injection === 'pilot-gated') parts.push('Injection pilot (OFF by default)');
  else if (caps.injection === 'reference-only') parts.push('Injection (reference only)');

  return parts.length > 0 ? parts.join(' · ') : 'Metadata only';
}
