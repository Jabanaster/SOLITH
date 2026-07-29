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
import { isTrainerCapabilityEnabled } from '../src/core/settings/unlock-trainer-capabilities.js';
import { RegistryRunVerificationSchema, RegistrySelectProcessSchema } from './ipc-validation.js';
import { compareProcessIdentity, isCompleteProcessIdentity, queryWindowsProcessIdentity } from '../src/core/live-memory/windows-process-identity.js';
import {
  createProcessSelection,
  resolveProcessSelection,
  clearSelectionsForWindow,
} from '../src/core/security/process-selection-registry.js';
import { validateIpcSender } from './sender-validation.js';
import { wireSessionCleanupOnDestroy } from '../src/core/live-memory/session-cleanup.js';

const moduleFilename = fileURLToPath(import.meta.url);
const moduleDirectory = path.dirname(moduleFilename);

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
    const worker = new Worker(workerPath(), { type: 'module' } as unknown as import('node:worker_threads').WorkerOptions);
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
  // Batch B1.1: the renderer requests a selection here; the main process
  // independently re-verifies the claimed pid really IS the claimed
  // executable against the live OS (queryWindowsProcessIdentity) before
  // ever creating a selection record. registry-run-readonly-verification
  // below then references the selection by id — it can no longer accept a
  // renderer-supplied pid/executableName directly.
  ipcMain.handle('registry-select-process', async (event, payload: unknown) => {
    try {
      const senderCheck = validateIpcSender(event, ['main']);
      if (!senderCheck.ok) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
      if (!isTrainerCapabilityEnabled('v2LiveModeEnabled')) {
        return { success: false, error: 'feature_disabled' };
      }
      const parsed = RegistrySelectProcessSchema.parse(payload);

      const liveIdentity = queryWindowsProcessIdentity(parsed.pid);
      if (!liveIdentity || !isCompleteProcessIdentity(liveIdentity)) {
        return { success: false, error: 'Process not found or identity incomplete — cannot select.' };
      }
      if (liveIdentity.executableName.toLowerCase() !== parsed.executableName.toLowerCase()) {
        return {
          success: false,
          error: `Selected PID ${parsed.pid} is ${liveIdentity.executableName}, not ${parsed.executableName} — refusing to select.`,
        };
      }

      const selection = createProcessSelection({
        pid: parsed.pid,
        executableName: liveIdentity.executableName,
        executablePath: liveIdentity.executablePath,
        processStartTime: liveIdentity.startTimeIso,
        volumeSerialNumber: liveIdentity.volumeSerialNumber ?? undefined,
        fileIndex: liveIdentity.fileIndex ?? undefined,
        exeSha256: liveIdentity.exeSha256 ?? undefined,
        windowId: event.sender.id,
      });
      wireSessionCleanupOnDestroy(event.sender, () => clearSelectionsForWindow(event.sender.id));

      return {
        success: true,
        selectionId: selection.selectionId,
        expiresAt: new Date(selection.expiresAtMs).toISOString(),
      };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  ipcMain.handle('registry-run-readonly-verification', async (event, payload: unknown) => {
    try {
      const senderCheck = validateIpcSender(event, ['main']);
      if (!senderCheck.ok) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
      // This opens the selected PID and reads its process memory — the same
      // privileged category of operation live-memory-* gates behind
      // v2LiveModeEnabled. It must not be reachable just because a renderer can
      // reach IPC at all.
      if (!isTrainerCapabilityEnabled('v2LiveModeEnabled')) {
        return { success: false, error: 'feature_disabled' };
      }

      const parsed = RegistryRunVerificationSchema.parse(payload);

      const resolved = resolveProcessSelection(parsed.selectionId, event.sender.id);
      if (resolved.ok === false) {
        return { success: false, error: `selection_rejected:${resolved.reason}` };
      }
      const { pid, executableName, executablePath } = resolved.selection;
      const identityError = compareProcessIdentity({
        pid,
        executableName,
        executablePath,
        startTime: resolved.selection.processStartTime ?? '',
        volumeSerialNumber: resolved.selection.volumeSerialNumber,
        fileIndex: resolved.selection.fileIndex,
        exeSha256: resolved.selection.exeSha256,
      }, queryWindowsProcessIdentity(pid));
      if (identityError) return { success: false, error: 'selection_rejected:identity_mismatch' };

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
          pid,
          executableName,
          executablePath,
          // selectedByUser is now backed by a main-process-verified selection record,
          // not a renderer-supplied boolean — see process-selection-registry.ts.
          // The worker no longer relies on this flag for authorization.
          selectedByUser: false,
          platform: process.platform,
        },
      }, parsed.timeoutMs);

      if (response.ok === false) {
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
