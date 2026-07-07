import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import {
  LiveMemoryListProcessesSchema,
  LiveMemoryAttachSchema,
  LiveMemoryDetachSchema,
  LiveMemoryReadSchema,
  LiveMemoryProposeWriteSchema,
  LiveMemoryConfirmWriteSchema,
  LiveMemoryRollbackSchema,
  LiveMemoryScanFirstSchema,
  LiveMemoryScanNextSchema,
  LiveMemoryFreezeStartSchema,
  LiveMemoryFreezeStopSchema,
  LiveMemoryFreezeStatusSchema,
  LiveMemoryListControlsSchema,
  LiveMemoryResolveControlSchema,
} from './ipc-validation.js';
import { LiveMemorySession, nativeMemoryDriver, listLiveMemoryProcesses, listControlsForGame, getControl } from '../src/core/live-memory/index.js';
import type { ScanMatch } from '../src/core/live-memory/types.js';

// Importing LiveMemorySession/nativeMemoryDriver here does NOT load the
// memoryjs native addon — nativeMemoryDriver lazily requires it only inside
// openProcess/readMemory/writeMemory/closeProcess, the first time one is
// actually called.

/**
 * Live Memory Trainer IPC — feature-flagged (`v2LiveModeEnabled`, off by
 * default), single-player/offline only (PROJECT_SPEC.md Section 3.1).
 *
 * Ownership model mirrors the V2 session monitor and TrainerHost handlers:
 * event.sender.id is the sole session-ownership key, never a value supplied
 * in the IPC payload — one renderer sender owns at most one attached session.
 *
 * No memory access of any kind occurs unless the feature flag is enabled AND
 * the caller explicitly confirms offline play AND the online-session guard
 * passes (rechecked before every write, not just at attach — see
 * LiveMemorySession). Nothing here bypasses that guard.
 */
