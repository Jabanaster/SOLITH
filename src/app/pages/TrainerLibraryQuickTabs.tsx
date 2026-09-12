import styles from './TrainerLibraryPage.module.css';

export type TrainerLibraryQuickTab = 'all' | 'running' | 'installed' | 'owned';

/**
 * "MY games and MY trainers first" quick-view row. Running/Installed/Owned
 * are a mutually exclusive narrowing of the existing section hierarchy
 * (clicking the active one again returns to "All Games") — they never
 * introduce a new sort or a new section, they just hide sections/rows that
 * don't match. Favorites reuses the pre-existing showFavoritesOnly toggle
 * verbatim (same state, same button accessible name "★ Favorites") so the
 * existing Mission 5 e2e coverage in
 * tests/electron-personal-library.e2e.test.ts keeps working unchanged —
 * Favorites is intentionally an independent toggle, not part of the
 * mutually-exclusive quickTab group.
 */
export function TrainerLibraryQuickTabs({
  activeTab,
  onSelectTab,
  favoritesActive,
  onToggleFavorites,
}: {
  activeTab: TrainerLibraryQuickTab;
  onSelectTab: (tab: TrainerLibraryQuickTab) => void;
  favoritesActive: boolean;
  onToggleFavorites: () => void;
}) {
  const toggle = (tab: TrainerLibraryQuickTab) => {
    onSelectTab(activeTab === tab ? 'all' : tab);
  };

  return (
    <div className={styles.quickTabs} role="group" aria-label="Trainer Library quick views">
      <button
        type="button"
        className={activeTab === 'running' ? styles.filterActive : styles.filterBtn}
        aria-pressed={activeTab === 'running'}
        onClick={() => toggle('running')}
      >
        Running
      </button>
      <button
        type="button"
        className={activeTab === 'installed' ? styles.filterActive : styles.filterBtn}
        aria-pressed={activeTab === 'installed'}
        onClick={() => toggle('installed')}
      >
        Installed
      </button>
      <button
        type="button"
        className={activeTab === 'owned' ? styles.filterActive : styles.filterBtn}
        aria-pressed={activeTab === 'owned'}
        onClick={() => toggle('owned')}
      >
        Owned
      </button>
      <button
        type="button"
        className={favoritesActive ? styles.filterActive : styles.filterBtn}
        aria-pressed={favoritesActive}
        onClick={onToggleFavorites}
      >
        ★ Favorites
      </button>
      <button
        type="button"
        className={activeTab === 'all' ? styles.filterActive : styles.filterBtn}
        aria-pressed={activeTab === 'all'}
        onClick={() => onSelectTab('all')}
      >
        All Games
      </button>
    </div>
  );
}
