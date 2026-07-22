import { app, ipcMain } from 'electron';
import { Worker } from 'node:worker_threads';
import crypto from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  HEADLESS_VERIFICATION_PROTOCOL_VERSION,
  type HeadlessVerificationArtifact,
  type HeadlessVerificationResponse,
} from '../src/core/runtime/headless-verification.js';
import { evaluateSessionStability } from '../src/core/runtime/delta-engine.js';
import { compareRestartSignatureArtifacts } from '../src/core/runtime/restart-validation.js';
import { validateLoadedRegistry } from '../src/core/registry/loaded-registry.js';

const moduleFilename = fileURLToPath(import.meta.url);
const moduleDirectory = path.dirname(moduleFilename);

const RunVerificationSchema = z.object({
  registry: z.unknown(),
  pid: z.number().int().positive(),
  executableName: z.string().min(1).max(260),
  executablePath: z.string().min(1).max(2000).optional(),
  timeoutMs: z.number().int().min(1_000).max(120_000).optional().default(30_000),
}).strict();

const CompareRestartSchema = z.object({
  previous: z.unknown(),
  current: z.unknown(),
}).strict();

function sanitize(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function artifactDirectory(): string {
  return path.join(app.getPath('userData'), 'runtime-verification');
}

function workerPath(): string {
  const bundledPath = path.join(moduleDirectory, 'headless-verification-worker.js');
  const unpackedPath = bundledPath.replace(
    `${path.sep}app.asar${path.sep}`,
    `${path.sep}app.asar.unpacked${path.sep}`,
  );
  return existsSync(unpackedPath) ? unpackedPath : bundledPath;
}

function safeTimestamp(value: string): string {
  return value.replace(/[:.]/g, '-');
}

async function writeVerificationArtifact(artifact: HeadlessVerificationArtifact): Promise<string> {
  const dir = artifactDirectory();
  await fs.mkdir(dir, { recursive: true });
  const shortHash = artifact.registrySource.sha256.slice(0, 12);
  const filename = `${safeTimestamp(artifact.generatedAt)}-${artifact.process.executableName}-${shortHash}.json`
    .replace(/[^a-z0-9_.-]/gi, '_');
  const targetPath = path.join(dir, filename);
  await fs.writeFile(targetPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return targetPath;
}

function runWorker(message: unknown, timeoutMs: number): Promise<HeadlessVerificationResponse> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath(), { type: 'module' });
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error(`Registry verification worker timed out after ${timeoutMs}ms.`));
    }, timeoutMs + 1_000);

    worker.once('message', (response: HeadlessVerificationResponse) => {
      clearTimeout(timer);
      void worker.terminate();
      resolve(response);
    });

    worker.once('error', (error) => {
      clearTimeout(timer);
      void worker.terminate();
      reject(error);
    });

    worker.once('exit', (code) => {
      if (code !== 0) {
        clearTimeout(timer);
        reject(new Error(`Registry verification worker exited with code ${code}.`));
      }
    });

    worker.postMessage(message);
  });
}

function isHeadlessArtifact(value: unknown): value is HeadlessVerificationArtifact {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { readOnly?: unknown }).readOnly === true &&
    (value as { executable?: unknown }).executable === false &&
    typeof (value as { requestId?: unknown }).requestId === 'string' &&
    typeof (value as { aobResolution?: unknown }).aobResolution === 'object'
  );
}

export function registerRegistryVerificationIpc(): void {
  ipcMain.handle('registry-run-readonly-verification', async (_event, payload: unknown) => {
    try {
      const parsed = RunVerificationSchema.parse(payload);
      const registry = validateLoadedRegistry(parsed.registry);
      const generatedAt = new Date().toISOString();
      const requestId = crypto.randomUUID();
      const response = await runWorker({
        protocolVersion: HEADLESS_VERIFICATION_PROTOCOL_VERSION,
        requestId,
        type: 'VERIFY_REGISTRY_READONLY',
        registry,
        sessionId: `registry-readonly-${Date.now()}`,
        generatedAt,
        timeoutMs: parsed.timeoutMs,
        process: {
          pid: parsed.pid,
          executableName: parsed.executableName,
          executablePath: parsed.executablePath,
          selectedByUser: true,
          platform: process.platform,
        },
      }, parsed.timeoutMs);

      if (!response.ok) {
        return { success: false, error: response.error.message };
      }

      const artifactPath = await writeVerificationArtifact(response.artifact);
      return {
        success: true,
        artifact: response.artifact,
        artifactPath,
      };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  ipcMain.handle('registry-compare-restart-artifacts', async (_event, payload: unknown) => {
    try {
      const parsed = CompareRestartSchema.parse(payload);
      if (!isHeadlessArtifact(parsed.previous) || !isHeadlessArtifact(parsed.current)) {
        return { success: false, error: 'Restart comparison requires two headless read-only verification artifacts.' };
      }

      const comparison = compareRestartSignatureArtifacts({
        previous: parsed.previous.aobResolution,
        current: parsed.current.aobResolution,
      });
      const pointerStability = evaluateSessionStability({
        baseline: parsed.previous,
        current: parsed.current,
      });
      return { success: true, comparison, pointerStability };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });
}
