import type { TrainerControl, ControlSafetyStatus, ControlType } from '../trainer-host/trainer-control-schema.js';
import type { SaveFieldFeatureV1, SolithDefinitionV1 } from './schema.v1.js';

/** Resolved at runtime when the user picks a concrete save file in the catalog controls UI. */
export const CATALOG_SAVE_FILE_PLACEHOLDER = '{CATALOG_SAVE_FILE}';

function inferControlType(dataType: string): ControlType {
  const lower = dataType.toLowerCase();
  if (lower === 'boolean' || lower === 'bool') return 'toggle';
  return 'number_input';
}

function safetyStatusForDefinition(definition: SolithDefinitionV1): ControlSafetyStatus {
  return definition.safety.requiresApproval ? 'requires_approval' : 'supported';
}

function fieldPathForSaveField(field: SaveFieldFeatureV1): string | null {
  if (field.mapping.searchKey?.trim()) return field.mapping.searchKey.trim();
  if (field.mapping.query?.trim()) return field.mapping.query.trim();
  return null;
}

/**
 * Map one schema.v1 save field to a TrainerHost save_field control.
 * Returns null when the field cannot be routed to TrainerHost (e.g. hex-only binary edits).
 */
export function saveFieldToTrainerControl(
  field: SaveFieldFeatureV1,
  definition: SolithDefinitionV1,
): TrainerControl | null {
  if (!definition.saveEditor) return null;

  const fieldPath = fieldPathForSaveField(field);
  if (!fieldPath) return null;

  const controlType = inferControlType(field.dataType);
  const control: TrainerControl = {
    id: field.id,
    label: field.name,
    description: `Save field (${definition.saveEditor.format}): ${fieldPath}`,
    category: field.category,
    controlType,
    backend: 'save_field',
    safetyStatus: safetyStatusForDefinition(definition),
    saveField: {
      filePath: CATALOG_SAVE_FILE_PLACEHOLDER,
      fieldPath,
      gameId: definition.id,
    },
  };

  if (controlType === 'number_input') {
    control.min = 0;
  }

  return control;
}

/** Convert schema.v1 saveEditor fields into executable TrainerControl rows. */
export function solithDefinitionToTrainerControls(definition: SolithDefinitionV1): TrainerControl[] {
  const fields = definition.saveEditor?.saveFields ?? [];
  return fields
    .map((field) => saveFieldToTrainerControl(field, definition))
    .filter((control): control is TrainerControl => control !== null);
}

export function resolveCatalogControlFilePath(control: TrainerControl, saveFilePath: string): TrainerControl {
  if (!control.saveField || control.saveField.filePath !== CATALOG_SAVE_FILE_PLACEHOLDER) {
    return control;
  }
  return {
    ...control,
    saveField: {
      ...control.saveField,
      filePath: saveFilePath,
    },
  };
}
