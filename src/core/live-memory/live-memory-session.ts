import { randomUUID } from 'node:crypto';
import { revokeWriteConsentsForSession } from '../consent/write-consent.js';
import { evaluateOnlineGuard } from './online-guard.js';
import { evaluateWriteConsent } from './write-consent.js';
import { observeRemoteConnections } from './remote-connection-observer.js';
import { getConnectionBaseline } from './game-connection-baselines.js';
import {
  scanFirst as scanFirstRegions,
  scanFirstAutoMatrix as scanFirstAutoMatrixRegions,
  scanNext as scanNextMatches,
  scanFirstUnknown as scanFirstUnknownSnapshot,
  scanNextFromSnapshotMultiType,
} from './memory-scanner.js';
import type { AutoFirstScanMatrixResult, AutoFirstScanQuery, ScanResult, TypedScanResult, UnknownScanSnapshot } from './memory-scanner.js';
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
import {
  registerActiveFreeze,
  unregisterActiveFreeze,
  unregisterAllFreezesForOwner,
} from './freeze-concurrency-registry.js';
import { assessProtectedTarget, assessTargetProcessAuthorization } from '../runtime/protected-target-guard.js';
import { evaluate, type AuthorityRequest } from '../authority/index.js';
import type { LiveTrainerControl } from './live-trainer-control.js';
import {
  compareProcessIdentity,
  isCompleteProcessIdentity,
  queryWindowsProcessIdentity,
} from './windows-process-identity.js';
import type {
  FreezeProposal,
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
const MIN_FREEZE_INTERVAL_MS = 50;
const MAX_FREEZE_INTERVAL_MS = 5000;
/**
 * Hard ceiling on how long a single freeze may run before it auto-stops.
 * Centralized here as the single source of truth (Batch B1.1) — chosen as a
 * judgment call ("long enough not to interrupt a normal multi-hour play
 * session, short enough to eventually self-terminate a forgotten freeze"),
 * not derived from a documented project policy. Exported so the IPC/consent
 * layer can display it and bind it into the freeze consent hash without a
 * second, potentially-drifting copy of the same number.
 */
export const MAX_FREEZE_DURATION_MS = 6 * 60 * 60 * 1000; // 6 hours
/**
 * Bounds how many confirmed-write manifests a session retains for rollback.
 * (Batch B1.1) When full of still-VALID (non-expired) entries, new confirms
 * are REJECTED rather than silently evicting a still-valid rollback record
 * — see recordConfirmedWrite. This is a judgment call, not derived from
 * measured usage; chosen because a normal single trainer session is very
 * unlikely to accumulate 50 concurrently-un-rolled-back writes, and because
 * failing loudly is strictly safer than silently losing a user's ability to
 * undo an earlier write.
 */
const MAX_CONFIRMED_WRITES = 50;
/**
 * (Batch B1.1) How long a confirmed write remains rollback-eligible before
 * it expires and is purged. Centralized, single source of truth. Chosen as
 * a judgment call: long enough to cover "try a few values in one sitting,
 * decide what to keep," short enough to bound how long a stale rollback
 * record (and the small manifest data it holds) is retained, and to reduce
 * the odds that "current memory still matches the confirmed post-write
 * value" (see rollback's new expected-value check) coincidentally holds
 * true again after enough elapsed time and unrelated gameplay.
 */
const CONFIRMED_WRITE_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface FreezeState {
  target: FreezeTarget;
  active: boolean;
  timer: unknown;
  tickCount: number;
  lastGuard: OnlineGuardResult | null;
  stopReason?: FreezeStopReason;
  intervalMs: number;
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
  manifest?: LiveWriteManifest;
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
export type RollbackValueComparison =
  | { comparable: true; equal: boolean }
  | { comparable: false; reason: 'unsupported_type' | 'non_finite_integer' | 'unsafe_integer' };

/**
 * (Gate 2) Fixed byte width per LiveValueType, matching memoryjs's native
 * encoding. Backs the exact-byte-fidelity rollback safety net: byte:1,
 * int32/uint32/float:4, double/int64:8 — little-endian throughout (x86/x64
 * user-mode memory), consistent with FakeMemoryDriver's *LE encode/decode.
 */
export function byteWidthForType(dataType: LiveValueType): number {
  switch (dataType) {
    case 'byte':
      return 1;
    case 'int32':
    case 'uint32':
    case 'float':
      return 4;
    case 'double':
    case 'int64':
      return 8;
  }
}

export function compareRollbackValue(dataType: LiveValueType, current: number, expected: number): RollbackValueComparison {
  switch (dataType) {
    case 'float':
      return { comparable: true, equal: Object.is(Math.fround(current), Math.fround(expected)) };
    case 'double':
      return { comparable: true, equal: Object.is(current, expected) };
    case 'byte':
    case 'int32':
    case 'uint32':
      if (!Number.isFinite(current) || !Number.isFinite(expected) || !Number.isInteger(current) || !Number.isInteger(expected)) {
        return { comparable: false, reason: 'non_finite_integer' };
      }
      return { comparable: true, equal: current === expected };
    case 'int64':
      if (!Number.isSafeInteger(current) || !Number.isSafeInteger(expected)) {
        return { comparable: false, reason: 'unsafe_integer' };
      }
      return { comparable: true, equal: current === expected };
    default:
      return { comparable: false, reason: 'unsupported_type' };
  }
}
export class LiveMemorySession {
  /**
   * Opaque per-session owner id (e.g. the owning WebContents id) for
   * cross-session freeze concurrency tracking. Defaults to a
   * unique-per-instance id so two independently-constructed
   * sessions (e.g. in different tests, or any future caller that forgets to
   * call setOwnerId) never collide in the cross-session freeze-concurrency
   * registry just because they happen to target the same pid/address. The
   * IPC layer always overrides this with the real webContents id.
   */
  private ownerId: string = randomUUID();
  private revoking = false;
  private freezeFeatureFlagCheck: (() => boolean) | null = null;
  private handle: LiveProcessHandle | null = null;
  private target: LiveProcessTarget | null = null;
  private userConfirmedOffline = false;
  private acceptedConnectionBaseline = 0;
  private pendingProposals = new Map<string, LiveWriteProposal>();
  /**
   * Writes this session actually confirmed, keyed by proposalId, each with
   * an expiry timestamp (Batch B1.1). rollback() may ONLY restore a write
   * recorded here — it never trusts a caller-supplied manifest. Each entry
   * is consumed (deleted) the moment it is successfully rolled back, so a
   * rollback authorization cannot be reused.
   */
  private confirmedWrites = new Map<
    string,
    {
      manifest: LiveWriteManifest;
      expiresAtMs: number;
      /**
       * (Gate 2) Exact raw bytes at this address immediately before/after the
       * confirmed write, when capture succeeded. Best-effort — absence just
       * means rollback falls back to the pre-existing numeric-only safety net
       * for that entry; it never blocks a confirm whose real memory write
       * already succeeded. Never exposed outside this class (not part of
       * LiveWriteManifest) and never logged/serialized — see remaining-risks.
       */
      rawBefore: Buffer | null;
      rawAfter: Buffer | null;
    }
  >();
  /** (Gate 2) Raw bytes captured at proposeWrite time, keyed by proposalId, consumed by confirmWrite. */
  private pendingRawBefore = new Map<string, Buffer>();
  /** Testing seam — lets tests move "now" forward without waiting on real TTLs. */
  private nowMsForTests: (() => number) | null = null;
  /** Staged, not-yet-authorized freeze requests, keyed by proposalId. See proposeFreeze/startFreezeConfirmed. */
  private pendingFreezeProposals = new Map<string, FreezeProposal>();
  private remoteConnectionObserver: RemoteConnectionObserverFn = observeRemoteConnections;
  private freezeScheduler: FreezeScheduler = DEFAULT_FREEZE_SCHEDULER;
  private freeze: FreezeState | null = null;
  private freezeGeneration = 0;
  private maxFreezeDurationMs = MAX_FREEZE_DURATION_MS;
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

  /** Testing seam — override the max-freeze-duration ceiling so tests don't need thousands of ticks. */
  _setMaxFreezeDurationMsForTests(ms: number): void {
    this.maxFreezeDurationMs = ms;
  }

  /** Testing seam — inject a fake clock so rollback-ledger TTL tests don't need real elapsed time. */
  _injectNowMsForTests(fn: (() => number) | null): void {
    this.nowMsForTests = fn;
  }

  /** Set once by the IPC layer after construction — identifies this session for cross-session freeze concurrency tracking. */
  setOwnerId(id: string): void {
    this.ownerId = id;
  }

  /**
   * Optional re-check run every freeze tick (Batch B1.1) — lets the IPC
   * layer wire in a live feature-flag read (e.g. v2LiveModeEnabled) without
   * this core module importing settings directly. Returning false stops the
   * freeze with stopReason 'feature_disabled'. Unset means no re-check
   * (matches pre-B1.1 behavior for any caller that doesn't wire one in).
   */
  _injectFreezeFeatureFlagCheck(fn: (() => boolean) | null): void {
    this.freezeFeatureFlagCheck = fn;
    if (fn && !fn()) {
      this.pendingProposals.clear();
      this.pendingRawBefore.clear();
      this.pendingFreezeProposals.clear();
      revokeWriteConsentsForSession(this.ownerId);
      this.stopFreezeInternal('feature_disabled');
    }
  }

  private nowMs(): number {
    return this.nowMsForTests ? this.nowMsForTests() : Date.now();
  }

  isAttached(): boolean {
    return this.handle !== null;
  }

  /** The executable name of the currently attached process, or null if not attached. */
  getAttachedExecutableName(): string | null {
    return this.target?.executableName ?? null;
  }

  /** Attached PID, or null if not attached. */
  getAttachedPid(): number | null {
    return this.target?.pid ?? null;
  }

  /** Fail-closed identity snapshot for consent bindings / confirm. */
  getAttachedIdentity(): {
    pid: number;
    executableName: string;
    executablePath: string;
    startTime: string;
    volumeSerialNumber?: string;
    fileIndex?: string;
    exeSha256?: string;
  } | null {
    if (!this.target?.executablePath?.trim() || !this.target.startTime?.trim()) {
      return null;
    }
    return {
      pid: this.target.pid,
      executableName: this.target.executableName,
      executablePath: this.target.executablePath,
      startTime: this.target.startTime,
      volumeSerialNumber: this.target.volumeSerialNumber,
      fileIndex: this.target.fileIndex,
      exeSha256: this.target.exeSha256,
    };
  }

  isOfflineConfirmed(): boolean {
    return this.userConfirmedOffline;
  }

  getAcceptedConnectionBaseline(): number {
    return this.acceptedConnectionBaseline;
  }

  /** Fresh remote-connection observation for the attached PID (fail-closed callers). */
  async observeAttachedRemoteConnections(): Promise<RemoteConnectionEvidence> {
    if (!this.target) {
      return {
        availability: 'unavailable',
        remoteConnectionCount: 0,
        observedAt: new Date().toISOString(),
        error: 'not_attached',
      };
    }
    // Test-only force: prove confirm fail-closed when online evidence exceeds baseline.
    const forced = process.env.SOLITH_FORCE_REMOTE_CONNECTION_COUNT;
    if (forced != null && forced !== '') {
      const count = Number(forced);
      if (Number.isFinite(count) && count >= 0) {
        return {
          availability: 'available',
          remoteConnectionCount: Math.floor(count),
          observedAt: new Date().toISOString(),
        };
      }
    }
    return this.remoteConnectionObserver(this.target.pid);
  }

  /**
   * Advisory connection observe (KI-017 history). Does not gate writes —
   * use evaluateWriteConsent / isOfflineConfirmed for allow/deny.
   */
  async recheckOnlineGuard(): Promise<OnlineGuardResult> {
    if (!this.target) {
      return { allowed: false, reason: 'No process attached.' };
    }
    const evidence = await this.remoteConnectionObserver(this.target.pid);
    // Diagnostic path still uses connection-count policy for transparency UIs.
    return evaluateOnlineGuard({
      userConfirmedOffline: this.userConfirmedOffline,
      remoteConnections: evidence,
      acceptedConnectionBaseline: this.acceptedConnectionBaseline,
    });
  }

  /** Write/attach consent: waiver only; connection counts are advisory in the reason. */
  async recheckWriteConsent(): Promise<OnlineGuardResult> {
    if (!this.target) {
      return { allowed: false, reason: 'No process attached.' };
    }
    const evidence = await this.remoteConnectionObserver(this.target.pid);
    return evaluateWriteConsent({
      userConfirmedOffline: this.userConfirmedOffline,
      remoteConnections: evidence,
    });
  }

  getMemoryAccess(): { driver: MemoryDriver; handle: LiveProcessHandle } | null {
    if (!this.handle) return null;
    return { driver: this.driver, handle: this.handle };
  }

  /**
   * Re-read the live attached process and confirm identity still matches.
   * Used on destructive confirm paths to mitigate PID reuse.
   * Fail-closed: missing required metadata is an error (no silent downgrade).
   */
  verifyAttachedProcessIdentity(): string | null {
    if (!this.handle || !this.target) {
      return 'No process attached.';
    }

    if (this.handle.pid !== this.target.pid) {
      return `Attached handle PID ${this.handle.pid} does not match session target PID ${this.target.pid}.`;
    }

    if (!this.target.executablePath?.trim() || !this.target.startTime?.trim()) {
      return 'Attached session is missing required process path or creation time; failing closed.';
    }

    let live =
      (this.handle.opaque as { fake?: boolean } | null)?.fake === true
        ? null
        : queryWindowsProcessIdentity(this.handle.pid);
    if (!live) {
      const name = this.driver.getProcessExecutableName(this.handle);
      const exePath = this.driver.getProcessExecutablePath(this.handle);
      const start = this.driver.getProcessStartTime(this.handle);
      if (!name || !exePath || !start) {
        return 'Unable to re-read live process identity (process may have exited).';
      }
      live = {
        pid: this.handle.pid,
        executableName: name,
        executablePath: exePath,
        startTimeIso: start,
        volumeSerialNumber: this.driver.getProcessVolumeSerial?.(this.handle) ?? null,
        fileIndex: this.driver.getProcessFileIndex?.(this.handle) ?? null,
        exeSha256: this.target.exeSha256 ?? null,
      };
      if (!isCompleteProcessIdentity(live)) {
        return 'Live process identity is incomplete (path or creation time unavailable); failing closed.';
      }
    }

    return compareProcessIdentity(
      {
        pid: this.target.pid,
        executableName: this.target.executableName,
        executablePath: this.target.executablePath,
        startTime: this.target.startTime,
        volumeSerialNumber: this.target.volumeSerialNumber,
        fileIndex: this.target.fileIndex,
        exeSha256: this.target.exeSha256,
      },
      live,
    );
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
    this.revoking = false;
    if (this.isAttached()) {
      return { success: false, guard: { allowed: false, reason: 'Session already attached.' }, error: 'already_attached' };
    }

    // Finding 2 (independent security review, ef254d1): the process picker's
    // blocklist (src/app/live-memory/process-picker.ts) only filters the
    // renderer's UI list — it is not a security boundary. This is the
    // authoritative, main-process check, enforced here regardless of what a
    // renderer sent, before consent evaluation or opening any process handle.
    const targetAuthorization = assessTargetProcessAuthorization({
      pid: target.pid,
      executableName: target.executableName,
      executablePath: target.executablePath,
    });
    if (!targetAuthorization.allowed) {
      return {
        success: false,
        guard: { allowed: false, reason: targetAuthorization.reason },
        error: targetAuthorization.reason,
      };
    }

    const acceptedConnectionBaseline =
      fingerprint?.connectionBaseline ?? getConnectionBaseline(target.executableName);
    const evidence = await this.remoteConnectionObserver(target.pid);
    // Trust Shift: attach requires single-player waiver only (connection count advisory).
    const guard = evaluateWriteConsent({ userConfirmedOffline, remoteConnections: evidence });

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

    let openedHandle: LiveProcessHandle;
    try {
      openedHandle = this.driver.openProcess(target.pid);
      this.handle = openedHandle;
    } catch (err) {
      return { success: false, guard, error: `Failed to open process: ${String(err)}` };
    }

    try {
      const protectedTarget = assessProtectedTarget({
        process: { pid: target.pid, executableName: target.executableName, selectedByUser: true },
        modules: this.driver.getModules(openedHandle),
      });
      if (!protectedTarget.allowed) {
        this.driver.closeProcess(openedHandle);
        this.handle = null;
        return { success: false, guard, error: protectedTarget.reason };
      }
    } catch (err) {
      this.driver.closeProcess(openedHandle);
      this.handle = null;
      return { success: false, guard, error: `Protected target check failed closed: ${String(err)}` };
    }

    const preferDriver = (openedHandle.opaque as { fake?: boolean } | null)?.fake === true;
    const osIdentityRaw = preferDriver ? null : queryWindowsProcessIdentity(openedHandle.pid);
    const resolvedOs =
      osIdentityRaw &&
      osIdentityRaw.executableName.toLowerCase() === target.executableName.toLowerCase()
        ? osIdentityRaw
        : null;
    const livePath =
      target.executablePath?.trim() ||
      resolvedOs?.executablePath ||
      this.driver.getProcessExecutablePath(openedHandle) ||
      undefined;
    const liveStart =
      target.startTime?.trim() ||
      resolvedOs?.startTimeIso ||
      this.driver.getProcessStartTime(openedHandle) ||
      undefined;
    const liveName =
      resolvedOs?.executableName ||
      this.driver.getProcessExecutableName(openedHandle) ||
      target.executableName;

    if (!livePath || !liveStart || !isCompleteProcessIdentity({
      executableName: liveName,
      executablePath: livePath,
      startTimeIso: liveStart,
    })) {
      this.driver.closeProcess(openedHandle);
      this.handle = null;
      return {
        success: false,
        guard,
        error: 'incomplete_process_identity',
      };
    }

    if (liveName.toLowerCase() !== target.executableName.toLowerCase()) {
      this.driver.closeProcess(openedHandle);
      this.handle = null;
      return {
        success: false,
        guard,
        error: `Attached process identity mismatch: expected ${target.executableName}, found ${liveName}.`,
      };
    }

    this.target = {
      ...target,
      executableName: liveName,
      executablePath: livePath,
      startTime: liveStart,
      volumeSerialNumber:
        target.volumeSerialNumber ??
        resolvedOs?.volumeSerialNumber ??
        this.driver.getProcessVolumeSerial?.(openedHandle) ??
        undefined,
      fileIndex:
        target.fileIndex ??
        resolvedOs?.fileIndex ??
        this.driver.getProcessFileIndex?.(openedHandle) ??
        undefined,
      exeSha256: target.exeSha256 ?? resolvedOs?.exeSha256 ?? undefined,
    };
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

  /**
   * UX-first manual scan: runs compatible first-scan modes across every value
   * type in one read-only pass matrix, and optionally captures an unknown-value
   * baseline under `unknownKey`. This removes the Cheat Engine-style burden of
   * manually picking Float vs Int vs Double and Exact vs Between vs Greater/Less
   * before the user has enough evidence to know which is right.
   */
  scanFirstAutoMatrix(
    query: AutoFirstScanQuery & { unknownKey?: string } = {},
  ): Omit<AutoFirstScanMatrixResult, 'unknown'> & {
    unknown?: Omit<NonNullable<AutoFirstScanMatrixResult['unknown']>, 'snapshot'>;
  } {
    if (!this.handle) throw new Error('No process attached.');
    const result = scanFirstAutoMatrixRegions(this.driver, this.handle, query);
    if (query.unknownKey && result.unknown) {
      this.unknownSnapshots.set(query.unknownKey, result.unknown.snapshot);
    }
    const { unknown, ...safeResult } = result;
    return {
      ...safeResult,
      ...(unknown
        ? {
            unknown: {
              regionsScanned: unknown.regionsScanned,
              bytesScanned: unknown.bytesScanned,
              truncated: unknown.truncated,
            },
          }
        : {}),
    };
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
    // Gate 2: best-effort exact-byte capture — a failure here does not block
    // staging a proposal (nothing has been written yet); it only means this
    // proposal's eventual rollback falls back to the numeric-only safety net.
    try {
      const rawBefore = this.driver.readBuffer(this.handle, address.address, byteWidthForType(address.dataType));
      this.pendingRawBefore.set(proposal.proposalId, rawBefore);
    } catch {
      // no-op — numeric rollback safety net still applies for this proposal.
    }
    return proposal;
  }

  /** Look up a staged write proposal (for consent binding). */
  getPendingWriteProposal(proposalId: string): LiveWriteProposal | undefined {
    return this.pendingProposals.get(proposalId);
  }

  /** Re-checks write consent (waiver), then executes a previously staged proposal. */
  async confirmWrite(proposalId: string): Promise<ConfirmWriteResult> {
    if (this.revoking) return { success: false, error: 'cleanup_in_progress' };
    if (!this.handle || !this.target) {
      return { success: false, error: 'No process attached.' };
    }

    const proposal = this.pendingProposals.get(proposalId);
    if (!proposal) {
      return { success: false, error: 'Unknown or expired proposal.' };
    }

    const evidence = await this.remoteConnectionObserver(this.target.pid);
    const guard = evaluateWriteConsent({
      userConfirmedOffline: this.userConfirmedOffline,
      remoteConnections: evidence,
    });

    if (!guard.allowed) {
      return { success: false, guard, error: 'Blocked by write consent at write time.' };
    }

    const identityError = this.verifyAttachedProcessIdentity();
    if (identityError) {
      return { success: false, guard, error: identityError };
    }

    // Batch B1.1: check ledger capacity BEFORE writing memory, so a full
    // ledger never leaves an orphan write with no rollback safety net.
    // Expired entries are purged first — only a still-full ledger of VALID
    // entries blocks the confirm.
    this.purgeExpiredConfirmedWrites();
    if (this.confirmedWrites.size >= MAX_CONFIRMED_WRITES) {
      return { success: false, guard, error: 'rollback_ledger_full' };
    }

    // SOL-1 G9: re-check revocation after the `await` above — a revoke()
    // triggered during that async gap must still block the write, not just
    // one issued before confirmWrite() was entered.
    if (this.revoking) return { success: false, guard, error: 'cleanup_in_progress' };

    const pid = this.getAttachedPid();
    const authReq: AuthorityRequest = {
      identity: { kind: 'internal_subsystem', subsystem: 'live-memory-session', sessionKey: 'live-memory-session' },
      capability: 'memory.write',
      target: { kind: 'process', identifier: String(pid ?? 0) },
      risk: 'MODERATE',
      context: {
        isPackaged: false,
        isTestBuild: process.env.SOLITH_TEST_BUILD === '1',
        consentTokenId: undefined,
        freezeActive: this.getFreezeStatus().active,
        emergencyStopActive: false,
        protectedTargetState: undefined,
        operationOrigin: 'internal',
        readOnlyMode: false,
      },
    };
    const authDecision = evaluate(authReq);
    if (authDecision.decision.outcome === 'DENY') {
      return { success: false, guard, error: `Authority DENIED [${authDecision.decision.policyId}]: ${authDecision.decision.reason}` };
    }

    try {
      this.driver.writeMemory(this.handle, proposal.target.address, proposal.target.dataType, proposal.requestedValue);
    } catch (err) {
      return { success: false, guard, error: `Write failed: ${String(err)}` };
    }

    this.pendingProposals.delete(proposalId);
    const rawBefore = this.pendingRawBefore.get(proposalId) ?? null;
    this.pendingRawBefore.delete(proposalId);

    const manifest: LiveWriteManifest = {
      proposalId: proposal.proposalId,
      target: proposal.target,
      valueBefore: proposal.currentValue,
      valueAfter: proposal.requestedValue,
      appliedAt: new Date().toISOString(),
    };
    // Gate 2: best-effort exact-byte capture of the just-applied bytes. A
    // failure here does not undo or fail the confirm — the real write already
    // succeeded — it only means this entry's rollback falls back to the
    // numeric-only safety net (compareRollbackValue), exactly like before
    // this feature existed.
    let rawAfter: Buffer | null = null;
    try {
      rawAfter = this.driver.readBuffer(this.handle, proposal.target.address, byteWidthForType(proposal.target.dataType));
    } catch {
      rawAfter = null;
    }
    this.recordConfirmedWrite(manifest, rawBefore, rawAfter);
    return { success: true, manifest, guard };
  }

  /**
   * Records a confirmed write for later rollback. Capacity is enforced in
   * confirmWrite BEFORE the memory write happens — by the time this runs,
   * the ledger is known to have room. TTL-expires after CONFIRMED_WRITE_TTL_MS.
   */
  private recordConfirmedWrite(manifest: LiveWriteManifest, rawBefore: Buffer | null, rawAfter: Buffer | null): void {
    this.confirmedWrites.set(manifest.proposalId, {
      manifest,
      expiresAtMs: this.nowMs() + CONFIRMED_WRITE_TTL_MS,
      rawBefore,
      rawAfter,
    });
  }

  /**
   * Removes ledger entries whose TTL has elapsed. Never removes a
   * still-valid entry — this is the ONLY eviction mechanism (Batch B1.1
   * replaces the prior FIFO-evict-when-full policy, which could silently
   * drop a still-valid, still-wanted rollback record).
   */
  private purgeExpiredConfirmedWrites(): void {
    const now = this.nowMs();
    for (const [key, entry] of this.confirmedWrites) {
      if (entry.expiresAtMs <= now) this.confirmedWrites.delete(key);
    }
  }

  /**
   * Restores the value captured before a write THIS SESSION actually confirmed.
   * Takes only a proposalId — never a caller-supplied manifest — so a renderer
   * cannot use "rollback" as a disguised arbitrary-address/arbitrary-value write
   * primitive. The manifest is looked up from confirmedWrites (populated solely
   * by confirmWrite) and consumed on success, so the same rollback cannot be
   * replayed. Re-checks write consent and process identity exactly like
   * confirmWrite. Batch B1.1: also re-reads current memory and refuses to
   * proceed if it no longer matches the value this write applied — an
   * intervening independent change (game logic, a concurrent freeze, a
   * second write) is never silently clobbered.
   */
  async rollback(proposalId: string): Promise<RollbackResult> {
    if (this.revoking) return { success: false, error: 'cleanup_in_progress' };
    if (!this.handle || !this.target) {
      return { success: false, error: 'No process attached.' };
    }

    this.purgeExpiredConfirmedWrites();
    const entry = this.confirmedWrites.get(proposalId);
    if (!entry) {
      return { success: false, error: 'Unknown, expired, or already rolled back write.' };
    }
    const manifest = entry.manifest;

    const evidence = await this.remoteConnectionObserver(this.target.pid);
    const guard = evaluateWriteConsent({
      userConfirmedOffline: this.userConfirmedOffline,
      remoteConnections: evidence,
    });

    if (!guard.allowed) {
      return { success: false, guard, error: 'Blocked by write consent at rollback time.' };
    }

    const identityError = this.verifyAttachedProcessIdentity();
    if (identityError) {
      return { success: false, guard, error: identityError };
    }

    let currentValue: number;
    try {
      currentValue = this.driver.readMemory(this.handle, manifest.target.address, manifest.target.dataType);
    } catch (err) {
      return { success: false, guard, error: `Unable to verify current memory before rollback: ${String(err)}` };
    }
    const comparison = compareRollbackValue(manifest.target.dataType, currentValue, manifest.valueAfter);
    if (comparison.comparable === false) {
      return { success: false, guard, error: `rollback_comparison_rejected:${comparison.reason}` };
    }
    if (!comparison.equal) {
      return {
        success: false,
        guard,
        error: 'expected_value_mismatch: current memory no longer matches the value this write applied; refusing to overwrite an independent change.',
      };
    }

    // Gate 2: stricter, additive exact-byte check — only runs when this entry
    // captured raw bytes (best-effort at propose/confirm time). Never loosens
    // the numeric check above; only ever rejects a case the numeric check
    // alone would have let through (e.g. a distinct NaN payload, or a
    // different signed-zero encoding that happens to compare equal/`Object.is`
    // true under the type-normalized numeric policy but differs at the byte
    // level — belt-and-suspenders, since compareRollbackValue's Object.is
    // policy already treats those as equal by design; this exists for the
    // case where raw bytes reveal an intervening change the numeric read
    // masked, e.g. a value written and then written back to the same decoded
    // number by something else).
    if (entry.rawAfter) {
      let currentRawBytes: Buffer;
      try {
        currentRawBytes = this.driver.readBuffer(this.handle, manifest.target.address, entry.rawAfter.length);
      } catch (err) {
        return { success: false, guard, error: `Unable to verify current memory bytes before rollback: ${String(err)}` };
      }
      if (!currentRawBytes.equals(entry.rawAfter)) {
        return {
          success: false,
          guard,
          error:
            'expected_value_mismatch: current memory bytes no longer match the exact bytes this write applied; refusing to overwrite an independent change.',
        };
      }
    }

    // SOL-1 G9: re-check revocation after the `await` above.
    if (this.revoking) return { success: false, guard, error: 'cleanup_in_progress' };

    try {
      if (entry.rawBefore) {
        // Gate 2: single authoritative byte-exact restore — guarantees
        // byte-for-byte fidelity (e.g. the precise NaN payload / signed-zero
        // encoding present before the write), which re-encoding a decoded
        // `number` through writeMemory cannot guarantee. Intentionally NOT
        // followed by a separate writeMemory call: two sequential writes
        // would leave a partial-mutation window if the second one failed
        // (memory already changed, but the caller told "rollback failed").
        this.driver.writeBuffer(this.handle, manifest.target.address, entry.rawBefore);
      } else {
        // Fallback — pre-Gate-2 behavior when exact-byte capture was
        // unavailable for this entry.
        this.driver.writeMemory(this.handle, manifest.target.address, manifest.target.dataType, manifest.valueBefore);
      }
    } catch (err) {
      return { success: false, guard, error: `Rollback write failed: ${String(err)}` };
    }

    // Single-use: this exact confirmed write can only be rolled back once.
    this.confirmedWrites.delete(proposalId);

    return { success: true, guard, manifest };
  }

  /**
   * Stages a freeze request without starting it. Mirrors proposeWrite: this
   * only validates and records the request, it never touches the target
   * process. A native-dialog-backed consent token (see
   * electron/live-memory-ipc.ts freeze-issue-consent) must be issued and
   * consumed via startFreezeConfirmed before any memory is written.
   */
  proposeFreeze(address: LiveMemoryAddress, value: number, intervalMs = DEFAULT_FREEZE_INTERVAL_MS): FreezeProposal {
    if (!this.handle || !this.target) throw new Error('No process attached.');
    if (!Number.isFinite(value)) throw new Error('Freeze value must be a finite number.');
    if (!Number.isInteger(intervalMs) || intervalMs < MIN_FREEZE_INTERVAL_MS || intervalMs > MAX_FREEZE_INTERVAL_MS) {
      throw new Error(`Freeze interval must be an integer between ${MIN_FREEZE_INTERVAL_MS} and ${MAX_FREEZE_INTERVAL_MS}ms.`);
    }
    const proposal: FreezeProposal = {
      proposalId: randomUUID(),
      target: address,
      value,
      intervalMs,
      createdAt: new Date().toISOString(),
    };
    this.pendingFreezeProposals.set(proposal.proposalId, proposal);
    return proposal;
  }

  /** Look up a staged freeze proposal (for consent binding). */
  getPendingFreezeProposal(proposalId: string): FreezeProposal | undefined {
    return this.pendingFreezeProposals.get(proposalId);
  }

  /**
   * Starts a previously-proposed freeze using ONLY the parameters recorded
   * at proposal time — the caller supplies just a proposalId, never fresh
   * address/value/interval, so a confirm call structurally cannot start a
   * freeze with different parameters than what was approved. Single-use:
   * the proposal is consumed (deleted) once consumed here, whether or not
   * the resulting startFreeze call itself succeeds — a stale/failed attempt
   * must not remain replayable.
   */
  startFreezeConfirmed(proposalId: string): StartFreezeResult {
    if (this.revoking) return { success: false, error: 'cleanup_in_progress' };
    const proposal = this.pendingFreezeProposals.get(proposalId);
    if (!proposal) {
      return { success: false, error: 'Unknown or already-consumed freeze proposal.' };
    }
    this.pendingFreezeProposals.delete(proposalId);
    return this.startFreeze(proposal.target, proposal.value, proposal.intervalMs);
  }

  /**
   * Starts continuously re-writing `value` to `address` on an interval —
   * mirrors mainstream "Infinite Health"/"Infinite Ammo" toggles. Every
   * tick re-checks write consent (single-player waiver). Connection counts
   * are advisory only and do not stop the freeze. Waiver loss or identity
   * mismatch stops the freeze.
   */
  startFreeze(address: LiveMemoryAddress, value: number, intervalMs = DEFAULT_FREEZE_INTERVAL_MS): StartFreezeResult {
    if (!this.handle || !this.target) {
      return { success: false, error: 'No process attached.' };
    }
    if (this.freeze?.active) {
      return { success: false, error: 'A freeze is already active on this session. Stop it first.' };
    }
    // Defense in depth: the IPC schema already bounds these, but the session API is
    // also callable directly (library/tests) — never rely solely on renderer/IPC validation.
    if (!Number.isFinite(value)) {
      return { success: false, error: 'Freeze value must be a finite number.' };
    }
    if (!Number.isInteger(intervalMs) || intervalMs < MIN_FREEZE_INTERVAL_MS || intervalMs > MAX_FREEZE_INTERVAL_MS) {
      return {
        success: false,
        error: `Freeze interval must be an integer between ${MIN_FREEZE_INTERVAL_MS} and ${MAX_FREEZE_INTERVAL_MS}ms.`,
      };
    }

    // Batch B1.1: cross-session concurrency limits — "one freeze per session" alone does
    // not stop a DIFFERENT session (e.g. main window + overlay window) from independently
    // freezing the same process, including the same address.
    const owner = this.ownerId;
    const registration = registerActiveFreeze(owner, this.target.pid, address.address.toString(), address.dataType);
    if (registration.ok === false) {
      return { success: false, error: `freeze_concurrency_limit:${registration.reason}` };
    }

    this.freezeGeneration += 1;
    const generation = this.freezeGeneration;

    this.freeze = {
      target: { address, value },
      active: true,
      timer: null,
      tickCount: 0,
      lastGuard: null,
      intervalMs,
    };

    const tick = async (): Promise<void> => {
      if (generation !== this.freezeGeneration || !this.freeze?.active || !this.handle || !this.target) return;

      const evidence = await this.remoteConnectionObserver(this.target.pid);
      const guard = evaluateWriteConsent({
        userConfirmedOffline: this.userConfirmedOffline,
        remoteConnections: evidence,
      });

      // Stale: stopped/replaced while awaiting the guard check.
      if (generation !== this.freezeGeneration || !this.freeze?.active) return;
      // SOL-1 G9: re-check revocation after the `await` above.
      if (this.revoking) return;

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

      if (this.freezeFeatureFlagCheck && !this.freezeFeatureFlagCheck()) {
        this.stopFreezeInternal('feature_disabled');
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
        // tickCount * intervalMs approximates elapsed run time under normal scheduling —
        // deterministic and testable via the injectable FreezeScheduler, unlike wall-clock time.
        const elapsedMs = this.freeze.tickCount * this.freeze.intervalMs;
        if (elapsedMs >= this.maxFreezeDurationMs) {
          this.stopFreezeInternal('max_duration_exceeded');
          return;
        }
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
    if (this.target) {
      unregisterActiveFreeze(
        this.ownerId,
        this.target.pid,
        this.freeze.target.address.address.toString(),
        this.freeze.target.address.dataType,
      );
    }
    this.freeze.active = false;
    this.freeze.stopReason = reason;
  }

  /** Phase-one cleanup barrier: invalidates in-flight ticks and blocks privileged writes. */
  beginCleanupRevocation(): void {
    this.revoking = true;
    this.freezeGeneration += 1;
  }

  revokePendingAuthorizationsForCleanup(): void {
    this.pendingProposals.clear();
    this.pendingRawBefore.clear();
    this.pendingFreezeProposals.clear();
  }

  stopFreezeForCleanup(): void {
    this.stopFreezeInternal('detached');
    unregisterAllFreezesForOwner(this.ownerId);
  }

  clearRollbackRecordsForCleanup(): void {
    this.confirmedWrites.clear();
  }

  detachMemoryForCleanup(): void {
    if (this.handle) this.driver.closeProcess(this.handle);
    this.handle = null;
    this.target = null;
    this.unknownSnapshots.clear();
    this.addressCache.clear();
    this.lastFingerprint = null;
    this.catalogGameId = null;
  }
  detach(): void {
    this.stopFreezeInternal('detached');
    unregisterAllFreezesForOwner(this.ownerId);
    if (this.handle) {
      this.driver.closeProcess(this.handle);
    }
    this.handle = null;
    this.target = null;
    this.pendingProposals.clear();
    this.pendingRawBefore.clear();
    this.confirmedWrites.clear();
    this.pendingFreezeProposals.clear();
    this.unknownSnapshots.clear();
    this.addressCache.clear();
    this.lastFingerprint = null;
    this.catalogGameId = null;
  }
}
