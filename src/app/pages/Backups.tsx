import React, { useState, useEffect } from 'react';
import {
  buildBackupDashboardSummary,
  type BackupDashboardItem,
} from './backups-dashboard.js';
import { PageModuleHeader } from '../components/PageModuleHeader.js';
import { BrandingArtwork } from '../components/BrandingArtwork.js';

interface BackupsProps {
  gameId: string | null;
}

type BackupItem = BackupDashboardItem;

function formatBackupFileLabel(filePath: string | null | undefined): string {
  if (!filePath) return 'Unknown file';
  return filePath.replace(/\\/g, '/').split('/').pop() || 'Unknown file';
}

const Backups: React.FC<BackupsProps> = ({ gameId }) => {
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const summary = buildBackupDashboardSummary(backups);

  useEffect(() => {
    if (gameId) {
      loadBackups();
    }
  }, [gameId]);

  const loadBackups = async () => {
    if (!window.electronAPI) {
      console.error('[Backups] window.electronAPI unavailable — must run inside Electron');
      setLoading(false);
      return;
    }
    if (!gameId) { setLoading(false); return; }
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
    if (!window.electronAPI) return;
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
      <PageModuleHeader
        artwork="recoveryPhoenix"
        title="Backup & Rollback"
        description="Solith takes an automatic snapshot of files before applying any trainer edits or custom tweaks. Rollback actions are explicit and require your confirmation."
        walkthroughId="backups"
      />

      {!loading && (
        <div className="glass" data-testid="rollback-dashboard-summary" style={{ marginBottom: '20px', padding: '16px' }}>
          <div className="section-header" style={{ marginBottom: '12px' }}>
            <h3>Rollback Dashboard</h3>
            <p className="description">
              Local-only backup visibility for rollback readiness. This dashboard does not perform silent restore.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
            <div className="glass" style={{ padding: '12px' }}>
              <div style={{ fontSize: '12px', color: '#8892b0' }}>Snapshots</div>
              <div data-testid="rollback-dashboard-total" style={{ fontSize: '24px', fontWeight: 700 }}>{summary.totalBackups}</div>
            </div>
            <div className="glass" style={{ padding: '12px' }}>
              <div style={{ fontSize: '12px', color: '#8892b0' }}>Target files</div>
              <div data-testid="rollback-dashboard-files" style={{ fontSize: '24px', fontWeight: 700 }}>{summary.uniqueFiles}</div>
            </div>
            <div className="glass" style={{ padding: '12px' }}>
              <div style={{ fontSize: '12px', color: '#8892b0' }}>Recipe-linked</div>
              <div data-testid="rollback-dashboard-recipe-linked" style={{ fontSize: '24px', fontWeight: 700 }}>{summary.recipeLinkedBackups}</div>
            </div>
            <div className="glass" style={{ padding: '12px' }}>
              <div style={{ fontSize: '12px', color: '#8892b0' }}>Latest snapshot</div>
              <div data-testid="rollback-dashboard-latest" style={{ fontSize: '14px', fontWeight: 700 }}>
                {summary.latestTimestamp ? new Date(summary.latestTimestamp).toLocaleString() : 'None yet'}
              </div>
              <div style={{ fontSize: '11px', color: '#8892b0', marginTop: '4px' }}>
                {summary.latestFilePath ? formatBackupFileLabel(summary.latestFilePath) : 'No rollback snapshots recorded yet.'}
              </div>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="empty-state glass">
          <div className="empty-state-icon-slot">
            <BrandingArtwork artwork="recoveryPhoenix" size="empty" />
          </div>
          <p>Loading backup snapshots...</p>
        </div>
      ) : backups.length === 0 ? (
        <div className="empty-state glass">
          <div className="empty-state-icon-slot">
            <BrandingArtwork artwork="recoveryPhoenix" size="empty" />
          </div>
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
                <th style={{ padding: '12px 16px' }}>Source</th>
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
                      <div style={{ fontSize: '11px', color: '#8892b0', marginTop: '2px' }}>Recorded local target file</div>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ color: '#e0e0e0', fontWeight: 600 }}>{backup.recipeId ?? 'Manual snapshot'}</div>
                      <div style={{ fontSize: '11px', color: '#8892b0', marginTop: '2px' }}>
                        {backup.recipeId ? 'Recipe-linked restore point' : 'Editor or trainer rollback point'}
                      </div>
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
