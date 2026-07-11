import React, { useState, useEffect } from 'react';
import { PageModuleHeader } from '../components/PageModuleHeader.js';

type ValidationStatus =
  | 'VERIFIED' | 'SUPPORTED' | 'READ_ONLY'
  | 'EXPERIMENTAL' | 'UNSUPPORTED' | 'BLOCKED';

interface ProfileSummary {
  id: string;
  gameName: string;
  validationStatus: ValidationStatus;
  store: string;
  engine: string;
  supportedAdapters: string;
  lastValidatedAt?: string;
  limitations: string;
  hasCloudSync: number;
  updatedAt: string;
}

const STATUS_CONFIG: Record<ValidationStatus, { color: string; label: string; description: string }> = {
  VERIFIED:     { color: 'safe',    label: 'Verified',     description: 'End-to-end tested with backup, apply, restore, and hash evidence.' },
  SUPPORTED:    { color: 'info',    label: 'Supported',    description: 'Adapter compatible, limited real-game validation.' },
  READ_ONLY:    { color: 'caution', label: 'Read-Only',    description: 'Detect and inspect only. Cannot safely write.' },
  EXPERIMENTAL: { color: 'caution', label: 'Experimental', description: 'Sandbox-only. Requires copied saves and user acknowledgement.' },
  UNSUPPORTED:  { color: 'muted',   label: 'Unsupported',  description: 'No safe adapter or integrity model available.' },
  BLOCKED:      { color: 'blocked', label: 'Blocked',      description: 'Requires prohibited behavior (anti-cheat, DRM, online systems).' },
};

const EVIDENCE_TIERS = [
  { label: 'Fixture-tested',       description: 'Validated using invented repository fixtures.' },
  { label: 'Sandbox-tested',       description: 'Validated against a copied real-world save in an isolated workspace.' },
  { label: 'Actual-save-tested',   description: 'Validated against an explicitly authorized local save.' },
];

const CompatibilityDashboard: React.FC = () => {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const apiAvailable = typeof window !== 'undefined' && !!(window as any).electronAPI?.getAllProfiles;

  useEffect(() => {
    if (!apiAvailable) { setLoading(false); return; }
    (window as any).electronAPI.getAllProfiles().then((rows: ProfileSummary[]) => {
      setProfiles(rows ?? []);
    }).catch(() => {
      setProfiles([]);
    }).finally(() => setLoading(false));
  }, [apiAvailable]);

  const counts = Object.fromEntries(
    (['VERIFIED', 'SUPPORTED', 'READ_ONLY', 'EXPERIMENTAL', 'UNSUPPORTED', 'BLOCKED'] as ValidationStatus[])
      .map(s => [s, profiles.filter(p => p.validationStatus === s).length])
  );

  return (
    <div className="compat-dashboard">
      <PageModuleHeader
        artwork="hoodedProfile"
        title="Compatibility Dashboard"
        description="Profile coverage, evidence tiers, and version drift status for all evaluated games. Support matrix output is local and evidence-based."
      />

      <div className="glass" style={{ padding: '12px', marginBottom: '16px' }}>
        <p style={{ margin: 0, fontSize: '13px', color: '#8892b0' }}>
          Imported profiles require review before support claims. Discovery and parser coverage do not automatically create executable write support.
        </p>
      </div>

      <div className="compat-stats-row">
        {(Object.entries(STATUS_CONFIG) as [ValidationStatus, typeof STATUS_CONFIG[ValidationStatus]][]).map(([status, cfg]) => (
          <div key={status} className={`compat-stat-card compat-stat-${cfg.color}`}>
            <div className="stat-count">{counts[status] ?? 0}</div>
            <div className="stat-label">{cfg.label}</div>
          </div>
        ))}
      </div>

      <div className="compat-evidence-tiers">
        <h3>Evidence Tiers</h3>
        <div className="tier-grid">
          {EVIDENCE_TIERS.map(t => (
            <div key={t.label} className="tier-card glass">
              <strong>{t.label}</strong>
              <p>{t.description}</p>
            </div>
          ))}
        </div>
        <div className="tier-blocked-note glass">
          <strong>Real-world pilot status:</strong> BLOCKED_PENDING_USER_DATA —
          No user-approved commercial game save was provided in this session.
          Fixture and demo workflows complete. Real-game sandbox validation requires
          user to provide an approved local save path.
        </div>
      </div>

      <div className="compat-profiles">
        <h3>Profiles ({profiles.length})</h3>
        {loading ? (
          <div className="loading-state">
            <div className="loading-spinner" />
            <span>Loading profiles…</span>
          </div>
        ) : profiles.length === 0 ? (
          <div className="empty-state glass">
            <p>No compatibility profiles yet. Use Workshop Mode to run a compatibility inspection.</p>
          </div>
        ) : (
          <table className="compat-table" aria-label="Compatibility profiles">
            <thead>
              <tr>
                <th>Game</th>
                <th>Status</th>
                <th>Store</th>
                <th>Engine</th>
                <th>Adapters</th>
                <th>Cloud</th>
                <th>Last Validated</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map(p => {
                const cfg = STATUS_CONFIG[p.validationStatus] ?? STATUS_CONFIG.UNSUPPORTED;
                const adapters = (() => { try { return JSON.parse(p.supportedAdapters || '[]').join(', '); } catch { return '—'; } })();
                return (
                  <tr key={p.id}>
                    <td>{p.gameName}</td>
                    <td>
                      <span className={`status-badge compat-status-${cfg.color}`} title={cfg.description}>
                        {cfg.label}
                      </span>
                    </td>
                    <td>{p.store}</td>
                    <td>{p.engine}</td>
                    <td>{adapters || '—'}</td>
                    <td>{p.hasCloudSync ? '⚠ Cloud' : '—'}</td>
                    <td>{p.lastValidatedAt ? new Date(p.lastValidatedAt).toLocaleDateString() : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="compat-issue-taxonomy glass">
        <h3>Issue Taxonomy</h3>
        <div className="taxonomy-grid">
          {[
            'LOCATION_NOT_FOUND', 'LOCATION_NOT_APPROVED', 'FORMAT_UNKNOWN',
            'FORMAT_ENCRYPTED', 'FORMAT_SIGNED', 'FORMAT_COMPRESSED',
            'PARSER_FAILED', 'VALIDATION_FAILED', 'CHECKSUM_UNSUPPORTED',
            'VERSION_DRIFT', 'TARGET_MISSING', 'TARGET_DUPLICATE',
            'TARGET_AMBIGUOUS', 'CLOUD_SYNC_RISK', 'GAME_RUNNING',
            'BACKUP_FAILED', 'APPLY_FAILED', 'RESTORE_FAILED',
            'USER_AUTHORIZATION_REQUIRED', 'PROHIBITED_CAPABILITY',
          ].map(code => (
            <code key={code} className="taxonomy-tag">{code}</code>
          ))}
        </div>
      </div>
    </div>
  );
};

export default CompatibilityDashboard;
