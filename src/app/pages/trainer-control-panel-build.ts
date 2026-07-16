import type { TrainerControl } from '../../core/trainer-host/trainer-control-schema.js';
import {
  alignStardewPanelPlaceholders,
  resolveSaveEditControlsDualRead,
  loadStardewProfileControls,
} from '../../core/definitions/dual-read-save-controls.js';

/**
 * Loads Stardew Valley trainer controls via Phase 2 dual-read:
 * schema.v1 preferred; game-profiles fallback. Path placeholders stay
 * profile-compatible for the default panel approval flow.
 */
export function buildControls(): TrainerControl[] {
  const result = resolveSaveEditControlsDualRead({ catalogGameId: 'stardew-valley' });
  if (result.source === 'schema.v1') {
    return alignStardewPanelPlaceholders(result.controls);
  }
  return result.controls.length > 0 ? result.controls : loadStardewProfileControls();
}
