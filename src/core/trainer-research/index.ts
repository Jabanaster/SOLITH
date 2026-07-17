/**
 * Browser-safe trainer-research surface.
 *
 * Do NOT re-export pe-analyzer here — it uses node:crypto / node:fs / node:path
 * and would crash the Vite renderer when ExternalTrainerResearchLab imports this
 * barrel. Electron main imports pe-analyzer directly via trainer-research-ipc.
 */
export * from './types.js';
export * from './ct-export.js';
export * from './schema-draft.js';

import { exportCandidatesToCheatTableXml } from './ct-export.js';
import {
  buildSchemaDraftFromCandidates,
  buildYamlDraftFromSchema,
} from './schema-draft.js';
import type { MemoryDiffCandidate, TrainerResearchExportBundle } from './types.js';

export function buildTrainerResearchExportBundle(input: {
  title: string;
  gameExecutable: string;
  trainerExePath?: string;
  trainerSha256?: string;
  candidates: MemoryDiffCandidate[];
}): TrainerResearchExportBundle {
  const ctXml = exportCandidatesToCheatTableXml(input.title, input.candidates, {
    gameExecutable: input.gameExecutable,
  });
  const schema = buildSchemaDraftFromCandidates(input);
  const schemaJson = `${JSON.stringify(schema, null, 2)}\n`;
  const yamlDraft = buildYamlDraftFromSchema(schema);

  return {
    ctXml,
    schemaJson,
    yamlDraft,
    title: input.title,
    candidateCount: input.candidates.length,
  };
}
