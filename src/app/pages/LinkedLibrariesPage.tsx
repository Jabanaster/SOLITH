import React, { useEffect, useState } from 'react';
import { PageModuleHeader } from '../components/PageModuleHeader.js';
import styles from './LinkedLibrariesPage.module.css';

type CapabilityLevel = 'supported' | 'partial' | 'unsupported';
type OwnershipEvidenceSource = 'local metadata' | 'authorized account' | 'unavailable';

interface LinkedLibraryProviderRow {
  provider: 'steam' | 'gog' | 'epic' | 'ubisoft' | 'ea' | 'xbox' | 'battlenet';
  displayName: string;
  localDiscoverySupported: boolean;
  fullOwnershipSupported: boolean;
  accountAuthorizationRequired: boolean;
  implementationFile: string | null;
  localInstalledCount: number;
  /** Mission 19 — three-level honesty scale; see provider-capabilities.ts. */
  installedDetectionLevel: CapabilityLevel;
  ownershipDetectionLevel: CapabilityLevel;
  ownershipSource: OwnershipEvidenceSource;
  /** Mission 19 — most recent evidence timestamp seen for this provider, or null if never scanned. */
  lastScanAt: string | null;
}

const CAPABILITY_LEVEL_LABELS: Record<CapabilityLevel, string> = {
  supported: 'Supported',
  partial: 'Partial',
  unsupported: 'Unsupported',
};

function capabilityBadgeClass(level: CapabilityLevel, styles: Record<string, string>): string {
  if (level === 'supported') return styles.badgeSupported;
  if (level === 'partial') return styles.badgePartial;
  return styles.badgeUnsupported;
}

function formatLastScan(lastScanAt: string | null): string {
  if (!lastScanAt) return 'Never scanned';
  const parsed = Date.parse(lastScanAt);
  if (Number.isNaN(parsed)) return 'Never scanned';
  return new Date(parsed).toLocaleString();
}

/**
 * Mission 10 (Gate 2.5 doc audit) — plain-language explanation of what the
 * installed-detection badge actually means for this provider, so "Partial"
 * and "Unsupported" read as honest capability statements instead of error
 * states. Every provider currently missing local discovery does have a real
 * manual fallback: dragging a game's .exe onto the Trainer Library page
 * (see TrainerLibraryPage.tsx's handleDropExe) records it locally. Never
 * claim that fallback for a level this function has not been told about.
 */
function installedDetectionNote(level: CapabilityLevel, displayName: string): string {
  if (level === 'supported') {
    return `SOLITH automatically finds ${displayName} games installed on this PC.`;
  }
  if (level === 'partial') {
    return `SOLITH makes a best-effort attempt to find ${displayName} games installed on this PC — some installs may be missed or need manual add. You can add a missed game yourself by dragging its .exe onto the Trainer Library page.`;
  }
  return `Automatic discovery for ${displayName} isn't available yet. You can add its games manually by dragging the game's .exe onto the Trainer Library page.`;
}

/**
 * Mission 8/19 (Personal Library Completion pass) — Linked Game Libraries
 * foundation. Every status shown here comes straight from
 * provider-capabilities.ts + real local install/scan evidence. Never renders
 * "Connected" or an owned-count claim for a provider with no scanner —
 * that would be fabricating account-sync SOLITH does not implement. A
 * provider with only installed-detection (no ownership signal) is never
 * described as "linked" in the full account-sync sense — see the intro
 * copy and the per-row "Ownership source" line below, both of which say
 * "unavailable" rather than implying any account connection exists.
 */
export default function LinkedLibrariesPage(): React.ReactElement {
  const [providers, setProviders] = useState<LinkedLibraryProviderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await window.electronAPI?.linkedLibrariesList?.();
        if (cancelled) return;
        if (result?.success && result.providers) {
          setProviders(result.providers as LinkedLibraryProviderRow[]);
        } else {
          setError(result?.error ?? 'Unable to load linked library providers.');
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className={styles.page}>
      <PageModuleHeader
        artwork="gameLibraryControllerMonitors"
        title="Linked Game Libraries"
        description="What SOLITH can actually see per launcher — installed-game detection today, not account ownership."
      />

      <p className={styles.intro}>
        SOLITH can detect games <strong>installed on this machine</strong> for launchers with a real
        local scanner. No launcher account is connected, and SOLITH cannot see a launcher's full
        owned library (including uninstalled titles) for any provider yet — that would require
        account-authorized API access this build does not implement.
      </p>

      {loading && <p>Loading providers…</p>}
      {error && <p role="alert">{error}</p>}

      {!loading && !error && (
        <div className={styles.providerList}>
          {providers.map((p) => (
            <div key={p.provider} className={styles.providerCard}>
              <div className={styles.providerMeta}>
                <span className={styles.providerName}>{p.displayName}</span>
                <div className={styles.statusRow}>
                  <span className={capabilityBadgeClass(p.installedDetectionLevel, styles)}>
                    Installed detection: {CAPABILITY_LEVEL_LABELS[p.installedDetectionLevel]}
                  </span>
                  <span className={capabilityBadgeClass(p.ownershipDetectionLevel, styles)}>
                    Ownership detection: {CAPABILITY_LEVEL_LABELS[p.ownershipDetectionLevel]}
                  </span>
                </div>
                <div className={styles.detailGrid}>
                  <span className={styles.detailLabel}>Games found</span>
                  <span className={styles.detailValue}>{p.localInstalledCount.toLocaleString()}</span>
                  <span className={styles.detailLabel}>Last scan</span>
                  <span className={styles.detailValue}>{formatLastScan(p.lastScanAt)}</span>
                  <span className={styles.detailLabel}>Ownership source</span>
                  <span className={styles.detailValue}>{p.ownershipSource}</span>
                </div>
              </div>
              <div className={styles.noteColumn}>
                <span className={styles.note}>
                  {installedDetectionNote(p.installedDetectionLevel, p.displayName)}
                </span>
                <span className={styles.note}>
                  {p.fullOwnershipSupported
                    ? 'Full owned-library sync available.'
                    : 'Full owned-library sync not implemented for any provider yet. Installed-only evidence is never treated as ownership.'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
