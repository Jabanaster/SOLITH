import React, { useCallback, useState, useEffect } from 'react';
import GameLibrary from './routes/GameLibrary';
import TrainerPage from './pages/TrainerPage';
import SaveEditor from './pages/SaveEditor';
import DiscoveryLab from './pages/DiscoveryLab';
import ExternalTrainerResearchLab from './pages/ExternalTrainerResearchLab';
import Recipes from './pages/Recipes';
import Backups from './pages/Backups';
import Journal from './pages/Journal';
import ProposalInspector from './pages/ProposalInspector';
import SaveLocations from './pages/SaveLocations';
import CompatibilityDashboard from './pages/CompatibilityDashboard';
import SessionMonitorPage from './pages/SessionMonitorPage';
import TrainerControlPanel from './pages/TrainerControlPanel';
import LiveMemoryTrainerPage from './pages/LiveMemoryTrainerPage';
import TrainerLibraryPage from './pages/TrainerLibraryPage';
import TrainerDeckPage from './pages/TrainerDeckPage';
import CatalogTrainerControlsPage from './pages/CatalogTrainerControlsPage';
import RegistryExplorerPage from './pages/RegistryExplorerPage';
import CtLibraryExplorerPage from './pages/CtLibraryExplorerPage';
import { ProcessDetectToast } from './components/ProcessDetectToast.js';
import { LibraryLaunchDialog, type LibraryLaunchChoice, type LibraryLaunchMode } from './components/LibraryLaunchDialog.js';
import { Icon, type IconName } from './components/icons/index.js';
import { solithBranding } from './assets/branding/index.js';
import { BrandingArtwork } from './components/BrandingArtwork.js';
import { SolithTopBanner } from './components/SolithTopBanner.js';
import { OnboardingWizard } from './components/OnboardingWizard.js';
import { OpeningCinematic } from './components/OpeningCinematic.js';
import { SolithWispCompanion } from './components/SolithWispCompanion.js';
import { NAV_MODULE_ARTWORK, SECTION_ARTWORK } from './assets/branding/module-artwork.js';
import openingCinematicUrl from '../../SOLITH OPENEING SEQUENCE.mp4';
import { WalkthroughOwner } from './components/PageWalkthrough.js';
import { SettingsPage } from './pages/settings/SettingsPage.js';
import { useNavSectionState } from './hooks/useNavSectionState.js';
import { useNotifications } from './hooks/useNotifications.js';
import { NotificationBell } from './components/NotificationBell.js';
import { NotificationCenter } from './components/NotificationCenter.js';
import { ToastHost } from './components/ToastHost.js';
import { WispConsentQueue } from './components/WispConsentQueue.js';
import type { Settings, NotificationAction } from '../shared/types/index.js';
import { type View, isValidView } from './nav-views.js';

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
    items: [
      { id: 'library', label: 'Game Library', icon: 'game' },
      { id: 'trainer-library', label: 'Trainer Library', icon: 'search' },
    ],
  },
  {
    title: 'Recovery',
    items: [
      { id: 'backups', label: 'Backups', icon: 'backups' },
      { id: 'locations', label: 'Save Locations', icon: 'search' },
      { id: 'journal', label: 'Journal', icon: 'log' },
    ],
  },
  {
    title: 'Save Tools',
    items: [
      { id: 'saves', label: 'Save Editor', icon: 'save' },
      { id: 'controls', label: 'Trainer Controls', icon: 'trainer', testId: 'nav-controls' },
    ],
  },
  {
    title: 'Specialized',
    items: [
      { id: 'discovery', label: 'Discovery Lab', icon: 'discovery' },
      { id: 'trainer-research', label: 'Trainer Research Lab', icon: 'search' },
      { id: 'ct-library', label: 'CT Library', icon: 'database' },
      { id: 'registry-explorer', label: 'Registry Explorer', icon: 'database' },
      { id: 'data', label: 'Data Editor', icon: 'database' },
      { id: 'compatibility', label: 'Compatibility', icon: 'safe' },
      { id: 'recipes', label: 'Recipe Editor', icon: 'apply' },
      { id: 'proposal-inspector', label: 'Proposal Inspector', icon: 'log' },
    ],
  },
  {
    title: 'Advanced',
    secondary: true,
    items: [
      { id: 'session-monitor', label: 'Session Monitor', icon: 'activity' },
      { id: 'live-memory', label: 'Live Memory Trainer', icon: 'trainer' },
    ],
  },
];

