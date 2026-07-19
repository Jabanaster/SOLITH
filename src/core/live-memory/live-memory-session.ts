import { randomUUID } from 'node:crypto';
import { evaluateOnlineGuard } from './online-guard.js';
import { observeRemoteConnections } from './remote-connection-observer.js';
import { getConnectionBaseline } from './game-connection-baselines.js';
import {
  scanFirst as scanFirstRegions,
  scanNext as scanNextMatches,
  scanFirstUnknown as scanFirstUnknownSnapshot,
  scanNextFromSnapshotMultiType,
} from './memory-scanner.js';
import type { ScanResult, TypedScanResult, UnknownScanSnapshot } from './memory-scanner.js';
import { resolvePointerPath } from './pointer-resolver.js';
import { scanForPointerPath, type PointerScanBounds } from './pointer-scanner.js';
import { scanAobInProcess } from './aob-resolver.js';
import {
  fingerprintBlocksAttach,
  verifyDefinitionFingerprint,
  type FingerprintVerifyResult,
} from '../definitions/fingerprint-verify.js';
import type { MemoryFeatureV1 } from '../definitions/schema.v1.js';
import { resolveMemoryFeatureAddress, SessionAddressCache } from './feature-resolver.js';
import type { LiveTrainerControl } from './live-trainer-control.js';
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

export interface AttachFingerprintOptions {
  executableHashSHA256?: string;
  executableHashPrefixes?: string[];
  targetSHA256?: string;
  /** User acknowledged executable drift after seeing fingerprintWarning. */
  driftAcknowledged?: boolean;
  /** Override connection baseline from a loaded definition. */
  connectionBaseline?: number;
  /** Catalog game id whose definition supplied fingerprint / feature resolution context. */
  catalogGameId?: string;
}

export interface AttachResult {
  success: boolean;
  guard: OnlineGuardResult;
  error?: string;
  fingerprintWarning?: string;
  fingerprint?: FingerprintVerifyResult;
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
  private unknownSnapshots = new Map<string, UnknownScanSnapshot>();
  private readonly addressCache = new SessionAddressCache();
  private lastFingerprint: FingerprintVerifyResult | null = null;
  private catalogGameId: string | null = null;

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

  isOfflineConfirmed(): boolean {
    return this.userConfirmedOffline;
  }

  async recheckOnlineGuard(): Promise<OnlineGuardResult> {
    if (!this.target) {
      return { allowed: false, reason: 'No process attached.' };
    }
    const evidence = await this.remoteConnectionObserver(this.target.pid);
    return evaluateOnlineGuard({
      userConfirmedOffline: this.userConfirmedOffline,
      remoteConnections: evidence,
      acceptedConnectionBaseline: this.acceptedConnectionBaseline,
    });
  }

  getMemoryAccess(): { driver: MemoryDriver; handle: LiveProcessHandle } | null {
    if (!this.handle) return null;
    return { driver: this.driver, handle: this.handle };
  }

  private verifyAttachedProcessIdentity(): string | null {
    if (!this.handle || !this.target) {
      return 'No process attached.';
    }

    const actualExecutableName = this.driver.getProcessExecutableName(this.handle);
    if (!actualExecutableName) {
      return `Unable to verify executable name for PID ${this.handle.pid}.`;
    }

    if (actualExecutableName.toLowerCase() !== this.target.executableName.toLowerCase()) {
      return `Attached process identity mismatch: expected ${this.target.executableName}, found ${actualExecutableName}.`;
    }

    return null;
  }

  /** Catalog game id from the most recent attach, if supplied. */
  getCatalogGameId(): string | null {
    return this.catalogGameId;
  }

