import type { MemoryFeatureV1, SaveFieldFeatureV1, SolithDefinitionV1 } from '../definitions/schema.v1.js';
import type { CertificationLevel } from '../definitions/schema.v1.js';

export type TrainerDeckRowKind = 'memory' | 'save';

export interface TrainerDeckRow {
  id: string;
  name: string;
  category: string;
  kind: TrainerDeckRowKind;
  certificationLevel: CertificationLevel;
  requiresApproval: boolean;
  requiresSession: boolean;
  detail: string;
  hotkeyHint?: string;
}

const HOTKEY_SLOTS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'];

export function buildTrainerDeckRows(definition: SolithDefinitionV1): TrainerDeckRow[] {
  const rows: TrainerDeckRow[] = [];
  const requiresApproval = definition.safety.requiresApproval;

  const memory = definition.memoryFeatures ?? [];
  memory.forEach((feature, index) => {
    rows.push(memoryFeatureToDeckRow(feature, requiresApproval, index));
  });

  const saveFields = definition.saveEditor?.saveFields ?? [];
  for (const field of saveFields) {
    rows.push(saveFieldToDeckRow(field, definition, requiresApproval));
  }

  return rows;
}

function memoryFeatureToDeckRow(
  feature: MemoryFeatureV1,
  requiresApproval: boolean,
  index: number,
): TrainerDeckRow {
  const resolution = feature.resolution;
  const hasPath =
    Boolean(resolution.moduleName) &&
    (Boolean(resolution.baseOffset) ||
      Boolean(resolution.signature) ||
      (resolution.pointerChain?.length ?? 0) > 0);

  return {
    id: feature.id,
    name: feature.name,
    category: feature.category,
    kind: 'memory',
    certificationLevel: feature.certificationLevel ?? 'L0',
    requiresApproval,
    requiresSession: true,
    hotkeyHint: index < HOTKEY_SLOTS.length ? HOTKEY_SLOTS[index] : undefined,
    detail: hasPath
      ? `${feature.type} · ${feature.dataType} · live session required`
      : `${feature.type} · resolution incomplete — scan required`,
  };
}

function saveFieldToDeckRow(
  field: SaveFieldFeatureV1,
  definition: SolithDefinitionV1,
  requiresApproval: boolean,
): TrainerDeckRow {
  const path =
    field.mapping.searchKey?.trim() ||
    field.mapping.query?.trim() ||
    field.mapping.hexOffset?.trim() ||
    '—';
  const routable = Boolean(field.mapping.searchKey?.trim() || field.mapping.query?.trim());

  return {
    id: field.id,
    name: field.name,
    category: field.category,
    kind: 'save',
    certificationLevel: definition.certificationLevel ?? 'L1',
    requiresApproval,
    requiresSession: false,
    detail: routable
      ? `save_field · ${definition.saveEditor?.format ?? 'save'} · ${path}`
      : `hex/binary field — not routed to TrainerHost`,
  };
}

export const RESTART_VERIFY_CHECKLIST = [
  'Attach to running game (solo/offline session)',
  'Resolve pointer path / AOB — read matches on-screen',
  'Kill game completely, relaunch (new PID / ASLR)',
  'Resolve again without full scan',
  'Safe write + in-game verify + rollback from backup',
  'Record executable hash prefix in schema.v1',
  'Set feature.certificationLevel to L3+ only after live evidence',
] as const;

export const REPAIR_PIPELINE_STEPS = [
  'Detect stale status (executable hash drift or quarantine)',
  'Run offline L1 certify (schema + resolution + backup path)',
  'Live: verify-pointer-path restart ritual (Milestone S)',
  'Update definition executableHashPrefixes after patch',
  'Promote certificationLevel when evidence is recorded',
] as const;
