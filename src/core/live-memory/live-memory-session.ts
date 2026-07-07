import { randomUUID } from 'node:crypto';
import { evaluateOnlineGuard } from './online-guard.js';
import { observeRemoteConnections } from './remote-connection-observer.js';
import { getConnectionBaseline } from './game-connection-baselines.js';
import { scanFirst as scanFirstRegions, scanNext as scanNextMatches } from './memory-scanner.js';
import type { ScanResult } from './memory-scanner.js';
import { resolvePointerPath } from './pointer-resolver.js';
import type { LiveTrainerControl } from './live-control-catalog.js';
import type {
  FreezeStatus,
  FreezeStopReason,
  FreezeTarget,
  LiveMemoryAddress,
  LiveProcessHandle,
  LiveProcessTarget,
  LiveValueType,
  LiveWriteManifest,
  LiveWriteProposal,
  MemoryDriver,
  OnlineGuardResult,
  RemoteConnectionEvidence,
  ScanBounds,
  ScanComparison,
  ScanMatch,
} from './types.js';

export type RemoteConnectionObserverFn = (pid: number, signal?: AbortSignal) => Promise<RemoteConnectionEvidence>;

/**
 * Scheduler abstraction so freeze-loop tests can drive ticks without real
 * timers — same pattern as PollScheduler in src/core/v2/session-monitor.ts.
 */
