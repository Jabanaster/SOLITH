import React, { useEffect, useState } from 'react';
import { PageModuleHeader } from '../components/PageModuleHeader.js';

interface ProposalInspectorProps {
  gameId: string | null;
}

interface ProposalRow {
  id: string;
  gameId: string;
  recipeId?: string;
  targetFile: string;
  operation: 'set' | 'increment' | 'decrement' | 'toggle';
  path: string;
  oldValue: unknown;
  newValue: unknown;
  risk: string;
  preview: string;
  validationRule: string;
  requiresBackup: boolean;
  dryRunPassed: boolean;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

/**
 * ROADMAP §6.2 Proposal Inspector — a dedicated read-only view over every
 * proposed save/data edit for the selected game (src/core/proposals),
 * previously only ever surfaced inline inside Save Editor/Discovery Lab's
 * own propose→apply flow. This page never creates, approves, or rejects a
 * proposal itself — it is inspection-only, matching its name.
 */
const ProposalInspector: React.FC<ProposalInspectorProps> = ({ gameId }) => {
  const [proposals, setProposals] = useState<ProposalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<ProposalRow | null>(null);

  useEffect(() => {
    void load();
  }, [gameId]);

  const load = async () => {
    if (!gameId) {
      setProposals([]);
      setLoading(false);
      return;
    }
    if (!window.electronAPI) {
      setError('window.electronAPI unavailable — must run inside Electron');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await window.electronAPI.getProposals(gameId);
      if (!result.success) {
        setError(result.error ?? 'Failed to load proposals.');
        setProposals([]);
        return;
      }
      setProposals(result.proposals ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load proposals.');
      setProposals([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="proposal-inspector-container">
      <PageModuleHeader
        artwork="recoveryPhoenix"
        title="Proposal Inspector"
        description="Every proposed save or data edit for this game — its risk, validation, backup requirement, and dry-run result. Inspection only; propose and apply from Save Editor or Discovery Lab."
        walkthroughId="proposal-inspector"
      />

      {!gameId ? (
        <div className="empty-state glass">
          <p>Select a game to inspect its proposals.</p>
        </div>
      ) : loading ? (
        <div className="empty-state glass">
          <p>Loading proposals...</p>
        </div>
      ) : error ? (
        <div className="empty-state glass">
          <p>{error}</p>
        </div>
      ) : proposals.length === 0 ? (
        <div className="empty-state glass">
          <h3>No proposals yet</h3>
          <p>Proposed edits from Save Editor or Discovery Lab will appear here.</p>
        </div>
      ) : (
        <table className="settings-table">
          <thead>
            <tr>
              <th>Created</th>
              <th>Operation</th>
              <th>Path</th>
              <th>Old → New</th>
              <th>Risk</th>
              <th>Backup required</th>
              <th>Dry run</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {proposals.map((p) => (
              <tr key={p.id}>
                <td>{new Date(p.createdAt).toLocaleString()}</td>
                <td>{p.operation}</td>
                <td>{p.path}</td>
                <td>{String(p.oldValue)} → {String(p.newValue)}</td>
                <td>{p.risk}</td>
                <td>{p.requiresBackup ? 'Yes' : 'No'}</td>
                <td>{p.dryRunPassed ? 'Passed' : 'Not run / failed'}</td>
                <td>{p.status}</td>
                <td>
                  <button type="button" onClick={() => setSelected(p)}>
                    Details
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selected && (
        <div
          className="modal-overlay"
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
        >
          <div className="modal-content glass" style={{ maxWidth: 600, width: '100%', padding: 24 }}>
            <h3 style={{ marginTop: 0 }}>Proposal Details</h3>
            <p><strong>Target file:</strong> {selected.targetFile}</p>
            <p><strong>Validation rule:</strong> {selected.validationRule}</p>
            <p><strong>Preview:</strong></p>
            <pre style={{ background: '#0d0d12', padding: 12, borderRadius: 6, overflowX: 'auto', fontSize: 12, maxHeight: 300 }}>
              {selected.preview}
            </pre>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProposalInspector;
