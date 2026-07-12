import React, { useState, useMemo, useCallback } from 'react';
import styles from './GameSpecificCheatMenu.module.css';
import { useGameCheatSession } from '../hooks/useGameCheatSession.js';
import { LiveWatchPanel } from './LiveWatchPanel.js';
import { FingerprintDriftDialog } from './FingerprintDriftDialog.js';
import { DefinitionRatingPrompt } from './DefinitionRatingPrompt.js';
import type { GameConfig, CheatDefinition } from '../../core/cheat-system/types.js';

interface GameSpecificCheatMenuProps {
  game: GameConfig;
  userConfirmedOffline: boolean;
}

/** Falls back to a generated initial-letter gradient tile if the Steam CDN image 404s. */
function GameArt({ game, variant }: { game: GameConfig; variant: 'header' | 'icon' }) {
  const [failed, setFailed] = useState(false);
  const src = variant === 'header' ? game.images?.headerUrl : game.images?.iconUrl;

  if (!src || failed) {
    return (
      <div className={variant === 'header' ? styles['header-fallback'] : styles['icon-fallback']}>
        <span>{game.name.charAt(0)}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={game.name}
      className={variant === 'header' ? styles['header-image'] : styles['icon-image']}
      onError={() => setFailed(true)}
      loading="lazy"
    />
  );
}

function isActionCheat(cheat: CheatDefinition): boolean {
  return cheat.tags?.includes('action') ?? false;
}

function isToggleCheat(cheat: CheatDefinition): boolean {
  return cheat.valueType === 'bool' || (cheat.tags?.includes('toggle') ?? false);
}

function isConsoleOnly(cheat: CheatDefinition): boolean {
  return cheat.valueType === 'string';
}

const EMPTY_ADVANCED_INPUTS = { delta: '', threshold: '', rangeMin: '', rangeMax: '' };

export const GameSpecificCheatMenu: React.FC<GameSpecificCheatMenuProps> = ({ game, userConfirmedOffline }) => {
  const session = useGameCheatSession(game, userConfirmedOffline);
  const [scanInputs, setScanInputs] = useState<Record<string, string>>({});
  const [watchingCheatId, setWatchingCheatId] = useState<string | null>(null);
  const [expandedAdvanced, setExpandedAdvanced] = useState<Record<string, boolean>>({});
  const [advancedInputs, setAdvancedInputs] = useState<
    Record<string, { delta: string; threshold: string; rangeMin: string; rangeMax: string }>
  >({});

  const getAdvancedInputs = useCallback(
    (cheatId: string) => advancedInputs[cheatId] ?? EMPTY_ADVANCED_INPUTS,
    [advancedInputs],
  );

  const patchAdvancedInputs = useCallback(
    (cheatId: string, patch: Partial<{ delta: string; threshold: string; rangeMin: string; rangeMax: string }>) => {
      setAdvancedInputs((prev) => ({
        ...prev,
        [cheatId]: { ...(prev[cheatId] ?? EMPTY_ADVANCED_INPUTS), ...patch },
      }));
    },
    [],
  );

  const watchingCheat = useMemo(
    () => (watchingCheatId ? game.cheats.find((c) => c.id === watchingCheatId) ?? null : null),
    [watchingCheatId, game.cheats],
  );

  const handleReadLive = useCallback(
    () => (watchingCheat ? session.readCandidatesLive(watchingCheat) : Promise.resolve([])),
    [watchingCheat, session],
  );

  const handleConfirmFromWatch = useCallback(
    (candidate: { address: string; value: number; dataType?: string }) => {
      if (!watchingCheat) return;
      session.confirmCandidate(watchingCheat, candidate);
      setWatchingCheatId(null);
    },
    [watchingCheat, session],
  );

  const cheatsByCategory = useMemo(() => {
    const map = new Map<string, CheatDefinition[]>();
    for (const cheat of game.cheats) {
      const list = map.get(cheat.category) ?? [];
      list.push(cheat);
      map.set(cheat.category, list);
    }
    return map;
  }, [game.cheats]);

  const pinnedCheats = useMemo(() => {
    if (!game.pinnedCheatIds?.length) return [];
    return game.pinnedCheatIds
      .map((id) => game.cheats.find((c) => c.id === id))
      .filter((c): c is CheatDefinition => Boolean(c));
  }, [game]);

  const hotkeySlotByCheatId = useMemo(() => {
    const map = new Map<string, number>();
    session.hotkeyCheats.forEach((cheat, index) => map.set(cheat.id, index + 1));
    return map;
  }, [session.hotkeyCheats]);

  function hotkeyLabel(cheatId: string): string | null {
    const slot = hotkeySlotByCheatId.get(cheatId);
    return slot != null && slot <= 12 ? `F${slot}` : null;
  }

  function renderDiscoveryPanel(cheat: CheatDefinition) {
    const state = session.getState(cheat.id);
    const inputValue = scanInputs[cheat.id] ?? '';

    if (state.status === 'error') {
      return (
        <div className={styles['discovery-panel']}>
          <span className={styles['discovery-error']}>{state.error}</span>
          <button className={styles['discovery-btn']} onClick={() => session.resetError(cheat.id)}>
            Retry
          </button>
        </div>
      );
    }

    if (state.unknownScanActive) {
      return (
        <div className={styles['discovery-panel']}>
          <span className={styles['discovery-hint']}>
            Baseline captured. Change the value in-game (take damage, spend the resource), then tell us how it moved:
          </span>
          <button className={styles['discovery-btn']} onClick={() => session.narrowUnknown(cheat, 'decreased')}>
            Decreased ↓
          </button>
          <button className={styles['discovery-btn']} onClick={() => session.narrowUnknown(cheat, 'increased')}>
            Increased ↑
          </button>
          <button className={styles['discovery-btn']} onClick={() => session.narrowUnknown(cheat, 'changed')}>
            Changed (any)
          </button>
        </div>
      );
    }

    if (state.candidates.length === 0) {
      return (
        <div className={styles['discovery-panel']}>
          <span className={styles['discovery-hint']}>Enter current in-game value:</span>
          <input
            type="number"
            className={styles['discovery-input']}
            value={inputValue}
            onChange={(e) => setScanInputs((prev) => ({ ...prev, [cheat.id]: e.target.value }))}
            placeholder="e.g. 100"
          />
          <button
            className={styles['discovery-btn']}
            disabled={inputValue === ''}
            onClick={() => session.discover(cheat, Number(inputValue))}
          >
            Scan
          </button>
          <button
            className={styles['discovery-btn-secondary']}
            onClick={() => session.discoverUnknown(cheat)}
            title="For stats with no visible number — e.g. a bar with no digits"
          >
            Don't know the value?
          </button>
        </div>
      );
    }

    if (state.candidates.length > 1) {
      return (
        <div className={styles['discovery-panel']}>
          <span className={styles['discovery-hint']}>
            {state.candidates.length} candidates — change the value in-game, then narrow by how it moved:
          </span>
          <button className={styles['discovery-btn']} onClick={() => session.narrowByComparison(cheat, 'decreased')}>
            Decreased ↓
          </button>
          <button className={styles['discovery-btn']} onClick={() => session.narrowByComparison(cheat, 'increased')}>
            Increased ↑
          </button>
          <button className={styles['discovery-btn']} onClick={() => session.narrowByComparison(cheat, 'changed')}>
            Changed (any)
          </button>
          <button
            className={styles['discovery-btn-secondary']}
            onClick={() => session.narrowByComparison(cheat, 'unchanged')}
            title="Filter out background noise — use while the value is genuinely holding still (bar full, not regenerating)"
          >
            Unchanged (stable)
          </button>
          <button
            className={styles['discovery-btn-secondary']}
            onClick={() => setWatchingCheatId(cheat.id)}
            title="Watch every candidate's live value update in real time and pick the one that's obviously correlated"
          >
            👁 Watch Live
          </button>
          <span className={styles['discovery-hint']}>or, if you know the exact new value:</span>
          <input
            type="number"
            className={styles['discovery-input']}
            value={inputValue}
            onChange={(e) => setScanInputs((prev) => ({ ...prev, [cheat.id]: e.target.value }))}
            placeholder="new value"
          />
          <button
            className={styles['discovery-btn']}
            disabled={inputValue === ''}
            onClick={() => session.narrow(cheat, Number(inputValue))}
          >
            Narrow
          </button>
          <button
            className={styles['discovery-btn-secondary']}
            onClick={() => session.resetError(cheat.id)}
            title="Discard this candidate set and pick a new starting value"
          >
            Start Over
          </button>

          <button
            className={styles['discovery-btn-secondary']}
            onClick={() => setExpandedAdvanced((prev) => ({ ...prev, [cheat.id]: !prev[cheat.id] }))}
          >
            {expandedAdvanced[cheat.id] ? '▾ Advanced' : '▸ Advanced'}
          </button>

          {expandedAdvanced[cheat.id] && renderAdvancedNarrow(cheat)}
        </div>
      );
    }

    return null;
  }

  function renderAdvancedNarrow(cheat: CheatDefinition) {
    const adv = getAdvancedInputs(cheat.id);

    return (
      <div className={styles['advanced-panel']}>
        <div className={styles['advanced-row']}>
          <span className={styles['discovery-hint']}>Moved by exactly:</span>
          <input
            type="number"
            className={styles['discovery-input']}
            value={adv.delta}
            onChange={(e) => patchAdvancedInputs(cheat.id, { delta: e.target.value })}
            placeholder="e.g. 12"
          />
          <button
            className={styles['discovery-btn-secondary']}
            disabled={adv.delta === ''}
            onClick={() => session.narrowByDelta(cheat, 'decreasedBy', Number(adv.delta))}
          >
            Decreased by this ↓
          </button>
          <button
            className={styles['discovery-btn-secondary']}
            disabled={adv.delta === ''}
            onClick={() => session.narrowByDelta(cheat, 'increasedBy', Number(adv.delta))}
          >
            Increased by this ↑
          </button>
        </div>

        <div className={styles['advanced-row']}>
          <span className={styles['discovery-hint']}>Current value is:</span>
          <input
            type="number"
            className={styles['discovery-input']}
            value={adv.threshold}
            onChange={(e) => patchAdvancedInputs(cheat.id, { threshold: e.target.value })}
            placeholder="threshold"
          />
          <button
            className={styles['discovery-btn-secondary']}
            disabled={adv.threshold === ''}
            onClick={() => session.narrowByThreshold(cheat, 'greaterThan', Number(adv.threshold))}
          >
            Greater than
          </button>
          <button
            className={styles['discovery-btn-secondary']}
            disabled={adv.threshold === ''}
            onClick={() => session.narrowByThreshold(cheat, 'lessThan', Number(adv.threshold))}
          >
            Less than
          </button>
        </div>

        <div className={styles['advanced-row']}>
          <span className={styles['discovery-hint']}>Current value is between:</span>
          <input
            type="number"
            className={styles['discovery-input']}
            value={adv.rangeMin}
            onChange={(e) => patchAdvancedInputs(cheat.id, { rangeMin: e.target.value })}
            placeholder="min"
          />
          <input
            type="number"
            className={styles['discovery-input']}
            value={adv.rangeMax}
            onChange={(e) => patchAdvancedInputs(cheat.id, { rangeMax: e.target.value })}
            placeholder="max"
          />
          <button
            className={styles['discovery-btn-secondary']}
            disabled={adv.rangeMin === '' || adv.rangeMax === ''}
            onClick={() => session.narrowByRange(cheat, Number(adv.rangeMin), Number(adv.rangeMax))}
          >
            Narrow to range
          </button>
        </div>
      </div>
    );
  }

  function renderToggleRow(cheat: CheatDefinition) {
    const state = session.getState(cheat.id);
    const disabled = !userConfirmedOffline || isConsoleOnly(cheat);
    const showDiscoveryPanel = state.enabled && state.status === 'discovering';

    return (
      <div key={cheat.id} className={styles['cheat-row-wrap']}>
        <div className={styles['cheat-row']}>
          <div className={styles['cheat-row-main']}>
            <span className={styles['bolt-icon']}>⚡</span>
            <span className={styles['cheat-row-name']}>{cheat.name}</span>
            {hotkeyLabel(cheat.id) && (
              <span className={styles['hotkey-tag']} title="Global hotkey when offline is confirmed">
                {hotkeyLabel(cheat.id)}
              </span>
            )}
            {(cheat.notes || isConsoleOnly(cheat)) && (
              <span className={styles['info-icon']} title={cheat.notes ?? 'Console-command cheat — not yet wired'}>
                ⓘ
              </span>
            )}
          </div>

          <div className={styles['cheat-row-controls']}>
            {showDiscoveryPanel && (
              <span className={`${styles['status-pill']} ${styles['status-discovering']}`}>DISCOVERING</span>
            )}
            {state.isFrozen && <span className={`${styles['status-pill']} ${styles['status-frozen']}`}>❄ FROZEN</span>}
            {state.status === 'error' && <span className={`${styles['status-pill']} ${styles['status-error']}`}>ERROR</span>}

            <button
              className={`${styles['off-on-toggle']} ${state.enabled ? styles['is-on'] : ''}`}
              disabled={disabled}
              onClick={() => session.toggleCheat(cheat, !state.enabled)}
            >
              <span className={styles['toggle-off-label']}>Off</span>
              <span className={styles['toggle-on-label']}>On</span>
            </button>

            {state.enabled && state.confirmedAddress && (
              <button
                className={`${styles['freeze-icon-btn']} ${state.isFrozen ? styles['active'] : ''}`}
                onClick={() => session.toggleFreeze(cheat, !state.isFrozen)}
                title="Freeze value (continuous re-write every 200ms)"
                disabled={disabled}
              >
                ❄
              </button>
            )}
          </div>
        </div>

        {showDiscoveryPanel && renderDiscoveryPanel(cheat)}
        {state.status === 'error' && renderDiscoveryPanel(cheat)}
      </div>
    );
  }

  function renderStepperRow(cheat: CheatDefinition) {
    const state = session.getState(cheat.id);
    const disabled = !userConfirmedOffline || isConsoleOnly(cheat);
    const showDiscoveryPanel = state.status === 'discovering' || state.status === 'error';
    const min = cheat.normalValues?.min ?? 0;
    const max = cheat.normalValues?.max ?? 999999;
    const currentValue = state.liveValue ?? Number(cheat.defaultValue ?? min);

    const applyDelta = (delta: number) => {
      const next = Math.max(min, Math.min(max, currentValue + delta));
      session.applyValue(cheat, next);
    };

    return (
      <div key={cheat.id} className={styles['cheat-row-wrap']}>
        <div className={styles['cheat-row']}>
          <div className={styles['cheat-row-main']}>
            <span className={styles['bolt-icon']}>⚡</span>
            <span className={styles['cheat-row-name']}>{cheat.name}</span>
            {hotkeyLabel(cheat.id) && (
              <span className={styles['hotkey-tag']} title="Global hotkey when offline is confirmed">
                {hotkeyLabel(cheat.id)}
              </span>
            )}
            {isConsoleOnly(cheat) && (
              <span className={styles['info-icon']} title="Console-command cheat — not yet wired">
                ⓘ
              </span>
            )}
          </div>

          <div className={styles['cheat-row-controls']}>
            {state.confirmedAddress && (
              <div className={styles['stepper']}>
                <button disabled={disabled} onClick={() => applyDelta(-1)}>
                  −
                </button>
                <span className={styles['stepper-value']}>{currentValue}</span>
                <button disabled={disabled} onClick={() => applyDelta(1)}>
                  +
                </button>
              </div>
            )}
            <button
              className={styles['apply-check-btn']}
              disabled={disabled}
              onClick={() => session.applyValue(cheat, currentValue || Number(cheat.defaultValue ?? min))}
              title={state.confirmedAddress ? 'Apply value' : 'Discover address'}
            >
              ✓
            </button>
          </div>
        </div>

        {showDiscoveryPanel && renderDiscoveryPanel(cheat)}
      </div>
    );
  }

  /** One-shot cheats (e.g. Undisputed's "Daze Opponent") — fire once, no persistent on/off state, no freeze. */
  function renderActionRow(cheat: CheatDefinition) {
    const state = session.getState(cheat.id);
    const disabled = !userConfirmedOffline || isConsoleOnly(cheat);
    const showDiscoveryPanel = state.status === 'discovering' || state.status === 'error';

    return (
      <div key={cheat.id} className={styles['cheat-row-wrap']}>
        <div className={styles['cheat-row']}>
          <div className={styles['cheat-row-main']}>
            <span className={styles['bolt-icon']}>⚡</span>
            <span className={styles['cheat-row-name']}>{cheat.name}</span>
            {hotkeyLabel(cheat.id) && (
              <span className={styles['hotkey-tag']} title="Global hotkey when offline is confirmed">
                {hotkeyLabel(cheat.id)}
              </span>
            )}
          </div>

          <div className={styles['cheat-row-controls']}>
            {state.status === 'error' && <span className={`${styles['status-pill']} ${styles['status-error']}`}>ERROR</span>}
            <button
              className={styles['discovery-btn']}
              disabled={disabled}
              onClick={() => {
                if (state.confirmedAddress) {
                  session.applyValue(cheat, Number(cheat.infiniteValue ?? 1));
                } else {
                  // One-shot triggers have no meaningful "current value" to search for (e.g. a
                  // constant like 1 matches thousands of unrelated locations) — always start
                  // from the unknown-value scan instead of guessing a number.
                  session.discoverUnknown(cheat);
                }
              }}
            >
              Apply
            </button>
          </div>
        </div>

        {showDiscoveryPanel && renderDiscoveryPanel(cheat)}
      </div>
    );
  }

  function renderCheatRow(cheat: CheatDefinition) {
    if (isActionCheat(cheat)) return renderActionRow(cheat);
    if (isToggleCheat(cheat)) return renderToggleRow(cheat);
    return renderStepperRow(cheat);
  }

  return (
    <div className={styles['menu-container']}>
      <div className={styles['game-header']}>
        <div className={styles['header-backdrop']}>
          <GameArt game={game} variant="header" />
          <div className={styles['header-overlay']} />
        </div>
        <div className={styles['header-content']}>
          <div className={styles['header-icon-wrap']}>
            <GameArt game={game} variant="icon" />
          </div>
          <div className={styles['header-text']}>
            <h1>{game.name}</h1>
            <div className={styles['header-meta']}>
              <span className={styles['platform-tag']}>{game.platform}</span>
              <span className={styles['cheat-count-tag']}>{game.cheats.length} cheats</span>
              <span className={styles['discovery-tag']}>{game.cheatDiscoveryType}</span>
            </div>
          </div>
        </div>
      </div>

      {!userConfirmedOffline && (
        <div className={styles['offline-warning']}>
          ⚠️ Confirm offline/single-player mode above to enable cheats for {game.name}.
        </div>
      )}

      {game.cheatDiscoveryType === 'console-command' && (
        <div className={styles['offline-warning']}>
          ℹ️ {game.name} cheats use in-game console commands, not memory scanning. Toggles here are reference-only
          until the command executor is wired.
        </div>
      )}

      {pinnedCheats.length > 0 && (
        <section className={styles['cheat-section']}>
          <h2 className={styles['section-title']}>📌 Pinned</h2>
          <div className={styles['cheat-list']}>
            {pinnedCheats.map((cheat) => renderCheatRow(cheat))}
          </div>
        </section>
      )}

      {game.categories.map((category) => {
        const cheats = cheatsByCategory.get(category.name) ?? cheatsByCategory.get(category.id) ?? [];
        if (cheats.length === 0) return null;

        return (
          <section key={category.id} className={styles['cheat-section']}>
            <h2 className={styles['section-title']}>{category.name}</h2>
            <div className={styles['cheat-list']}>
              {cheats.map((cheat) => renderCheatRow(cheat))}
            </div>
          </section>
        );
      })}

      {watchingCheat && (
        <LiveWatchPanel
          cheatName={watchingCheat.name}
          initialCandidates={session.getState(watchingCheat.id).candidates}
          onReadLive={handleReadLive}
          onConfirm={handleConfirmFromWatch}
          onClose={() => setWatchingCheatId(null)}
        />
      )}

      {session.driftPrompt && (
        <FingerprintDriftDialog
          warning={session.driftPrompt.warning}
          onProceed={() => session.resolveDriftPrompt(true)}
          onCancel={() => session.resolveDriftPrompt(false)}
        />
      )}

      {session.ratingPrompt && (
        <DefinitionRatingPrompt
          gameName={game.name}
          catalogGameId={game.gameId}
          featureId={session.ratingPrompt.cheatId}
          onClose={session.dismissRatingPrompt}
        />
      )}
    </div>
  );
};
