import { randomUUID } from 'node:crypto';
import type { MemoryFeatureV1 } from '../../src/core/definitions/schema.v1.js';
import type { WriteCallOptions } from '../../src/core/live-memory/memory-manager.js';
import type {
  AttachFingerprintOptions,
  AttachResult,
  RollbackResult,
  StartFreezeResult,
} from '../../src/core/live-memory/live-memory-session.js';
import type { ConfirmWriteManagerResult } from '../../src/core/live-memory/memory-manager.js';
import type {
  FreezeProposal,
  FreezeStatus,
  LiveMemoryAddress,
  LiveProcessTarget,
  LiveWriteManifest,
  LiveWriteProposal,
} from '../../src/core/live-memory/types.js';
import type { TrainerRuntimeCapabilities } from '../../src/core/trainer-runtime/capabilities.js';

/**
 * Deterministic, fully-scriptable TrainerRuntimeCapabilities for P4-5 tests.
 * Test-only infrastructure — not a production fallback. Unlike
 * FakeMemoryDriver (which simulates the native memory boundary underneath a
 * *real* LiveMemorySession/MemoryManager), this fake implements the P4-5
 * capability interface directly, so failure modes that don't exist in the
 * real system's normal operation (e.g. "AOB capability unavailable") can be
 * simulated precisely without fighting real session state machinery.
 *
 * Defaults behave like a working system (happy path needs no scripting);
 * set the `next*` fields to inject a specific failure for the next call.
 */
export class FakeTrainerRuntimeCapabilities implements TrainerRuntimeCapabilities {
  private attached = false;
  private readonly pendingWrites = new Map<string, LiveWriteProposal>();
  private readonly confirmedWrites = new Map<string, LiveWriteManifest>();
  private freeze: { address: LiveMemoryAddress; value: number; active: boolean } | null = null;
  private pendingFreeze: FreezeProposal | null = null;

  /** Address resolveFeature() returns for a given feature id, or a specific error message to throw instead. */
  resolvedAddresses = new Map<string, LiveMemoryAddress>();
  resolveErrors = new Map<string, string>();

  /** When set, the next attach() call returns this instead of succeeding normally. */
  nextAttachResult: AttachResult | null = null;
  /** When set, verifyIdentity() returns this instead of null (simulates process loss / stale PID). */
  identityError: string | null = null;
  /** When set, the next proposeWrite() throws this message instead of succeeding. */
  nextProposeWriteError: string | null = null;
  /** When set, the next confirmWrite() returns this instead of a real success. */
  nextConfirmWriteResult: ConfirmWriteManagerResult | null = null;
  /** When set, the next rollback() returns this instead of a real success. */
  nextRollbackResult: RollbackResult | null = null;
  /** When set, the next proposeFreeze() throws this message instead of succeeding. */
  nextProposeFreezeError: string | null = null;
  /** When set, the next freezeStart() returns this instead of a real success. */
  nextFreezeStartResult: StartFreezeResult | null = null;

  isAttached(): boolean {
    return this.attached;
  }

  async attach(_target: LiveProcessTarget, userConfirmedOffline: boolean, _fingerprint?: AttachFingerprintOptions): Promise<AttachResult> {
    if (this.nextAttachResult) {
      const result = this.nextAttachResult;
      this.nextAttachResult = null;
      if (result.success) this.attached = true;
      return result;
    }
    this.attached = true;
    return { success: true, guard: { allowed: userConfirmedOffline, reason: userConfirmedOffline ? 'ok' : 'waiver required' } };
  }

  detach(): void {
    this.attached = false;
    this.pendingWrites.clear();
    this.confirmedWrites.clear();
    this.freeze = null;
    this.pendingFreeze = null;
  }

  verifyIdentity(): string | null {
    return this.identityError;
  }

