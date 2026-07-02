import fs from 'fs';
import path from 'path';
import {
  detectSaveFormatFromPath,
  getDeclaredSaveFormatCapability,
  type SaveFormatOperation,
} from '../saves/save-format.js';
import {
  validateGameProfile,
  type GameProfile,
  type ProfileValidationError,
} from './types.js';

const EXECUTABLE_STATUSES = new Set(['supported', 'requires_approval', 'requires_save_reload', 'requires_game_restart', 'rollback_available']);
const NON_SHIPPED_STATUSES = new Set(['disabled', 'future_feature']);

export interface ProfileAuthoringValidationInput {
  profile: unknown;
  fixturePath?: string;
  approvedRuntimeBindings?: string[];
}

export interface ProfileAuthoringFixtureEvidence {
  fileName: string;
  present: boolean;
  detectedFormat: string;
  formatMatchesProfile: boolean;
}

export interface ProfileAuthoringValidationReport {
  valid: boolean;
  gameId?: string;
  displayName?: string;
  saveFormat?: string;
  fixture: ProfileAuthoringFixtureEvidence | null;
  supportedOperations: SaveFormatOperation[];
  blockedOperations: SaveFormatOperation[];
  executableControlIds: string[];
  errors: ProfileValidationError[];
  warnings: ProfileValidationError[];
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{([A-Z0-9_]+)\}/g)].map(match => match[1]);
}

function isSingleRuntimeBinding(value: string): boolean {
  return /^\{[A-Z0-9_]+\}$/.test(value);
}

function makeFixtureEvidence(profileFormat: string | undefined, fixturePath: string | undefined): ProfileAuthoringFixtureEvidence | null {
  if (!fixturePath) return null;

  const detectedFormat = detectSaveFormatFromPath(fixturePath);
  return {
    fileName: path.basename(fixturePath),
    present: fs.existsSync(fixturePath),
    detectedFormat,
    formatMatchesProfile: detectedFormat === profileFormat,
  };
}

function operationsForFormat(format: unknown): {
  supportedOperations: SaveFormatOperation[];
  blockedOperations: SaveFormatOperation[];
} {
  const capability = getDeclaredSaveFormatCapability(format);
  const supportedOperations: SaveFormatOperation[] = [];
  const blockedOperations: SaveFormatOperation[] = [];
  const operations: SaveFormatOperation[] = ['inspect', 'save_field_read', 'save_field_propose', 'save_field_write', 'save_field_rollback'];

  for (const operation of operations) {
    const supported =
      operation === 'inspect'
        ? capability.canInspect
        : operation === 'save_field_read'
          ? capability.canReadSaveField
          : operation === 'save_field_propose'
            ? capability.canProposeSaveField
            : capability.canWriteSaveField;
    (supported ? supportedOperations : blockedOperations).push(operation);
  }

  return { supportedOperations, blockedOperations };
}

export function validateProfileAuthoringWorkflow(input: ProfileAuthoringValidationInput): ProfileAuthoringValidationReport {
  const errors = validateGameProfile(input.profile);
  const warnings: ProfileValidationError[] = [];
  const profile = input.profile as Partial<GameProfile>;
  const { supportedOperations, blockedOperations } = operationsForFormat(profile?.saveFormat);
  const fixture = makeFixtureEvidence(profile?.saveFormat, input.fixturePath);
  const approvedRuntimeBindings = new Set(input.approvedRuntimeBindings ?? []);
  const executableControlIds: string[] = [];

  if (!fixture) {
    errors.push({ field: 'fixturePath', message: 'fixture-backed validation requires a fixture path' });
  } else {
    if (!fixture.present) {
      errors.push({ field: 'fixturePath', message: `fixture file is missing: ${fixture.fileName}` });
    }
    if (fixture.detectedFormat !== 'unknown' && fixture.detectedFormat !== 'unsupported' && !fixture.formatMatchesProfile) {
      errors.push({ field: 'fixturePath', message: 'fixture format must match the profile saveFormat' });
    }
  }

  if (profile?.saveFormat && supportedOperations.length === 0) {
    errors.push({ field: 'saveFormat', message: 'profile saveFormat is not supported by the V1 authoring workflow' });
  }

  if (Array.isArray(profile?.controls)) {
    profile.controls.forEach((control, index) => {
      const prefix = `controls[${index}]`;
      const executableStatus = EXECUTABLE_STATUSES.has(control.safetyStatus);

      if (NON_SHIPPED_STATUSES.has(control.safetyStatus)) {
        errors.push({ field: `${prefix}.safetyStatus`, message: 'profile authoring reports must not ship disabled or future controls' });
      }

      if (control.backend === 'unsupported' && executableStatus) {
        errors.push({ field: `${prefix}.backend`, message: 'unsupported controls must be blocked, not executable' });
      }

      if (control.backend === 'memory_write' && executableStatus) {
        errors.push({ field: `${prefix}.backend`, message: 'memory_write controls are not allowed in V1 authoring reports' });
      }

      if (control.backend !== 'save_field' || !executableStatus) {
        return;
      }

      executableControlIds.push(control.id);

      if (!supportedOperations.includes('save_field_write')) {
        errors.push({ field: `${prefix}.saveField`, message: 'executable save_field controls require a write-capable save format' });
      }

      if (control.safetyStatus !== 'requires_approval') {
        errors.push({ field: `${prefix}.safetyStatus`, message: 'executable save_field controls must require approval and backup' });
      }

      if (!control.saveField) return;

      if (!isSingleRuntimeBinding(control.saveField.filePath)) {
        errors.push({ field: `${prefix}.saveField.filePath`, message: 'filePath must be one approved runtime binding token' });
      }

      const unknownBindings = placeholders(control.saveField.filePath).filter(binding => !approvedRuntimeBindings.has(binding));
      for (const binding of unknownBindings) {
        errors.push({ field: `${prefix}.saveField.filePath`, message: `runtime binding is not approved: ${binding}` });
      }
    });
  }

  executableControlIds.sort((a, b) => a.localeCompare(b));

  return {
    valid: errors.length === 0,
    gameId: typeof profile?.gameId === 'string' ? profile.gameId : undefined,
    displayName: typeof profile?.displayName === 'string' ? profile.displayName : undefined,
    saveFormat: typeof profile?.saveFormat === 'string' ? profile.saveFormat : undefined,
    fixture,
    supportedOperations,
    blockedOperations,
    executableControlIds,
    errors,
    warnings,
  };
}
