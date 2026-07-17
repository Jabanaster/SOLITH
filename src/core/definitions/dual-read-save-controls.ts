/**
 * Phase 4 — schema.v1-only save-edit controls.
 * Legacy game-profiles fallback removed. Milestone J field paths come from
 * bundled STARDEW_DEFINITION; panel path placeholders are applied here.
 */
import { catalogDefinitionCapabilities } from './catalog-definition-capabilities.js';
import { solithDefinitionToTrainerControls } from './definition-to-trainer-controls.js';
import type { SolithDefinitionV1 } from './schema.v1.js';
import { bundledDefinitionsForTests } from '../trainer-catalog/bundled-definition-seed.js';
import type { TrainerControl } from '../trainer-host/trainer-control-schema.js';

export type SaveEditControlSource = 'schema.v1';

export interface SchemaSaveResult {
  controls: TrainerControl[];
  source: SaveEditControlSource | null;
  catalogGameId: string;
}

export interface SchemaSaveDeps {
  loadDefinition?: (catalogGameId: string) => SolithDefinitionV1 | null;
}

/** Historic Stardew panel path-approval id + file placeholder (Milestone J workflow). */
export const STARDEW_PANEL_GAME_ID = 'demo-game-quest-id-000000000000';
export const STARDEW_SAVE_FILE_PLACEHOLDER = '{STARDEW_SAVE_FILE}';

const STARDEW_PANEL_CONSTRAINTS: Record<string, { min?: number; max?: number }> = {
  'stardew-money': { min: 0, max: 2147483647 },
  'stardew-stamina': { min: 0, max: 508 },
  'stardew-max-stamina': { min: 270, max: 508 },
  'stardew-farming-xp': { min: 0, max: 15000 },
};

/**
 * Renderer-safe default: bundled seed only.
 * Electron IPC / host paths that need SQLite can inject loadCatalogDefinition via deps.
 */
function defaultLoadDefinition(catalogGameId: string): SolithDefinitionV1 | null {
  return bundledDefinitionsForTests().find((d) => d.id === catalogGameId) ?? null;
}

/**
 * Load save-edit TrainerControls exclusively from schema.v1.
 * Returns empty controls when definition missing or saveEdit is not executable.
 */
export function resolveSaveEditControlsFromSchema(
  options: { catalogGameId?: string } = {},
  deps: SchemaSaveDeps = {},
): SchemaSaveResult {
  const catalogGameId = options.catalogGameId ?? 'stardew-valley';
  const loadDefinition = deps.loadDefinition ?? defaultLoadDefinition;

  let definition: SolithDefinitionV1 | null = null;
  try {
    definition = loadDefinition(catalogGameId);
  } catch {
    definition = null;
  }

  if (definition) {
    const caps = catalogDefinitionCapabilities(definition);
    if (caps.saveEdit === 'executable') {
      const controls = solithDefinitionToTrainerControls(definition);
      if (controls.length > 0) {
        return { controls, source: 'schema.v1', catalogGameId };
      }
    }
  }

  return { controls: [], source: null, catalogGameId };
}

/** @deprecated Phase 4 alias — use resolveSaveEditControlsFromSchema */
export const resolveSaveEditControlsDualRead = resolveSaveEditControlsFromSchema;

/**
 * Apply Stardew panel path-approval placeholders + Milestone J constraints
 * without reading game-profiles JSON.
 */
export function alignStardewPanelPlaceholders(controls: TrainerControl[]): TrainerControl[] {
  return controls.map((control) => {
    if (!control.saveField) return control;
    const constraints = STARDEW_PANEL_CONSTRAINTS[control.id];
    return {
      ...control,
      min: control.min ?? constraints?.min,
      max: control.max ?? constraints?.max,
      saveField: {
        ...control.saveField,
        filePath: STARDEW_SAVE_FILE_PLACEHOLDER,
        gameId: STARDEW_PANEL_GAME_ID,
      },
    };
  });
}

/** @deprecated Phase 4 — profiles removed; always returns []. */
export function loadStardewProfileControls(): TrainerControl[] {
  return [];
}

export type DualReadSaveResult = SchemaSaveResult;
export type DualReadSaveDeps = SchemaSaveDeps;