  async resolveFeature(feature: MemoryFeatureV1): Promise<LiveMemoryAddress> {
    const error = this.resolveErrors.get(feature.id);
    if (error) throw new Error(error);
    const address = this.resolvedAddresses.get(feature.id);
    if (!address) throw new Error(`FakeTrainerRuntimeCapabilities: no resolvedAddresses entry seeded for feature "${feature.id}".`);
    return address;
  }

  read(address: LiveMemoryAddress, _reason?: string): number {
    return Number(address.address);
  }

  proposeWrite(address: LiveMemoryAddress, requestedValue: number, _options?: WriteCallOptions): LiveWriteProposal {
    if (this.nextProposeWriteError) {
      const message = this.nextProposeWriteError;
      this.nextProposeWriteError = null;
      throw new Error(message);
    }
    const proposal: LiveWriteProposal = {
      proposalId: randomUUID(),
      target: address,
      currentValue: 0,
      requestedValue,
      createdAt: new Date().toISOString(),
    };
    this.pendingWrites.set(proposal.proposalId, proposal);
    return proposal;
  }

  async confirmWrite(proposalId: string, _options?: WriteCallOptions): Promise<ConfirmWriteManagerResult> {
    if (this.nextConfirmWriteResult) {
      const result = this.nextConfirmWriteResult;
      this.nextConfirmWriteResult = null;
      return result;
    }
    const proposal = this.pendingWrites.get(proposalId);
    if (!proposal) return { success: false, error: 'Unknown or already-consumed write proposal.' };
    this.pendingWrites.delete(proposalId);
    const manifest: LiveWriteManifest = {
      proposalId,
      target: proposal.target,
      valueBefore: proposal.currentValue,
      valueAfter: proposal.requestedValue,
      appliedAt: new Date().toISOString(),
    };
    this.confirmedWrites.set(proposalId, manifest);
    return { success: true, manifest };
  }

  async rollback(proposalId: string, _featureId?: string): Promise<RollbackResult> {
    if (this.nextRollbackResult) {
      const result = this.nextRollbackResult;
      this.nextRollbackResult = null;
      return result;
    }
    const manifest = this.confirmedWrites.get(proposalId);
    if (!manifest) return { success: false, error: 'Unknown or already-consumed write proposal.' };
    this.confirmedWrites.delete(proposalId);
    return { success: true, manifest };
  }

  proposeFreeze(address: LiveMemoryAddress, value: number, intervalMs = 200): FreezeProposal {
    if (this.nextProposeFreezeError) {
      const message = this.nextProposeFreezeError;
      this.nextProposeFreezeError = null;
      throw new Error(message);
    }
    const proposal: FreezeProposal = { proposalId: randomUUID(), target: address, value, intervalMs, createdAt: new Date().toISOString() };
    this.pendingFreeze = proposal;
    return proposal;
  }

  async freezeStart(
    proposalId: string,
    _options: { consentToken: string; consentBinding: unknown; featureId?: string },
  ): Promise<StartFreezeResult> {
    if (this.nextFreezeStartResult) {
      const result = this.nextFreezeStartResult;
      this.nextFreezeStartResult = null;
      return result;
    }
    if (!this.pendingFreeze || this.pendingFreeze.proposalId !== proposalId) {
      return { success: false, error: 'Unknown or already-consumed freeze proposal.' };
    }
    this.freeze = { address: this.pendingFreeze.target, value: this.pendingFreeze.value, active: true };
    this.pendingFreeze = null;
    return { success: true };
  }

  stopFreeze(): FreezeStatus {
    if (this.freeze) this.freeze.active = false;
    return this.getFreezeStatus();
  }

  getFreezeStatus(): FreezeStatus {
    if (!this.freeze) return { active: false, target: null, lastGuard: null, tickCount: 0 };
    return {
      active: this.freeze.active,
      target: { address: this.freeze.address, value: this.freeze.value },
      lastGuard: { allowed: true, reason: 'ok' },
      tickCount: 0,
    };
  }
}
