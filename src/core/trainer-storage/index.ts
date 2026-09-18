export type { TrainerStorageFailureReason, TrainerStorageError } from './errors.js';
export { storageError } from './errors.js';
export type {
  StorageResult,
  TrainerDefinitionSourceType,
  ConflictingTrainerSource,
  TrainerDefinitionProvenance,
  CanonicalTrainerRecord,
  TrainerDefinitionListResult,
  SaveTrainerDefinitionInput,
} from './types.js';
export { ok, fail } from './types.js';
export { sourcePriorityRank, sourceTypeForProvider, pickPreferredRow, type PickedRow } from './source-priority.js';
export {
  getCanonicalTrainerDefinition,
  listCanonicalTrainerDefinitions,
  persistTrainerDefinition,
  removeCanonicalTrainerDefinition,
} from './repository.js';
