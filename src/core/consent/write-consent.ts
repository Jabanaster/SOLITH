/**
 * Operation-bound write / injector consent artifacts.
 *
 * Short-lived, single-use tokens bound to an operation hash (proposal, session,
 * PID, executable identity, optional address/value/path). Privileged code must
 * issue these only after a main-process confirmation surface; confirm paths must
 * consume them.
 */
import { createHash, randomUUID } from 'node:crypto';

export const WRITE_CONSENT_TTL_MS = 5 * 60 * 1000;

export type ConsentOperation =
  | 'live_memory_confirm_write'
  | 'injector_confirm_launch';

export interface WriteConsentBinding {
  operation: ConsentOperation;
  sessionKey: string;
  proposalId: string;
  attachedPid: number;
  attachedExecutableName: string;
  /** Canonical attached executable path (required for privileged destructive ops). */
  executablePath?: string;
  /** UTC ISO process creation time. */
  processStartTime?: string;
  volumeSerialNumber?: string;
  fileIndex?: string;
  attachedExeSha256?: string;
  /** Memory write target address as decimal string. */
  address?: string;
  dataType?: string;
  currentValue?: number;
  requestedValue?: number;
  /** Injector helper absolute path. */
  exePath?: string;
  exeSha256?: string;
}

export interface WriteConsentArtifact {
  tokenId: string;
  bindingHash: string;
  operation: ConsentOperation;
  proposalId: string;
  expiresAt: string;
  createdAt: string;
}

interface StoredConsent {
  bindingHash: string;
  operation: ConsentOperation;
  proposalId: string;
  expiresAtMs: number;
  consumed: boolean;
}

const store = new Map<string, StoredConsent>();

export function hashConsentBinding(binding: WriteConsentBinding): string {
  const payload = JSON.stringify({
    operation: binding.operation,
    sessionKey: binding.sessionKey,
    proposalId: binding.proposalId,
    attachedPid: binding.attachedPid,
    attachedExecutableName: binding.attachedExecutableName.toLowerCase(),
    executablePath: binding.executablePath ? binding.executablePath.toLowerCase() : null,
    processStartTime: binding.processStartTime ?? null,
    volumeSerialNumber: binding.volumeSerialNumber ?? null,
    fileIndex: binding.fileIndex ?? null,
    attachedExeSha256: binding.attachedExeSha256 ? binding.attachedExeSha256.toLowerCase() : null,
    address: binding.address ?? null,
    dataType: binding.dataType ?? null,
    currentValue: binding.currentValue ?? null,
    requestedValue: binding.requestedValue ?? null,
    exePath: binding.exePath ? binding.exePath.toLowerCase() : null,
    exeSha256: binding.exeSha256 ? binding.exeSha256.toLowerCase() : null,
  });
  return createHash('sha256').update(payload).digest('hex');
}

export function issueWriteConsent(
  binding: WriteConsentBinding,
  options: { ttlMs?: number; nowMs?: number } = {},
): WriteConsentArtifact {
  if (!Number.isInteger(binding.attachedPid) || binding.attachedPid <= 0) {
    throw new Error('Consent requires a valid attached PID.');
  }
  if (!binding.sessionKey || !binding.proposalId || !binding.attachedExecutableName.trim()) {
    throw new Error('Consent binding is incomplete.');
  }
  if (!binding.executablePath?.trim() || !binding.processStartTime?.trim()) {
    throw new Error('Consent requires fail-closed process path and creation time.');
  }
  const nowMs = options.nowMs ?? Date.now();
  const ttlMs = options.ttlMs ?? WRITE_CONSENT_TTL_MS;
  const bindingHash = hashConsentBinding(binding);
  const tokenId = randomUUID();
  const createdAt = new Date(nowMs).toISOString();
  const expiresAtMs = nowMs + ttlMs;
  store.set(tokenId, {
    bindingHash,
    operation: binding.operation,
    proposalId: binding.proposalId,
    expiresAtMs,
    consumed: false,
  });
  return {
    tokenId,
    bindingHash,
    operation: binding.operation,
    proposalId: binding.proposalId,
    createdAt,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

export type ConsumeConsentResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Validate binding match, expiry, and single-use; consume on success.
 */
export function consumeWriteConsent(
  tokenId: string,
  binding: WriteConsentBinding,
  options: { nowMs?: number } = {},
): ConsumeConsentResult {
  const entry = store.get(tokenId);
  if (!entry) {
    return { ok: false, reason: 'Unknown or already-used consent token.' };
  }
  if (entry.consumed) {
    return { ok: false, reason: 'Consent token already consumed.' };
  }
  const nowMs = options.nowMs ?? Date.now();
  if (entry.expiresAtMs <= nowMs) {
    store.delete(tokenId);
    return { ok: false, reason: 'Consent token expired.' };
  }
  if (entry.operation !== binding.operation || entry.proposalId !== binding.proposalId) {
    return { ok: false, reason: 'Consent token does not match this operation.' };
  }
  const bindingHash = hashConsentBinding(binding);
  if (bindingHash !== entry.bindingHash) {
    return { ok: false, reason: 'Consent token binding mismatch.' };
  }
  entry.consumed = true;
  store.delete(tokenId);
  return { ok: true };
}

export function peekWriteConsent(tokenId: string): StoredConsent | undefined {
  const entry = store.get(tokenId);
  return entry ? { ...entry } : undefined;
}

export function clearWriteConsentStore(): void {
  store.clear();
}
