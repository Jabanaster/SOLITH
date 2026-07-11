/**
 * Trainer Control Schema — Milestone E
 *
 * Defines the data model for every control that appears in the ResourceForge
 * trainer panel. Controls are pure data; the panel component interprets them.
 *
 * Safety rules enforced here:
 *   - Controls backed by 'unsupported' cannot be executed.
 *   - memory_observation is read-only and never executable.
 *   - save_field and memory_write controls execute when safetyStatus is
 *     'supported' or 'requires_approval'.
 *   - 'requires_approval' controls must go through propose → explicit-approve → execute.
 *   - 'rollback_available' is a result status set after a successful write, not an
 *     initial configuration.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** What mechanism backs the control. Determines execution eligibility. */
export type ControlBackend =
  | 'save_field'        // TrainerHost XML/JSON save read-write (supported)
  | 'runtime_file'      // Live config file patching (future)
  | 'memory_observation'// Read-only memory scan (future, read-only)
  | 'memory_write'      // Live process memory write (V2 live trainer)
  | 'unsupported';      // No backend — placeholder / future feature

/** User-visible and logic-visible safety status of the control. */
export type ControlSafetyStatus =
  | 'supported'            // Safe to use as-is
  | 'disabled'             // Control exists but cannot be used right now
  | 'requires_approval'    // Shows diff/proposal; needs explicit user confirmation
  | 'requires_save_reload' // Write is safe but requires reloading the save in-game
  | 'requires_game_restart'// Write requires a full game restart to take effect
  | 'rollback_available'   // A backup exists — rollback is available
  | 'future_feature';      // Not implemented; shown for roadmap visibility

/** Input widget type rendered in the UI. */
export type ControlType =
  | 'toggle'
  | 'button'
  | 'number_input'
  | 'slider'
  | 'select'
  | 'readonly_value';

// ── Core schema ───────────────────────────────────────────────────────────────

export interface TrainerControl {
  /** Stable identifier — must be unique within a panel. */
  id: string;
  /** Display label shown to the user. */
  label: string;
  /** One-line description of what the control does. */
  description: string;
  /** Category for grouping (matches TrainerItem.category values). */
  category: string;
  /** The widget type rendered in the UI. */
  controlType: ControlType;
  /** What mechanism executes the change. */
  backend: ControlBackend;
  /** Current live/known value (may be undefined if not yet read). */
  currentValue?: string | number | boolean;
  /** For number_input / slider: minimum allowed value. */
  min?: number;
  /** For number_input / slider: maximum allowed value. */
  max?: number;
  /** For slider: step size. */
  step?: number;
  /** For select: available choices. */
  options?: Array<{ label: string; value: string | number | boolean }>;
  /**
   * Safety and execution status. Controls safety gating in the UI and logic layers.
   * Controls with 'disabled' or 'future_feature' cannot be executed.
   * Controls with 'requires_approval' must go through propose → approve → execute.
   */
  safetyStatus: ControlSafetyStatus;
  /**
   * Optional: when backend === 'save_field', this identifies the XML/JSON field path
   * and the source file for the TrainerHost write workflow.
   */
  saveField?: {
    filePath: string;
    fieldPath: string;
    /** gameId used for path-approval check in the main process. */
    gameId: string;
  };
}

// ── Execution eligibility ─────────────────────────────────────────────────────

/**
 * Returns true only if a control can be submitted for write execution.
 *
 * Executable when safetyStatus is 'supported' or 'requires_approval' and
 * backend is save_field, memory_write, or runtime_file.
 * memory_observation and unsupported are never executable.
 */
export function isControlExecutable(control: TrainerControl): boolean {
  if (control.backend === 'unsupported' || control.backend === 'memory_observation') {
    return false;
  }
  if (
    control.backend !== 'save_field'
    && control.backend !== 'memory_write'
    && control.backend !== 'runtime_file'
  ) {
    return false;
  }
  return control.safetyStatus === 'supported' || control.safetyStatus === 'requires_approval';
}

/**
 * Returns true if the control requires an explicit approval step before write.
 * The UI must show a proposal/diff and get user confirmation before calling
 * approveAndWrite.
 */
