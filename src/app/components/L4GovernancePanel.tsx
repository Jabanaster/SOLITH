import React, { useMemo, useReducer } from 'react';
import {
  createInitialL4GovernanceState,
  l4GovernanceReducer,
  type L4EntryEvidence,
} from '../../core/registry/l4-governance.js';

export interface L4GovernancePanelProps {
  entries: L4EntryEvidence[];
}

function pointerChainLabel(entry: L4EntryEvidence): string {
  return entry.pointerChain.length > 0 ? entry.pointerChain.join(' → ') : 'none';
}

export const L4GovernancePanel: React.FC<L4GovernancePanelProps> = ({ entries }) => {
  const initialState = useMemo(() => createInitialL4GovernanceState(entries), [entries]);
  const [state, dispatch] = useReducer(l4GovernanceReducer, initialState);
  const selectedEntry = entries.find((entry) => entry.ctEntryId === state.selectedEntryId) ?? null;

  return (
    <section className="l4-governance-panel" aria-label="L4 write authorization prep">
      <div className="split-header">
        <div>
          <p className="eyebrow">Offline L4 prep</p>
          <h4>L4 authorization, audit, and rollback guards</h4>
          <p className="muted">
            UI-only governance prep. This panel does not attach to a process, write memory, or execute CT scripts.
          </p>
        </div>
        <span className="status-pill">writes off</span>
      </div>

      {entries.length === 0 ? (
        <p className="safety-note">No pointer entries are available for L4 prep in this registry.</p>
      ) : (
        <div className="result-stack">
          {entries.slice(0, 8).map((entry) => {
            const row = state.entries[entry.ctEntryId] ?? {
              ctEntryId: entry.ctEntryId,
              tier: entry.certificationTier,
              active: false,
              snapshotCaptured: false,
              rollbackPending: false,
            };
            const canAuthorize = entry.certificationTier === 'L3' && Boolean(entry.l3ArtifactHash);

            return (
              <div className="l4-entry-row" key={entry.ctEntryId}>
                <div>
                  <span className={row.tier === 'L4' ? 'status-pill status-pill-green' : 'status-pill'}>
                    {row.tier}
                  </span>
                  {row.snapshotCaptured && <span className="snapshot-badge">Pre-Write Snapshot</span>}
                </div>
                <div>
                  <strong>{entry.label}</strong>
                  <small>
                    {entry.moduleTarget} · {entry.valueType} · {pointerChainLabel(entry)}
                  </small>
                </div>
                <div className="l4-actions">
                  {row.tier !== 'L4' ? (
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={!canAuthorize}
                      title={canAuthorize ? 'Open explicit L4 authorization modal' : 'Requires L3 artifact evidence first'}
                      onClick={() => dispatch({ type: 'REQUEST_AUTHORIZE', entry })}
                    >
                      Authorize &amp; Enable
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn-secondary"
                        aria-pressed={row.active}
                        onClick={() =>
                          dispatch({
                            type: 'TOGGLE_ACTIVE',
                            entry,
                            active: !row.active,
                            auditWriteOk: true,
                            timestamp: new Date().toISOString(),
                          })
                        }
                      >
                        {row.active ? 'Active' : 'Inactive'}
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() =>
                          dispatch({
                            type: 'DISABLE_AND_ROLLBACK',
                            entry,
                            auditWriteOk: true,
                            timestamp: new Date().toISOString(),
                          })
                        }
                      >
                        Disable + Rollback
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedEntry && (
        <div className="l4-modal" role="dialog" aria-modal="true" aria-label="Authorize L4 write-capable control">
          <div className="l4-modal-card">
            <h4>Authorize L4 write-capable control</h4>
            <p className="safety-note">
              This is the only UI path that can dispatch PROMOTE_TO_L4. It records an audit entry and marks the
              pre-write snapshot requirement before activation is available.
            </p>
            <dl className="kv-grid">
              <dt>ct_entry_id</dt>
              <dd>{selectedEntry.ctEntryId}</dd>
              <dt>module_target</dt>
              <dd>{selectedEntry.moduleTarget}</dd>
              <dt>pointer_chain</dt>
              <dd>{pointerChainLabel(selectedEntry)}</dd>
              <dt>type</dt>
              <dd>{selectedEntry.valueType}</dd>
              <dt>L3 artifact hash</dt>
              <dd>{selectedEntry.l3ArtifactHash}</dd>
            </dl>
            <div className="l4-modal-actions">
              <button type="button" className="btn-secondary" onClick={() => dispatch({ type: 'CANCEL_AUTHORIZE' })}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() =>
                  dispatch({
                    type: 'PROMOTE_TO_L4',
                    entry: selectedEntry,
                    modalConfirmed: true,
                    auditWriteOk: true,
                    timestamp: new Date().toISOString(),
                  })
                }
              >
                Confirm L4 Authorization
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="l4-audit-viewer" aria-label="Offline L4 audit log">
        <h4>Offline audit log</h4>
        {state.auditLog.length === 0 ? (
          <p className="muted">No L4 actions recorded in this session.</p>
        ) : (
          <div className="result-stack">
            {state.auditLog.map((entry, index) => (
              <div className="result-row-static" key={`${entry.ctEntryId}-${entry.action}-${index}`}>
                <span>{entry.action}</span>
                <strong>{entry.ctEntryId}</strong>
                <small>
                  {entry.timestamp} · L3 artifact {entry.l3ArtifactHash}
                </small>
              </div>
            ))}
          </div>
        )}
      </section>
    </section>
  );
};