  async attach(
    target: LiveProcessTarget,
    userConfirmedOffline: boolean,
    fingerprint?: AttachFingerprintOptions,
  ): Promise<AttachResult> {
    if (this.isAttached()) {
      return { success: false, guard: { allowed: false, reason: 'Session already attached.' }, error: 'already_attached' };
    }

    const acceptedConnectionBaseline =
      fingerprint?.connectionBaseline ?? getConnectionBaseline(target.executableName);
    const evidence = await this.remoteConnectionObserver(target.pid);
    const guard = evaluateOnlineGuard({ userConfirmedOffline, remoteConnections: evidence, acceptedConnectionBaseline });

    if (!guard.allowed) {
      return { success: false, guard };
    }

    let fingerprintResult: FingerprintVerifyResult | undefined;
    if (
      fingerprint &&
      (fingerprint.targetSHA256 ||
        (fingerprint.executableHashPrefixes && fingerprint.executableHashPrefixes.length > 0))
    ) {
      fingerprintResult = verifyDefinitionFingerprint({
        executableHashSHA256: fingerprint.executableHashSHA256 ?? null,
        executableHashPrefixes: fingerprint.executableHashPrefixes,
        targetSHA256: fingerprint.targetSHA256,
      });

      if (fingerprintBlocksAttach(fingerprintResult, fingerprint.driftAcknowledged)) {
        return {
          success: false,
          guard,
          error: 'executable_fingerprint_mismatch',
          fingerprintWarning: fingerprintResult.warning,
          fingerprint: fingerprintResult,
        };
      }
    }

    try {
      this.handle = this.driver.openProcess(target.pid);
    } catch (err) {
      return { success: false, guard, error: `Failed to open process: ${String(err)}` };
    }

    this.target = target;
    this.userConfirmedOffline = userConfirmedOffline;
    this.acceptedConnectionBaseline = acceptedConnectionBaseline;
    this.lastFingerprint = fingerprintResult ?? null;
    this.catalogGameId = fingerprint?.catalogGameId ?? null;
    return {
      success: true,
      guard,
      fingerprint: fingerprintResult,
      fingerprintWarning:
        fingerprintResult?.status === 'mismatch' && fingerprint?.driftAcknowledged
          ? fingerprintResult.warning
          : undefined,
    };
  }

