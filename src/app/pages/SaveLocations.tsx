import React, { useState, useEffect, useCallback } from 'react';
import { PageModuleHeader } from '../components/PageModuleHeader.js';
import { GameScopePicker } from '../components/GameScopePicker.js';

interface SaveLocationsProps {
  gameId: string | null;
}

interface SaveLocation {
  id: string;
  gameId: string;
  canonicalPath: string;
  locationType: string;
  discoverySource: 'AUTOMATIC' | 'USER_SELECTED';
  confidence: number;
  approvalState: 'Suggested' | 'Awaiting Approval' | 'Approved' | 'Revoked' | 'Missing' | 'Unsafe' | 'Needs Review';
  lastScanned?: string;
  existsState: number;
  writableState: number;
  detectionEvidence: string;
}

const SaveLocations: React.FC<SaveLocationsProps> = ({ gameId: initialGameId }) => {
  const [scopeGameId, setScopeGameId] = useState<string | null>(initialGameId);
  const [scopeGameName, setScopeGameName] = useState('');
  const [locations, setLocations] = useState<SaveLocation[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [userPath, setUserPath] = useState('');
  const [addingLocation, setAddingLocation] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    if (initialGameId) setScopeGameId(initialGameId);
  }, [initialGameId]);

  const loadLocations = useCallback(async () => {
    if (!window.electronAPI) {
      setLoading(false);
      return;
    }
    if (!scopeGameId) {
      setLocations([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await window.electronAPI.getSaveLocations(scopeGameId);
      setLocations(result || []);
    } catch (e) {
      console.error('Failed to load save locations:', e);
      setLocations([]);
    } finally {
      setLoading(false);
    }
  }, [scopeGameId]);

  useEffect(() => {
    void loadLocations();
  }, [loadLocations]);

  const handleScan = async () => {
    if (!scopeGameId || !window.electronAPI) return;
    setScanning(true);
    setStatusMessage('');
    try {
      const result = await window.electronAPI.discoverSaveLocations(scopeGameId);
      setStatusMessage(`Scan complete — discovered ${result.length} potential save folder(s). Review and approve below.`);
      await loadLocations();
    } catch (e) {
      console.error('Failed to discover locations:', e);
      setStatusMessage('An error occurred during scanning.');
    } finally {
      setScanning(false);
    }
  };

  const handleApprove = async (id: string) => {
    if (!window.electronAPI) return;
    try {
      const res = await window.electronAPI.approveSaveLocation(id);
      if (res.success) {
        await loadLocations();
      } else {
        setStatusMessage(`Failed to approve: ${res.error || 'Unknown error'}`);
      }
    } catch (e) {
      console.error('Approval error:', e);
      setStatusMessage('An error occurred during approval.');
    }
  };

  const handleRevoke = async (id: string) => {
    if (!window.electronAPI) return;
    if (!confirm('Revoke access? Solith will block scans and edits to this location immediately.')) {
      return;
    }
    try {
      const res = await window.electronAPI.revokeSaveLocation(id);
      if (res.success) {
        await loadLocations();
      } else {
        setStatusMessage(`Failed to revoke: ${res.error || 'Unknown error'}`);
      }
    } catch (e) {
      console.error('Revocation error:', e);
      setStatusMessage('An error occurred.');
    }
  };

  const handleAddUserPath = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scopeGameId || !userPath.trim() || !window.electronAPI) return;
    setAddingLocation(true);
    try {
      const result = await window.electronAPI.addUserSelectedLocation(scopeGameId, userPath.trim());
      if (result.success) {
        setUserPath('');
        setStatusMessage('Custom save folder added and approved.');
        await loadLocations();
      } else {
        setStatusMessage(`Failed to add path: ${result.error || 'Path validation failed'}`);
      }
    } catch (e) {
      console.error('Add user location error:', e);
      setStatusMessage('An error occurred while adding the path.');
    } finally {
      setAddingLocation(false);
    }
  };

  const getStatusColor = (state: string) => {
    switch (state) {
      case 'Approved':
        return '#00ff66';
      case 'Suggested':
      case 'Awaiting Approval':
        return '#ffb300';
      case 'Revoked':
      case 'Unsafe':
      case 'Needs Review':
        return '#ff3333';
      case 'Missing':
      default:
        return '#888888';
    }
  };

  return (
    <div className="save-locations-container content-panel">
      <PageModuleHeader
        artwork="recoveryPhoenix"
        title="Save Locations"
        description="Discover, approve, and manage folders where Solith may read or write save files."
        actions={
          <button
            type="button"
            onClick={() => void handleScan()}
            disabled={scanning || !scopeGameId}
            className="btn-primary"
          >
            {scanning ? 'Scanning…' : 'Scan for saves'}
          </button>
        }
      />

      <GameScopePicker
        value={scopeGameId}
        onChange={(id, name) => {
          setScopeGameId(id);
          setScopeGameName(name);
        }}
        label="Game scope"
        hint="Pick a registered or installed catalog game before scanning."
      />

      {scopeGameId && scopeGameName && (
        <p className="tcp-summary-meta">Active scope: <strong>{scopeGameName}</strong></p>
      )}

      {statusMessage && <p className="tcp-host-message" role="status">{statusMessage}</p>}

      <div className="glass save-locations-add-panel">
        <h3>Add custom folder</h3>
        <form onSubmit={handleAddUserPath} className="save-locations-add-form">
          <input
            type="text"
            placeholder="e.g. %APPDATA%\StardewValley\Saves"
            value={userPath}
            onChange={(e) => setUserPath(e.target.value)}
            disabled={addingLocation || !scopeGameId}
          />
          <button type="submit" disabled={addingLocation || !userPath.trim() || !scopeGameId} className="btn-primary">
            {addingLocation ? 'Adding…' : 'Add & approve'}
          </button>
        </form>
      </div>

      {!scopeGameId ? (
        <div className="empty-state glass">
          <p>Select a game above to scan for save folders or add a custom path.</p>
        </div>
      ) : loading ? (
        <div className="empty-state glass">
          <p>Loading save locations…</p>
        </div>
      ) : locations.length === 0 ? (
        <div className="empty-state glass">
          <h3>No save locations yet</h3>
          <p>Run <strong>Scan for saves</strong> to search common Windows folders, or paste a path above.</p>
        </div>
      ) : (
        <div className="table-wrapper glass save-locations-table">
          <table className="fields-table">
            <thead>
              <tr>
                <th>Type & source</th>
                <th>Folder path</th>
                <th>Confidence</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {locations.map((loc) => {
                const statusColor = getStatusColor(loc.approvalState);
                return (
                  <tr key={loc.id}>
                    <td>
                      <div className="loc-type">{loc.locationType}</div>
                      <div className="loc-source">{loc.discoverySource}</div>
                    </td>
                    <td className="loc-path">{loc.canonicalPath}</td>
                    <td>
                      <div>{loc.confidence}%</div>
                      <div className="loc-evidence">{loc.detectionEvidence}</div>
                    </td>
                    <td>
                      <span className="loc-status-pill" style={{ color: statusColor, borderColor: statusColor }}>
                        {loc.approvalState}
                      </span>
                    </td>
                    <td>
                      {loc.approvalState === 'Approved' ? (
                        <button type="button" onClick={() => void handleRevoke(loc.id)} className="btn-secondary btn-danger-outline">
                          Revoke
                        </button>
                      ) : (
                        <button type="button" onClick={() => void handleApprove(loc.id)} className="btn-primary btn-sm">
                          Approve
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default SaveLocations;
