import React, { useState, useEffect } from 'react';
import GameLibrary from './routes/GameLibrary';
import TrainerPage from './pages/TrainerPage';
import SaveEditor from './pages/SaveEditor';
import DiscoveryLab from './pages/DiscoveryLab';
import ExternalTrainerResearchLab from './pages/ExternalTrainerResearchLab';
import Recipes from './pages/Recipes';
import Backups from './pages/Backups';
import Journal from './pages/Journal';
import SaveLocations from './pages/SaveLocations';
import CompatibilityDashboard from './pages/CompatibilityDashboard';
import SessionMonitorPage from './pages/SessionMonitorPage';
import TrainerControlPanel from './pages/TrainerControlPanel';
import LiveMemoryTrainerPage from './pages/LiveMemoryTrainerPage';
import TrainerLibraryPage from './pages/TrainerLibraryPage';
import MultiGameTrainerPage from './pages/MultiGameTrainerPage';
import CatalogTrainerControlsPage from './pages/CatalogTrainerControlsPage';
import { LibraryLaunchDialog, type LibraryLaunchChoice, type LibraryLaunchMode } from './components/LibraryLaunchDialog.js';
import { Icon, type IconName } from './components/icons/index.js';
import { solithBranding } from './assets/branding/index.js';
import { BrandingArtwork } from './components/BrandingArtwork.js';
import { SolithTopBanner } from './components/SolithTopBanner.js';
import { OnboardingWizard } from './components/OnboardingWizard.js';
import { NAV_MODULE_ARTWORK, SECTION_ARTWORK } from './assets/branding/module-artwork.js';

class ContentErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error('Page crashed:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="content-error-fallback" role="alert">
          <h2>This page failed to load.</h2>
          <p>Pick another page from the sidebar to keep working.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

type View =
  | 'library' | 'trainer' | 'saves' | 'data' | 'discovery' | 'trainer-research'
  | 'recipes' | 'backups' | 'journal' | 'locations' | 'compatibility'
  | 'session-monitor' | 'controls' | 'live-memory' | 'multi-game-trainer' | 'trainer-library'
  | 'catalog-save-controls';

type NavItem = {
  id: View;
  label: string;
  icon: IconName;
  testId?: string;
};

type NavSection = {
  title: string;
  secondary?: boolean;
  items: NavItem[];
};

const TRAINER_CATEGORIES: { id: string; label: string }[] = [
  { id: 'all',           label: 'All Items' },
  { id: 'player',        label: 'Player' },
  { id: 'currency',      label: 'Currency' },
  { id: 'inventory',     label: 'Inventory' },
  { id: 'stats',         label: 'Stats' },
  { id: 'skills',        label: 'Skills' },
  { id: 'attributes',    label: 'Attributes' },
  { id: 'health',        label: 'Health' },
  { id: 'stamina',       label: 'Stamina' },
  { id: 'mana',          label: 'Mana' },
  { id: 'equipment',     label: 'Equipment' },
  { id: 'weapons',       label: 'Weapons' },
  { id: 'armor',         label: 'Armor' },
  { id: 'experience',    label: 'Experience' },
  { id: 'world',         label: 'World' },
  { id: 'difficulty',    label: 'Difficulty' },
  { id: 'game',          label: 'Game' },
  { id: 'video',         label: 'Video' },
  { id: 'audio',         label: 'Audio' },
  { id: 'accessibility', label: 'Accessibility' },
  { id: 'enemies',       label: 'Enemies' },
  { id: 'unlocks',       label: 'Unlocks' },
  { id: 'discovery',     label: 'Discovered' },
];

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Library',
    items: [{ id: 'library', label: 'Game Library', icon: 'game' }],
  },
  {
    title: 'Core Tools',
    items: [
      { id: 'saves', label: 'Save Editor', icon: 'save' },
      { id: 'backups', label: 'Backups', icon: 'backups' },
      { id: 'journal', label: 'Journal', icon: 'log' },
      { id: 'locations', label: 'Save Locations', icon: 'search' },
    ],
  },
  {
    title: 'Utilities',
    items: [
      { id: 'discovery', label: 'Discovery Lab', icon: 'discovery' },
      { id: 'trainer-research', label: 'Trainer Research Lab', icon: 'search' },
      { id: 'data', label: 'Data Editor', icon: 'database' },
      { id: 'recipes', label: 'Recipes', icon: 'apply' },
      { id: 'compatibility', label: 'Compatibility', icon: 'safe' },
    ],
  },
  {
    title: 'Advanced',
    secondary: true,
    items: [
      { id: 'session-monitor', label: 'Session Monitor', icon: 'activity' },
      { id: 'live-memory', label: 'Live Memory Trainer', icon: 'trainer' },
      { id: 'multi-game-trainer', label: 'Multi-Game Cheats', icon: 'game', testId: 'nav-live-trainer' },
      { id: 'trainer-library', label: 'Trainer Library', icon: 'search' },
      { id: 'controls', label: 'Trainer Controls', icon: 'trainer', testId: 'nav-controls' },
    ],
  },
];