export function registerLiveMemoryIpc(): void {
  ipcMain.handle('live-memory-list-processes', async (event) => {
    try {
      if (event.sender.isDestroyed()) return { success: false, error: 'sender_invalid' };
      LiveMemoryListProcessesSchema.parse({});
      if (!(await isFeatureEnabled())) return { success: false, error: 'feature_disabled' };

      return { success: true, processes: listLiveMemoryProcesses() };
    } catch (error) {
      return { success: false, error: sanitize(error, 'list_processes_failed') };
    }
  });

  ipcMain.handle('live-memory-attach', async (event, payload: unknown) => {
    try {
      if (event.sender.isDestroyed()) return { success: false, error: 'sender_invalid' };
      if (!(await isFeatureEnabled())) return { success: false, error: 'feature_disabled' };

      const parsed = LiveMemoryAttachSchema.parse(payload);

      disposeSession(event.sender.id);
      const session = new LiveMemorySession(nativeMemoryDriver);
      const result = await session.attach(
        { pid: parsed.pid, executableName: parsed.executableName },
        parsed.userConfirmedOffline,
      );

      if (result.success) {
        sessions.set(event.sender.id, session);
      }
      return result;
    } catch (error) {
      return { success: false, error: sanitize(error, 'attach_failed') };
    }
  });

  ipcMain.handle('live-memory-detach', async (event) => {
    try {
      LiveMemoryDetachSchema.parse({});
      disposeSession(event.sender.id);
      return { success: true };
    } catch (error) {
      return { success: false, error: sanitize(error, 'detach_failed') };
    }
  });

  ipcMain.handle('live-memory-read', async (event, payload: unknown) => {
    try {
      const session = requireSession(event);
      const parsed = LiveMemoryReadSchema.parse(payload);
      const value = session.readValue({ address: BigInt(parsed.address), dataType: parsed.dataType });
      return { success: true, value };
    } catch (error) {
      return { success: false, error: sanitize(error, 'read_failed') };
    }
  });

  ipcMain.handle('live-memory-propose-write', async (event, payload: unknown) => {
    try {
      const session = requireSession(event);
      const parsed = LiveMemoryProposeWriteSchema.parse(payload);
      const proposal = session.proposeWrite(
        { address: BigInt(parsed.address), dataType: parsed.dataType },
        parsed.requestedValue,
      );
      // Serialize bigint address to a string for the structured-clone IPC boundary.
      return { success: true, proposal: { ...proposal, target: { ...proposal.target, address: proposal.target.address.toString() } } };
    } catch (error) {
      return { success: false, error: sanitize(error, 'propose_failed') };
    }
  });

  ipcMain.handle('live-memory-confirm-write', async (event, payload: unknown) => {
    try {
      const session = requireSession(event);
      const parsed = LiveMemoryConfirmWriteSchema.parse(payload);
      const result = await session.confirmWrite(parsed.proposalId);
      return serializeWriteResult(result);
    } catch (error) {
      return { success: false, error: sanitize(error, 'confirm_write_failed') };
    }
  });

  ipcMain.handle('live-memory-rollback', async (event, payload: unknown) => {
    try {
      const session = requireSession(event);
      const parsed = LiveMemoryRollbackSchema.parse(payload);
      const manifest = {
        ...parsed.manifest,
        target: { ...parsed.manifest.target, address: BigInt(parsed.manifest.target.address) },
      };
      const result = await session.rollback(manifest);
      return { success: result.success, guard: result.guard, error: result.error };
    } catch (error) {
      return { success: false, error: sanitize(error, 'rollback_failed') };
    }
  });

  // Read-only: no guard check needed here, nothing is written to the process.
  ipcMain.handle('live-memory-scan-first', async (event, payload: unknown) => {
    try {
      const session = requireSession(event);
      const parsed = LiveMemoryScanFirstSchema.parse(payload);
      const result = session.scanFirst(parsed.dataType, parsed.targetValue, {
        maxRegionBytes: parsed.maxRegionBytes,
        maxTotalBytes: parsed.maxTotalBytes,
        maxMatches: parsed.maxMatches,
      });
      return { success: true, result: serializeScanResult(result) };
    } catch (error) {
      return { success: false, error: sanitize(error, 'scan_first_failed') };
    }
  });

  ipcMain.handle('live-memory-scan-next', async (event, payload: unknown) => {
    try {
      const session = requireSession(event);
      const parsed = LiveMemoryScanNextSchema.parse(payload);
      const previous: ScanMatch[] = parsed.previous.map((m) => ({ address: BigInt(m.address), value: m.value }));
      const matches = session.scanNext(parsed.dataType, parsed.comparison, previous);
      return { success: true, matches: serializeMatches(matches) };
    } catch (error) {
      return { success: false, error: sanitize(error, 'scan_next_failed') };
    }
  });

  ipcMain.handle('live-memory-freeze-start', async (event, payload: unknown) => {
    try {
      const session = requireSession(event);
      const parsed = LiveMemoryFreezeStartSchema.parse(payload);
      const result = session.startFreeze(
        { address: BigInt(parsed.address), dataType: parsed.dataType },
        parsed.value,
        parsed.intervalMs,
      );
      return result;
    } catch (error) {
      return { success: false, error: sanitize(error, 'freeze_start_failed') };
    }
  });

  ipcMain.handle('live-memory-freeze-stop', async (event) => {
    try {
      const session = requireSession(event);
      LiveMemoryFreezeStopSchema.parse({});
      const status = session.stopFreeze();
      return { success: true, status: serializeFreezeStatus(status) };
    } catch (error) {
      return { success: false, error: sanitize(error, 'freeze_stop_failed') };
    }
  });

  ipcMain.handle('live-memory-freeze-status', async (event) => {
    try {
      const session = requireSession(event);
      LiveMemoryFreezeStatusSchema.parse({});
      return { success: true, status: serializeFreezeStatus(session.getFreezeStatus()) };
    } catch (error) {
      return { success: false, error: sanitize(error, 'freeze_status_failed') };
    }
  });

  // Read-only: lists the catalog's saved controls for whichever game is currently attached.
  ipcMain.handle('live-memory-list-controls', async (event) => {
    try {
      const session = requireSession(event);
      LiveMemoryListControlsSchema.parse({});
      const executableName = session.getAttachedExecutableName();
      if (!executableName) return { success: true, controls: [] };
      const controls = listControlsForGame(executableName);
      return { success: true, controls: controls.map(serializeControlSummary) };
    } catch (error) {
      return { success: false, error: sanitize(error, 'list_controls_failed') };
    }
  });

  // Read-only: resolves a catalog control's pointer path to its current address + value.
  // Does not write anything — the caller still goes through proposeWrite/confirmWrite (and
  // therefore the online-session guard) to actually change it.
  ipcMain.handle('live-memory-resolve-control', async (event, payload: unknown) => {
    try {
      const session = requireSession(event);
      const parsed = LiveMemoryResolveControlSchema.parse(payload);
      const control = getControl(parsed.controlId);
      if (!control) return { success: false, error: 'unknown_control' };

      const address = session.resolveControl(control);
      const currentValue = session.readValue(address);
      return {
        success: true,
        address: { address: address.address.toString(), dataType: address.dataType },
        currentValue,
      };
    } catch (error) {
      return { success: false, error: sanitize(error, 'resolve_control_failed') };
    }
  });
}

