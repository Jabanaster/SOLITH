import type {
  CtCompilerPipelineEntry,
  CtCompilerPipelineRegistry,
  SolithUnifiedCtRegistry,
} from '../registry/compile-ct-registry.js';
import type { RuntimeModuleInfo } from './module-inspection.js';
import { findModule } from './module-inspection.js';
import type { RuntimeProcessSummary } from './process-discovery.js';
import {
  resolveRegistrySignaturesReadOnly,
  type ResolveRegistrySignaturesInput,
  type SignatureResolutionArtifact,
} from './signature-resolution.js';
import {
  openWindowsReadOnlyProcessSession,
  type WindowsReadOnlyProcessSession,
} from './windows-readonly-process-module-reader.js';

export const HEADLESS_VERIFICATION_PROTOCOL_VERSION = '1.0.0' as const;

export type HeadlessVerificationRequestType = 'VERIFY_REGISTRY_READONLY';

export type HeadlessPointerStatus =
  | 'not_applicable'
  | 'schema_only'
  | 'module_missing'
  | 'invalid_offset'
  | 'root_in_module_range'
  | 'root_out_of_module_range';

export interface HeadlessVerificationRequest {
  protocolVersion: typeof HEADLESS_VERIFICATION_PROTOCOL_VERSION;
  requestId: string;
  type: HeadlessVerificationRequestType;
  registry: SolithUnifiedCtRegistry;
  process: RuntimeProcessSummary;
  sessionId: string;
  generatedAt?: string;
  timeoutMs?: number;
}

export interface HeadlessPointerVerificationResult {
  entryId: string;
  label: string;
  module: string;
  rawAddress: string;
  rootOffset?: string;
  pointerChainLength: number;
  status: HeadlessPointerStatus;
  reason: string;
}

export interface HeadlessVerificationArtifact {
  protocolVersion: typeof HEADLESS_VERIFICATION_PROTOCOL_VERSION;
  requestId: string;
  generatedAt: string;
  readOnly: true;
  executable: false;
  registrySource: {
    game: string;
    sourceFile: string;
    sha256: string;
    pipelineSchemaVersion?: string;
  };
  process: RuntimeProcessSummary;
  aobResolution: SignatureResolutionArtifact;
  pointerResults: HeadlessPointerVerificationResult[];
  summary: {
    aobSignatures: SignatureResolutionArtifact['summary'];
    pointers: Record<HeadlessPointerStatus, number>;
  };
}

export type HeadlessVerificationResponse =
  | {
      protocolVersion: typeof HEADLESS_VERIFICATION_PROTOCOL_VERSION;
      requestId: string;
      type: 'VERIFY_REGISTRY_READONLY_RESULT';
      ok: true;
      artifact: HeadlessVerificationArtifact;
    }
  | {
      protocolVersion: typeof HEADLESS_VERIFICATION_PROTOCOL_VERSION;
      requestId: string;
      type: 'VERIFY_REGISTRY_READONLY_RESULT';
      ok: false;
      error: {
        code: 'invalid_request' | 'verification_failed' | 'timeout';
        message: string;
      };
    };

