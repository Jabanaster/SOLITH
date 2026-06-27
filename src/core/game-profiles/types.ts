/**
 * Game Profile Types — Milestone H
 *
 * Data-driven game profile system that defines trainer controls per game.
 * Replaces hardcoded controls in TrainerControlPanel with loadable profiles.
 *
 * A game profile contains:
 *   - game metadata (id, name, save format, paths)
 *   - control definitions (fields, paths, types, constraints)
 *   - safety metadata (risk levels, approval requirements, rollback support)
 */

import type {
  ControlBackend,
  ControlSafetyStatus,
  ControlType,
} from '../trainer-host/trainer-control-schema.js';

// ── Profile Metadata ──────────────────────────────────────────────────────────

export interface GameProfile {
  /** Profile format version (semver). */
  profileVersion: string;
  /** Unique game identifier (kebab-case). */
  gameId: string;
  /** Human-readable game name. */
  displayName: string;
  /** Save file format (xml, json, binary, etc.). */
  saveFormat: 'xml' | 'json' | 'ini' | 'binary' | 'other';
  /**
   * Optional hints for locating save root directories.
   * Platform-specific paths (e.g., Windows AppData, Steam userdata).
   */
  saveRootHints?: {
    windows?: string;
    linux?: string;
    mac?: string;
  };
  /**
   * Optional game version compatibility notes.
   * Use to document which game versions this profile supports.
   */
  gameVersionNotes?: string;
  /** List of trainer controls for this game. */
  controls: ProfileControl[];
}

// ── Control Definition ────────────────────────────────────────────────────────

export interface ProfileControl {
  /** Stable unique control identifier within this game profile. */
  id: string;
  /** Display label shown to the user. */
  label: string;
  /** One-line description of what the control does. */
  description: string;
  /** Category for grouping (e.g., CURRENCY, HEALTH, SKILLS). */
  category: string;
  /** The widget type rendered in the UI. */
  controlType: ControlType;
  /** What mechanism executes the change. */
  backend: ControlBackend;
  /** Current safety/execution status. */
  safetyStatus: ControlSafetyStatus;
  /**
   * For save_field backend: defines the save file path and field path.
   * Required when backend === 'save_field' and safetyStatus is executable.
   */
  saveField?: {
    /** Path to the save file (can use template vars like {SAVE_ROOT}). */
    filePath: string;
    /** Dot-notation or bracket path to the field within the save file. */
    fieldPath: string;
    /** Game ID for path-approval check (usually matches profile.gameId). */
    gameId: string;
  };
  /**
   * Value constraints for number_input / slider controls.
   */
  constraints?: {
    min?: number;
    max?: number;
    step?: number;
  };
  /**
   * For select controls: available choices.
   */
  options?: Array<{ label: string; value: string | number | boolean }>;
  /**
   * Optional metadata for testing and validation.
   */
  metadata?: {
    /** Expected data type in the save file. */
    valueType?: 'string' | 'number' | 'boolean' | 'float' | 'int';
    /** Safe test value for validation (e.g., in acceptance tests). */
    safeTestValue?: string | number;
    /** Original/default value in a fresh save. */
    defaultValue?: string | number;
    /** Risk assessment notes. */
    riskNotes?: string;
  };
}

// ── Validation ────────────────────────────────────────────────────────────────

export interface ProfileValidationError {
  field: string;
  message: string;
}

/**
 * Validates a game profile structure.
 * Returns an array of validation errors; empty array means valid.
 */
