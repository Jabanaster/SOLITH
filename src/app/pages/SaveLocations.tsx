import React, { useState, useEffect } from 'react';

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

const SaveLocations: React.FC<SaveLocationsProps> = ({ gameId }) => {
  const [locations, setLocations] = useState<SaveLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [userPath, setUserPath] = useState('');
  const [addingLocation, setAddingLocation] = useState(false);

  useEffect(() => {
    if (gameId) {
      loadLocations();
    }
  }, [gameId]);

  const loadLocations = async () => {
    if (!window.electronAPI) {
      console.error('[SaveLocations] window.electronAPI unavailable — must run inside Electron');
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await window.electronAPI.getSaveLocations(gameId);
      setLocations(result || []);
    } catch (e) {
      console.error('Failed to load save locations:', e);
      setLocations([]);
    } finally {
      setLoading(false);
    }
  };

  const handleScan = async () => {
    if (!gameId || !window.electronAPI) return;
    setScanning(true);
    try {
      const result = await window.electronAPI.discoverSaveLocations(gameId);
      alert(`Scan completed. Discovered ${result.length} potential save folder(s).`);
      await loadLocations();
    } catch (e) {
      console.error('Failed to discover locations:', e);
      alert('An error occurred during scanning.');
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
        alert(`Failed to approve: ${res.error || 'Unknown error'}`);
      }
    } catch (e) {
      console.error('Approval error:', e);
      alert('An error occurred during approval.');
    }
  };

  const handleRevoke = async (id: string) => {
    if (!window.electronAPI) return;
    if (!confirm('Are you sure you want to revoke access? ResourceForge will block all scans and edits to this location immediately.')) {
      return;
    }
    try {
      const res = await window.electronAPI.revokeSaveLocation(id);
      if (res.success) {
        await loadLocations();
      } else {
        alert(`Failed to revoke: ${res.error || 'Unknown error'}`);
      }
    } catch (e) {
      console.error('Revocation error:', e);
      alert('An error occurred.');
    }
  };

  const handleAddUserPath = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!gameId || !userPath.trim() || !window.electronAPI) return;
    setAddingLocation(true);
    try {
      const result = await window.electronAPI.addUserSelectedLocation(gameId, userPath.trim());
      if (result.success) {
        setUserPath('');
        await loadLocations();
      } else {
        alert(`Failed to add path: ${result.error || 'Path validation failed'}`);
      }
    } catch (e) {
      console.error('Add user location error:', e);
      alert('An error occurred while adding the path.');
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
    <div className="save-locations-container">
      <div className="section-header" style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2>Save Locations</h2>
          <p className="description">
            To security-harden ResourceForge, accessing or modifying folders outside the registered game directory requires explicit user approval.
          </p>
        </div>
        <button 
          onClick={handleScan} 
          disabled={scanning}
          className="btn-primary" 
          style={{ background: '#64ffda', color: '#0d0d12' }}
        >
          {scanning ? '🔍 Scanning folders...' : '🔍 Scan for Saves'}
        </button>
      </div>

      <div className="glass" style={{ padding: '20px', marginBottom: '24px', border: '1px solid #2d3a5c', borderRadius: '8px' }}>
        <h3 style={{ marginTop: 0, marginBottom: '12px', color: '#64ffda' }}>Add Custom Location</h3>
        <form onSubmit={handleAddUserPath} style={{ display: 'flex', gap: '12px' }}>
          <input
            type="text"
            placeholder="e.g. C:\Users\YourUser\AppData\Local\MyGame\Saves"
            value={userPath}
            onChange={(e) => setUserPath(e.target.value)}
            disabled={addingLocation}
            style={{
              flex: 1,
              padding: '10px 14px',
              borderRadius: '4px',
              border: '1px solid #2d3a5c',
              background: '#0d0d12',
              color: '#ffffff',
              fontSize: '13px'
            }}
          />
          <button
            type="submit"
            disabled={addingLocation || !userPath.trim()}
            className="btn-primary"
            style={{ padding: '10px 20px', cursor: 'pointer' }}
          >
            {addingLocation ? 'Adding...' : '➕ Add & Approve'}
          </button>
        </form>
      </div>

      {loading ? (
        <div className="empty-state glass">
          <p>Loading save locations...</p>
        </div>
      ) : locations.length === 0 ? (
        <div className="empty-state glass">
          <h3>No save locations found</h3>
          <p>Click "Scan for Saves" to automatically search common Windows folders, or manually paste a path above.</p>
        </div>
      ) : (
        <div className="table-wrapper glass" style={{ border: '1px solid #2d3a5c', borderRadius: '8px', overflow: 'hidden' }}>
          <table className="fields-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: 'rgba(22, 33, 62, 0.95)', borderBottom: '1px solid #2d3a5c', color: '#64ffda', fontSize: '13px' }}>
                <th style={{ padding: '12px 16px' }}>Type & Source</th>
                <th style={{ padding: '12px 16px' }}>Folder Path</th>
                <th style={{ padding: '12px 16px' }}>Confidence & Evidence</th>
                <th style={{ padding: '12px 16px' }}>Status</th>
                <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {locations.map(loc => {
                const statusColor = getStatusColor(loc.approvalState);
                return (
                  <tr key={loc.id} style={{ borderBottom: '1px solid rgba(45, 58, 92, 0.4)', fontSize: '13px' }}>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ fontWeight: 600, color: '#e0e0e0' }}>{loc.locationType}</div>
                      <div style={{ fontSize: '11px', color: '#8892b0', marginTop: '2px' }}>{loc.discoverySource}</div>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ color: '#00d4ff', wordBreak: 'break-all' }}>{loc.canonicalPath}</div>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ fontWeight: 600 }}>{loc.confidence}% Confidence</div>
                      <div style={{ fontSize: '11px', color: '#8892b0', marginTop: '2px' }}>{loc.detectionEvidence}</div>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 600,
                        backgroundColor: statusColor + '20',
                        color: statusColor,
                        border: `1px solid ${statusColor}`
                      }}>
                        {loc.approvalState}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      {loc.approvalState === 'Approved' ? (
                        <button
                          onClick={() => handleRevoke(loc.id)}
                          className="btn-secondary"
                          style={{
                            padding: '6px 12px',
                            fontSize: '12px',
                            borderRadius: '4px',
                            background: 'rgba(255, 51, 51, 0.1)',
                            border: '1px solid #ff3333',
                            color: '#ff3333',
                            cursor: 'pointer'
                          }}
                        >
                          Revoke
                        </button>
                      ) : (
                        <button
                          onClick={() => handleApprove(loc.id)}
                          className="btn-primary"
                          style={{
                            padding: '6px 12px',
                            fontSize: '12px',
                            borderRadius: '4px',
                            background: '#00ff66',
                            border: 'none',
                            color: '#0d0d12',
                            fontWeight: 600,
                            cursor: 'pointer'
                          }}
                        >
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