export interface HeadlessVerificationDependencies {
  openSession?: ResolveRegistrySignaturesInput['openSession'];
  now?: () => string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function assertHeadlessVerificationRequest(value: unknown): asserts value is HeadlessVerificationRequest {
  if (!isRecord(value)) throw new Error('Headless verification request must be an object.');
  if (value.protocolVersion !== HEADLESS_VERIFICATION_PROTOCOL_VERSION) {
    throw new Error(`Unsupported headless verification protocol: ${String(value.protocolVersion ?? 'missing')}`);
  }
  if (value.type !== 'VERIFY_REGISTRY_READONLY') {
    throw new Error(`Unsupported headless verification request type: ${String(value.type ?? 'missing')}`);
  }
  if (typeof value.requestId !== 'string' || value.requestId.length === 0) {
    throw new Error('Headless verification request requires requestId.');
  }
  if (typeof value.sessionId !== 'string' || value.sessionId.length === 0) {
    throw new Error('Headless verification request requires sessionId.');
  }
  if (!isRecord(value.registry)) throw new Error('Headless verification request requires registry.');
  if (!isRecord(value.process)) throw new Error('Headless verification request requires process.');
  if (typeof value.process.pid !== 'number' || !Number.isInteger(value.process.pid) || value.process.pid <= 0) {
    throw new Error('Headless verification request requires an explicit positive PID.');
  }
  if (value.process.selectedByUser !== true) {
    throw new Error('Headless verification request requires an explicitly selected process.');
  }
}

function parseRootOffset(entry: CtCompilerPipelineEntry): bigint | null {
  const candidate = entry.address_data.root_offset ?? entry.address_data.raw_address;
  if (!/^[-+]?0x[0-9a-f]+$/i.test(candidate)) return null;
  try {
    return BigInt(candidate);
  } catch {
    return null;
  }
}

function pointerStatusCounts(): Record<HeadlessPointerStatus, number> {
  return {
    not_applicable: 0,
    schema_only: 0,
    module_missing: 0,
    invalid_offset: 0,
    root_in_module_range: 0,
    root_out_of_module_range: 0,
  };
}

export function verifyPipelinePointersReadOnly(
  pipeline: CtCompilerPipelineRegistry | undefined,
  modules: RuntimeModuleInfo[],
): HeadlessPointerVerificationResult[] {
  if (!pipeline || pipeline.entries.length === 0) return [];

  return pipeline.entries.map((entry) => {
    const module = findModule(modules, entry.address_data.base);
    if (!module) {
      return {
        entryId: entry.ct_entry_id,
        label: entry.label,
        module: entry.address_data.base,
        rawAddress: entry.address_data.raw_address,
        rootOffset: entry.address_data.root_offset,
        pointerChainLength: entry.address_data.pointer_chain.length,
        status: 'module_missing',
        reason: `Module ${entry.address_data.base} was not loaded in the selected process.`,
      };
    }

    const rootOffset = parseRootOffset(entry);
    if (rootOffset === null || rootOffset < 0n || rootOffset > BigInt(Number.MAX_SAFE_INTEGER)) {
      return {
        entryId: entry.ct_entry_id,
        label: entry.label,
        module: entry.address_data.base,
        rawAddress: entry.address_data.raw_address,
        rootOffset: entry.address_data.root_offset,
        pointerChainLength: entry.address_data.pointer_chain.length,
        status: 'invalid_offset',
        reason: `Root offset ${entry.address_data.root_offset ?? entry.address_data.raw_address} is not valid bounded hex.`,
      };
    }

    const rootOffsetNumber = Number(rootOffset);
    const insideModule = rootOffsetNumber >= 0 && rootOffsetNumber < module.size;
    return {
      entryId: entry.ct_entry_id,
      label: entry.label,
      module: entry.address_data.base,
      rawAddress: entry.address_data.raw_address,
      rootOffset: entry.address_data.root_offset,
      pointerChainLength: entry.address_data.pointer_chain.length,
      status: insideModule ? 'root_in_module_range' : 'root_out_of_module_range',
      reason: insideModule
        ? 'Pointer root offset is inside the verified module range. Pointer dereference remains disabled in this worker.'
        : 'Pointer root offset is outside the verified module range. Pointer dereference remains disabled in this worker.',
    };
  });
}

function summarizePointers(results: HeadlessPointerVerificationResult[]): Record<HeadlessPointerStatus, number> {
  const counts = pointerStatusCounts();
  for (const result of results) counts[result.status] += 1;
  return counts;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number | undefined): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Headless verification timed out after ${timeoutMs}ms.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runHeadlessVerificationJob(
  request: HeadlessVerificationRequest,
  dependencies: HeadlessVerificationDependencies = {},
): Promise<HeadlessVerificationArtifact> {
  assertHeadlessVerificationRequest(request);
  let capturedModules: RuntimeModuleInfo[] = [];
  const sessionFactory = dependencies.openSession ?? openWindowsReadOnlyProcessSession;
  const openSession = (process: RuntimeProcessSummary): WindowsReadOnlyProcessSession => {
    const session = sessionFactory(process);
    capturedModules = session.getModules();
    return session;
  };

  const aobResolution = await withTimeout(
    resolveRegistrySignaturesReadOnly({
      registry: request.registry,
      process: request.process,
      sessionId: request.sessionId,
      generatedAt: request.generatedAt,
      openSession,
    }),
    request.timeoutMs,
  );

  const pointerResults = verifyPipelinePointersReadOnly(request.registry.pipeline, capturedModules);
  const generatedAt = dependencies.now?.() ?? request.generatedAt ?? new Date().toISOString();

  return {
    protocolVersion: HEADLESS_VERIFICATION_PROTOCOL_VERSION,
    requestId: request.requestId,
    generatedAt,
    readOnly: true,
    executable: false,
    registrySource: {
      game: request.registry.game,
      sourceFile: request.registry.sourceFile,
      sha256: request.registry.artifact.source.sha256,
      pipelineSchemaVersion: request.registry.pipeline?.schema_version,
    },
    process: aobResolution.process,
    aobResolution,
    pointerResults,
    summary: {
      aobSignatures: aobResolution.summary,
      pointers: summarizePointers(pointerResults),
    },
  };
}

export async function handleHeadlessVerificationMessage(
  message: unknown,
  dependencies: HeadlessVerificationDependencies = {},
): Promise<HeadlessVerificationResponse> {
  try {
    assertHeadlessVerificationRequest(message);
    const artifact = await runHeadlessVerificationJob(message, dependencies);
    return {
      protocolVersion: HEADLESS_VERIFICATION_PROTOCOL_VERSION,
      requestId: message.requestId,
      type: 'VERIFY_REGISTRY_READONLY_RESULT',
      ok: true,
      artifact,
    };
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    return {
      protocolVersion: HEADLESS_VERIFICATION_PROTOCOL_VERSION,
      requestId: isRecord(message) && typeof message.requestId === 'string' ? message.requestId : 'unknown',
      type: 'VERIFY_REGISTRY_READONLY_RESULT',
      ok: false,
      error: {
        code: /timed out/i.test(messageText) ? 'timeout' : 'verification_failed',
        message: messageText,
      },
    };
  }
}
