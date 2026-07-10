import React, { useState, useEffect } from 'react';
import GameLibrary from './routes/GameLibrary';
import TrainerPage from './pages/TrainerPage';
import SaveEditor from './pages/SaveEditor';
import DiscoveryLab from './pages/DiscoveryLab';
import Recipes from './pages/Recipes';
import Backups from './pages/Backups';
import Journal from './pages/Journal';
import SaveLocations from './pages/SaveLocations';
import CompatibilityDashboard from './pages/CompatibilityDashboard';
import SessionMonitorPage from './pages/SessionMonitorPage';
import TrainerControlPanel from './pages/TrainerControlPanel';
import LiveMemoryTrainerPage from './pages/LiveMemoryTrainerPage';
import MultiGameTrainerPage from './pages/MultiGameTrainerPage';

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
  | 'library' | 'trainer' | 'saves' | 'data' | 'discovery'
  | 'recipes' | 'backups' | 'journal' | 'locations' | 'compatibility'
  | 'session-monitor' | 'controls' | 'live-memory' | 'multi-game-trainer';

type AppMode = 'trainer' | 'workshop';

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

const WORKSHOP_PAGES: { id: View; label: string }[] = [
  { id: 'saves',         label: 'Save Editor' },
  { id: 'data',          label: 'Data Editor' },
  { id: 'discovery',     label: 'Discovery Lab' },
  { id: 'locations',     label: 'Save Locations' },
  { id: 'recipes',       label: 'Recipes' },
  { id: 'backups',       label: 'Backups' },
  { id: 'journal',       label: 'Journal' },
  { id: 'compatibility', label: 'Compatibility' },
  { id: 'session-monitor', label: 'Session Monitor (V2)' },
  { id: 'live-memory', label: 'Live Memory Trainer (V2)' },
  { id: 'multi-game-trainer', label: 'Multi-Game Cheats (V2)' },
];

