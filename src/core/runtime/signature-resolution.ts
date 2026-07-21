import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { CompiledCtRegistry } from '../registry/load-registry.js';
import { loadRegistry } from '../registry/load-registry.js';
import type { RuntimeProcessSummary } from './process-discovery.js';
import { assertExplicitProcessSelection } from './process-discovery.js';
import {
  validateRegistrySignaturesReadOnly,
  type RuntimeSignatureValidationArtifact,
  type SignatureValidationStatus,
} from './signature-validation.js';
import {
  openWindowsReadOnlyProcessSession,
  type WindowsReadOnlyProcessSession,
} from './windows-readonly-process-module-reader.js';

export interface SignatureResolutionSummary {
  total: number;
  byStatus: Record<SignatureValidationStatus, number>;
}

export interface SignatureResolutionArtifact extends RuntimeSignatureValidationArtifact {
  generatedAt: string;
  readOnly: true;
  executable: false;
  summary: SignatureResolutionSummary;
}

export interface ResolveRegistrySignaturesInput {
  registry: CompiledCtRegistry;
  sessionId: string;
  process: RuntimeProcessSummary;
  openSession?: (process: RuntimeProcessSummary) => WindowsReadOnlyProcessSession;
  generatedAt?: string;
}

export interface ResolveRegistrySignaturesFromFileInput {
  registryPath: string;
  process: RuntimeProcessSummary;
  sessionId?: string;
  outputPath?: string;
  openSession?: (process: RuntimeProcessSummary) => WindowsReadOnlyProcessSession;
  generatedAt?: string;
}

function createEmptyStatusCounts(): Record<SignatureValidationStatus, number> {
  return {
    not_tested: 0,
    no_match: 0,
    unique_match: 0,
    multiple_matches: 0,
    read_failure: 0,
    module_missing: 0,
  };
}

export function summarizeSignatureResolution(
  artifact: RuntimeSignatureValidationArtifact,
): SignatureResolutionSummary {
  const byStatus = createEmptyStatusCounts();
  for (const result of artifact.signatureResults) {
    byStatus[result.status] += 1;
  }
  return {
    total: artifact.signatureResults.length,
    byStatus,
  };
}

export async function resolveRegistrySignaturesReadOnly(
  input: ResolveRegistrySignaturesInput,
): Promise<SignatureResolutionArtifact> {
  assertExplicitProcessSelection(input.process);
  const openSession = input.openSession ?? openWindowsReadOnlyProcessSession;
  const session = openSession(input.process);
  try {
    const baseArtifact = await validateRegistrySignaturesReadOnly({
      registry: input.registry,
      sessionId: input.sessionId,
      process: session.process,
      modules: session.getModules(),
      reader: session,
    });
    return {
      ...baseArtifact,
      generatedAt: input.generatedAt ?? new Date().toISOString(),
      readOnly: true,
      executable: false,
      summary: summarizeSignatureResolution(baseArtifact),
    };
  } finally {
    session.close();
  }
}

export async function resolveRegistrySignaturesFromFileReadOnly(
  input: ResolveRegistrySignaturesFromFileInput,
): Promise<SignatureResolutionArtifact> {
  const registry = await loadRegistry(input.registryPath);
  const artifact = await resolveRegistrySignaturesReadOnly({
    registry,
    sessionId: input.sessionId ?? `sigres-${Date.now()}`,
    process: input.process,
    openSession: input.openSession,
    generatedAt: input.generatedAt,
  });

  if (input.outputPath) {
    await fs.mkdir(path.dirname(input.outputPath), { recursive: true });
    await fs.writeFile(input.outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  }

  return artifact;
}