// ── Per-sender session ownership ─────────────────────────────────────────────

const sessions = new Map<number, LiveMemorySession>();

function disposeSession(senderId: number): void {
  const existing = sessions.get(senderId);
  if (existing) {
    existing.detach();
    sessions.delete(senderId);
  }
}

function requireSession(event: IpcMainInvokeEvent) {
  if (event.sender.isDestroyed()) throw new Error('sender_invalid');
  const session = sessions.get(event.sender.id);
  if (!session || !session.isAttached()) throw new Error('not_attached');
  return session;
}

function serializeControlSummary(control: {
  id: string;
  label: string;
  description: string;
  dataType: string;
  constraints?: { min?: number; max?: number };
}) {
  // Deliberately omits pointerPath/evidence/discoveredAt — the renderer only needs
  // enough to display the control and request a resolve/propose by id.
  return {
    id: control.id,
    label: control.label,
    description: control.description,
    dataType: control.dataType,
    constraints: control.constraints,
  };
}

function serializeMatches(matches: ScanMatch[]) {
  return matches.map((m) => ({ address: m.address.toString(), value: m.value }));
}

function serializeScanResult(result: { matches: ScanMatch[]; regionsScanned: number; bytesScanned: number; truncated: boolean }) {
  return {
    matches: serializeMatches(result.matches),
    regionsScanned: result.regionsScanned,
    bytesScanned: result.bytesScanned,
    truncated: result.truncated,
  };
}

function serializeFreezeStatus(status: {
  active: boolean;
  target: { address: { address: bigint; dataType: string }; value: number } | null;
  lastGuard: unknown;
  stopReason?: string;
  tickCount: number;
}) {
  return {
    ...status,
    target: status.target
      ? { ...status.target, address: { ...status.target.address, address: status.target.address.address.toString() } }
      : null,
  };
}

function serializeWriteResult(result: { success: boolean; manifest?: unknown; guard?: unknown; error?: string }) {
  if (!result.success || !result.manifest) return result;
  const manifest = result.manifest as { target: { address: bigint } };
  return {
    ...result,
    manifest: { ...manifest, target: { ...manifest.target, address: manifest.target.address.toString() } },
  };
}

async function isFeatureEnabled(): Promise<boolean> {
  const settingsModule = await import('../src/core/settings/index.js');
  const raw = settingsModule.getSetting('v2LiveModeEnabled');
  return raw === true || raw === 1;
}

function sanitize(error: unknown, fallback: string): string {
  if (error instanceof Error && (error.message === 'not_attached' || error.message === 'sender_invalid')) {
    return error.message;
  }
  return fallback;
}
