/**
 * Visual Library 2.0 — top-level app sidebar.
 *
 * Renders INSIDE App.tsx's single `<aside className="sidebar">` nav
 * landmark (in the `#app-nav` body), as an alternative to the legacy
 * NAV_SECTIONS nav for the personal-library-first destinations: Home / My
 * Games / Trainer Library / CT Library / Linked Libraries, plus the
 * Running/Favorites/My-Games quick access shelves. App.tsx renders EXACTLY
 * ONE of {this component, the legacy NAV_SECTIONS nav} per view — see
 * `APP_SIDEBAR_VIEWS` in nav-views.ts and App.tsx's `isAppSidebarView` — so
 * there is never a duplicate-accessible-name nav surface on screen.
 *
 * Static nav item ids are the REAL View ids from src/app/nav-views.ts —
 * never invented.
 */
import React from 'react';
import { Icon, type IconName } from '../icons/index.js';
import { NAV_MODULE_ARTWORK } from '../../assets/branding/module-artwork.js';
import { BrandingArtwork } from '../BrandingArtwork.js';
import { SidebarQuickAccess } from './SidebarQuickAccess.js';
import { usePersonalLibraryGames } from '../../hooks/usePersonalLibraryGames.js';
import type { View } from '../../nav-views.js';
import styles from './sidebar.module.css';

const SHELF_LIMIT = 5;

interface AppSidebarNavItem {
  id: View;
  label: string;
  icon: IconName;
}

/**
 * Real View ids only — matched against src/app/nav-views.ts's ALL_VIEWS and
 * the existing NAV_SECTIONS ids already wired in App.tsx (trainer-library,
 * ct-library, linked-libraries), not guessed.
 */
const STATIC_NAV_ITEMS: AppSidebarNavItem[] = [
  { id: 'home', label: 'Home', icon: 'activity' },
  { id: 'my-games', label: 'My Games', icon: 'game' },
  // Discovery Master Pass section 1 — Discovery/Community/Backups are three
  // of the owner's five primary product destinations (Home/My Games are the
  // other two, above); Trainer Library/CT Library/Linked Libraries below are
  // pre-existing destinations pending the Stage 4 nav-consolidation audit.
  { id: 'discovery', label: 'Discovery', icon: 'discovery' },
  { id: 'community', label: 'Community', icon: 'database' },
  { id: 'backups', label: 'Backups', icon: 'backups' },
  { id: 'trainer-library', label: 'Trainer Library', icon: 'search' },
  { id: 'ct-library', label: 'CT Library', icon: 'database' },
  { id: 'linked-libraries', label: 'Linked Libraries', icon: 'database' },
];

export interface AppSidebarProps {
  currentView: View;
  onNavigate: (view: View) => void;
  /** Selecting a game card navigates to game-detail — the page itself is a later step's concern. */
  onSelectGame: (gameId: string) => void;
  /**
   * Mirrors App.tsx's `sidebarCollapsed` (manual toggle + Mission 8's
   * auto-collapse-at-narrow-width behavior) — the outer `<aside class="sidebar
   * sidebar--collapsed">` already shrinks to 72px via index.css, but that
   * global stylesheet only targets the legacy NAV_SECTIONS markup (plain
   * `.nav-label` etc.), not this component's CSS-module class names. Without
   * this prop AppSidebar would keep rendering full labels and the game-card
   * quick-access shelves inside a 72px-wide rail. Defaults to false so every
   * existing caller/test keeps rendering the expanded layout unchanged.
   */
  isCollapsed?: boolean;
}

export function AppSidebar({ currentView, onNavigate, onSelectGame, isCollapsed = false }: AppSidebarProps) {
  const { runningGame, favoriteGames, myGames } = usePersonalLibraryGames();

  return (
    <nav
      className={isCollapsed ? `${styles.appSidebar} ${styles.appSidebarCollapsed}` : styles.appSidebar}
      aria-label="Library navigation"
      data-testid="app-sidebar"
    >
      <ul className={styles.navList}>
        {STATIC_NAV_ITEMS.map((item) => {
          const artwork = NAV_MODULE_ARTWORK[item.id];
          const isActive = currentView === item.id;
          return (
            <li key={item.id}>
              <button
                type="button"
                className={isActive ? `${styles.navButton} ${styles.navButtonActive}` : styles.navButton}
                onClick={() => onNavigate(item.id)}
                aria-current={isActive ? 'page' : undefined}
                data-testid={`app-sidebar-nav-${item.id}`}
                // Icon-only in collapsed mode still needs an accessible name
                // and a visible-on-hover hint — the visible label text below
                // is omitted from the DOM in that mode, not just hidden, so
                // this is the only place that name comes from.
                aria-label={isCollapsed ? item.label : undefined}
                title={isCollapsed ? item.label : undefined}
              >
                <span className={styles.navIcon} aria-hidden="true">
                  {artwork ? (
                    <BrandingArtwork artwork={artwork} size="nav" />
                  ) : (
                    <Icon name={item.icon} size={20} />
                  )}
                </span>
                {!isCollapsed && <span className={styles.navLabel}>{item.label}</span>}
              </button>
            </li>
          );
        })}
      </ul>

      {/* Quick-access shelves (Running/Favorites/My Games game cards with
          names) don't have a meaningful icon-only rendering — hide them in
          collapsed mode rather than squeezing card art + text into 72px.
          Reachable via the still-present "My Games" nav item above and the
          manual expand control in App.tsx's sidebar header. */}
      {!isCollapsed && (
        <SidebarQuickAccess
          runningGame={runningGame}
          favoriteGames={favoriteGames}
          myGames={myGames}
          onSelectGame={onSelectGame}
          onViewAllGames={() => onNavigate('my-games')}
          shelfLimit={SHELF_LIMIT}
        />
      )}
    </nav>
  );
}

export default AppSidebar;
