export type FreezeSessionState =
  | 'PROPOSED'
  | 'APPROVED'
  | 'STARTING'
  | 'ACTIVE'
  | 'STOPPING'
  | 'STOPPED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'FAILED'
  | 'CLEANUP_FAILED';

export type FreezeCleanupState = 'PENDING' | 'SUCCEEDED' | 'FAILED';

export interface FreezeSessionRecord {
  freezeSessionId: string;
  rendererId: number;
  frameId?: number;
  pid: number;
  startedAt: number;
  expiresAt: number;
  approvalTokenId: string;
  state: FreezeSessionState;
  cleanupState: FreezeCleanupState;
}

export interface FreezeSessionAuditEvent {
  op:
    | 'freeze_proposed'
    | 'freeze_approved'
    | 'freeze_started'
    | 'freeze_stopped'
    | 'freeze_expired'
    | 'freeze_cleanup_failed';
  at: number;
  freezeSessionId: string;
  from: FreezeSessionState;
  to: FreezeSessionState;
  reason?: string;
  error?: string;
  rendererId: number;
  pid: number;
}

export interface FreezeSessionAuditSink {
  emit(event: FreezeSessionAuditEvent): void;
}

export interface FreezeSessionScheduler {
  schedule(fn: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export interface FreezeSessionRegistryOptions {
  audit: FreezeSessionAuditSink;
  cleanup: (record: FreezeSessionRecord) => void;
  now?: () => number;
  scheduler?: FreezeSessionScheduler;
}

export type FreezeSessionTransitionResult =
  | { ok: true; record: FreezeSessionRecord }
  | { ok: false; code: 'missing' | 'invalid_transition' | 'not_owner' | 'cleanup_failed'; error?: string };

const DEFAULT_SCHEDULER: FreezeSessionScheduler = {
  schedule: (fn, delayMs) => setTimeout(fn, delayMs),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const TRANSITIONS: Record<FreezeSessionState, FreezeSessionState[]> = {
  PROPOSED: ['APPROVED', 'CANCELLED', 'EXPIRED', 'FAILED'],
  APPROVED: ['STARTING', 'CANCELLED', 'EXPIRED', 'FAILED'],
  STARTING: ['ACTIVE', 'FAILED', 'STOPPING'],
  ACTIVE: ['STOPPING', 'EXPIRED', 'FAILED'],
  STOPPING: ['STOPPED', 'EXPIRED', 'CLEANUP_FAILED'],
  STOPPED: [],
  EXPIRED: [],
  CANCELLED: [],
  FAILED: [],
  CLEANUP_FAILED: [],
};

export class FreezeSessionRegistry {
  private readonly sessions = new Map<string, FreezeSessionRecord>();
  private readonly expiryTimers = new Map<string, unknown>();
  private readonly audit: FreezeSessionAuditSink;
  private readonly cleanup: (record: FreezeSessionRecord) => void;
  private readonly now: () => number;
  private readonly scheduler: FreezeSessionScheduler;

  constructor(options: FreezeSessionRegistryOptions) {
    this.audit = options.audit;
    this.cleanup = options.cleanup;
    this.now = options.now ?? Date.now;
    this.scheduler = options.scheduler ?? DEFAULT_SCHEDULER;
  }

  register(input: Omit<FreezeSessionRecord, 'state' | 'cleanupState'> & {
    state?: FreezeSessionState;
  }): FreezeSessionRecord {
    const record: FreezeSessionRecord = {
      ...input,
      state: input.state ?? 'PROPOSED',
      cleanupState: 'PENDING',
    };
    this.sessions.set(record.freezeSessionId, record);
    this.emit(record, record.state, 'freeze_proposed');
    this.scheduleExpiry(record);
    return { ...record };
  }

  markApproved(id: string): FreezeSessionTransitionResult {
    return this.transition(id, 'APPROVED', 'freeze_approved');
  }

  markStarting(id: string): FreezeSessionTransitionResult {
    return this.transition(id, 'STARTING', 'freeze_started');
  }

  markActive(id: string): FreezeSessionTransitionResult {
    return this.transition(id, 'ACTIVE', 'freeze_started');
  }

  stopByRenderer(rendererId: number, reason = 'renderer_stopped'): FreezeSessionTransitionResult[] {
    return [...this.sessions.values()]
      .filter((record) => record.rendererId === rendererId && !isTerminal(record.state))
      .map((record) => this.stop(record.freezeSessionId, reason));
  }

  stopAll(reason = 'app_quit'): FreezeSessionTransitionResult[] {
    return [...this.sessions.values()]
      .filter((record) => !isTerminal(record.state))
      .map((record) => this.stop(record.freezeSessionId, reason));
  }

  stopById(id: string, reason = 'user_stopped'): FreezeSessionTransitionResult {
    return this.stop(id, reason);
  }

  get(id: string): FreezeSessionRecord | undefined {
    const record = this.sessions.get(id);
    return record ? { ...record } : undefined;
  }

  private stop(id: string, reason: string, terminal: 'STOPPED' | 'EXPIRED' = 'STOPPED'): FreezeSessionTransitionResult {
    const record = this.sessions.get(id);
    if (!record) return { ok: false, code: 'missing' };
    if (isTerminal(record.state)) return { ok: true, record: { ...record } };
    if (record.state === 'PROPOSED' || record.state === 'APPROVED') {
      return this.transition(id, terminal === 'EXPIRED' ? 'EXPIRED' : 'CANCELLED', reason,
        terminal === 'EXPIRED' ? 'freeze_expired' : 'freeze_stopped');
    }
    const stopping = this.transition(id, 'STOPPING', reason);
    if (!stopping.ok) return stopping;
    const current = this.sessions.get(id)!;
    try {
      this.cleanup({ ...current });
      current.cleanupState = 'SUCCEEDED';
      return this.transition(id, terminal, reason, terminal === 'EXPIRED' ? 'freeze_expired' : 'freeze_stopped');
    } catch (error) {
      current.cleanupState = 'FAILED';
      const failed = this.transition(id, 'CLEANUP_FAILED', reason, 'freeze_cleanup_failed', String(error));
      if (!failed.ok) return { ok: false, code: 'cleanup_failed', error: String(error) };
      return { ok: false, code: 'cleanup_failed', error: String(error) };
    }
  }

  private transition(
    id: string,
    to: FreezeSessionState,
    reason?: string,
    op?: FreezeSessionAuditEvent['op'],
    error?: string,
  ): FreezeSessionTransitionResult {
    const record = this.sessions.get(id);
    if (!record) return { ok: false, code: 'missing' };
    if (!TRANSITIONS[record.state].includes(to)) {
      this.audit.emit({
        op: 'freeze_stopped',
        at: this.now(),
        freezeSessionId: id,
        from: record.state,
        to: record.state,
        reason: reason ?? 'invalid_transition',
        error: 'invalid_transition',
        rendererId: record.rendererId,
        pid: record.pid,
      });
      return { ok: false, code: 'invalid_transition' };
    }
    const from = record.state;
    record.state = to;
    this.emit(record, from, op ?? operationFor(to), reason, error);
    if (isTerminal(to)) this.cancelExpiry(id);
    return { ok: true, record: { ...record } };
  }

  private emit(
    record: FreezeSessionRecord,
    from: FreezeSessionState,
    op: FreezeSessionAuditEvent['op'],
    reason?: string,
    error?: string,
  ): void {
    this.audit.emit({
      op,
      at: this.now(),
      freezeSessionId: record.freezeSessionId,
      from,
      to: record.state,
      reason,
      error,
      rendererId: record.rendererId,
      pid: record.pid,
    });
  }

  private scheduleExpiry(record: FreezeSessionRecord): void {
    const delay = Math.max(0, record.expiresAt - this.now());
    const timer = this.scheduler.schedule(() => {
      this.expiryTimers.delete(record.freezeSessionId);
      this.stop(record.freezeSessionId, 'max_duration', 'EXPIRED');
    }, delay);
    this.expiryTimers.set(record.freezeSessionId, timer);
  }

  private cancelExpiry(id: string): void {
    const timer = this.expiryTimers.get(id);
    if (timer !== undefined) this.scheduler.cancel(timer);
    this.expiryTimers.delete(id);
  }
}

function isTerminal(state: FreezeSessionState): boolean {
  return state === 'STOPPED' || state === 'EXPIRED' || state === 'CANCELLED' ||
    state === 'FAILED' || state === 'CLEANUP_FAILED';
}

function operationFor(state: FreezeSessionState): FreezeSessionAuditEvent['op'] {
  if (state === 'APPROVED') return 'freeze_approved';
  if (state === 'ACTIVE') return 'freeze_started';
  if (state === 'EXPIRED') return 'freeze_expired';
  if (state === 'CLEANUP_FAILED') return 'freeze_cleanup_failed';
  return 'freeze_stopped';
}
