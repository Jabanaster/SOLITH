import type { SolithDefinitionV1 } from './schema.v1.js';
import { definitionExportFilename, discoveryResultToDefinition, type DiscoveryExportContext } from './discovery-export.js';
import { memoryContextToDefinition, type MemoryExportContext } from './memory-export.js';
import { serializeDefinitionToYaml } from './export-yaml.v1.js';

export interface DefinitionYamlBundle {
  filename: string;
  yaml: string;
  definition: SolithDefinitionV1;
}

export function exportDiscoveryCandidateToYaml(context: DiscoveryExportContext): DefinitionYamlBundle {
  const definition = discoveryResultToDefinition(context);
  const yaml = serializeDefinitionToYaml(definition, {
    headerLines: [
      `# Exported from Discovery Lab for game: ${context.gameName}`,
      `# Save path: ${context.saveFilePath}`,
    ],
    discoveryEvidence:
      context.candidate.evidence ??
      context.candidate.explanation ??
      `confidence=${context.candidate.confidence}%`,
  });
  return {
    filename: definitionExportFilename(definition),
    yaml,
    definition,
  };
}

export function exportMemoryFeatureToYaml(context: MemoryExportContext): DefinitionYamlBundle {
  const definition = memoryContextToDefinition(context);
  const yaml = serializeDefinitionToYaml(definition, {
    headerLines: [
      `# Exported from Live Memory Trainer for: ${context.executableName}`,
      `# Feature: ${context.featureName}`,
    ],
    sessionAddressNote: context.sessionAddress,
  });
  return {
    filename: definitionExportFilename(definition),
    yaml,
    definition,
  };
}
