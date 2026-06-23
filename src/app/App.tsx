import React, { useState, useEffect } from 'react';
import GameLibrary from './routes/GameLibrary';
import TrainerPage from './pages/TrainerPage';
import SaveEditor from './pages/SaveEditor';
import DiscoveryLab from './pages/DiscoveryLab';
import Recipes from './pages/Recipes';
import Backups from './pages/Backups';
import Journal from './pages/Journal';
import SaveLocations from './pages/SaveLocations';

type View = 'library' | 'trainer' | 'saves' | 'data' | 'discovery' | 'recipes' | 'backups' | 'journal' | 'locations';

const TRAINER_CATEGORIES = [
  { id: 'all', label: 'All Mods', icon: '⚡' },
  { id: 'player', label: 'Player', icon: '🧑' },
  { id: 'inventory', label: 'Inventory', icon: '🎒' },
  { id: 'stats', label: 'Stats', icon: '📊' },
  { id: 'enemies', label: 'Enemies', icon: '👾' },
  { id: 'game', label: 'Game', icon: '🎮' },
  { id: 'unlocks', label: 'Unlocks', icon: '🔓' },
  { id: 'video', label: 'Video', icon: '🎥' },
  { id: 'voice', label: 'Voice', icon: '🔊' },
  { id: 'discovery', label: 'Discovered', icon: '🔍' },
];

const TOOL_PAGES: { id: View; label: string; icon: string }[] = [
  { id: 'saves',     label: 'Save Editor',    icon: '💾' },
  { id: 'data',      label: 'Data Editor',    icon: '📝' },
  { id: 'discovery', label: 'Discovery Lab',  icon: '🔬' },
  { id: 'locations', label: 'Save Locations', icon: '📂' },
  { id: 'recipes',   label: 'Recipes',        icon: '📋' },
  { id: 'backups',   label: 'Backups',        icon: '🗃️' },
  { id: 'journal',   label: 'Journal',        icon: '📜' },
];

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<View>('library');
  const [selectedGame, setSelectedGame] = useState<{ id: string; name: string } | null>(null);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [games, setGames] = useState<Array<{ id: string; name: string; path: string; dateAdded: string; lastScan: string; engine: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadGames();
  }, []);

  const loadGames = async () => {
    try {
      if (!window.electronAPI) {
        console.error('window.electronAPI unavailable — app must run inside Electron');
        return;
      }
      const result = await window.electronAPI.getGames();
      if (!result.error) {
        setGames(result);
      }
    } catch (error) {
      console.error('Error loading games:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleGameSelect = (gameId: string) => {
    const game = games.find(g => g.id === gameId);
    setSelectedGame({ id: gameId, name: game?.name || 'Unknown Game' });
    setCurrentView('trainer');
  };

  const handleBackToLibrary = () => {
    setSelectedGame(null);
    setCurrentView('library');
  };

  const handleAddGame = async (gameData: { name: string; path: string; engine?: string }) => {
    try {
      if (!window.electronAPI) return;
      const result = await window.electronAPI.addGame(gameData);
      if (result.success) {
        await loadGames();
      }
    } catch (error) {
      console.error('Error adding game:', error);
    }
  };

  const renderContent = () => {
    switch (currentView) {
      case 'library':
        return <GameLibrary games={games} onSelect={handleGameSelect} onAddGame={handleAddGame} />;
      case 'trainer':
        return selectedGame ? (
          <TrainerPage
            gameId={selectedGame.id}
            category={selectedCategory}
            onBack={handleBackToLibrary}
          />
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
          <p className="subtitle">Local Trainer & Discovery Lab</p>
        </div>

        <nav className="nav-section">
          <h3>Library</h3>
          <button
            onClick={() => setCurrentView('library')}
            className={currentView === 'library' ? 'active' : ''}
          >
            🎮 Game Library
          </button>
        </nav>

        {selectedGame && (
          <>
            <nav className="nav-section">
              <h3>Trainer</h3>
              {TRAINER_CATEGORIES.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => { setSelectedCategory(cat.id); setCurrentView('trainer'); }}
                  className={currentView === 'trainer' && selectedCategory === cat.id ? 'active' : ''}
                >
                  {cat.icon} {cat.label}
                </button>
              ))}
            </nav>

            <nav className="nav-section">
              <h3>Tools</h3>
              {TOOL_PAGES.map(page => (
                <button
                  key={page.id}
                  onClick={() => setCurrentView(page.id)}
                  className={currentView === page.id ? 'active' : ''}
                >
                  {page.icon} {page.label}
                </button>
              ))}
            </nav>
          </>
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
                <button className="btn-secondary" onClick={() => window.electronAPI.scanGame(selectedGame.id)}>
                  🔍 Rescan
                </button>
                <button className="btn-secondary" onClick={() => setCurrentView('backups')}>
                  🗃️ Backup
                </button>
                <button className="btn-primary" onClick={() => setCurrentView('discovery')}>
                  🔬 Discovery Lab
                </button>
              </div>
            </>
          ) : (
            <h2>ResourceForge</h2>
          )}
        </header>

        <main className="content-area">
          {loading ? (
            <div className="loading-state">
              <div className="loading-spinner" />
              <span>Loading ResourceForge…</span>
            </div>
          ) : renderContent()}
        </main>
      </div>

      <div className="v2-notice">
        ⚡ V1: File-backed edits only — No memory injection, no anti-cheat interaction — Live trainer mode coming in V2
      </div>
    </div>
  );
};

export default App;
