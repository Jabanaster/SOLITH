import React from 'react';
import styles from './DiscoveryPage.module.css';

/**
 * Community — placeholder destination.
 *
 * Discovery Master Pass, Stage 1 only wires the navigation slot for
 * Community (nav-views.ts, AppSidebar) so the five-destination model
 * (Home/My Games/Community/Discovery/Backups) exists as real, navigable
 * routes. The actual Community surface (Search/Popular/Recently Updated/
 * Needs Update, trainer-ecosystem browsing, Phoenix identity) is Stage 5's
 * deliverable — see the master pass plan. This is intentionally NOT a fake
 * or mocked Community UI: showing placeholder data here would violate the
 * pass's explicit "never present fixture data as real" rule.
 */
export function CommunityPage() {
  return (
    <div className={styles.page} data-testid="community-page">
      <div className={styles.header}>
        <h1 className={styles.title}>Community</h1>
      </div>
      <div className={styles.emptyState}>
        <p>
          Community (Search, Popular, Recently Updated, Needs Update) is being built in a later stage of the
          Discovery Master Pass. This destination is wired and reachable now; its real content is not implemented
          yet.
        </p>
      </div>
    </div>
  );
}

export default CommunityPage;
