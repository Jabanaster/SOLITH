/**
 * Game Profile Loader — Milestone H
 *
 * Loads and validates game profiles from JSON files.
 * Provides a registry of available game profiles for the trainer UI.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { GameProfile } from './types.js';
import { validateGameProfile } from './types.js';

// Re-export the pure transforms so existing Node/test consumers that import them
// from the loader continue to work. The renderer must import them from
// './transform.js' directly to avoid pulling fs/path/url into the browser bundle.
export {
  profileControlToTrainerControl,
  loadTrainerControls,
} from './transform.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILES_DIR = path.join(__dirname, 'profiles');

/**
 * Loads a game profile from a JSON file and validates it.
 * Throws an error if the profile is invalid.
 */
export function loadGameProfile(profilePath: string): GameProfile {
  if (!fs.existsSync(profilePath)) {
    throw new Error(`Profile not found: ${profilePath}`);
  }

  const raw = fs.readFileSync(profilePath, 'utf-8');
  let parsed: unknown;
  
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Failed to parse profile JSON: ${e}`);
  }

  const errors = validateGameProfile(parsed);
  if (errors.length > 0) {
    const errorMessages = errors.map(e => `  - ${e.field}: ${e.message}`).join('\n');
    throw new Error(`Profile validation failed:\n${errorMessages}`);
  }

  return parsed as GameProfile;
}

/**
 * Loads the Stardew Valley profile (used by default in Milestone H).
 */
export function loadStardewProfile(): GameProfile {
  const profilePath = path.join(PROFILES_DIR, 'stardew-valley.json');
  return loadGameProfile(profilePath);
}
