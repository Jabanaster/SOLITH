/**
 * Game Profile Transforms — Milestone H
 *
 * Pure, environment-agnostic functions that convert a validated GameProfile
 * into the TrainerControl shape consumed by the UI.
 *
 * IMPORTANT: This module must remain free of Node built-ins (fs/path/url) so it
 * can be imported by the renderer (React panel) as well as the Node main process
 * and tests. The fs-backed profile *loading* lives in loader.ts (Node only).
 */

import type { GameProfile } from './types.js';
import type { TrainerControl } from '../trainer-host/trainer-control-schema.js';

/**
 * Converts a profile control to a TrainerControl for the UI.
 * Pure: performs no I/O and no path resolution.
 */
export function profileControlToTrainerControl(
  profileCtrl: GameProfile['controls'][0],
): TrainerControl {
  const control: TrainerControl = {
    id: profileCtrl.id,
    label: profileCtrl.label,
    description: profileCtrl.description,
    category: profileCtrl.category,
    controlType: profileCtrl.controlType,
    backend: profileCtrl.backend,
    safetyStatus: profileCtrl.safetyStatus,
  };

  if (profileCtrl.saveField) {
    control.saveField = {
      filePath: profileCtrl.saveField.filePath,
      fieldPath: profileCtrl.saveField.fieldPath,
      gameId: profileCtrl.saveField.gameId,
    };
  }

  if (profileCtrl.constraints) {
    control.min = profileCtrl.constraints.min;
    control.max = profileCtrl.constraints.max;
    control.step = profileCtrl.constraints.step;
  }

  if (profileCtrl.options) {
    control.options = profileCtrl.options;
  }

  return control;
}

/**
 * Loads all controls from a game profile and converts them to TrainerControl format.
 * Pure: performs no I/O.
 */
export function loadTrainerControls(profile: GameProfile): TrainerControl[] {
  return profile.controls.map(profileControlToTrainerControl);
}
