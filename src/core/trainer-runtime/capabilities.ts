import type { MemoryFeatureV1 } from '../definitions/schema.v1.js';
import type {
  AttachFingerprintOptions,
  AttachResult,
  LiveMemorySession,
  RollbackResult,
  StartFreezeResult,
} from '../live-memory/live-memory-session.js';
import type { ConfirmWriteManagerResult, MemoryManager, WriteCallOptions } from '../live-memory/memory-manager.js';
import type {
  FreezeProposal,
  FreezeStatus,
  LiveMemoryAddress,
  LiveProcessTarget,
  LiveWriteProposal,
} from '../live-memory/types.js';
import type { WriteConsentBinding } from '../consent/write-consent.js';

/**
 * The seam between the canonical trainer runtime (Phase 4) and the real
 * live-memory implementation (Phase 2). Deliberately mirrors
 * LiveMemorySession/MemoryManager's own method names and signatures almost
 * 1:1 rather than inventing a new shape — the point is composition, not a
 * redesign. Methods that throw on the real session/manager (resolveFeature,
 * read, proposeWrite, proposeFreeze) keep that throwing signature here too;
 * callers in this module catch and classify (see errors.ts).
 *
 * Phase 2 stays fully replaceable: anything implementing this interface
 * (the real adapter below, or a test fake) can back the runtime.
 */
export interface TrainerRuntimeCapabilities {
  isAttached(): boolean;
  attach(target: LiveProcessTarget, userConfirmedOffline: boolean, fingerprint?: AttachFingerprintOptions): Promise<AttachResult>;
  detach(): void;
  /** Mirrors LiveMemorySession.verifyAttachedProcessIdentity(): null = OK, string = reason it is not. */
  verifyIdentity(): string | null;
  /**
   * P4-10: the identity of the process this capability is currently attached
   * to, without opening a new handle — the seam `bindExisting()` uses to
   * cross-check a borrowed session against the caller's claimed target
   * instead of re-attaching. Mirrors LiveMemorySession.getAttachedIdentity().
   */
  getAttachedIdentity(): {
    pid: number;
    executableName: string;
    executablePath: string;
    startTime: string;
    volumeSerialNumber?: string;
    fileIndex?: string;
    exeSha256?: string;
  } | null;
  resolveFeature(feature: MemoryFeatureV1): Promise<LiveMemoryAddress>;
  read(address: LiveMemoryAddress, reason?: string): number;
  proposeWrite(address: LiveMemoryAddress, requestedValue: number, options?: WriteCallOptions): LiveWriteProposal;
  confirmWrite(proposalId: string, options?: WriteCallOptions): Promise<ConfirmWriteManagerResult>;
  rollback(proposalId: string, featureId?: string): Promise<RollbackResult>;
  proposeFreeze(address: LiveMemoryAddress, value: number, intervalMs?: number): FreezeProposal;
  freezeStart(
    proposalId: string,
    options: { consentToken: string; consentBinding: WriteConsentBinding; featureId?: string },
  ): Promise<StartFreezeResult>;
  stopFreeze(): FreezeStatus;
  getFreezeStatus(): FreezeStatus;
}

/** Real, production adapter — thin pass-through to LiveMemorySession + MemoryManager. No new logic. */
export class LiveMemoryCapabilities implements TrainerRuntimeCapabilities {
  constructor(
    private readonly session: LiveMemorySession,
    private readonly manager: MemoryManager,
  ) {}

  isAttached(): boolean {
    return this.session.isAttached();
  }

  attach(target: LiveProcessTarget, userConfirmedOffline: boolean, fingerprint?: AttachFingerprintOptions): Promise<AttachResult> {
    return this.session.attach(target, userConfirmedOffline, fingerprint);
  }

  detach(): void {
    this.session.detach();
  }

  verifyIdentity(): string | null {
    return this.session.verifyAttachedProcessIdentity();
  }

  getAttachedIdentity() {
    return this.session.getAttachedIdentity();
  }

  resolveFeature(feature: MemoryFeatureV1): Promise<LiveMemoryAddress> {
    return this.session.resolveMemoryFeature(feature);
  }

  read(address: LiveMemoryAddress, reason?: string): number {
    return this.manager.read(address, reason);
  }

  proposeWrite(address: LiveMemoryAddress, requestedValue: number, options?: WriteCallOptions): LiveWriteProposal {
    return this.manager.proposeWrite(address, requestedValue, options);
  }

  confirmWrite(proposalId: string, options?: WriteCallOptions): Promise<ConfirmWriteManagerResult> {
    return this.manager.confirmWrite(proposalId, options);
  }

  rollback(proposalId: string, featureId?: string): Promise<RollbackResult> {
    return this.manager.rollback(proposalId, featureId);
  }

  proposeFreeze(address: LiveMemoryAddress, value: number, intervalMs?: number): FreezeProposal {
    return intervalMs === undefined
      ? this.session.proposeFreeze(address, value)
      : this.session.proposeFreeze(address, value, intervalMs);
  }

  freezeStart(
    proposalId: string,
    options: { consentToken: string; consentBinding: WriteConsentBinding; featureId?: string },
  ): Promise<StartFreezeResult> {
    return this.manager.freezeStart(proposalId, options);
  }

  stopFreeze(): FreezeStatus {
    return this.session.stopFreeze();
  }

  getFreezeStatus(): FreezeStatus {
    return this.session.getFreezeStatus();
  }
}
