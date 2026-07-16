/**
 * Phase 2 — dual-read save-edit controls: prefer schema.v1, fall back to game-profiles.
 * Does not delete profiles; preserves Milestone J field paths + requires_approval.
 */
import {
  catalogDefinitionCapabilities,
  loadCatalogDefinition,
} from '../definitions/load-catalog-definition.js';
import {
  solithDefinitionToTrainerControls,
} from '../definitions/definition-to-trainer-controls.js';
import type { SolithDefinitionV1 } from '../definitions/schema.v1.js';
import { validateGameProfile, type GameProfile } from '../game-profiles/types.js';
import { loadTrainerControls } from '../game-profiles/transform.js';
import stardewProfileData from '../game-profiles/profiles/stardew-valley.json';
import type { TrainerControl } from '../trainer-host/trainer-control-schema.js';

export type SaveEditControlSource = 'schema.v1' | 'game-profiles';

export interface DualReadSaveResult {
  controls: TrainerControl[];
  source: SaveEditControlSource;
  catalogGameId: string;
}

export interface DualReadSaveDeps {
  loadDefinition?: (catalogGameId: string) => SolithDefinitionV1 | null;
  loadLegacyControls?: (catalogGameId: string) => TrainerControl[];
  warn?: (message: string) => void;
}

const DEFAULT_WARN = (message: string) => {
  console.warn(message);
};

/** Legacy Stardew game-profile controls (Milestone J). */
export function loadStardewProfileControls(): TrainerControl[] {
  const profile = stardewProfileData as GameProfile;
  const errors = validateGameProfile(profile);
  if (errors.length > 0) {
    console.error('Stardew profile failed validation:', errors);
    return [];
  }
  return loadTrainerControls(profile);
}

function loadLegacyForCatalogId(catalogGameId: string): TrainerControl[] {
  if (catalogGameId === 'stardew-valley' || catalogGameId === 'demo-game-quest-id-000000000000') {
    return loadStardewProfileControls();
  }
  return [];
}

/**
 * Prefer schema.v1 saveEditor when saveEdit is executable; otherwise fall back to game-profiles.
 */
export function resolveSaveEditControlsDualRead(
  options: { catalogGameId?: string } = {},
  deps: DualReadSaveDeps = {},
): DualReadSaveResult {
  const catalogGameId = options.catalogGameId ?? 'stardew-valley';
  const warn = deps.warn ?? DEFAULT_WARN;
  const loadDefinition = deps.loadDefinition ?? loadCatalogDefinition;
  const loadLegacy = deps.loadLegacyControls ?? loadLegacyForCatalogId;

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

  warn(`[Schema.v1] Fallback triggered for Save Edit: ${catalogGameId}`);
  return {
    controls: loadLegacy(catalogGameId),
    source: 'game-profiles',
    catalogGameId,
  };
}

/**
 * Align definition-sourced Stardew controls with the legacy path-approval gameId
 * and `{STARDEW_SAVE_FILE}` placeholder used by the default TrainerControlPanel.
 * Field paths remain those from schema.v1 (must match Milestone J).
 */
export function alignStardewPanelPlaceholders(controls: TrainerControl[]): TrainerControl[] {
  const legacy = loadStardewProfileControls();
  const byId = new Map(legacy.map((c) => [c.id, c]));
  return controls.map((control) => {
    const leg = byId.get(control.id);
    if (!leg?.saveField || !control.saveField) return control;
    return {
      ...control,
      // Keep constraints from profile when definition omitted them.
      min: control.min ?? leg.min,
      max: control.max ?? leg.max,
      step: control.step ?? leg.step,
      saveField: {
        ...control.saveField,
        filePath: leg.saveField.filePath,
        gameId: leg.saveField.gameId,
        // fieldPath intentionally from schema.v1 (control.saveField.fieldPath)
      },
    };
  });
}
