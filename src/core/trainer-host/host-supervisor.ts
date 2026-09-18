/**
 * TrainerHost supervisor — main-process side.
 *
 * Spawns the host-entry child process with shell:false, manages the
 * stdio JSON-RPC channel, enforces approved-path checks before any
 * capability call, and ensures no orphan processes on app quit.
 *
 * OWNERSHIP: IPC ownership (which renderer started the host) is enforced
 * in electron/main.ts via event.sender.id — not here. The supervisor is
 * purely the process-management and RPC-correlation layer.
 *
 * ORPHAN PREVENTION:
 *   - PID + startTime recorded immediately after spawn (before any await).
 *   - verifyExitOrKill() checks process.kill(pid, 0) and SIGTERMs if alive.
 *   - startTime guards against PID reuse.
 *   - host-entry also exits on stdin end/close (parent-loss guard).
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { spawn as nodeSpawn } from 'child_process';
import { LineFramer, encodeRequest, isRpcResponse, isRpcError } from './protocol';
import { isPathApproved } from '../saves/locations';

// ── Write RPC boundary validation (P4-13 mission §15) ──────────────────────────
//
// `proposeWrite`'s params were previously typed `string` and trusted as-is —
// safe today only because its one real caller (definition-to-trainer-
// controls.ts's saveFieldToTrainerControl, via electron/main.ts's IPC
// handler, which separately validates its own payload shape with
// TrainerHostProposeWriteSchema) happens to always construct well-formed
// values. This is a second, independent guard directly at the boundary this
// supervisor forwards across to the TrainerHost child process's RPC
// channel — not a duplicate of the IPC-layer schema (electron/ipc-
// validation.ts is Electron-only; this module is a plain src/core module
// with no dependency on it), so a future caller cannot reintroduce the same
// blind-trust gap by construction alone.
const MAX_FIELD_PATH_LENGTH = 512;
const MAX_VALUE_LENGTH = 1024;

function validateWriteRpcParams(params: {
  gameId: string;
  filePath: string;
  field: string;
  currentValue: string;
  newValue: string;
}): string | null {
  if (typeof params.gameId !== 'string' || params.gameId.trim() === '') return 'invalid_write_params: gameId';
  if (typeof params.filePath !== 'string' || params.filePath.trim() === '') return 'invalid_write_params: filePath';
  if (typeof params.field !== 'string' || params.field.trim() === '' || params.field.length > MAX_FIELD_PATH_LENGTH) {
    return 'invalid_write_params: field';
  }
  if (typeof params.currentValue !== 'string' || params.currentValue.length > MAX_VALUE_LENGTH) {
    return 'invalid_write_params: currentValue';
  }
  if (typeof params.newValue !== 'string' || params.newValue.length > MAX_VALUE_LENGTH) {
    return 'invalid_write_params: newValue';
  }
  return null;
}

// ── Injectable interfaces ─────────────────────────────────────────────────────

export interface ChildProcessLike {
  pid: number | undefined;
  stdin: { write(data: string): void };
  stdout: { on(event: 'data', cb: (chunk: Buffer) => void): unknown };
  stderr: { on(event: 'data', cb: (chunk: Buffer) => void): unknown };
  on(event: 'close', cb: (code: number | null) => void): unknown;
  on(event: 'error', cb: (err: Error) => void): unknown;
  kill(signal?: string): boolean;
}

export type SpawnFn = (
  cmd: string,
  args: string[],
  opts: { shell: boolean; windowsHide: boolean; stdio: string[]; env?: NodeJS.ProcessEnv },
) => ChildProcessLike;

// ── Public types ──────────────────────────────────────────────────────────────

export interface HostStatus {
  running: boolean;
  pid: number | null;
  capabilities: string[];
}

export interface TrainerHostSupervisor {
  start(): Promise<{ success: boolean; error?: string }>;
  stop(): Promise<void>;
  readField(
    gameId: string,
    filePath: string,
    field: string,
  ): Promise<{ success: boolean; value?: string | null; error?: string }>;
  proposeWrite(
    gameId: string,
    filePath: string,
    field: string,
    currentValue: string,
    newValue: string,
  ): Promise<{ success: boolean; proposalId?: string; error?: string }>;
  approveAndWrite(
    proposalId: string,
  ): Promise<{ success: boolean; verifiedValue?: string; backupPath?: string; error?: string }>;
  rollback(
    filePath: string,
    backupPath: string,
    field: string,
    gameId: string,
  ): Promise<{ success: boolean; verifiedValue?: string; error?: string }>;
  getStatus(): HostStatus;
  verifyExitOrKill(): void;
  dispose(): void;
}

// ── RPC correlation ───────────────────────────────────────────────────────────

interface PendingRequest {
  resolve(value: any): void;
  reject(err: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

const RPC_TIMEOUT_MS = 5000;
/** Bound on how long stop() waits for the child's 'close' event per attempt (SOL-1 G11). */
const STOP_EXIT_TIMEOUT_MS = 2000;
let _reqCounter = 0;
function nextId(): string {
  return `rpc-${++_reqCounter}`;
}

