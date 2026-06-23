import React, { useState, useEffect } from 'react';

interface BackupsProps {
  gameId: string | null;
}

interface BackupItem {
  id: string;
  timestamp: string;
  filePath: string;
  originalHash: string;
  backupPath: string;
  recipeId?: string;
}

const Backups: React.FC<BackupsProps> = ({ gameId }) => {
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  useEffect(() => {
    if (gameId) {
      loadBackups();
    }
  }, [gameId]);

  const loadBackups = async () => {
    setLoading(true);
    try {
      const result = await window.electronAPI.getBackups(gameId);
      setBackups(result || []);
    } catch (e) {
      console.error('Failed to load backups:', e);
      setBackups([]);
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async (backupId: string) => {
    if (!confirm('Are you sure you want to restore this backup? This will overwrite the current save file state.')) {
      return;
    }
    setRestoringId(backupId);
    try {
      const res = await window.electronAPI.restoreBackup(backupId);
      if (res.success) {
        alert('Rollback completed successfully! Current file state restored.');
        await loadBackups();
      } else {
        alert(`Failed to restore backup: ${res.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Restore backup error:', error);
      alert('An error occurred while restoring the backup.');
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <div className="backups-container">
      <div className="section-header" style={{ marginBottom: '24px' }}>
        <h2>Backup & Rollback</h2>
        <p className="description">
          ResourceForge takes an automatic snapshot of files before applying any trainer edits or custom tweaks. You can safely rollback to any historical point below.
        </p>
      </div>

      {loading ? (
        <div className="empty-state glass">
          <p>Loading backup snapshots...</p>
        </div>
      ) : backups.length === 0 ? (
        <div className="empty-state glass">
          <h3>No backups created yet</h3>
          <p>Backups are automatically generated when you apply modifications in the Save/Data Editor or Trainer pages.</p>
        </div>
      ) : (
        <div className="table-wrapper glass" style={{ border: '1px solid #2d3a5c', borderRadius: '8px', overflow: 'hidden' }}>
          <table className="fields-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: 'rgba(22, 33, 62, 0.95)', borderBottom: '1px solid #2d3a5c', color: '#64ffda', fontSize: '13px' }}>
                <th style={{ padding: '12px 16px' }}>Date & Time</th>
                <th style={{ padding: '12px 16px' }}>Target File Path</th>
                <th style={{ padding: '12px 16px' }}>Original Hash</th>
                <th style={{ padding: '12px 16px', textAlign: 'right' }}>Rollback Action</th>
              </tr>
            </thead>
            <tbody>
              {backups.map(backup => {
                const fileName = backup.filePath.replace(/\\/g, '/').split('/').pop() || 'Unknown File';
                const formattedTime = new Date(backup.timestamp).toLocaleString();
                
                return (
                  <tr key={backup.id} style={{ borderBottom: '1px solid rgba(45, 58, 92, 0.4)', fontSize: '13px' }}>
                    <td style={{ padding: '12px 16px', fontWeight: 600, color: '#e0e0e0' }}>{formattedTime}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ color: '#00d4ff', fontWeight: 600 }}>{fileName}</div>
                      <div style={{ fontSize: '11px', color: '#8892b0', marginTop: '2px', wordBreak: 'break-all' }}>{backup.filePath}</div>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <code style={{ fontSize: '11px', color: '#a0a0c0' }}>{backup.originalHash.substring(0, 16)}...</code>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      <button
                        onClick={() => handleRestore(backup.id)}
                        disabled={restoringId === backup.id}
                        className="btn-primary"
                        style={{
                          padding: '6px 14px',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          borderRadius: '4px',
                          background: '#ff9664',
                          border: 'none',
                          color: '#0d0d12'
                        }}
                      >
                        {restoringId === backup.id ? 'Rolling back...' : '🔄 Rollback File'}
                      </button>
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

export default Backups;
