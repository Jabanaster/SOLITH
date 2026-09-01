import React, { useState, useEffect, useCallback } from 'react';
import { PageModuleHeader } from '../components/PageModuleHeader.js';
import { BrandingArtwork } from '../components/BrandingArtwork.js';

type GameLauncherIdentity = 'steam' | 'epic' | 'gog' | 'xbox' | 'ubisoft' | 'ea' | 'battlenet' | 'manual';

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
  launcher?: GameLauncherIdentity;
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
  launcher?: GameLauncherIdentity;
}

interface GameLibraryProps {
  games: Game[];
  onSelect: (id: string) => void;
  onAddGame?: (gameData: GameFormPayload) => Promise<{ success?: boolean; error?: string } | void> | { success?: boolean; error?: string } | void;
}

type GameLibraryView = 'installed' | 'all' | 'owned';

type GameLibraryInstallation = {
  installationId: string;
  launcher: GameLauncherIdentity;
  edition?: string;
  installPath?: string;
  executablePath?: string;
  buildVersion?: string;
  launchUri?: string;
  lastSeenAt: string;
  detectionSource: 'auto-detected' | 'manual';
  active: boolean;
  sourceGameId?: string;
};

type GameLibraryRecord = {
  canonicalGameId: string;
  title: string;
  aliases: string[];
  artworkUrl?: string;
  supportState: 'supported' | 'partial' | 'unsupported' | 'unknown';
  trainerAvailability: 'available' | 'unavailable' | 'unknown';
  verificationStatus: 'verified' | 'community' | 'metadata-only' | 'unverified' | 'unknown';
  ownershipStatus?: 'owned';
  manuallyAdded: boolean;
  installations: GameLibraryInstallation[];
  saveLocations: string[];
};

const LAUNCHER_LABELS: Record<GameLibraryInstallation['launcher'], string> = {
  steam: 'Steam',
  epic: 'Epic',
  gog: 'GOG',
  xbox: 'Xbox',
  ubisoft: 'Ubisoft Connect',
  ea: 'EA app',
  battlenet: 'Battle.net',
  manual: 'Standalone',
};

const LAUNCHER_SELECT_OPTIONS: Array<{ value: GameLauncherIdentity; label: string }> = [
  { value: 'manual', label: 'Standalone' },
  { value: 'steam', label: 'Steam' },
  { value: 'gog', label: 'GOG' },
  { value: 'epic', label: 'Epic Games Store' },
  { value: 'xbox', label: 'Xbox / Microsoft Store' },
  { value: 'ubisoft', label: 'Ubisoft Connect' },
  { value: 'ea', label: 'EA app' },
  { value: 'battlenet', label: 'Battle.net' },
];

const GAME_LIBRARY_VIEW_KEY = 'solith-game-library-view';

function readInitialView(): GameLibraryView {
  try {
    const saved = localStorage.getItem(GAME_LIBRARY_VIEW_KEY);
    if (saved === 'installed' || saved === 'all' || saved === 'owned') return saved;
  } catch {
    // ignore — no localStorage access
  }
  return 'installed';
}

