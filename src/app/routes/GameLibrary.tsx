import React, { useState, useEffect } from 'react';
import { Icon } from '../components/icons/index.js';
import { PageModuleHeader } from '../components/PageModuleHeader.js';
import { BrandingArtwork } from '../components/BrandingArtwork.js';

interface Game {
  id: string;
  name: string;
  path: string;
  dateAdded: string;
  lastScan?: string;
  engine?: string;
  fingerprint?: any;
  needsRescan?: boolean;
}

interface GameLibraryProps {
  games: Game[];
  onSelect: (id: string) => void;
  onAddGame?: (gameData: { name: string; path: string; engine?: string }) => void;
}

const GameLibrary: React.FC<GameLibraryProps> = ({ games, onSelect, onAddGame }) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [newGameName, setNewGameName] = useState('');
  const [newGamePath, setNewGamePath] = useState('');
  const [externalScanEnabled, setExternalScanEnabled] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      if (!window.electronAPI) return;
      const settings = await window.electronAPI.getSettings();
      setExternalScanEnabled(!!settings.externalSaveScanEnabled);
    } catch (e) {
      console.error('Failed to load settings:', e);
    }
  };

  const handleToggleExternalScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.checked;
    setExternalScanEnabled(val);
    try {
      await window.electronAPI.setSetting('externalSaveScanEnabled', val.toString());
    } catch (err) {
      console.error('Failed to save setting:', err);
    }
  };

  const handleAddGame = () => {
    if (newGameName && newGamePath) {
      onAddGame?.({ name: newGameName, path: newGamePath });
      setShowAddModal(false);
      setNewGameName('');
      setNewGamePath('');
    }
  };

  const handleScan = async (e: React.MouseEvent, gameId: string) => {
    e.stopPropagation();
    setLoading(true);
    try {
      await window.electronAPI.scanGame(gameId);
      // Trigger reloading from App component (which should reload the games prop)
      window.location.reload(); 
    } catch (err) {
      console.error('Failed to scan game:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="game-library">
      <PageModuleHeader
        artwork="gameLibraryControllerMonitors"
        title="Game Library"
        description="Manage local game folders, scan files, and edit saves"
        actions={<button onClick={() => setShowAddModal(true)} className="btn-add">+ Add Game</button>}
      />

      <div className="settings-panel glass">
        <label className="checkbox-container">
          <input 
            type="checkbox" 
            checked={externalScanEnabled} 
            onChange={handleToggleExternalScan}
          />
          <span className="checkmark"></span>
          <div className="checkbox-text">
            <strong>Enable External Save Scan (Requires Approval)</strong>
            <p>Searches AppData, Saved Games, Documents, and Steam folders for matches. Keeps all scanning strictly offline.</p>
          </div>
        </label>
      </div>
      
      {games.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon-slot">
            <BrandingArtwork artwork="gameLibraryControllerMonitors" size="empty" />
          </div>
          <h3>No games added yet</h3>
          <p>Add a local game directory to build custom file-backed trainers.</p>
          <button onClick={() => setShowAddModal(true)} className="btn-primary empty-state-cta">Add Game Now</button>
        </div>
      ) : (
        <div className="game-grid">
          {games.map(game => {
            const hasScan = !!game.fingerprint;
            const fileCount = game.fingerprint?.fileCount || 0;
            const totalSizeMB = game.fingerprint?.totalSize ? (game.fingerprint.totalSize / (1024 * 1024)).toFixed(1) : '0';

            return (
              <div 
                key={game.id} 
                className={`game-card glass ${game.needsRescan ? 'border-warning' : ''}`}
                onClick={() => onSelect(game.id)}
              >
                <div className="game-card-content">
                  <div className="game-card-header">
                    <h3 className="game-name">{game.name}</h3>
                    <span className={`badge engine-badge ${game.engine?.toLowerCase() || 'generic'}`}>
                      {game.engine || 'Generic'}
                    </span>
                  </div>
                  
                  <div className="game-path" title={game.path}>
                    📁 {game.path}
                  </div>

                  {hasScan ? (
                    <div className="game-stats">
                      <div>📄 <strong>{fileCount}</strong> scanned files</div>
                      <div>💾 <strong>{totalSizeMB} MB</strong> total size</div>
                    </div>
                  ) : (
                    <p className="no-scan-text">⚠️ Game not scanned. Scan now to discover saves & configurations.</p>
                  )}
                </div>

                <div className="game-card-actions">
                  <button 
                    onClick={(e) => handleScan(e, game.id)} 
                    className="btn-scan"
                    disabled={loading}
                  >
                    {loading ? 'Scanning...' : '🔍 Scan Folder'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal-content glass">
            <h3>Add Game Path</h3>
            <p className="modal-description">Point Solith to the local directory where the game is installed.</p>
            <div className="input-group">
              <label>Game Name</label>
              <input
                type="text"
                placeholder="e.g. Witcher 3"
                value={newGameName}
                onChange={(e) => setNewGameName(e.target.value)}
              />
            </div>
            <div className="input-group">
              <label>Folder Path</label>
              <input
                type="text"
                placeholder="e.g. C:\Games\Witcher3"
                value={newGamePath}
                onChange={(e) => setNewGamePath(e.target.value)}
              />
            </div>
            <div className="modal-actions">
              <button onClick={handleAddGame} className="btn-primary">Add Game</button>
              <button onClick={() => setShowAddModal(false)} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GameLibrary;