  /** Fingerprint result from the most recent successful attach, if any. */
  getAttachFingerprint(): FingerprintVerifyResult | null {
    return this.lastFingerprint;
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
   * "Unknown initial value" first scan — for a stat with no visible number
   * (a bar, a percentage with no digits). Captures a raw-bytes baseline of
   * every writable region instead of searching for one target value. Call
   * scanNextFromUnknown after provoking a real in-game change to turn this
   * into a concrete candidate list; from there the normal scanNext/exact
   * flow narrows further. Read-only — nothing is written.
   *
   * `key` scopes the baseline to one caller-chosen slot (the renderer passes
   * the cheat id) — a session is one attached process, but a user routinely
   * runs unknown-value discovery on more than one stat at once (e.g. Health
   * and Stamina together). A single unkeyed snapshot field would let a
   * second scanFirstUnknown silently clobber the first one's baseline.
   */
  scanFirstUnknown(key: string, bounds?: ScanBounds): { regionsScanned: number; bytesScanned: number; truncated: boolean } {
    if (!this.handle) throw new Error('No process attached.');
    const snapshot = scanFirstUnknownSnapshot(this.driver, this.handle, bounds);
    this.unknownSnapshots.set(key, snapshot);
    return {
      regionsScanned: snapshot.regionsScanned,
      bytesScanned: snapshot.bytesScanned,
      truncated: snapshot.truncated,
    };
  }

  /**
   * Consumes the snapshot from scanFirstUnknown for the same `key`: re-reads
   * those regions now and keeps cells whose value satisfies `comparison`
   * against the baseline (e.g. `{kind: 'decreased'}` after taking damage),
   * trying every dataType in `dataTypes` at each offset rather than
   * committing to one interpretation upfront (multi-type "All" scan
   * type) — see scanNextFromSnapshotMultiType's doc comment for why this
   * matters. Single-use per key — clears that slot once called, since its
   * raw bytes are only valid as a baseline for the very next comparison.
   */
  scanNextFromUnknown(
    key: string,
    dataTypes: LiveValueType[],
    comparison: ScanComparison,
    bounds?: ScanBounds,
  ): TypedScanResult {
    if (!this.handle) throw new Error('No process attached.');
    const snapshot = this.unknownSnapshots.get(key);
    if (!snapshot) {
      throw new Error('No unknown-value scan in progress for this cheat — call scanFirstUnknown first.');
    }
    const result = scanNextFromSnapshotMultiType(this.driver, this.handle, dataTypes, comparison, snapshot, bounds);
    this.unknownSnapshots.delete(key);
    return result;
  }

  /**
   * Bulk-reads a list of (address, dataType) pairs in one call — the backing
   * primitive for the Watch Live Values panel, which polls a whole candidate
   * list on an interval and needs that to be one round trip, not N. Each
   * candidate carries its own dataType since a multi-type unknown scan's
   * survivors aren't all the same type. Unreadable addresses (freed/moved
   * since the last poll) are silently dropped rather than throwing — same
   * steady-state reasoning as scanNext.
   */
  readMany(addresses: { address: bigint; dataType: LiveValueType }[]): { address: bigint; value: number; dataType: LiveValueType }[] {
    if (!this.handle) throw new Error('No process attached.');
    const results: { address: bigint; value: number; dataType: LiveValueType }[] = [];
    for (const target of addresses) {
      try {
        const value = this.driver.readMemory(this.handle, target.address, target.dataType);
        results.push({ address: target.address, value, dataType: target.dataType });
      } catch {
        continue;
      }
    }
    return results;
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

  /**
   * Resolves a schema.v1 memory feature to a concrete address. Uses the per-session
   * AOB/pointer cache so freeze loops do not re-scan on every tick.
   */
  resolveMemoryFeature(feature: MemoryFeatureV1): LiveMemoryAddress {
    if (!this.handle) throw new Error('No process attached.');
    return resolveMemoryFeatureAddress(this.driver, this.handle, feature, this.addressCache);
  }

  /** Expose session address cache for Zero-Input bulk resolve. */
  getAddressCache(): SessionAddressCache {
    return this.addressCache;
  }

  getMemoryAccessOrThrow(): { driver: MemoryDriver; handle: LiveProcessHandle } {
    if (!this.handle) throw new Error('No process attached.');
    return { driver: this.driver, handle: this.handle };
  }

  /** Reverse pointer scan from a dynamic address (Advanced Scan Mode). */
  pointerScan(targetAddress: bigint, bounds?: PointerScanBounds) {
    if (!this.handle) throw new Error('No process attached.');
    return scanForPointerPath(this.driver, this.handle, targetAddress, bounds);
  }

  /** Read-only AOB scan in the attached process (Script Research Analyzer). */
  scanAobSignature(signature: string, moduleName?: string): { address: string } | null {
    if (!this.handle) throw new Error('No process attached.');
    const match = scanAobInProcess(this.driver, this.handle, signature, { moduleName });
    if (match == null) return null;
    return { address: `0x${match.toString(16)}` };
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

    const identityError = this.verifyAttachedProcessIdentity();
    if (identityError) {
      return { success: false, guard, error: identityError };
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

    const identityError = this.verifyAttachedProcessIdentity();
    if (identityError) {
      return { success: false, guard, error: identityError };
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
   * mirrors mainstream "Infinite Health"/"Infinite Ammo" toggles. Every
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

      const identityError = this.verifyAttachedProcessIdentity();
      if (identityError) {
        this.stopFreezeInternal('identity_mismatch');
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
    this.unknownSnapshots.clear();
    this.addressCache.clear();
    this.lastFingerprint = null;
    this.catalogGameId = null;
  }
}