const SIDEBAR_COLLAPSED_KEY = 'solith-sidebar-collapsed';

const App: React.FC = () => {
  const e2eTrainerState = (window as any).electronAPI?.e2eTrainerState as string | null;
  const [currentView, setCurrentView] = useState<View>(e2eTrainerState ? 'trainer' : 'library');
  const [selectedGame, setSelectedGame] = useState<{ id: string; name: string } | null>(
    e2eTrainerState ? { id: 'e2e-renderer-state-fixture', name: 'Renderer State Fixture' } : null
  );
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'; } catch { return false; }
  });
  const [games, setGames] = useState<
    Array<{ id: string; name: string; path: string; dateAdded: string; lastScan: string; engine: string }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [libraryLaunchGameId, setLibraryLaunchGameId] = useState<string | null>(null);
  const [libraryLaunchDisplayName, setLibraryLaunchDisplayName] = useState<string>('');
  const [pendingLibraryLaunch, setPendingLibraryLaunch] = useState<LibraryLaunchChoice | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const settings = await (window as any).electronAPI?.getSettings?.();
        if (settings && settings.onboardingCompleted !== true) {
          setShowOnboarding(true);
        }
      } catch {
        // ignore — browser mode
      }
    })();
  }, []);

  const handleLibraryLaunch = (
    catalogGameId: string,
    displayName: string,
    capabilities?: {
      memoryCheatCount?: number;
      saveControlCount?: number;
    },
  ) => {
    const memoryCount = capabilities?.memoryCheatCount ?? 0;
    const saveCount = capabilities?.saveControlCount ?? 0;

    if (memoryCount > 0 && saveCount > 0) {
      setPendingLibraryLaunch({
        catalogGameId,
        displayName,
        memoryCheatCount: memoryCount,
        saveControlCount: saveCount,
      });
      return;
    }

    setLibraryLaunchGameId(catalogGameId);
    setLibraryLaunchDisplayName(displayName);

    if (saveCount > 0 && memoryCount === 0) {
      setCurrentView('catalog-save-controls');
      return;
    }

    setCurrentView('multi-game-trainer');
  };

  const completeLibraryLaunch = (mode: LibraryLaunchMode) => {
    if (!pendingLibraryLaunch) return;
    setLibraryLaunchGameId(pendingLibraryLaunch.catalogGameId);
    setLibraryLaunchDisplayName(pendingLibraryLaunch.displayName);
    setCurrentView(mode === 'save-controls' ? 'catalog-save-controls' : 'multi-game-trainer');
    setPendingLibraryLaunch(null);
  };

  useEffect(() => { loadGames(); }, []);

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  };

  const navigateTo = (view: View) => {
    setCurrentView(view);
  };

  const loadGames = async () => {
    try {
      if (!(window as any).electronAPI) return;
      const result = await (window as any).electronAPI.getGames();
      if (Array.isArray(result)) setGames(result);
    } catch (e) {
      console.error('Error loading games:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleGameSelect = (gameId: string) => {
    const game = games.find(g => g.id === gameId);
    setSelectedGame({ id: gameId, name: game?.name ?? 'Unknown Game' });
    setCurrentView('trainer');
  };

  const handleBackToLibrary = () => {
    setSelectedGame(null);
    setCurrentView('library');
  };

  const handleAddGame = async (gameData: { name: string; path: string; engine?: string }) => {
    if (!(window as any).electronAPI) return;
    const result = await (window as any).electronAPI.addGame(gameData);
    if (result?.success) await loadGames();
  };

  const isNavActive = (view: View) => currentView === view;

  const renderContent = () => {
    switch (currentView) {
      case 'library':
        return <GameLibrary games={games} onSelect={handleGameSelect} onAddGame={handleAddGame} />;
      case 'trainer':
        return selectedGame ? (
          <TrainerPage gameId={selectedGame.id} category={selectedCategory} onBack={handleBackToLibrary} />
        ) : (
          <GameLibrary games={games} onSelect={handleGameSelect} onAddGame={handleAddGame} />
        );
      case 'saves':
        return <SaveEditor gameId={selectedGame?.id ?? null} />;
      case 'data':
        return <SaveEditor gameId={selectedGame?.id ?? null} mode="data" />;
      case 'discovery':
        return <DiscoveryLab gameId={selectedGame?.id ?? null} />;
      case 'trainer-research':
        return <ExternalTrainerResearchLab />;
      case 'recipes':
        return <Recipes gameId={selectedGame?.id ?? null} />;
      case 'backups':
        return <Backups gameId={selectedGame?.id ?? null} />;
      case 'journal':
        return <Journal gameId={selectedGame?.id ?? null} />;
      case 'locations':
        return <SaveLocations gameId={selectedGame?.id ?? null} />;
      case 'compatibility':
        return <CompatibilityDashboard />;
      case 'session-monitor':
        return <SessionMonitorPage />;
      case 'trainer-library':
        return <TrainerLibraryPage onLaunchGame={handleLibraryLaunch} />;
      case 'live-memory':
        return <LiveMemoryTrainerPage />;
      case 'multi-game-trainer':
        return <MultiGameTrainerPage initialGameId={libraryLaunchGameId} />;
      case 'catalog-save-controls':
        return libraryLaunchGameId ? (
          <CatalogTrainerControlsPage
            catalogGameId={libraryLaunchGameId}
            displayName={libraryLaunchDisplayName}
          />
        ) : (
          <TrainerLibraryPage onLaunchGame={handleLibraryLaunch} />
        );
      case 'controls':
        return <TrainerControlPanel />;
      default:
        return null;
    }
  };

  return (
    <div className={`app-container${sidebarCollapsed ? ' app-container--sidebar-collapsed' : ''}`}>
      <aside
        className={`sidebar${sidebarCollapsed ? ' sidebar--collapsed' : ''}`}
        aria-label="Main navigation"
      >
        <div className="sidebar-header">
          <div className="sidebar-header__brand">
            <div className="sidebar-header__mark" aria-hidden="true">
              <img src={solithBranding.trainerController} alt="" />
            </div>
            {!sidebarCollapsed && (
              <span className="sidebar-header__label">Solith</span>
            )}
          </div>
          <button
            type="button"
            className="sidebar-collapse-btn"
            onClick={toggleSidebar}
            aria-expanded={!sidebarCollapsed}
            aria-controls="app-nav"
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <span className="sidebar-collapse-icon" aria-hidden="true">
              {sidebarCollapsed ? '»' : '«'}
            </span>
          </button>
        </div>

        <div id="app-nav" className="sidebar-nav">
          {NAV_SECTIONS.map((section) => (
            <nav
              key={section.title}
              className={`nav-section${section.secondary ? ' nav-section--secondary' : ''}`}
              aria-label={section.title}
            >
              <h3>
                {SECTION_ARTWORK[section.title] && !sidebarCollapsed ? (
                  <BrandingArtwork artwork={SECTION_ARTWORK[section.title]!} size="section" />
                ) : null}
                <span>{section.title}</span>
              </h3>
              {section.items.map((item) => {
                const artwork = NAV_MODULE_ARTWORK[item.id];
                return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigateTo(item.id)}
                  className={isNavActive(item.id) ? 'active' : ''}
                  title={item.label}
                  data-testid={item.testId}
                >
                  <span className={`nav-icon-slot${artwork ? ' nav-icon-slot--artwork' : ''}`}>
                    {artwork ? (
                      <BrandingArtwork artwork={artwork} size="nav" />
                    ) : (
                      <Icon name={item.icon} size={18} />
                    )}
                  </span>
                  <span className="nav-label">{item.label}</span>
                </button>
              );
              })}
            </nav>
          ))}

          {selectedGame && (
            <nav className="nav-section nav-section--context" aria-label="Game trainer categories">
              <h3>{sidebarCollapsed ? 'Game' : selectedGame.name}</h3>
              <button
                type="button"
                onClick={() => navigateTo('trainer')}
                className={currentView === 'trainer' && selectedCategory === 'all' ? 'active' : ''}
                title="Game Trainer"
              >
                <span className="nav-icon-slot nav-icon-slot--artwork">
                  <BrandingArtwork artwork="trainerController" size="nav" />
                </span>
                <span className="nav-label">Game Trainer</span>
              </button>
              {!sidebarCollapsed && TRAINER_CATEGORIES.filter((cat) => cat.id !== 'all').map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => { setSelectedCategory(cat.id); navigateTo('trainer'); }}
                  className={currentView === 'trainer' && selectedCategory === cat.id ? 'active' : ''}
                  title={cat.label}
                >
                  <span className="nav-category-dot" aria-hidden="true" />
                  <span className="nav-label">{cat.label}</span>
                </button>
              ))}
            </nav>
          )}
        </div>
      </aside>

      <div className="main-content">
        <SolithTopBanner />

        {selectedGame && (
          <div className="game-context-bar">
            <button type="button" onClick={handleBackToLibrary} className="back-btn">
              ← Library
            </button>
            <h2 id="game-title">{selectedGame.name}</h2>
            <div className="header-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => (window as any).electronAPI?.scanGame(selectedGame.id)}
              >
                Rescan
              </button>
            </div>
          </div>
        )}

        <main className="content-area" id="main-content">
          {loading ? (
            <div className="loading-state">
              <div className="loading-brand" aria-hidden="true">
                <img src={solithBranding.trainerController} alt="" />
              </div>
              <div className="loading-spinner" aria-hidden="true" />
              <span>Loading Solith…</span>
            </div>
          ) : (
            <ContentErrorBoundary key={currentView}>{renderContent()}</ContentErrorBoundary>
          )}
        </main>
      </div>

      {pendingLibraryLaunch && (
        <LibraryLaunchDialog
          choice={pendingLibraryLaunch}
          onSelect={completeLibraryLaunch}
          onCancel={() => setPendingLibraryLaunch(null)}
        />
      )}

      {showOnboarding && (
        <OnboardingWizard onComplete={() => setShowOnboarding(false)} />
      )}
    </div>
  );
};

export default App;
