import type { CompiledCtRegistry } from '../registry/load-registry.js';
import type { RuntimeModuleInfo } from './module-inspection.js';
import { findModule } from './module-inspection.js';
import type { ReadOnlyMemoryReader } from './memory-reader.js';
import { scanModuleForSignature } from './signature-scanner.js';
import type { RuntimeProcessSummary } from './process-discovery.js';

export type SignatureValidationStatus =
  | 'not_tested'
  | 'no_match'
  | 'unique_match'
  | 'multiple_matches'
  | 'read_failure'
  | 'module_missing';

export interface SignatureValidationResult {
  signatureId: string;
  symbol: string;
  module: string | null;
  status: SignatureValidationStatus;
  matchCount: number;
  matches: Array<{ offset: number; address: string }>;
  error?: string;
}

export interface RuntimeSignatureValidationArtifact {
  registryId: string;
  sessionId: string;
  process: RuntimeProcessSummary;
  moduleHashes: Record<string, string | undefined>;
  signatureResults: SignatureValidationResult[];
}

function statusForCount(count: number): SignatureValidationStatus {
  if (count === 0) return 'no_match';
  if (count === 1) return 'unique_match';
  return 'multiple_matches';
}

export async function validateRegistrySignaturesReadOnly(input: {
  registry: CompiledCtRegistry;
  sessionId: string;
  process: RuntimeProcessSummary;
  modules: RuntimeModuleInfo[];
  reader: ReadOnlyMemoryReader;
}): Promise<RuntimeSignatureValidationArtifact> {
  const signatureResults: SignatureValidationResult[] = [];
  const moduleHashes = Object.fromEntries(input.modules.map((module) => [module.name, module.sha256]));

  for (const signature of input.registry.aobSignatures) {
    if (!signature.module) {
      signatureResults.push({
        signatureId: signature.id,
        symbol: signature.symbol,
        module: null,
        status: 'not_tested',
        matchCount: 0,
        matches: [],
        error: 'Module-less signatures require an explicit scan region.',
      });
      continue;
    }

    const module = findModule(input.modules, signature.module);
    if (!module) {
      signatureResults.push({
        signatureId: signature.id,
        symbol: signature.symbol,
        module: signature.module,
        status: 'module_missing',
        matchCount: 0,
        matches: [],
      });
      continue;
    }

    try {
      const scan = await scanModuleForSignature({
        module,
        pattern: signature.normalizedPattern,
        reader: input.reader,
      });
      signatureResults.push({
        signatureId: signature.id,
        symbol: signature.symbol,
        module: signature.module,
        status: statusForCount(scan.matches.length),
        matchCount: scan.matches.length,
        matches: scan.matches,
      });
    } catch (error) {
      signatureResults.push({
        signatureId: signature.id,
        symbol: signature.symbol,
        module: signature.module,
        status: 'read_failure',
        matchCount: 0,
        matches: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    registryId: `${input.registry.game}:${input.registry.artifact.source.sha256}`,
    sessionId: input.sessionId,
    process: input.process,
    moduleHashes,
    signatureResults,
  };
}