const App: React.FC = () => {
  const e2eTrainerState = (window as any).electronAPI?.e2eTrainerState as string | null;
  const [currentView, setCurrentView] = useState<View>(e2eTrainerState ? 'trainer' : 'library');
  const [selectedGame, setSelectedGame] = useState<{ id: string; name: string } | null>(
    e2eTrainerState ? { id: 'e2e-renderer-state-fixture', name: 'Renderer State Fixture' } : null
  );
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [appMode, setAppMode] = useState<AppMode>(() => {
    try { return (localStorage.getItem('rf-app-mode') as AppMode) ?? 'trainer'; } catch { return 'trainer'; }
  });
  const [games, setGames] = useState<
    Array<{ id: string; name: string; path: string; dateAdded: string; lastScan: string; engine: string }>
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadGames(); }, []);

  const switchMode = (mode: AppMode) => {
    setAppMode(mode);
    try { localStorage.setItem('rf-app-mode', mode); } catch { /* ignore */ }
    if (mode === 'trainer' && selectedGame) setCurrentView('trainer');
    if (mode === 'workshop') setCurrentView(selectedGame ? 'saves' : 'library');
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
    setCurrentView(appMode === 'workshop' ? 'saves' : 'trainer');
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

  const renderContent = () => {
    switch (currentView) {
      case 'library':
        return <GameLibrary games={games} onSelect={handleGameSelect} onAddGame={handleAddGame} />;
      case 'trainer':
        return selectedGame ? (
          <TrainerPage gameId={selectedGame.id} category={selectedCategory} onBack={handleBackToLibrary} />
        ) : null;
      case 'saves':
        return <SaveEditor gameId={selectedGame?.id ?? null} />;
      case 'data':
        return <SaveEditor gameId={selectedGame?.id ?? null} mode="data" />;
      case 'discovery':
        return <DiscoveryLab gameId={selectedGame?.id ?? null} />;
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
      case 'live-memory':
        return <LiveMemoryTrainerPage />;
      case 'multi-game-trainer':
        return <MultiGameTrainerPage />;
      case 'controls':
        return <TrainerControlPanel />;
      default:
        return null;
    }
  };

  return (
    <div className="app-container">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="app-title">
          <h1>ResourceForge</h1>
          <p className="subtitle">Local Trainer &amp; Discovery Lab</p>
        </div>

        {/* Mode toggle */}
        <div className="mode-toggle-row">
          <button
            className={`mode-btn ${appMode === 'trainer' ? 'mode-active' : ''}`}
            onClick={() => switchMode('trainer')}
            aria-pressed={appMode === 'trainer'}
            title="Trainer Mode — simple controls for common edits"
          >
            Trainer
          </button>
          <button
            className={`mode-btn ${appMode === 'workshop' ? 'mode-active' : ''}`}
            onClick={() => switchMode('workshop')}
            aria-pressed={appMode === 'workshop'}
            title="Workshop Mode — advanced discovery, recipes, and diagnostics"
          >
            Workshop
          </button>
        </div>

        <nav className="nav-section" aria-label="Game library">
          <h3>Library</h3>
          <button
            onClick={() => setCurrentView('library')}
            className={currentView === 'library' ? 'active' : ''}
          >
            Game Library
          </button>
        </nav>

        {selectedGame && appMode === 'trainer' && (
          <nav className="nav-section" aria-label="Trainer categories">
            <h3>Trainer</h3>
            {TRAINER_CATEGORIES.map(cat => (
              <button
                key={cat.id}
                onClick={() => { setSelectedCategory(cat.id); setCurrentView('trainer'); }}
                className={currentView === 'trainer' && selectedCategory === cat.id ? 'active' : ''}
              >
                {cat.label}
              </button>
            ))}
          </nav>
        )}

        {selectedGame && appMode === 'trainer' && (
          <nav className="nav-section" aria-label="Quick actions">
            <h3>Actions</h3>
            <button onClick={() => setCurrentView('controls')} className={currentView === 'controls' ? 'active' : ''}
                    data-testid="nav-controls">
              Trainer Controls
            </button>
            <button onClick={() => setCurrentView('backups')} className={currentView === 'backups' ? 'active' : ''}>
              Backups
            </button>
            <button onClick={() => setCurrentView('journal')} className={currentView === 'journal' ? 'active' : ''}>
              Journal
            </button>
          </nav>
        )}

        {appMode === 'workshop' && (
          <nav className="nav-section" aria-label="Workshop tools">
            <h3>Workshop</h3>
            {WORKSHOP_PAGES.map(page => (
              <button
                key={page.id}
                onClick={() => setCurrentView(page.id)}
                className={currentView === page.id ? 'active' : ''}
              >
                {page.label}
              </button>
            ))}
          </nav>
        )}
      </aside>

      {/* ── Main Content ── */}
      <div className="main-content">
        <header className="game-header">
          {selectedGame ? (
            <>
              <button onClick={handleBackToLibrary} className="back-btn">← Library</button>
              <h2 id="game-title">{selectedGame.name}</h2>
              <div className="header-actions">
                <button
                  className="btn-secondary"
                  onClick={() => (window as any).electronAPI?.scanGame(selectedGame.id)}
                >
                  Rescan
                </button>
                {appMode === 'trainer' && (
                  <button className="btn-secondary" onClick={() => switchMode('workshop')}>
                    Workshop Mode
                  </button>
                )}
                {appMode === 'workshop' && (
                  <button className="btn-primary" onClick={() => { switchMode('trainer'); setCurrentView('trainer'); }}>
                    Trainer Mode
                  </button>
                )}
              </div>
            </>
          ) : (
            <h2>ResourceForge</h2>
          )}
        </header>

        <main className="content-area" id="main-content">
          {loading ? (
            <div className="loading-state">
              <div className="loading-spinner" aria-hidden="true" />
              <span>Loading ResourceForge…</span>
            </div>
          ) : (
            <ContentErrorBoundary key={currentView}>{renderContent()}</ContentErrorBoundary>
          )}
        </main>
      </div>

      <div className="v2-notice" role="status">
        V1 default: file-backed edits only. V2 Live Memory Trainer (Workshop Mode, off by default):
        single-player/offline only — no injection, no anti-cheat interaction.
      </div>
    </div>
  );
};

export default App;
