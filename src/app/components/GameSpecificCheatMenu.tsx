import React, { useState, useMemo } from 'react';
import styles from './GameSpecificCheatMenu.module.css';
import { useGameCheatSession } from '../hooks/useGameCheatSession.js';
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

function isToggleCheat(cheat: CheatDefinition): boolean {
  return cheat.valueType === 'bool' || (cheat.tags?.includes('toggle') ?? false);
}

function isConsoleOnly(cheat: CheatDefinition): boolean {
  return cheat.valueType === 'string';
}

export const GameSpecificCheatMenu: React.FC<GameSpecificCheatMenuProps> = ({ game, userConfirmedOffline }) => {
  const session = useGameCheatSession(game, userConfirmedOffline);
  const [scanInputs, setScanInputs] = useState<Record<string, string>>({});

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
        </div>
      );
    }

    if (state.candidates.length > 1) {
      return (
        <div className={styles['discovery-panel']}>
          <span className={styles['discovery-hint']}>
            {state.candidates.length} candidates — change the value in-game, then enter the new value:
          </span>
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
        </div>
      );
    }

    return null;
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
            {pinnedCheats.map((cheat) => (isToggleCheat(cheat) ? renderToggleRow(cheat) : renderStepperRow(cheat)))}
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
              {cheats.map((cheat) => (isToggleCheat(cheat) ? renderToggleRow(cheat) : renderStepperRow(cheat)))}
            </div>
          </section>
        );
      })}
    </div>
  );
};