export function validateGameProfile(profile: unknown): ProfileValidationError[] {
  const errors: ProfileValidationError[] = [];

  if (typeof profile !== 'object' || profile === null) {
    return [{ field: 'profile', message: 'Profile must be a non-null object' }];
  }

  const p = profile as Record<string, unknown>;

  // Required top-level fields
  if (typeof p.profileVersion !== 'string' || !p.profileVersion) {
    errors.push({ field: 'profileVersion', message: 'profileVersion must be a non-empty string' });
  }
  if (typeof p.gameId !== 'string' || !p.gameId) {
    errors.push({ field: 'gameId', message: 'gameId must be a non-empty string' });
  }
  if (typeof p.displayName !== 'string' || !p.displayName) {
    errors.push({ field: 'displayName', message: 'displayName must be a non-empty string' });
  }
  if (!['xml', 'json', 'ini', 'binary', 'other'].includes(p.saveFormat as string)) {
    errors.push({ field: 'saveFormat', message: 'saveFormat must be one of: xml, json, ini, binary, other' });
  }

  // Controls array
  if (!Array.isArray(p.controls)) {
    errors.push({ field: 'controls', message: 'controls must be an array' });
    return errors; // Cannot validate controls if not an array
  }

  const controlIds = new Set<string>();
  for (let i = 0; i < p.controls.length; i++) {
    const ctrl = p.controls[i];
    const prefix = `controls[${i}]`;

    if (typeof ctrl !== 'object' || ctrl === null) {
      errors.push({ field: prefix, message: 'Control must be a non-null object' });
      continue;
    }

    const c = ctrl as Record<string, unknown>;

    // Required control fields
    if (typeof c.id !== 'string' || !c.id) {
      errors.push({ field: `${prefix}.id`, message: 'id must be a non-empty string' });
    } else {
      // Check for duplicate IDs
      if (controlIds.has(c.id)) {
        errors.push({ field: `${prefix}.id`, message: `Duplicate control id: ${c.id}` });
      }
      controlIds.add(c.id);
    }

    if (typeof c.label !== 'string' || !c.label) {
      errors.push({ field: `${prefix}.label`, message: 'label must be a non-empty string' });
    }
    if (typeof c.description !== 'string') {
      errors.push({ field: `${prefix}.description`, message: 'description must be a string' });
    }
    if (typeof c.category !== 'string' || !c.category) {
      errors.push({ field: `${prefix}.category`, message: 'category must be a non-empty string' });
    }

    // Validate backend and safetyStatus
    const validBackends: ControlBackend[] = ['save_field', 'runtime_file', 'memory_observation', 'memory_write', 'unsupported'];
    if (!validBackends.includes(c.backend as ControlBackend)) {
      errors.push({ field: `${prefix}.backend`, message: `backend must be one of: ${validBackends.join(', ')}` });
    }

    const validSafetyStatuses: ControlSafetyStatus[] = [
      'supported', 'disabled', 'requires_approval', 'requires_save_reload',
      'requires_game_restart', 'rollback_available', 'future_feature',
    ];
    if (!validSafetyStatuses.includes(c.safetyStatus as ControlSafetyStatus)) {
      errors.push({ field: `${prefix}.safetyStatus`, message: `safetyStatus must be one of: ${validSafetyStatuses.join(', ')}` });
    }

    // For save_field backend with executable status, saveField is required
    if (
      c.backend === 'save_field' &&
      c.safetyStatus !== 'disabled' &&
      c.safetyStatus !== 'future_feature'
    ) {
      if (typeof c.saveField !== 'object' || c.saveField === null) {
        errors.push({ field: `${prefix}.saveField`, message: 'saveField is required for executable save_field controls' });
      } else {
        const sf = c.saveField as Record<string, unknown>;
        if (typeof sf.filePath !== 'string' || !sf.filePath) {
          errors.push({ field: `${prefix}.saveField.filePath`, message: 'filePath must be a non-empty string' });
        }
        if (typeof sf.fieldPath !== 'string' || !sf.fieldPath) {
          errors.push({ field: `${prefix}.saveField.fieldPath`, message: 'fieldPath must be a non-empty string' });
        }
        if (typeof sf.gameId !== 'string' || !sf.gameId) {
          errors.push({ field: `${prefix}.saveField.gameId`, message: 'gameId must be a non-empty string' });
        }
      }
    }
  }

  return errors;
}
