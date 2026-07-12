import type { SolithDefinitionV1 } from './schema.v1.js';
import { definitionExportFilename } from './discovery-export.js';
import { serializeDefinitionToYaml } from './export-yaml.v1.js';
import { getDefinitionPayload } from '../trainer-catalog/store.js';
import type { DefinitionYamlBundle } from './export-definition.js';

/** Export a catalog-stored schema.v1 definition as a shareable YAML community pack. */
export function exportCatalogDefinitionToYaml(catalogGameId: string): DefinitionYamlBundle | null {
  const definition = getDefinitionPayload(catalogGameId);
  if (!definition) return null;

  const yaml = serializeDefinitionToYaml(definition, {
    headerLines: [
      `# Community pack export — game: ${definition.title}`,
      `# Catalog id: ${catalogGameId}`,
      `# Verification: ${definition.safety.verificationStatus}`,
      `# Re-import via Trainer Library → Import YAML`,
    ],
  });

  return {
    filename: definitionExportFilename(definition),
    yaml,
    definition,
  };
}

export function exportDefinitionObjectToYaml(
  definition: SolithDefinitionV1,
  headerLines: string[] = [],
): DefinitionYamlBundle {
  const yaml = serializeDefinitionToYaml(definition, { headerLines });
  return {
    filename: definitionExportFilename(definition),
    yaml,
    definition,
  };
}
