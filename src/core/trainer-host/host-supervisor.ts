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
  opts: { shell: boolean; windowsHide: boolean; stdio: string[] },
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
let _reqCounter = 0;
function nextId(): string {
  return `rpc-${++_reqCounter}`;
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
    filePath: string;
    field: string;
    currentValue: string;
    newValue: string;
  }
  const pendingProposals = new Map<string, PendingProposal>();
  let _proposalCounter = 0;

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
    try {
      await sendRpc('shutdown');
    } catch {
      child?.kill('SIGTERM');
    }
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
    if (!isPathApproved(filePath, gameId)) return { success: false, error: 'path_not_approved' };

    try {
      await sendRpc('proposeWriteField', { filePath, field, currentValue, newValue });
      const proposalId = `prop-${++_proposalCounter}-${Date.now()}`;
      pendingProposals.set(proposalId, { filePath, field, currentValue, newValue });
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

    try {
      const result = await sendRpc('rollbackWriteField', { filePath, backupPath, field });
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
