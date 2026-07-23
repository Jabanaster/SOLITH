export type L4CertificationTier = 'L0' | 'L1' | 'L2' | 'L3' | 'L4';

export type L4AuditAction = 'AUTHORIZED' | 'WRITE_TOGGLED' | 'ROLLED_BACK';

export interface L4EntryEvidence {
  ctEntryId: string;
  label: string;
  certificationTier: L4CertificationTier;
  moduleTarget: string;
  pointerChain: string[];
  valueType: string;
  l3ArtifactHash?: string;
}

export interface L4AuditEntry {
  timestamp: string;
  ctEntryId: string;
  l3ArtifactHash: string;
  action: L4AuditAction;
}

export interface L4GovernanceEntryState {
  ctEntryId: string;
  tier: L4CertificationTier;
  active: boolean;
  snapshotCaptured: boolean;
  rollbackPending: boolean;
  lastAuditAction?: L4AuditAction;
}

export interface L4GovernanceState {
  entries: Record<string, L4GovernanceEntryState>;
  auditLog: L4AuditEntry[];
  selectedEntryId: string | null;
}

export type L4GovernanceAction =
  | { type: 'REQUEST_AUTHORIZE'; entry: L4EntryEvidence }
  | {
      type: 'PROMOTE_TO_L4';
      entry: L4EntryEvidence;
      modalConfirmed: boolean;
      auditWriteOk: boolean;
      timestamp: string;
    }
  | { type: 'TOGGLE_ACTIVE'; entry: L4EntryEvidence; active: boolean; auditWriteOk: boolean; timestamp: string }
  | { type: 'DISABLE_AND_ROLLBACK'; entry: L4EntryEvidence; auditWriteOk: boolean; timestamp: string }
  | { type: 'CANCEL_AUTHORIZE' };

export function createInitialL4GovernanceState(entries: L4EntryEvidence[] = []): L4GovernanceState {
  return {
    entries: Object.fromEntries(entries.map((entry) => [
      entry.ctEntryId,
      {
        ctEntryId: entry.ctEntryId,
        tier: entry.certificationTier,
        active: false,
        snapshotCaptured: false,
        rollbackPending: false,
      } satisfies L4GovernanceEntryState,
    ])),
    auditLog: [],
    selectedEntryId: null,
  };
}

function requireL3Evidence(entry: L4EntryEvidence): string {
  if (entry.certificationTier !== 'L3') {
    throw new Error(`PROMOTE_TO_L4 rejected: ${entry.ctEntryId} is ${entry.certificationTier}, not L3.`);
  }
  if (!entry.l3ArtifactHash || !/^[a-f0-9]{16,128}$/i.test(entry.l3ArtifactHash)) {
    throw new Error(`PROMOTE_TO_L4 rejected: ${entry.ctEntryId} is missing a valid L3 artifact hash.`);
  }
  if (!entry.moduleTarget || entry.pointerChain.length === 0 || !entry.valueType) {
    throw new Error(`PROMOTE_TO_L4 rejected: ${entry.ctEntryId} is missing target, pointer-chain, or value-type evidence.`);
  }
  return entry.l3ArtifactHash;
}

function requireAuditWrite(auditWriteOk: boolean, action: L4AuditAction): void {
  if (!auditWriteOk) {
    throw new Error(`${action} rejected: audit log write did not complete.`);
  }
}

function appendAudit(
  state: L4GovernanceState,
  entry: L4EntryEvidence,
  action: L4AuditAction,
  timestamp: string,
): L4AuditEntry[] {
  const l3ArtifactHash = requireL3Evidence(entry);
  return [...state.auditLog, { timestamp, ctEntryId: entry.ctEntryId, l3ArtifactHash, action }];
}

function hasAuthorizationAudit(state: L4GovernanceState, entry: L4EntryEvidence): boolean {
  return state.auditLog.some(
    (audit) =>
      audit.ctEntryId === entry.ctEntryId &&
      audit.l3ArtifactHash === entry.l3ArtifactHash &&
      audit.action === 'AUTHORIZED',
  );
}

export function l4GovernanceReducer(
  state: L4GovernanceState,
  action: L4GovernanceAction,
): L4GovernanceState {
  if (action.type === 'CANCEL_AUTHORIZE') return { ...state, selectedEntryId: null };

  if (action.type === 'REQUEST_AUTHORIZE') {
    requireL3Evidence(action.entry);
    return { ...state, selectedEntryId: action.entry.ctEntryId };
  }

  if (action.type === 'PROMOTE_TO_L4') {
    if (!action.modalConfirmed) {
      throw new Error(`PROMOTE_TO_L4 rejected: modal confirmation was not captured for ${action.entry.ctEntryId}.`);
    }
    requireAuditWrite(action.auditWriteOk, 'AUTHORIZED');
    const auditLog = appendAudit(state, action.entry, 'AUTHORIZED', action.timestamp);
    return {
      ...state,
      selectedEntryId: null,
      auditLog,
      entries: {
        ...state.entries,
        [action.entry.ctEntryId]: {
          ctEntryId: action.entry.ctEntryId,
          tier: 'L4',
          active: false,
          snapshotCaptured: true,
          rollbackPending: false,
          lastAuditAction: 'AUTHORIZED',
        },
      },
    };
  }

  if (action.type === 'TOGGLE_ACTIVE') {
    const existing = state.entries[action.entry.ctEntryId];
    if (!existing || existing.tier !== 'L4') {
      throw new Error(`WRITE_TOGGLED rejected: ${action.entry.ctEntryId} is not L4.`);
    }
    if (!existing.snapshotCaptured || !hasAuthorizationAudit(state, action.entry)) {
      throw new Error(`WRITE_TOGGLED rejected: authorization audit and pre-write snapshot are required.`);
    }
    requireAuditWrite(action.auditWriteOk, 'WRITE_TOGGLED');
    return {
      ...state,
      auditLog: appendAudit(state, action.entry, 'WRITE_TOGGLED', action.timestamp),
      entries: {
        ...state.entries,
        [action.entry.ctEntryId]: {
          ...existing,
          active: action.active,
          rollbackPending: false,
          lastAuditAction: 'WRITE_TOGGLED',
        },
      },
    };
  }

  const existing = state.entries[action.entry.ctEntryId];
  if (!existing || existing.tier !== 'L4') {
    throw new Error(`ROLLED_BACK rejected: ${action.entry.ctEntryId} is not L4.`);
  }
  requireAuditWrite(action.auditWriteOk, 'ROLLED_BACK');
  return {
    ...state,
    auditLog: appendAudit(state, action.entry, 'ROLLED_BACK', action.timestamp),
    entries: {
      ...state.entries,
      [action.entry.ctEntryId]: {
        ...existing,
        active: false,
        rollbackPending: false,
        lastAuditAction: 'ROLLED_BACK',
      },
    },
  };
}
