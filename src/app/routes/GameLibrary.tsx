import React, { useState, useEffect } from 'react';
import { PageModuleHeader } from '../components/PageModuleHeader.js';
import { BrandingArtwork } from '../components/BrandingArtwork.js';

interface Game {
  id: string;
  name: string;
  path: string;
  dateAdded: string;
  lastScan?: string;
  engine?: string;
  executablePath?: string;
  coverPath?: string;
  iconPath?: string;
  saveLocations?: string[];
  notes?: string;
  metadataId?: string;
  fingerprint?: any;
  needsRescan?: boolean;
}

interface GameFormPayload {
  name: string;
  path: string;
  engine?: string;
  executablePath?: string;
  coverPath?: string;
  iconPath?: string;
  saveLocations?: string[];
  notes?: string;
  metadataId?: string;
}

interface GameLibraryProps {
  games: Game[];
  onSelect: (id: string) => void;
  onAddGame?: (gameData: GameFormPayload) => Promise<{ success?: boolean; error?: string } | void> | { success?: boolean; error?: string } | void;
}

const GameLibrary: React.FC<GameLibraryProps> = ({ games, onSelect, onAddGame }) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingGame, setEditingGame] = useState<Game | null>(null);
  const [newGameName, setNewGameName] = useState('');
  const [newGamePath, setNewGamePath] = useState('');
  const [newGameExecutable, setNewGameExecutable] = useState('');
  const [newGameLauncher, setNewGameLauncher] = useState('');
  const [newGameSaveLocations, setNewGameSaveLocations] = useState('');
  const [newGameCover, setNewGameCover] = useState('');
  const [newGameIcon, setNewGameIcon] = useState('');
  const [newGameNotes, setNewGameNotes] = useState('');
  const [newGameMetadataId, setNewGameMetadataId] = useState('');
  const [modalError, setModalError] = useState('');
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

  const resetManualForm = () => {
    setEditingGame(null);
    setNewGameName('');
    setNewGamePath('');
    setNewGameExecutable('');
    setNewGameLauncher('');
    setNewGameSaveLocations('');
    setNewGameCover('');
    setNewGameIcon('');
    setNewGameNotes('');
    setNewGameMetadataId('');
    setModalError('');
  };

  const openAddModal = () => {
    resetManualForm();
    setShowAddModal(true);
  };

  const openEditModal = (game: Game, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setEditingGame(game);
    setNewGameName(game.name);
    setNewGamePath(game.path);
    setNewGameExecutable(game.executablePath ?? '');
    setNewGameLauncher(game.engine === 'Generic' ? '' : game.engine ?? '');
    setNewGameSaveLocations((game.saveLocations ?? []).join('\n'));
    setNewGameCover(game.coverPath ?? '');
    setNewGameIcon(game.iconPath ?? '');
    setNewGameNotes(game.notes ?? '');
    setNewGameMetadataId(game.metadataId ?? game.id);
    setModalError('');
    setShowAddModal(true);
  };

  const closeModal = () => {
    setShowAddModal(false);
    resetManualForm();
  };

  const handlePickFolder = async () => {
    const result = await window.electronAPI?.pickGameFolder?.();
    if (result?.success && result.folderPath) {
      setNewGamePath(result.folderPath);
      setModalError('');
    } else if (result && !result.canceled) {
      setModalError(result.error ?? 'Could not select folder.');
    }
  };

  const handlePickExecutable = async () => {
    const result = await window.electronAPI?.pickGameExecutable?.();
    if (result?.success && result.filePath && result.folderPath) {
      setNewGameExecutable(result.filePath);
      setNewGamePath(result.folderPath);
      if (!newGameName) {
        const base = result.filePath.slice(Math.max(result.filePath.lastIndexOf('/'), result.filePath.lastIndexOf('\\')) + 1);
        setNewGameName(base.replace(/\.exe$/i, ''));
      }
      setModalError('');
    } else if (result && !result.canceled) {
      setModalError(result.error ?? 'Could not select executable.');
    }
  };

  const handleAddGame = async () => {
    const pathToSave = newGamePath.trim();
    const nameToSave = newGameName.trim();
    if (!nameToSave || !pathToSave) {
      setModalError('Game name and install folder are required.');
      return;
    }
    const duplicate = games.find((game) =>
      game.id !== editingGame?.id &&
      game.path.trim().toLowerCase() === pathToSave.toLowerCase()
    );
    if (duplicate) {
      setModalError(`This path is already recorded for ${duplicate.name}.`);
      return;
    }
    const engine = newGameLauncher.trim() || 'Manual';
    const payload: GameFormPayload = {
      name: nameToSave,
      path: pathToSave,
      engine,
      executablePath: newGameExecutable.trim() || undefined,
      coverPath: newGameCover.trim() || undefined,
      iconPath: newGameIcon.trim() || undefined,
      saveLocations: newGameSaveLocations
        .split(/[\n;]+/)
        .map((location) => location.trim())
        .filter(Boolean),
      notes: newGameNotes.trim() || undefined,
      metadataId: newGameMetadataId.trim() || undefined,
    };
    if (editingGame) {
      const result = await window.electronAPI?.updateGame?.({
        gameId: editingGame.id,
        ...payload,
      });
      if (!result?.success) {
        setModalError(result?.error ?? 'Could not update game.');
        return;
      }
      if (onAddGame) {
        await onAddGame(payload);
      }
      closeModal();
      return;
    }
    if (onAddGame) {
      try {
        const result = await onAddGame(payload);
        if (result && !result.success) {
          setModalError(result.error ?? 'Could not add game.');
          return;
        }
      } catch (err) {
        console.error('Failed to add game:', err);
        setModalError(err instanceof Error ? err.message : 'Could not add game.');
        return;
      }
    }
    closeModal();
  };

  const handleRemoveGame = async (game: Game, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const confirmed = window.confirm(
      `Remove "${game.name}" from the local Solith library? This does not delete game files.`,
    );
    if (!confirmed) return;
    const result = await window.electronAPI?.deleteGame?.(game.id);
    if (result?.success) {
      if (onAddGame) {
        await onAddGame({ name: '', path: '' });
      }
    } else {
      console.error('Failed to remove game:', result?.error ?? result);
    }
  };

  const handleScan = async (e: React.MouseEvent, gameId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setLoading(true);
    try {
      await window.electronAPI.scanGame(gameId);
      if (onAddGame) {
        await onAddGame({ name: '', path: '' });
      }
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
        walkthroughId="game-library"
        actions={<button id="game-library-add-manual" onClick={openAddModal} className="btn-add">+ Add Game Manually</button>}
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
          <button id="game-library-empty-add-manual" onClick={openAddModal} className="btn-primary empty-state-cta">Add Game Manually</button>
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
              >
                <div 
                  className="game-card-clickable"
                  onClick={() => onSelect(game.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(game.id); }}
                >
                  <div className="game-card-art" aria-hidden="true">
                    <BrandingArtwork artwork="gameLibraryControllerMonitors" size="section" />
                  </div>
                  <div className="game-card-content">
                    <div className="game-card-header">
                      <h3 className="game-name">{game.name}</h3>
                      <span className={`badge engine-badge ${game.engine?.toLowerCase() || 'generic'}`}>
                        {game.engine || 'Manual'}
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
                </div>

                <div className="game-card-actions">
                  <button 
                    onClick={(e) => handleScan(e, game.id)} 
                    className="btn-scan"
                    disabled={loading}
                  >
                    {loading ? 'Scanning...' : '🔍 Scan Folder'}
                  </button>
                  <button
                    onClick={(e) => openEditModal(game, e)}
                    className="btn-scan"
                    disabled={loading}
                  >
                    Edit local record
                  </button>
                  <button
                    onClick={(e) => void handleRemoveGame(game, e)}
                    className="btn-scan"
                    disabled={loading}
                  >
                    Remove entry only
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
            <h3>{editingGame ? 'Edit Local Game Record' : 'Add Game Manually'}</h3>
            <p className="modal-description">
              Create or edit a persisted local metadata record. This does not scan memory, attach to a process, or modify game files.
            </p>
            {modalError && <p className="no-scan-text">{modalError}</p>}
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
              <label>Install Folder</label>
              <input
                type="text"
                placeholder="e.g. C:\Games\Witcher3"
                value={newGamePath}
                onChange={(e) => setNewGamePath(e.target.value)}
              />
              <button type="button" className="btn-secondary" onClick={() => void handlePickFolder()}>
                Browse Folder
              </button>
            </div>
            <div className="input-group">
              <label>Executable (optional)</label>
              <input
                type="text"
                placeholder="e.g. C:\Games\Witcher3\witcher3.exe"
                value={newGameExecutable}
                onChange={(e) => setNewGameExecutable(e.target.value)}
              />
              <button type="button" className="btn-secondary" onClick={() => void handlePickExecutable()}>
                Browse EXE
              </button>
            </div>
            <div className="input-group">
              <label>Launcher / Source</label>
              <input
                type="text"
                placeholder="Manual, Steam, GOG, Epic, Xbox"
                value={newGameLauncher}
                onChange={(e) => setNewGameLauncher(e.target.value)}
              />
            </div>
            <div className="input-group">
              <label>Save Locations (optional, persisted)</label>
              <input
                type="text"
                placeholder="Optional local save paths, separated by semicolons"
                value={newGameSaveLocations}
                onChange={(e) => setNewGameSaveLocations(e.target.value)}
              />
            </div>
            <div className="input-group">
              <label>Cover / Icon (optional, persisted)</label>
              <input
                type="text"
                placeholder="Cover path or URL"
                value={newGameCover}
                onChange={(e) => setNewGameCover(e.target.value)}
              />
              <input
                type="text"
                placeholder="Icon path"
                value={newGameIcon}
                onChange={(e) => setNewGameIcon(e.target.value)}
              />
            </div>
            <div className="input-group">
              <label>Metadata ID / Notes (optional, persisted)</label>
              <input
                type="text"
                placeholder="Optional local ID"
                value={newGameMetadataId}
                onChange={(e) => setNewGameMetadataId(e.target.value)}
              />
              <input
                type="text"
                placeholder="Optional notes"
                value={newGameNotes}
                onChange={(e) => setNewGameNotes(e.target.value)}
              />
            </div>
            <div className="modal-actions">
              <button onClick={() => void handleAddGame()} className="btn-primary">
                {editingGame ? 'Save Local Record' : 'Add Game'}
              </button>
              <button onClick={closeModal} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GameLibrary;
