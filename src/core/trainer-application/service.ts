import {
  getCanonicalTrainerDefinition,
  listCanonicalTrainerDefinitions,
  persistTrainerDefinition,
  removeCanonicalTrainerDefinition,
  type CanonicalTrainerRecord,
  type SaveTrainerDefinitionInput,
  type StorageResult,
  type TrainerDefinitionListResult,
} from '../trainer-storage/index.js';

/**
 * Narrow application-service boundary between trainer-facing IPC and the
 * canonical Phase 4 stack (P4-9). IPC handlers should call through here for
 * definition reads/writes instead of instantiating or orchestrating
 * persistence internals themselves (mission §7) — this module owns no
 * storage logic of its own, it only forwards to src/core/trainer-storage
 * (P4-8), which is the single place migration-on-read, source-priority
 * conflict resolution, and transactional write/verify actually live.
 *
 * Runtime-execution methods (activateFeature/rollback/executeComposite) are
 * deliberately NOT included in this stage. Wiring live single-action
 * write/freeze/rollback execution through TrainerRuntime requires reusing
 * the SAME already-attached LiveMemorySession a game session is bound to
 * (electron/live-memory-ipc.ts's per-sender session bundle) rather than
 * calling TrainerRuntime.bind(), which performs its own attach() — cutting
 * that over safely needs dedicated session-reuse design and real-process
 * regression coverage beyond what this stage can certify. See
 * Docs/phase4/005-p4-9-canonical-ui-ipc-convergence.md, "Runtime IPC".
 */
export const trainerApplicationService = {
  getTrainer(catalogGameId: string): StorageResult<CanonicalTrainerRecord> {
    return getCanonicalTrainerDefinition(catalogGameId);
  },

  listTrainers(): StorageResult<TrainerDefinitionListResult> {
    return listCanonicalTrainerDefinitions();
  },

  saveTrainer(rawInput: unknown, input: SaveTrainerDefinitionInput): StorageResult<CanonicalTrainerRecord> {
    return persistTrainerDefinition(rawInput, input);
  },

  removeTrainer(catalogGameId: string): StorageResult<void> {
    return removeCanonicalTrainerDefinition(catalogGameId);
  },
};

export type TrainerApplicationService = typeof trainerApplicationService;