export interface FreezeScheduler {
  schedule(fn: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

const DEFAULT_FREEZE_SCHEDULER: FreezeScheduler = {
  schedule: (fn, delay) => setTimeout(fn, delay),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const DEFAULT_FREEZE_INTERVAL_MS = 200;

interface FreezeState {
  target: FreezeTarget;
  active: boolean;
  timer: unknown;
  tickCount: number;
  lastGuard: OnlineGuardResult | null;
  stopReason?: FreezeStopReason;
}

export interface StartFreezeResult {
  success: boolean;
  error?: string;
}

export interface AttachResult {
  success: boolean;
  guard: OnlineGuardResult;
  error?: string;
}

export interface ConfirmWriteResult {
  success: boolean;
  manifest?: LiveWriteManifest;
  guard?: OnlineGuardResult;
  error?: string;
}

export interface RollbackResult {
  success: boolean;
  guard?: OnlineGuardResult;
  error?: string;
}

/**
 * Orchestrates a single live-memory attach session.
 *
 * Mirrors the file-based proposal → dry-run → apply → rollback philosophy
 * (PROJECT_SPEC.md Section 4.1) but for a live process: attach requires the
 * online-session guard to pass; every write re-runs the guard immediately
 * before executing (same "recheck containment immediately before
 * modification" principle used for file targets in Section 13), so a session
 * that goes online mid-flow cannot be written to just because attach
 * happened while offline.
 *
 * One session === one attached process. Create a new instance per attach.
 */
export class LiveMemorySession {
  private handle: LiveProcessHandle | null = null;
  private target: LiveProcessTarget | null = null;
  private userConfirmedOffline = false;
  private acceptedConnectionBaseline = 0;
  private pendingProposals = new Map<string, LiveWriteProposal>();
  private remoteConnectionObserver: RemoteConnectionObserverFn = observeRemoteConnections;
  private freezeScheduler: FreezeScheduler = DEFAULT_FREEZE_SCHEDULER;
  private freeze: FreezeState | null = null;
  private freezeGeneration = 0;

  constructor(private readonly driver: MemoryDriver) {}

  /** Testing seam — inject a fake remote-connection observer. */
  _injectRemoteConnectionObserver(fn: RemoteConnectionObserverFn): void {
    this.remoteConnectionObserver = fn;
  }

  /** Testing seam — inject a fake scheduler so freeze-loop tests don't need real timers. */
  _injectFreezeScheduler(scheduler: FreezeScheduler): void {
    this.freezeScheduler = scheduler;
  }

  isAttached(): boolean {
    return this.handle !== null;
  }

  /** The executable name of the currently attached process, or null if not attached. */
  getAttachedExecutableName(): string | null {
    return this.target?.executableName ?? null;
  }

  async attach(target: LiveProcessTarget, userConfirmedOffline: boolean): Promise<AttachResult> {
    if (this.isAttached()) {
      return { success: false, guard: { allowed: false, reason: 'Session already attached.' }, error: 'already_attached' };
    }

    const acceptedConnectionBaseline = getConnectionBaseline(target.executableName);
    const evidence = await this.remoteConnectionObserver(target.pid);
    const guard = evaluateOnlineGuard({ userConfirmedOffline, remoteConnections: evidence, acceptedConnectionBaseline });

    if (!guard.allowed) {
      return { success: false, guard };
    }

    try {
      this.handle = this.driver.openProcess(target.pid);
    } catch (err) {
      return { success: false, guard, error: `Failed to open process: ${String(err)}` };
    }

    this.target = target;
    this.userConfirmedOffline = userConfirmedOffline;
    this.acceptedConnectionBaseline = acceptedConnectionBaseline;
    return { success: true, guard };
  }

  readValue(address: LiveMemoryAddress): number {
    if (!this.handle) throw new Error('No process attached.');
    return this.driver.readMemory(this.handle, address.address, address.dataType);
  }

  /** First scan: read-only, no guard check needed (nothing is written). */
  scanFirst(dataType: LiveValueType, targetValue: number, bounds?: ScanBounds): ScanResult {
    if (!this.handle) throw new Error('No process attached.');
    return scanFirstRegions(this.driver, this.handle, dataType, targetValue, bounds);
  }

  /** Next scan: read-only narrowing of a prior candidate set. */
  scanNext(dataType: LiveValueType, comparison: ScanComparison, previous: ScanMatch[]): ScanMatch[] {
    if (!this.handle) throw new Error('No process attached.');
    return scanNextMatches(this.driver, this.handle, dataType, comparison, previous);
  }

  /**
   * Resolves a named, catalog-defined control's pointer path to a concrete,
   * currently-valid address for the attached process. Read-only — resolving
   * a control does not write anything. The returned LiveMemoryAddress feeds
   * directly into the existing readValue/proposeWrite/confirmWrite/rollback
   * flow, so a catalog control gets exactly the same guard rechecks and
   * proposal/confirm semantics as a manually-entered address.
   *
   * Must be called fresh each attach (and re-called if a long time has
   * passed) — the path is restart-stable, but the concrete address it
   * resolves to is not guaranteed stable within/across GC activity for
   * managed-runtime games, or across process restarts in general.
   */
  resolveControl(control: LiveTrainerControl): LiveMemoryAddress {
    if (!this.handle) throw new Error('No process attached.');
    const address = resolvePointerPath(this.driver, this.handle, control.pointerPath);
    return { address, dataType: control.dataType };
  }

  /** Captures the current value and stages a proposed write. Does not write anything yet. */
  proposeWrite(address: LiveMemoryAddress, requestedValue: number): LiveWriteProposal {
    if (!this.handle) throw new Error('No process attached.');

    const currentValue = this.driver.readMemory(this.handle, address.address, address.dataType);
    const proposal: LiveWriteProposal = {
      proposalId: randomUUID(),
      target: address,
      currentValue,
      requestedValue,
      createdAt: new Date().toISOString(),
    };
    this.pendingProposals.set(proposal.proposalId, proposal);
    return proposal;
  }

  /** Re-checks the online guard, then executes a previously staged proposal. */
  async confirmWrite(proposalId: string): Promise<ConfirmWriteResult> {
    if (!this.handle || !this.target) {
      return { success: false, error: 'No process attached.' };
    }

    const proposal = this.pendingProposals.get(proposalId);
    if (!proposal) {
      return { success: false, error: 'Unknown or expired proposal.' };
    }

    const evidence = await this.remoteConnectionObserver(this.target.pid);
    const guard = evaluateOnlineGuard({ userConfirmedOffline: this.userConfirmedOffline, remoteConnections: evidence, acceptedConnectionBaseline: this.acceptedConnectionBaseline });

    if (!guard.allowed) {
      // Guard flipped between propose() and confirm() — reject this write but
      // keep the session attached; the caller may retry once conditions clear.
      return { success: false, guard, error: 'Blocked by online-session guard at write time.' };
    }

    try {
      this.driver.writeMemory(this.handle, proposal.target.address, proposal.target.dataType, proposal.requestedValue);
    } catch (err) {
      return { success: false, guard, error: `Write failed: ${String(err)}` };
    }

    this.pendingProposals.delete(proposalId);

    const manifest: LiveWriteManifest = {
      proposalId: proposal.proposalId,
      target: proposal.target,
      valueBefore: proposal.currentValue,
      valueAfter: proposal.requestedValue,
      appliedAt: new Date().toISOString(),
    };
    return { success: true, manifest, guard };
  }

  /** Restores the value captured before a prior confirmed write. Re-checks the guard, same as any write. */
  async rollback(manifest: LiveWriteManifest): Promise<RollbackResult> {
    if (!this.handle || !this.target) {
      return { success: false, error: 'No process attached.' };
    }

    const evidence = await this.remoteConnectionObserver(this.target.pid);
    const guard = evaluateOnlineGuard({ userConfirmedOffline: this.userConfirmedOffline, remoteConnections: evidence, acceptedConnectionBaseline: this.acceptedConnectionBaseline });

    if (!guard.allowed) {
      return { success: false, guard, error: 'Blocked by online-session guard at rollback time.' };
    }

    try {
      this.driver.writeMemory(this.handle, manifest.target.address, manifest.target.dataType, manifest.valueBefore);
    } catch (err) {
      return { success: false, guard, error: `Rollback write failed: ${String(err)}` };
    }

    return { success: true, guard };
  }

  /**
   * Starts continuously re-writing `value` to `address` on an interval —
   * mirrors WeMod/Wand-style "Infinite Health"/"Infinite Ammo" toggles. Every
   * tick re-runs the online-session guard before writing (same recheck
   * principle as confirmWrite/rollback); the first guard failure stops the
   * freeze outright rather than silently retrying, so a session that goes
   * online while frozen doesn't keep writing in the background.
   */
  startFreeze(address: LiveMemoryAddress, value: number, intervalMs = DEFAULT_FREEZE_INTERVAL_MS): StartFreezeResult {
    if (!this.handle || !this.target) {
      return { success: false, error: 'No process attached.' };
    }
    if (this.freeze?.active) {
      return { success: false, error: 'A freeze is already active on this session. Stop it first.' };
    }

    this.freezeGeneration += 1;
    const generation = this.freezeGeneration;

    this.freeze = {
      target: { address, value },
      active: true,
      timer: null,
      tickCount: 0,
      lastGuard: null,
    };

    const tick = async (): Promise<void> => {
      if (generation !== this.freezeGeneration || !this.freeze?.active || !this.handle || !this.target) return;

      const evidence = await this.remoteConnectionObserver(this.target.pid);
      const guard = evaluateOnlineGuard({ userConfirmedOffline: this.userConfirmedOffline, remoteConnections: evidence, acceptedConnectionBaseline: this.acceptedConnectionBaseline });

      // Stale: stopped/replaced while awaiting the guard check.
      if (generation !== this.freezeGeneration || !this.freeze?.active) return;

      this.freeze.lastGuard = guard;

      if (!guard.allowed) {
        this.stopFreezeInternal('guard_blocked');
        return;
      }

      try {
        this.driver.writeMemory(this.handle, address.address, address.dataType, value);
        this.freeze.tickCount += 1;
      } catch {
        this.stopFreezeInternal('write_failed');
        return;
      }

      if (generation === this.freezeGeneration && this.freeze?.active) {
        this.freeze.timer = this.freezeScheduler.schedule(() => {
          void tick();
        }, intervalMs);
      }
    };

    void tick();
    return { success: true };
  }

  /** User-initiated stop. Safe to call even if no freeze is active. */
  stopFreeze(): FreezeStatus {
    this.stopFreezeInternal('user_stopped');
    return this.getFreezeStatus();
  }

  getFreezeStatus(): FreezeStatus {
    if (!this.freeze) {
      return { active: false, target: null, lastGuard: null, tickCount: 0 };
    }
    return {
      active: this.freeze.active,
      target: this.freeze.target,
      lastGuard: this.freeze.lastGuard,
      stopReason: this.freeze.stopReason,
      tickCount: this.freeze.tickCount,
    };
  }

  private stopFreezeInternal(reason: FreezeStopReason): void {
    if (!this.freeze || !this.freeze.active) return;
    this.freezeGeneration += 1; // invalidate any in-flight tick's scheduling
    if (this.freeze.timer !== null) {
      this.freezeScheduler.cancel(this.freeze.timer);
    }
    this.freeze.active = false;
    this.freeze.stopReason = reason;
  }

  detach(): void {
    this.stopFreezeInternal('detached');
    if (this.handle) {
      this.driver.closeProcess(this.handle);
    }
    this.handle = null;
    this.target = null;
    this.pendingProposals.clear();
  }
}