const GameLibrary: React.FC<GameLibraryProps> = ({ games, onSelect, onAddGame }) => {
  const [view, setView] = useState<GameLibraryView>(readInitialView);
  const [records, setRecords] = useState<GameLibraryRecord[] | null>(null);
  const [recordsError, setRecordsError] = useState('');
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [launchStatus, setLaunchStatus] = useState<Record<string, string>>({});
  const [rescanning, setRescanning] = useState(false);

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingGame, setEditingGame] = useState<Game | null>(null);
  const [newGameName, setNewGameName] = useState('');
  const [newGamePath, setNewGamePath] = useState('');
  const [newGameExecutable, setNewGameExecutable] = useState('');
  const [newGameLauncher, setNewGameLauncher] = useState<GameLauncherIdentity>('manual');
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

  const loadRecords = useCallback(async () => {
    if (!window.electronAPI?.listGameLibrary) return;
    setRecordsLoading(true);
    setRecordsError('');
    try {
      const result = await window.electronAPI.listGameLibrary({ view });
      if (result.success) {
        setRecords(result.records ?? []);
      } else {
        setRecordsError(result.error ?? 'Could not load Game Library.');
        setRecords([]);
      }
    } catch (err) {
      setRecordsError(err instanceof Error ? err.message : 'Could not load Game Library.');
      setRecords([]);
    } finally {
      setRecordsLoading(false);
    }
  }, [view]);

  useEffect(() => {
    void loadRecords();
    // Re-fetch whenever the legacy games table changes (add/edit/remove/scan), since
    // manual entries feed the canonical model through the migration bridge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, games]);

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

  const selectView = (next: GameLibraryView) => {
    setView(next);
    try {
      localStorage.setItem(GAME_LIBRARY_VIEW_KEY, next);
    } catch {
      // ignore — no localStorage access
    }
  };

  const resetManualForm = () => {
    setEditingGame(null);
    setNewGameName('');
    setNewGamePath('');
    setNewGameExecutable('');
    setNewGameLauncher('manual');
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

  const openEditModalForGame = (game: Game) => {
    setEditingGame(game);
    setNewGameName(game.name);
    setNewGamePath(game.path);
    setNewGameExecutable(game.executablePath ?? '');
    setNewGameLauncher(game.launcher ?? 'manual');
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
    const payload: GameFormPayload = {
      name: nameToSave,
      path: pathToSave,
      executablePath: newGameExecutable.trim() || undefined,
      coverPath: newGameCover.trim() || undefined,
      iconPath: newGameIcon.trim() || undefined,
      saveLocations: newGameSaveLocations
        .split(/[\n;]+/)
        .map((location) => location.trim())
        .filter(Boolean),
      notes: newGameNotes.trim() || undefined,
      metadataId: newGameMetadataId.trim() || undefined,
      launcher: newGameLauncher,
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

  const handleRemoveGame = async (game: Game) => {
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

  const handleScan = async (gameId: string) => {
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

  const handleRescanLaunchers = async () => {
    setRescanning(true);
    try {
      await window.electronAPI.installDiscoveryScan();
      await loadRecords();
    } catch (err) {
      console.error('Failed to rescan launchers:', err);
    } finally {
      setRescanning(false);
    }
  };

  const handleLaunch = async (record: GameLibraryRecord, installation: GameLibraryInstallation) => {
    const key = installation.installationId;
    setLaunchStatus((prev) => ({ ...prev, [key]: 'Launching…' }));
    try {
      const result = await window.electronAPI.launchInstallation({
        canonicalGameId: record.canonicalGameId,
        installationId: installation.installationId,
      });
      setLaunchStatus((prev) => ({ ...prev, [key]: result.success ? '' : (result.error ?? 'Launch failed.') }));
    } catch (err) {
      setLaunchStatus((prev) => ({ ...prev, [key]: err instanceof Error ? err.message : 'Launch failed.' }));
    }
  };

  const matchesSearch = (record: GameLibraryRecord): boolean => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.trim().toLowerCase();
    if (record.title.toLowerCase().includes(q)) return true;
    return record.aliases.some((alias) => alias.toLowerCase().includes(q));
  };

  const visibleRecords = (records ?? []).filter(matchesSearch);

  const trainerBadgeLabel = (availability: GameLibraryRecord['trainerAvailability']): string => {
    if (availability === 'available') return 'Trainer available';
    if (availability === 'unavailable') return 'Trainer unavailable';
    return 'Trainer: unknown';
  };

  return (
    <div className="game-library">
      <PageModuleHeader
        artwork="gameLibraryControllerMonitors"
        title="Game Library"
        description="Your installed-game hub: detected launchers, manually-added games, and local file records"
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

      <nav className="game-library-tabs" aria-label="Game Library views">
        {(['installed', 'all', 'owned'] as GameLibraryView[]).map((tabView) => (
          <button
            key={tabView}
            type="button"
            className={tabView === view ? 'active' : ''}
            aria-current={tabView === view ? 'page' : undefined}
            onClick={() => selectView(tabView)}
          >
            {tabView === 'installed' ? 'Installed' : tabView === 'all' ? 'All' : 'Owned'}
          </button>
        ))}
        <input
          type="search"
          className="game-library-search"
          placeholder="Search by title or alias…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search Game Library"
        />
        <button type="button" className="btn-secondary" onClick={() => void handleRescanLaunchers()} disabled={rescanning}>
          {rescanning ? 'Rescanning…' : '🔄 Rescan launchers'}
        </button>
      </nav>

      {recordsError && <p className="no-scan-text">{recordsError}</p>}

      {!recordsLoading && visibleRecords.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon-slot">
            <BrandingArtwork artwork="gameLibraryControllerMonitors" size="empty" />
          </div>
          <h3>
            {view === 'installed' ? 'No installed games detected yet' : view === 'owned' ? 'No proven ownership yet' : 'No games recorded yet'}
          </h3>
          <p>
            {view === 'owned'
              ? 'Ownership is only shown when Solith has trustworthy evidence — connected launcher accounts are not supported yet.'
              : 'Add a game manually, or rescan detected launchers, to populate the library.'}
          </p>
          <button id="game-library-empty-add-manual" onClick={openAddModal} className="btn-primary empty-state-cta">Add Game Manually</button>
        </div>
      ) : (
        <div className="game-grid">
          {visibleRecords.map((record) => {
            const launchers = [...new Set(record.installations.map((i) => LAUNCHER_LABELS[i.launcher]))];
            const isExpanded = expandedCard === record.canonicalGameId;
            return (
              <div key={record.canonicalGameId} className="game-card glass">
                <div className="game-card-art" aria-hidden="true">
                  {record.artworkUrl ? (
                    <img src={record.artworkUrl} alt="" loading="lazy" />
                  ) : (
                    <BrandingArtwork artwork="gameLibraryControllerMonitors" size="section" />
                  )}
                </div>
                <div className="game-card-content">
                  <div className="game-card-header">
                    <h3 className="game-name">{record.title}</h3>
                    {record.ownershipStatus === 'owned' && <span className="badge">Owned</span>}
                  </div>

                  <div className="game-card-badges">
                    {launchers.map((label) => (
                      <span key={label} className="badge engine-badge">{label}</span>
                    ))}
                    <span className="badge">{trainerBadgeLabel(record.trainerAvailability)}</span>
                    <span className="badge">{record.verificationStatus === 'unknown' ? 'Verification: unknown' : record.verificationStatus}</span>
                  </div>

                  <button
                    type="button"
                    className="btn-secondary"
                    aria-expanded={isExpanded}
                    onClick={() => setExpandedCard(isExpanded ? null : record.canonicalGameId)}
                  >
                    {isExpanded ? 'Hide installations' : `Show installations (${record.installations.length})`}
                  </button>

                  {isExpanded && (
                    <div className="game-card-installations">
                      {record.installations.map((installation) => {
                        const legacyGame = installation.sourceGameId
                          ? games.find((g) => g.id === installation.sourceGameId)
                          : undefined;
                        return (
                          <div key={installation.installationId} className={`installation-row ${installation.active ? '' : 'installation-inactive'}`}>
                            <div className="installation-row-header">
                              <strong>{LAUNCHER_LABELS[installation.launcher]}</strong>
                              {installation.edition && <span> — {installation.edition}</span>}
                              {!installation.active && <span className="badge">No longer detected</span>}
                            </div>
                            {installation.installPath && (
                              <div className="game-path" title={installation.installPath}>📁 {installation.installPath}</div>
                            )}
                            <div className="installation-row-meta">
                              Last seen: {new Date(installation.lastSeenAt).toLocaleString()}
                            </div>
                            <div className="installation-row-actions">
                              {installation.executablePath && (
                                <button
                                  type="button"
                                  className="btn-scan"
                                  onClick={() => void handleLaunch(record, installation)}
                                >
                                  ▶ Launch
                                </button>
                              )}
                              {legacyGame && (
                                <>
                                  <button
                                    type="button"
                                    className="btn-scan"
                                    disabled={loading}
                                    onClick={() => void handleScan(legacyGame.id)}
                                  >
                                    {loading ? 'Scanning...' : '🔍 Scan Folder'}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-scan"
                                    onClick={() => openEditModalForGame(legacyGame)}
                                  >
                                    Edit local record
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-scan"
                                    onClick={() => void handleRemoveGame(legacyGame)}
                                  >
                                    Remove entry only
                                  </button>
                                </>
                              )}
                            </div>
                            {launchStatus[installation.installationId] && (
                              <p className="no-scan-text">{launchStatus[installation.installationId]}</p>
                            )}
                          </div>
                        );
                      })}
                      {record.saveLocations.length > 0 && (
                        <div className="installation-row">
                          <strong>Save locations</strong>
                          <ul>
                            {record.saveLocations.map((location) => (
                              <li key={location} title={location}>{location}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {record.installations.some((i) => i.sourceGameId) && (
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => {
                            const withGame = record.installations.find((i) => i.sourceGameId);
                            const legacyGame = withGame ? games.find((g) => g.id === withGame.sourceGameId) : undefined;
                            if (legacyGame) onSelect(legacyGame.id);
                          }}
                        >
                          Open save editor / trainer detail
                        </button>
                      )}
                    </div>
                  )}
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
              <label>Launcher</label>
              <select
                value={newGameLauncher}
                onChange={(e) => setNewGameLauncher(e.target.value as GameLauncherIdentity)}
              >
                {LAUNCHER_SELECT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
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
