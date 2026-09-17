/**
 * Phase 4 — schema.v1-only live control listing/resolve.
 * Legacy live-control-catalog fallback removed; missing definition → empty / undefined.
 */
import {
  catalogDefinitionCapabilities,
  loadCatalogDefinition,
} from '../definitions/load-catalog-definition.js';
import type { MemoryFeatureV1, SolithDefinitionV1 } from '../definitions/schema.v1.js';
import { memoryDataTypeToLiveValue } from '../definitions/schema.v1.js';
import { listCatalogExecutableIndex } from '../trainer-catalog/store.js';
import { parseHexOffset } from './feature-resolver.js';
import type { LiveTrainerControl } from './live-trainer-control.js';
import type { LivePointerPath } from './pointer-resolver.js';
import type { LiveValueType } from './types.js';

export type LiveControlSource = 'schema.v1';

export interface SchemaLiveListResult {
  controls: LiveTrainerControl[];
  source: LiveControlSource | null;
  catalogGameId?: string;
}

export interface SchemaLiveResolveResult {
  control: LiveTrainerControl | undefined;
  source: LiveControlSource | null;
  feature?: MemoryFeatureV1;
  catalogGameId?: string;
}

export interface SchemaLiveDeps {
  loadDefinition?: (catalogGameId: string) => SolithDefinitionV1 | null;
  findCatalogGameIdsByExecutable?: (executableName: string) => string[];
}

/**
 * Catalog ids whose entry executables match (case-insensitive), searched
 * across the whole catalog — not a text-search-derived, fixed-size page.
 * A prior version ran a 40-row title/searchableText search keyed on the
 * executable's own filename, which both capped coverage AND depended on
 * the executable name happening to textually resemble the display name
 * (many real games ship an executable whose name has no such resemblance,
 * e.g. an abbreviated internal build name) — the same D07 defect class as
 * the catalog-process-watch/install-discovery windows, just via a fuzzy
 * text search instead of a numeric row cap.
 */
export function findCatalogGameIdsByExecutable(executableName: string): string[] {
  const needle = executableName.toLowerCase();
  const ids: string[] = [];
  try {
    for (const entry of listCatalogExecutableIndex()) {
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

function tryLoadDefinition(
  catalogGameId: string,
  deps: SchemaLiveDeps,
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
  deps: SchemaLiveDeps,
): SchemaLiveListResult | null {
  const definition = tryLoadDefinition(catalogGameId, deps);
  if (!definition) return null;
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
 * List live controls exclusively from schema.v1.
 * Returns empty controls when no definition / liveMemory capability exists.
 */
export function listLiveControlsFromSchema(
  options: { executableName?: string; catalogGameId?: string },
  deps: SchemaLiveDeps = {},
): SchemaLiveListResult {
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

    const slugGuess = options.executableName
      .replace(/\.exe$/i, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-');
    for (const guess of [slugGuess, slugGuess.replace(/-dx12$/, ''), 'atomfall']) {
      const preferred = tryDefinitionForLive(guess, options.executableName, deps);
      if (preferred) return preferred;
    }
  }

  return {
    controls: [],
    source: null,
    catalogGameId: options.catalogGameId,
  };
}

/** @deprecated Phase 4 alias — use listLiveControlsFromSchema */
export const listLiveControlsDualRead = listLiveControlsFromSchema;

/**
 * Resolve a control by id — definition-prefixed ids (`game:feature`) only.
 */
export function resolveLiveControlFromSchema(
  controlId: string,
  options: { executableName?: string; catalogGameId?: string } = {},
  deps: SchemaLiveDeps = {},
): SchemaLiveResolveResult {
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
    const listed = listLiveControlsFromSchema(options, deps);
    const hit = listed.controls.find((c) => c.id === controlId);
    if (hit) {
      return {
        control: hit,
        source: listed.source,
        catalogGameId: listed.catalogGameId,
      };
    }
  }

  return { control: undefined, source: null };
}

/** @deprecated Phase 4 alias — use resolveLiveControlFromSchema */
export const resolveLiveControlDualRead = resolveLiveControlFromSchema;

/** Dual-read types retained as aliases for existing imports. */
export type DualReadLiveListResult = SchemaLiveListResult;
export type DualReadLiveResolveResult = SchemaLiveResolveResult;
export type DualReadLiveDeps = SchemaLiveDeps;
