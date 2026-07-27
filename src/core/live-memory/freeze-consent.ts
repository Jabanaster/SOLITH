import { randomBytes, randomUUID } from 'node:crypto';

export const LIVE_MEMORY_FREEZE_START_OPERATION = 'live-memory-freeze-start' as const;
export const DEFAULT_FREEZE_CONSENT_TTL_MS = 60_000;

export interface FreezeConsentDetails {
  operation?: typeof LIVE_MEMORY_FREEZE_START_OPERATION;
  pid: number;
  processIdentity: string;
  address: string;
  dataType: string;
  value: number;
  intervalMs: number;
  maxDurationMs: number;
  rendererId?: number | null;
}

export type FreezeConsentState = 'PROPOSED' | 'APPROVED';

export interface FreezeConsentRecord {
  tokenId?: string;
  proposalId: string;
  operation: typeof LIVE_MEMORY_FREEZE_START_OPERATION;
  pid: number;
  processIdentity: string;
  address: string;
  dataType: string;
  value: number;
  intervalMs: number;
  maxDurationMs: number;
  rendererId: number | null;
  issuedAt: number;
  expiresAt: number;
  state: FreezeConsentState;
}

export type FreezeConsentPreview = Omit<FreezeConsentRecord, 'tokenId' | 'state'> & {
  state: 'PROPOSED';
};

export interface FreezeConsentConfirmation {
  rendererId?: number | null;
  /**
   * Kept in the call shape for IPC/UI adapters, but never authorizes approval.
   * The injected confirmation provider is the sole approval authority.
   */
  confirm?: boolean;
}

export type FreezeConsentApprovalResult =
  | { ok: true; tokenId: string; record: FreezeConsentRecord }
  | {
      ok: false;
      code: 'missing' | 'expired' | 'renderer_mismatch' | 'not_approved' | 'confirmation_unavailable' | 'confirmation_denied' | 'malformed';
    };

export interface FreezeConsentBinding {
  operation: typeof LIVE_MEMORY_FREEZE_START_OPERATION;
  pid: number;
  processIdentity: string;
  address: string;
  dataType: string;
  value: number;
  intervalMs: number;
  maxDurationMs: number;
  rendererId?: number | null;
}

export type FreezeConsentConsumeResult =
  | { ok: true; record: FreezeConsentRecord }
  | {
      ok: false;
      code: 'missing' | 'expired' | 'replayed' | 'pid_mismatch' | 'duration_mismatch' |
        'operation_mismatch' | 'renderer_mismatch' | 'not_approved' | 'malformed';
    };

export type FreezeConsentConfirmationProvider = (
  preview: FreezeConsentPreview,
) => boolean | Promise<boolean>;

export interface FreezeConsentStoreOptions {
  ttlMs?: number;
  now?: () => number;
  randomToken?: () => string;
  confirmationProvider?: FreezeConsentConfirmationProvider;
}

export function redactFreezeConsentRecord(
  record: FreezeConsentRecord | FreezeConsentPreview,
): Omit<FreezeConsentRecord, 'tokenId'> & { tokenId?: string } {
  const tokenId = 'tokenId' in record ? record.tokenId : undefined;
  const safe = { ...record } as Omit<FreezeConsentRecord, 'tokenId'>;
  delete (safe as Partial<FreezeConsentRecord>).tokenId;
  return {
    ...safe,
    ...(tokenId ? { tokenId: `${tokenId.slice(0, 4)}…redacted` } : {}),
  };
}

export class FreezeConsentStore {
  private readonly records = new Map<string, FreezeConsentRecord>();
  private readonly consumed = new Set<string>();
  private readonly expired = new Set<string>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly randomToken: () => string;
  private readonly confirmationProvider?: FreezeConsentConfirmationProvider;

  constructor(options: FreezeConsentStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_FREEZE_CONSENT_TTL_MS;
    this.now = options.now ?? Date.now;
    this.randomToken =
      options.randomToken ??
      (() => randomBytes(32).toString('hex'));
    this.confirmationProvider = options.confirmationProvider;
    if (!Number.isFinite(this.ttlMs) || this.ttlMs <= 0) {
      throw new Error('Freeze consent TTL must be positive.');
    }
  }