/** Resolves true if `promise` settles first, false if `timeoutMs` elapses first. */
function raceWithTimeout(promise: Promise<void>, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    promise.then(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createTrainerHostSupervisor(spawnFn?: SpawnFn): TrainerHostSupervisor {
  const realSpawnFn: SpawnFn = spawnFn ?? ((cmd, args, opts) =>
    nodeSpawn(cmd, args, opts as any) as unknown as ChildProcessLike
  );

  let child: ChildProcessLike | null = null;
  let childPid: number | null = null;
  let childStartTime: number | null = null;
  let capabilities: string[] = [];
  const pending = new Map<string, PendingRequest>();

  // Pending write proposals — created by proposeWrite, consumed by approveAndWrite.
  // Existence in this map IS the approval gate. No entry → write refused.
  interface PendingProposal {
    gameId: string;
    filePath: string;
    field: string;
    currentValue: string;
    newValue: string;
  }
  interface OwnedBackup {
    gameId: string;
    filePath: string;
    field: string;
    backupPath: string;
  }
  const pendingProposals = new Map<string, PendingProposal>();
  const ownedBackups = new Map<string, OwnedBackup>();
  let _proposalCounter = 0;

  function canonicalKey(filePath: string): string {
    return path.resolve(filePath).toLowerCase();
  }

  function isRunning(): boolean {
    if (!child || childPid === null) return false;
    try {
      process.kill(childPid, 0);
      return true;
    } catch {
      return false;
    }
  }

  function sendRpc(method: string, params?: unknown): Promise<any> {
    if (!child) return Promise.reject(new Error('not_running'));
    const id = nextId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        child?.kill('SIGTERM');
        reject(new Error('rpc_timeout'));
      }, RPC_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      child!.stdin.write(encodeRequest(id, method, params));
    });
  }

  function handleResponse(line: string): void {
    let msg: any;
    try { msg = JSON.parse(line); } catch { return; }
    if (!msg || typeof msg.id !== 'string') return;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    if (isRpcResponse(msg)) {
      p.resolve(msg.result);
    } else if (isRpcError(msg)) {
      p.reject(new Error(msg.error));
    }
  }

  function rejectAllPending(reason: string): void {
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    pending.clear();
  }

  async function start(): Promise<{ success: boolean; error?: string }> {
    if (isRunning()) return { success: false, error: 'already_running' };

    // Resolve host-entry path. When bundled by tsup into main.js, import.meta.url
    // resolves to main.js's directory (dist-electron/), where host-entry.js lives.
    // In the packaged app the file is marked asarUnpack — replace app.asar with
    // app.asar.unpacked so the OS can actually exec the file (no-op outside asar).
    const supervisorDir = path.dirname(fileURLToPath(import.meta.url));
    const rawPath = path.resolve(supervisorDir, 'host-entry.js');
    const entryPath = rawPath.replace(/app\.asar([\\/])/g, 'app.asar.unpacked$1');

    const spawned = realSpawnFn(process.execPath, [entryPath], {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      // ELECTRON_RUN_AS_NODE makes the packaged Electron binary behave like Node.js
      // so it executes host-entry.js rather than reloading the ASAR app bundle.
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });

    // Record identity synchronously before any await
    childPid = spawned.pid ?? null;
    childStartTime = Date.now();
    child = spawned;
    capabilities = [];

    const framer = new LineFramer();
    spawned.stdout.on('data', (chunk: Buffer) => {
      let messages;
      try { messages = framer.push(chunk); } catch { return; }
      for (const msg of messages) {
        if (typeof (msg as any).id === 'string') {
          handleResponse(JSON.stringify(msg));
        }
      }
    });

    spawned.on('close', () => {
      child = null;
      childPid = null;
      childStartTime = null;
      rejectAllPending('host_exited');
    });

    spawned.on('error', (err) => {
      child = null;
      childPid = null;
      childStartTime = null;
      rejectAllPending(err.message);
    });

    // Wait for handshake
    try {
      const handshake = await new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('handshake_timeout')), RPC_TIMEOUT_MS);
        pending.set('handshake', {
          resolve: (v) => { clearTimeout(timer); resolve(v); },
          reject: (e) => { clearTimeout(timer); reject(e); },
          timer,
        });
      });
      capabilities = handshake.capabilities ?? [];
      return { success: true };
    } catch (e) {
      child?.kill('SIGTERM');
      child = null;
      childPid = null;
      childStartTime = null;
      return { success: false, error: String(e) };
    }
  }

  async function stop(): Promise<void> {
    if (!child) return;
    const childRef = child;
    const exited = new Promise<void>((resolve) => {
      childRef.on('close', () => resolve());
    });

    try {
      await sendRpc('shutdown');
    } catch {
      childRef.kill('SIGTERM');
    }

    // SOL-1 G11: wait for the child to actually exit (the 'close' listener
    // above, and the on('close') handler set at spawn time, both fire and
    // clear PID/lifecycle state) instead of assuming shutdown/SIGTERM
    // succeeded. Bounded by STOP_EXIT_TIMEOUT_MS — if the child hasn't
    // closed by then, force-kill and give it one more short window before
    // giving up on confirmation.
    const closedInTime = await raceWithTimeout(exited, STOP_EXIT_TIMEOUT_MS);
    if (!closedInTime) {
      childRef.kill('SIGKILL');
      await raceWithTimeout(exited, STOP_EXIT_TIMEOUT_MS);
    }

    // Defensive: the on('close') handler set at spawn time already clears
    // child/childPid/childStartTime when the process actually exits. Clear
    // them here too in case 'close' never fires (e.g. an already-dead
    // handle), so stop() never leaves stale lifecycle state regardless.
    child = null;
    childPid = null;
    childStartTime = null;
    rejectAllPending('stopped');
  }

  async function readField(
    gameId: string,
    filePath: string,
    field: string,
  ): Promise<{ success: boolean; value?: string | null; error?: string }> {
    if (!isRunning()) return { success: false, error: 'not_running' };

    // Main-process path approval — checked here before any data reaches the child
    if (!isPathApproved(filePath, gameId)) {
      return { success: false, error: 'path_not_approved' };
    }

    try {
      const result = await sendRpc('readSaveField', { filePath, field });
      return { success: true, value: result.value };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  async function proposeWrite(
    gameId: string,
    filePath: string,
    field: string,
    currentValue: string,
    newValue: string,
  ): Promise<{ success: boolean; proposalId?: string; error?: string }> {
    if (!isRunning()) return { success: false, error: 'not_running' };
    const paramsError = validateWriteRpcParams({ gameId, filePath, field, currentValue, newValue });
    if (paramsError) return { success: false, error: paramsError };
    if (!isPathApproved(filePath, gameId)) return { success: false, error: 'path_not_approved' };

    try {
      await sendRpc('proposeWriteField', { filePath, field, currentValue, newValue });
      const proposalId = `prop-${++_proposalCounter}-${Date.now()}`;
      pendingProposals.set(proposalId, { gameId, filePath, field, currentValue, newValue });
      return { success: true, proposalId };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  async function approveAndWrite(
    proposalId: string,
  ): Promise<{ success: boolean; verifiedValue?: string; backupPath?: string; error?: string }> {
    if (!isRunning()) return { success: false, error: 'not_running' };

    const proposal = pendingProposals.get(proposalId);
    if (!proposal) return { success: false, error: 'proposal_not_found' };

    // Consume the proposal — approval is one-time use
    pendingProposals.delete(proposalId);

    try {
      const result = await sendRpc('executeWriteField', {
        filePath: proposal.filePath,
        field: proposal.field,
        currentValue: proposal.currentValue,
        newValue: proposal.newValue,
      });
      if (typeof result.backupPath === 'string' && result.backupPath.length > 0) {
        ownedBackups.set(canonicalKey(result.backupPath), {
          gameId: proposal.gameId,
          filePath: proposal.filePath,
          field: proposal.field,
          backupPath: result.backupPath,
        });
      }
      return { success: true, verifiedValue: result.verifiedValue, backupPath: result.backupPath };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  async function rollback(
    filePath: string,
    backupPath: string,
    field: string,
    gameId: string,
  ): Promise<{ success: boolean; verifiedValue?: string; error?: string }> {
    if (!isRunning()) return { success: false, error: 'not_running' };
    if (!isPathApproved(filePath, gameId)) return { success: false, error: 'path_not_approved' };

    const backupRecord = ownedBackups.get(canonicalKey(backupPath));
    if (!backupRecord) return { success: false, error: 'backup_not_owned' };
    if (backupRecord.gameId !== gameId) return { success: false, error: 'backup_target_mismatch' };
    if (canonicalKey(backupRecord.filePath) !== canonicalKey(filePath)) {
      return { success: false, error: 'backup_target_mismatch' };
    }
    if (backupRecord.field !== field) return { success: false, error: 'backup_target_mismatch' };
    if (path.dirname(canonicalKey(backupRecord.backupPath)) !== path.dirname(canonicalKey(filePath))) {
      return { success: false, error: 'backup_path_invalid' };
    }

    try {
      const result = await sendRpc('rollbackWriteField', { filePath, backupPath, field });
      ownedBackups.delete(canonicalKey(backupPath));
      return { success: true, verifiedValue: result.verifiedValue };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  function getStatus(): HostStatus {
    return { running: isRunning(), pid: childPid, capabilities };
  }

  function verifyExitOrKill(): void {
    if (childPid === null) return;
    try {
      process.kill(childPid, 0);
      // Still alive — terminate
      child?.kill('SIGTERM');
    } catch {
      // Already exited — nothing to do
    }
  }

  function dispose(): void {
    verifyExitOrKill();
  }

  return { start, stop, readField, proposeWrite, approveAndWrite, rollback, getStatus, verifyExitOrKill, dispose };
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _supervisor: TrainerHostSupervisor | null = null;

export function getTrainerHostSupervisor(): TrainerHostSupervisor {
  if (!_supervisor) {
    _supervisor = createTrainerHostSupervisor();
  }
  return _supervisor;
}
