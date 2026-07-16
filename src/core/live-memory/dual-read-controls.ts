/**
 * Phase 2 — dual-read live controls: prefer schema.v1, fall back to live-control-catalog.
 * Legacy catalog is not deleted; fallback is logged when used.
 */
import {
  catalogDefinitionCapabilities,
  loadCatalogDefinition,
} from '../definitions/load-catalog-definition.js';
import type { MemoryFeatureV1, SolithDefinitionV1 } from '../definitions/schema.v1.js';
import { memoryDataTypeToLiveValue } from '../definitions/schema.v1.js';
import { searchCatalog } from '../trainer-catalog/store.js';
import { parseHexOffset } from './feature-resolver.js';
import {
  getControl as getLegacyControl,
  listControlsForGame as listLegacyControlsForGame,
  type LiveTrainerControl,
} from './live-control-catalog.js';
import type { LivePointerPath } from './pointer-resolver.js';
import type { LiveValueType } from './types.js';

export type LiveControlSource = 'schema.v1' | 'live-control-catalog';

export interface DualReadLiveListResult {
  controls: LiveTrainerControl[];
  source: LiveControlSource;
  catalogGameId?: string;
}

export interface DualReadLiveResolveResult {
  control: LiveTrainerControl | undefined;
  source: LiveControlSource | null;
  /** Present when control came from a memoryFeature (session may use resolveMemoryFeature). */
  feature?: MemoryFeatureV1;
  catalogGameId?: string;
}

export interface DualReadLiveDeps {
  loadDefinition?: (catalogGameId: string) => SolithDefinitionV1 | null;
  findCatalogGameIdsByExecutable?: (executableName: string) => string[];
  listLegacy?: (executableName: string) => LiveTrainerControl[];
  getLegacy?: (controlId: string) => LiveTrainerControl | undefined;
  warn?: (message: string) => void;
}

const DEFAULT_WARN = (message: string) => {
  console.warn(message);
};

/** Catalog ids whose entry executables match (case-insensitive). */
export function findCatalogGameIdsByExecutable(executableName: string): string[] {
  const needle = executableName.toLowerCase();
  const ids: string[] = [];
  try {
    const fromSearch = searchCatalog(executableName.replace(/\.exe$/i, ''), 40, 0);
    for (const entry of fromSearch.entries) {
      if (entry.executables.some((exe) => exe.toLowerCase() === needle)) {
        ids.push(entry.catalogGameId);
      }
    }
  } catch {
    // Catalog DB may be uninitialized in unit tests — treat as no hits.
  }
  return [...new Set(ids)];
}

function featureToPointerPath(feature: MemoryFeatureV1): LivePointerPath {
  const moduleOffset = (() => {
    try {
      return feature.resolution.baseOffset ? parseHexOffset(feature.resolution.baseOffset) : 0;
    } catch {
      return 0;
    }
  })();
  return {
    moduleName: feature.resolution.moduleName,
    moduleOffset,
    offsets: feature.resolution.pointerChain ?? [],
  };
}

export function memoryFeatureToLiveControl(
  feature: MemoryFeatureV1,
  definition: SolithDefinitionV1,
  executableName: string,
): LiveTrainerControl {
  const dataType = memoryDataTypeToLiveValue(feature.dataType) as LiveValueType;
  return {
    id: `${definition.id}:${feature.id}`,
    executableName,
    label: feature.name,
    description:
      feature.type === 'scan_unknown' || feature.type === 'scan_first'
        ? `${feature.name} — Discovery / L0 (${feature.type}); resolve may require Advanced Scan Mode.`
        : `${feature.name} — schema.v1 memoryFeature (${feature.type}).`,
    dataType,
    pointerPath: featureToPointerPath(feature),
    discoveredAt: 'schema.v1',
    evidence: `Derived from definition ${definition.id} feature ${feature.id}`,
  };
}

function definitionMatchesExecutable(definition: SolithDefinitionV1, executableName: string): boolean {
  const needle = executableName.toLowerCase();
  return definition.target.executables.some((exe) => exe.toLowerCase() === needle);
}

function tryLoadDefinition(
  catalogGameId: string,
  deps: DualReadLiveDeps,
): SolithDefinitionV1 | null {
  const load = deps.loadDefinition ?? loadCatalogDefinition;
  try {
    return load(catalogGameId);
  } catch {
    return null;
  }
}

