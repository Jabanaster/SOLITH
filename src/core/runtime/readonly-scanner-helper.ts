import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CtCompilerPipelineEntry } from '../registry/compile-ct-registry.js';
import type { RuntimeProcessSummary } from './process-discovery.js';

export const READONLY_SCANNER_PROTOCOL_VERSION = '1.0.0' as const;
export const READONLY_SCANNER_EXECUTABLE = 'solith-readonly-scanner.exe' as const;

export type PointerL2Status =
  | 'module_missing'
  | 'invalid_offset'
  | 'root_out_of_module_range'
  | 'l2_resolved'
  | 'l2_unreadable'
  | 'l2_invalid_chain';

export interface PointerL2Hop {
  address: string;
  pointerValue: string;
  offset: string;
  nextAddress: string;
}

export interface PointerL2Result {
  entryId: string;
  label: string;
  module: string;
  rawAddress: string;
  rootOffset?: string;
  pointerChainLength: number;
  status: PointerL2Status;
  reason: string;
  finalAddress?: string;
  hops: PointerL2Hop[];
}

export interface ReadOnlyScannerModuleSummary {
  name: string;
  baseAddress: string;
  size: number;
}

export interface ReadOnlyScannerRequest {
  protocolVersion: typeof READONLY_SCANNER_PROTOCOL_VERSION;
  requestId: string;
  type: 'VALIDATE_POINTER_L2_READONLY';
  process: {
    pid: number;
    executableName: string;
    selectedByUser: true;
  };
  pointers: Array<{
    entryId: string;
    label: string;
    module: string;
    rawAddress: string;
    rootOffset?: string;
    pointerChain: string[];
  }>;
  maxReadBytes?: number;
}

export type ReadOnlyScannerResponse =
  | {
      protocolVersion: typeof READONLY_SCANNER_PROTOCOL_VERSION;
      requestId: string;
      type: 'POINTER_L2_RESULT';
      ok: true;
      process: {
        pid: number;
        executableName: string;
      };
      modules: ReadOnlyScannerModuleSummary[];
      pointerResults: PointerL2Result[];
    }
  | {
      protocolVersion: typeof READONLY_SCANNER_PROTOCOL_VERSION;
      requestId: string;
      type: 'POINTER_L2_RESULT';
      ok: false;
      error: {
        code: string;
        message: string;
      };
    };

export interface ReadOnlyScannerTransportOptions {
  scannerPath?: string;
  timeoutMs?: number;
  maxStdoutBytes?: number;
  spawnProcess?: typeof spawn;
}

const moduleFilename = fileURLToPath(import.meta.url);
const moduleDirectory = path.dirname(moduleFilename);

function asarUnpackedPath(candidate: string): string {
  return candidate.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
}

export function defaultReadOnlyScannerPath(): string {
  const bundledPath = path.join(moduleDirectory, READONLY_SCANNER_EXECUTABLE);
  const unpackedPath = asarUnpackedPath(bundledPath);
  const candidates = [
    unpackedPath,
    bundledPath,
    path.join(process.cwd(), 'dist-electron', READONLY_SCANNER_EXECUTABLE),
    path.join(
      process.cwd(),
      'native',
      'solith-readonly-scanner',
      'target',
      'release',
      READONLY_SCANNER_EXECUTABLE,
    ),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? bundledPath;
}

export function pipelineEntriesToScannerPointers(entries: CtCompilerPipelineEntry[]): ReadOnlyScannerRequest['pointers'] {
  return entries.map((entry) => ({
    entryId: entry.ct_entry_id,
    label: entry.label,
    module: entry.address_data.base,
    rawAddress: entry.address_data.raw_address,
    rootOffset: entry.address_data.root_offset,
    pointerChain: entry.address_data.pointer_chain,
  }));
}

function parseResponse(raw: string, requestId: string): ReadOnlyScannerResponse {
  const parsed = JSON.parse(raw) as Partial<ReadOnlyScannerResponse>;
  if (parsed.protocolVersion !== READONLY_SCANNER_PROTOCOL_VERSION || parsed.type !== 'POINTER_L2_RESULT') {
    throw new Error('Read-only scanner returned an unsupported protocol response.');
  }
  if (parsed.requestId !== requestId && parsed.requestId !== 'unknown') {
    throw new Error(`Read-only scanner response requestId mismatch: ${String(parsed.requestId)}`);
  }
  return parsed as ReadOnlyScannerResponse;
}

function writeAndClose(child: ChildProcessWithoutNullStreams, payload: string): void {
  child.stdin.end(payload);
}

export function runReadOnlyScannerPointerL2(
  request: ReadOnlyScannerRequest,
  options: ReadOnlyScannerTransportOptions = {},
): Promise<ReadOnlyScannerResponse> {
  const scannerPath = options.scannerPath ?? defaultReadOnlyScannerPath();
  const spawnProcess = options.spawnProcess ?? spawn;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxStdoutBytes = options.maxStdoutBytes ?? 2 * 1024 * 1024;

  return new Promise((resolve, reject) => {
    const child = spawnProcess(scannerPath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let settled = false;
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`Read-only scanner timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (stdout.length > maxStdoutBytes) {
        finish(() => {
          child.kill();
          reject(new Error('Read-only scanner output exceeded the configured limit.'));
        });
      }
    });

    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.once('error', (error) => {
      finish(() => reject(error));
    });

    child.once('close', (code) => {
      finish(() => {
        if (code !== 0 && stdout.trim().length === 0) {
          reject(new Error(`Read-only scanner exited with code ${code}: ${stderr.trim()}`));
          return;
        }
        try {
          resolve(parseResponse(stdout.trim(), request.requestId));
        } catch (error) {
          reject(error);
        }
      });
    });

    writeAndClose(child, `${JSON.stringify(request)}\n`);
  });
}

export async function validatePointerL2WithScanner(input: {
  requestId: string;
  process: RuntimeProcessSummary;
  entries: CtCompilerPipelineEntry[];
  timeoutMs?: number;
  scannerPath?: string;
}): Promise<ReadOnlyScannerResponse> {
  if (input.process.selectedByUser !== true) {
    throw new Error('Read-only scanner requires an explicitly selected process.');
  }
  return runReadOnlyScannerPointerL2({
    protocolVersion: READONLY_SCANNER_PROTOCOL_VERSION,
    requestId: input.requestId,
    type: 'VALIDATE_POINTER_L2_READONLY',
    process: {
      pid: input.process.pid,
      executableName: input.process.executableName,
      selectedByUser: true,
    },
    pointers: pipelineEntriesToScannerPointers(input.entries),
  }, {
    scannerPath: input.scannerPath,
    timeoutMs: input.timeoutMs,
  });
}