  propose(details: FreezeConsentDetails): FreezeConsentPreview {
    const now = this.now();
    const record: FreezeConsentRecord = {
      proposalId: randomUUID(),
      operation: details.operation ?? LIVE_MEMORY_FREEZE_START_OPERATION,
      pid: details.pid,
      processIdentity: details.processIdentity,
      address: details.address,
      dataType: details.dataType,
      value: details.value,
      intervalMs: details.intervalMs,
      maxDurationMs: details.maxDurationMs,
      rendererId: details.rendererId ?? null,
      issuedAt: now,
      expiresAt: now + this.ttlMs,
      state: 'PROPOSED',
    };
    this.records.set(record.proposalId, record);
    return this.preview(record);
  }

  async approve(
    proposalId: string,
    request: FreezeConsentConfirmation = {},
  ): Promise<FreezeConsentApprovalResult> {
    this.pruneExpired();
    const record = this.records.get(proposalId);
    if (!record) return { ok: false, code: 'missing' };
    if (this.now() >= record.expiresAt) {
      this.records.delete(proposalId);
      return { ok: false, code: 'expired' };
    }
    if (record.state !== 'PROPOSED') return { ok: false, code: 'not_approved' };
    if ((request.rendererId ?? null) !== record.rendererId) {
      return { ok: false, code: 'renderer_mismatch' };
    }
    if (!this.confirmationProvider) {
      return { ok: false, code: 'confirmation_unavailable' };
    }

    let confirmed = false;
    try {
      confirmed = await this.confirmationProvider(this.preview(record));
    } catch {
      return { ok: false, code: 'confirmation_denied' };
    }
    if (!confirmed) return { ok: false, code: 'confirmation_denied' };

    const tokenId = this.randomToken();
    if (!/^[0-9a-f]{64}$/i.test(tokenId)) {
      return { ok: false, code: 'malformed' };
    }
    this.records.delete(proposalId);
    record.tokenId = tokenId;
    record.state = 'APPROVED';
    this.records.set(tokenId, record);
    return { ok: true, tokenId, record: { ...record } };
  }

  consume(tokenId: string, expected: FreezeConsentBinding): FreezeConsentConsumeResult {
    this.pruneExpired();
    if (typeof tokenId !== 'string' || !/^[0-9a-f]{64}$/i.test(tokenId)) {
      return { ok: false, code: 'malformed' };
    }

    // Delete before checking expiry or any operation binding. This is the
    // single-use boundary and remains atomic within the main-process event loop.
    const record = this.records.get(tokenId);
    if (!record) {
      if (this.consumed.has(tokenId)) return { ok: false, code: 'replayed' };
      if (this.expired.has(tokenId)) {
        this.consumed.add(tokenId);
        return { ok: false, code: 'expired' };
      }
      return { ok: false, code: 'missing' };
    }
    this.records.delete(tokenId);
    this.consumed.add(tokenId);

    if (this.now() >= record.expiresAt) return { ok: false, code: 'expired' };
    if (record.state !== 'APPROVED' || !record.tokenId) return { ok: false, code: 'not_approved' };
    if (!isBindingValid(expected)) return { ok: false, code: 'malformed' };
    if (record.operation !== expected.operation) return { ok: false, code: 'operation_mismatch' };
    if (record.pid !== expected.pid || record.processIdentity !== expected.processIdentity ||
        record.address !== expected.address || record.dataType !== expected.dataType ||
        record.value !== expected.value) {
      return { ok: false, code: 'pid_mismatch' };
    }
    if (record.intervalMs !== expected.intervalMs || record.maxDurationMs !== expected.maxDurationMs) {
      return { ok: false, code: 'duration_mismatch' };
    }
    if (record.rendererId !== (expected.rendererId ?? null)) {
      return { ok: false, code: 'renderer_mismatch' };
    }
    return { ok: true, record: { ...record } };
  }

  private preview(record: FreezeConsentRecord): FreezeConsentPreview {
    const { tokenId: _tokenId, state: _state, ...details } = record;
    return { ...details, state: 'PROPOSED' };
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [key, record] of this.records) {
      if (now >= record.expiresAt) {
        this.records.delete(key);
        if (record.tokenId) this.expired.add(record.tokenId);
      }
    }
  }
}

function isBindingValid(binding: FreezeConsentBinding): boolean {
  return typeof binding.operation === 'string' &&
    Number.isInteger(binding.pid) &&
    typeof binding.processIdentity === 'string' &&
    typeof binding.address === 'string' &&
    typeof binding.dataType === 'string' &&
    Number.isFinite(binding.value) &&
    Number.isInteger(binding.intervalMs) &&
    Number.isInteger(binding.maxDurationMs);
}