function tryDefinitionForLive(
  catalogGameId: string,
  executableName: string | undefined,
  deps: DualReadLiveDeps,
): DualReadLiveListResult | null {
  const definition = tryLoadDefinition(catalogGameId, deps);
  if (!definition) return null;
  if (executableName && !definitionMatchesExecutable(definition, executableName)) {
    // Allow catalogGameId override even if exe list drifts slightly.
  }
  const caps = catalogDefinitionCapabilities(definition);
  if (caps.liveMemory === 'none') return null;

  const exe =
    executableName ??
    definition.target.executables[0] ??
    `${definition.id}.exe`;
  const features = definition.memoryFeatures ?? [];
  if (features.length === 0) return null;

  return {
    controls: features.map((f) => memoryFeatureToLiveControl(f, definition, exe)),
    source: 'schema.v1',
    catalogGameId: definition.id,
  };
}

/**
 * List live controls: schema.v1 preferred when liveMemory is executable or scan-required.
 */
export function listLiveControlsDualRead(
  options: { executableName?: string; catalogGameId?: string },
  deps: DualReadLiveDeps = {},
): DualReadLiveListResult {
  const warn = deps.warn ?? DEFAULT_WARN;
  const listLegacy = deps.listLegacy ?? listLegacyControlsForGame;
  const findIds = deps.findCatalogGameIdsByExecutable ?? findCatalogGameIdsByExecutable;

  if (options.catalogGameId) {
    const preferred = tryDefinitionForLive(options.catalogGameId, options.executableName, deps);
    if (preferred) return preferred;
  }

  if (options.executableName) {
    const candidateIds = findIds(options.executableName);
    for (const id of candidateIds) {
      const preferred = tryDefinitionForLive(id, options.executableName, deps);
      if (preferred) return preferred;
    }

    // Direct load by slug guess (bundled ids often match searchable names)
    const slugGuess = options.executableName
      .replace(/\.exe$/i, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-');
    for (const guess of [slugGuess, slugGuess.replace(/-dx12$/, ''), 'atomfall']) {
      const preferred = tryDefinitionForLive(guess, options.executableName, deps);
      if (preferred) return preferred;
    }
  }

  const exe = options.executableName ?? '';
  const fallbackKey = options.catalogGameId ?? (exe.length > 0 ? exe : '(none)');
  warn(`[Schema.v1] Fallback triggered for Live Memory: ${fallbackKey}`);
  return {
    controls: exe ? listLegacy(exe) : [],
    source: 'live-control-catalog',
    catalogGameId: options.catalogGameId,
  };
}

/**
 * Resolve a control by id — definition-prefixed ids (`game:feature`) or legacy catalog ids.
 */
export function resolveLiveControlDualRead(
  controlId: string,
  options: { executableName?: string; catalogGameId?: string } = {},
  deps: DualReadLiveDeps = {},
): DualReadLiveResolveResult {
  const warn = deps.warn ?? DEFAULT_WARN;
  const getLegacy = deps.getLegacy ?? getLegacyControl;

  const colon = controlId.indexOf(':');
  if (colon > 0) {
    const defId = controlId.slice(0, colon);
    const featureId = controlId.slice(colon + 1);
    const definition = tryLoadDefinition(defId, deps);
    if (definition) {
      const caps = catalogDefinitionCapabilities(definition);
      if (caps.liveMemory !== 'none') {
        const feature = definition.memoryFeatures?.find((f) => f.id === featureId);
        if (feature) {
          const exe =
            options.executableName ??
            definition.target.executables[0] ??
            `${definition.id}.exe`;
          return {
            control: memoryFeatureToLiveControl(feature, definition, exe),
            source: 'schema.v1',
            feature,
            catalogGameId: definition.id,
          };
        }
      }
    }
  }

  if (options.catalogGameId || options.executableName) {
    const listed = listLiveControlsDualRead(options, deps);
    const hit = listed.controls.find((c) => c.id === controlId);
    if (hit) {
      return {
        control: hit,
        source: listed.source,
        catalogGameId: listed.catalogGameId,
      };
    }
  }

  const legacy = getLegacy(controlId);
  if (legacy) {
    warn(`[Schema.v1] Fallback triggered for Live Memory resolve: ${controlId}`);
    return { control: legacy, source: 'live-control-catalog' };
  }

  warn(`[Schema.v1] Fallback triggered for Live Memory resolve: ${controlId}`);
  return { control: undefined, source: null };
}