export function requiresApproval(control: TrainerControl): boolean {
  return control.safetyStatus === 'requires_approval';
}

// ── Validation ────────────────────────────────────────────────────────────────

const VALID_BACKENDS: ControlBackend[] = [
  'save_field', 'runtime_file', 'memory_observation', 'memory_write', 'unsupported',
];

const VALID_SAFETY_STATUSES: ControlSafetyStatus[] = [
  'supported', 'disabled', 'requires_approval', 'requires_save_reload',
  'requires_game_restart', 'rollback_available', 'future_feature',
];

const VALID_CONTROL_TYPES: ControlType[] = [
  'toggle', 'button', 'number_input', 'slider', 'select', 'readonly_value',
];

/**
 * Validates a value as a well-formed TrainerControl.
 * Returns an array of error strings; empty array means valid.
 */
export function validateControl(value: unknown): string[] {
  const errors: string[] = [];

  if (typeof value !== 'object' || value === null) {
    return ['control must be a non-null object'];
  }

  const c = value as Record<string, unknown>;

  if (typeof c.id !== 'string' || c.id.trim() === '') errors.push('id must be a non-empty string');
  if (typeof c.label !== 'string' || c.label.trim() === '') errors.push('label must be a non-empty string');
  if (typeof c.description !== 'string') errors.push('description must be a string');
  if (typeof c.category !== 'string' || c.category.trim() === '') errors.push('category must be a non-empty string');

  if (!VALID_CONTROL_TYPES.includes(c.controlType as ControlType)) {
    errors.push(`controlType must be one of: ${VALID_CONTROL_TYPES.join(', ')}`);
  }
  if (!VALID_BACKENDS.includes(c.backend as ControlBackend)) {
    errors.push(`backend must be one of: ${VALID_BACKENDS.join(', ')}`);
  }
  if (!VALID_SAFETY_STATUSES.includes(c.safetyStatus as ControlSafetyStatus)) {
    errors.push(`safetyStatus must be one of: ${VALID_SAFETY_STATUSES.join(', ')}`);
  }

  if (c.controlType === 'slider') {
    if (typeof c.min !== 'number') errors.push('slider requires min (number)');
    if (typeof c.max !== 'number') errors.push('slider requires max (number)');
    if (typeof c.min === 'number' && typeof c.max === 'number' && c.min >= c.max) {
      errors.push('slider min must be less than max');
    }
  }

  if (c.controlType === 'select') {
    if (!Array.isArray(c.options) || c.options.length === 0) {
      errors.push('select requires at least one option');
    }
  }

  if (c.backend === 'save_field' && c.safetyStatus !== 'disabled' && c.safetyStatus !== 'future_feature') {
    if (typeof c.saveField !== 'object' || c.saveField === null) {
      errors.push('save_field backend requires saveField object with filePath, fieldPath, gameId');
    } else {
      const sf = c.saveField as Record<string, unknown>;
      if (typeof sf.filePath !== 'string' || !sf.filePath) errors.push('saveField.filePath required');
      if (typeof sf.fieldPath !== 'string' || !sf.fieldPath) errors.push('saveField.fieldPath required');
      if (typeof sf.gameId !== 'string' || !sf.gameId) errors.push('saveField.gameId required');
    }
  }

  return errors;
}

// ── Label helpers ─────────────────────────────────────────────────────────────

export const BACKEND_LABELS: Record<ControlBackend, string> = {
  save_field:         'Save Field',
  runtime_file:       'Runtime File',
  memory_observation: 'Memory (Read-Only)',
  memory_write:       'Memory Write',
  unsupported:        'Not Supported',
};

export const SAFETY_STATUS_LABELS: Record<ControlSafetyStatus, string> = {
  supported:             'Supported',
  disabled:              'Disabled',
  requires_approval:     'Requires Approval',
  requires_save_reload:  'Requires Save Reload',
  requires_game_restart: 'Requires Game Restart',
  rollback_available:    'Rollback Available',
  future_feature:        'Future Feature',
};
