import type { TrainerControl } from '../../core/trainer-host/trainer-control-schema.js';
import {
  alignStardewPanelPlaceholders,
  resolveSaveEditControlsFromSchema,
} from '../../core/definitions/dual-read-save-controls.js';

/**
 * Loads Stardew Valley trainer controls exclusively from schema.v1 (Phase 4).
 * Applies panel path-approval placeholders for the default TrainerControlPanel.
 */
export function buildControls(): TrainerControl[] {
  const result = resolveSaveEditControlsFromSchema({ catalogGameId: 'stardew-valley' });
  if (result.source !== 'schema.v1' || result.controls.length === 0) {
    return [];
  }
  return alignStardewPanelPlaceholders(result.controls);
}