const SIDEBAR_COLLAPSED_KEY = 'solith-sidebar-collapsed';

const App: React.FC = () => {
  const e2eTrainerState = (window as any).electronAPI?.e2eTrainerState as string | null;
  const [showOpeningCinematic, setShowOpeningCinematic] = useState(
    () => !navigator.webdriver && !e2eTrainerState,
  );
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
  const [deckCatalogGameId, setDeckCatalogGameId] = useState<string | null>(null);
  const [deckDisplayName, setDeckDisplayName] = useState('');
  const [deckDetectedPid, setDeckDetectedPid] = useState<number | null>(null);
  const [processToast, setProcessToast] = useState<{
    catalogGameId: string;
    displayName: string;
    pid: number;
    executable: string;
    prepareReady?: boolean;
    blockReason?: string;
  } | null>(null);
  const [pendingLibraryLaunch, setPendingLibraryLaunch] = useState<LibraryLaunchChoice | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const finishOpeningCinematic = useCallback(() => {
    setShowOpeningCinematic(false);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const result = await (window as any).electronAPI?.getSettings?.();
        if (result && !result.error) {
          setSettings(result);
          if (result.onboardingCompleted !== true) {
            setShowOnboarding(true);
          }
        }
      } catch {
        // ignore — browser mode
      }
    })();
  }, []);

  const updateSetting = useCallback((key: keyof Settings, value: Settings[keyof Settings]) => {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
    void (window as any).electronAPI?.setSetting?.(key, value);
  }, []);

  const handleLibraryLaunch = (
    catalogGameId: string,
    displayName: string,
    _capabilities?: {
      memoryCheatCount?: number;
      saveControlCount?: number;
    },
  ) => {
    setDeckCatalogGameId(catalogGameId);
    setDeckDisplayName(displayName);
    setDeckDetectedPid(null);
    setCurrentView('trainer-deck');
  };

  const openDeckFromToast = () => {
    if (!processToast) return;
    setDeckCatalogGameId(processToast.catalogGameId);
    setDeckDisplayName(processToast.displayName);
    setDeckDetectedPid(processToast.pid);
    setCurrentView('trainer-deck');
    setProcessToast(null);
  };

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onCatalogProcessDetected?.((payload) => {
      setProcessToast(payload);
    });
    return () => unsubscribe?.();
  }, []);

  const openLiveTrainerFromDeck = (catalogGameId: string) => {
    setLibraryLaunchGameId(catalogGameId);
    setCurrentView('live-memory');
  };

  const completeLibraryLaunch = (mode: LibraryLaunchMode) => {
    if (!pendingLibraryLaunch) return;
    setLibraryLaunchGameId(pendingLibraryLaunch.catalogGameId);
    setLibraryLaunchDisplayName(pendingLibraryLaunch.displayName);
    if (mode === 'save-controls') {
      setCurrentView('catalog-save-controls');
    } else {
      setDeckCatalogGameId(pendingLibraryLaunch.catalogGameId);
      setDeckDisplayName(pendingLibraryLaunch.displayName);
      setCurrentView('trainer-deck');
    }
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

  const handleAddGame = async (gameData: {
    name: string;
    path: string;
    engine?: string;
    executablePath?: string;
    coverPath?: string;
    iconPath?: string;
    saveLocations?: string[];
    notes?: string;
    metadataId?: string;
  }) => {
    if (!(window as any).electronAPI) return { success: false, error: 'Electron API unavailable' };
    try {
      const result = await (window as any).electronAPI.addGame(gameData);
      if (result?.success) {
        await loadGames();
        return { success: true };
      }
      console.error('addGame IPC failed:', result?.error);
      return { success: false, error: result?.error ?? 'Failed to add game' };
    } catch (error) {
      console.error('addGame IPC exception:', error);
      return { success: false, error: String(error) };
    }
  };

  const isNavActive = (view: View) => currentView === view;
  const activeSectionTitle = NAV_SECTIONS.find((section) =>
    section.items.some((item) => item.id === currentView),
  )?.title ?? null;
  const { isCollapsed: isSectionCollapsed, toggleSection, canManuallyToggle: canManuallyToggleSection } =
    useNavSectionState({
      activeSectionTitle,
      behaviorMode: settings?.navSectionBehaviorMode ?? 'remember',
      rememberedStateRaw: settings?.navRememberedSectionState ?? '{}',
      onPersistRememberedState: (raw) => updateSetting('navRememberedSectionState', raw),
    });
  const navCompactMode = settings?.navCompactMode ?? false;
  const navShowSectionLabels = settings?.navShowSectionLabels ?? true;
  const [notificationCenterOpen, setNotificationCenterOpen] = useState(false);
  const { notifications, unreadCount, toasts, markRead, markAllRead, clearHistory, dismissToast } =
    useNotifications({ toastsEnabled: settings?.notificationsToastEnabled ?? true });
  const handleNotificationAction = (action: NotificationAction) => {
    setNotificationCenterOpen(false);
    // action.view is untrusted (persisted/IPC-derived) — never cast it, always
    // validate against the canonical View allowlist. Unknown/malformed values
    // are ignored and never touch currentView.
    if (action.type === 'open-view' && isValidView(action.view)) {
      setCurrentView(action.view);
    }
  };

  useEffect(() => {
    if (!notificationCenterOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNotificationCenterOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [notificationCenterOpen]);
  const walkthroughOwnerKey = [
    currentView,
    selectedGame?.id ?? '',
    deckCatalogGameId ?? '',
    libraryLaunchGameId ?? '',
  ].join(':');

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
      case 'registry-explorer':
        return <RegistryExplorerPage />;
      case 'ct-library':
        return <CtLibraryExplorerPage />;
      case 'recipes':
        return <Recipes gameId={selectedGame?.id ?? null} />;
      case 'proposal-inspector':
        return <ProposalInspector gameId={selectedGame?.id ?? null} />;
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
        return <LiveMemoryTrainerPage initialCatalogGameId={libraryLaunchGameId} />;
      case 'catalog-save-controls':
        return libraryLaunchGameId ? (
          <CatalogTrainerControlsPage
            catalogGameId={libraryLaunchGameId}
            displayName={libraryLaunchDisplayName}
          />
        ) : (
          <TrainerLibraryPage onLaunchGame={handleLibraryLaunch} />
        );
      case 'trainer-deck':
        return deckCatalogGameId ? (
          <TrainerDeckPage
            catalogGameId={deckCatalogGameId}
            displayName={deckDisplayName}
            detectedPid={deckDetectedPid}
            onBack={() => setCurrentView('trainer-library')}
            onOpenLiveTrainer={openLiveTrainerFromDeck}
          />
        ) : (
          <TrainerLibraryPage onLaunchGame={handleLibraryLaunch} />
        );
      case 'controls':
        return <TrainerControlPanel />;
      case 'settings':
        return (
          <SettingsPage
            settings={settings}
            onUpdateSetting={updateSetting}
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={toggleSidebar}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className={`app-container${sidebarCollapsed ? ' app-container--sidebar-collapsed' : ''}${navCompactMode ? ' app-container--nav-compact' : ''}`}>
      <aside
        className={`sidebar${sidebarCollapsed ? ' sidebar--collapsed' : ''}${navCompactMode ? ' sidebar--compact' : ''}`}
        aria-label="Main navigation"
      >
        <div className="sidebar-header">
          <div className="sidebar-header__brand">
            <div className="sidebar-header__mark" aria-hidden="true">
              <img src={solithBranding.solithEmblem} alt="" decoding="async" />
            </div>
            {!sidebarCollapsed && (
              <span className="sidebar-header__label">Solith</span>
            )}
          </div>
          <div className="sidebar-notification-anchor">
            <NotificationBell
              unreadCount={unreadCount}
              showBadge={settings?.notificationsShowUnreadBadge ?? true}
              isOpen={notificationCenterOpen}
              onToggle={() => setNotificationCenterOpen((prev) => !prev)}
            />
            {notificationCenterOpen && (
              <NotificationCenter
                notifications={notifications}
                unreadCount={unreadCount}
                onClose={() => setNotificationCenterOpen(false)}
                onMarkRead={markRead}
                onMarkAllRead={markAllRead}
                onClearHistory={clearHistory}
                onAction={handleNotificationAction}
              />
            )}
          </div>
          <button
            type="button"
            className="sidebar-settings-btn"
            onClick={() => navigateTo('settings')}
            aria-label="Settings"
            title="Settings"
          >
            <Icon name="settings" size={20} />
          </button>
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
          {NAV_SECTIONS.map((section) => {
            const collapsed = isSectionCollapsed(section.title);
            return (
            <nav
              key={section.title}
              className={`nav-section${section.secondary ? ' nav-section--secondary' : ''}${collapsed ? ' nav-section--collapsed' : ''}`}
              aria-label={section.title}
            >
              <h3>
                {SECTION_ARTWORK[section.title] && !sidebarCollapsed ? (
                  <BrandingArtwork artwork={SECTION_ARTWORK[section.title]!} size="section" />
                ) : null}
                {!sidebarCollapsed && navShowSectionLabels && <span>{section.title}</span>}
                {!sidebarCollapsed && canManuallyToggleSection && (
                  <button
                    type="button"
                    className="nav-section-toggle"
                    onClick={() => toggleSection(section.title)}
                    aria-expanded={!collapsed}
                    aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${section.title} section`}
                    title={`${collapsed ? 'Expand' : 'Collapse'} ${section.title}`}
                  >
                    <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
                  </button>
                )}
              </h3>
              {(!collapsed || sidebarCollapsed) && section.items.map((item) => {
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
                      <BrandingArtwork artwork={artwork} size="nav" className="w-6 h-6 object-contain" />
                    ) : (
                      <Icon name={item.icon} size={54} />
                    )}
                  </span>
                  <span className="nav-label">{item.label}</span>
                </button>
              );
              })}
            </nav>
            );
          })}

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
                <img src={solithBranding.solithEmblem} alt="" />
              </div>
              <div className="loading-spinner" aria-hidden="true" />
              <span>Loading Solith…</span>
            </div>
          ) : (
            <WalkthroughOwner key={walkthroughOwnerKey}>
              <ContentErrorBoundary key={currentView}>{renderContent()}</ContentErrorBoundary>
            </WalkthroughOwner>
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

      {processToast && (
        <ProcessDetectToast
          displayName={processToast.displayName}
          executable={processToast.executable}
          prepareReady={processToast.prepareReady}
          blockReason={processToast.blockReason}
          onOpenDeck={openDeckFromToast}
          onDismiss={() => setProcessToast(null)}
        />
      )}

      <ToastHost toasts={toasts} onDismiss={dismissToast} />
      <WispConsentQueue />

      {showOpeningCinematic && (
        <OpeningCinematic
          source={openingCinematicUrl}
          onComplete={finishOpeningCinematic}
        />
      )}

      {!navigator.webdriver && !showOpeningCinematic && (
        <SolithWispCompanion
          currentPage={NAV_SECTIONS.flatMap((section) => section.items).find((item) => item.id === currentView)?.label ?? currentView}
          onNavigate={(target) => setCurrentView(target)}
        />
      )}
    </div>
  );
};

export default App;
