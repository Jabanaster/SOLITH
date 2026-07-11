import type { TrainerControl } from '../../core/trainer-host/trainer-control-schema.js';
import type { GameProfile } from '../../core/game-profiles/types.js';
import { validateGameProfile } from '../../core/game-profiles/types.js';
import { loadTrainerControls } from '../../core/game-profiles/transform.js';
import stardewProfileData from '../../core/game-profiles/profiles/stardew-valley.json';

/** Loads trainer controls from the bundled Stardew Valley game profile. */
export function buildControls(): TrainerControl[] {
  const profile = stardewProfileData as GameProfile;
  const errors = validateGameProfile(profile);
  if (errors.length > 0) {
    console.error('Stardew profile failed validation:', errors);
    return [];
  }
  return loadTrainerControls(profile);
}
