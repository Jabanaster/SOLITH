import React, { useState, useCallback, useMemo } from 'react';
import styles from './GameSpecificCheatMenu.module.css';
import type { GameConfig, CheatDefinition } from '../../core/cheat-system/types.js';

interface CheatRowState {
  enabled: boolean;
  value: number | string;
  isFrozen: boolean;
  status: 'idle' | 'discovering' | 'confirmed' | 'frozen' | 'error';
  error?: string;
}

interface GameSpecificCheatMenuProps {
  game: GameConfig;
  userConfirmedOffline: boolean;
  onCheatToggle: (cheatId: string, enabled: boolean, value: number | string) => void;
  onCheatFreeze: (cheatId: string, enabled: boolean) => void;
  onCheatDiscover: (cheatId: string) => void;
  onValueApply?: (cheatId: string, value: number | string) => void;
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

export const GameSpecificCheatMenu: React.FC<GameSpecificCheatMenuProps> = ({
  game,
  userConfirmedOffline,
  onCheatToggle,
  onCheatFreeze,
  onCheatDiscover,
  onValueApply,
}) => {
  const [rowStates, setRowStates] = useState<Record<string, CheatRowState>>({});
  const [pendingValues, setPendingValues] = useState<Record<string, number>>({});

  const getRowState = useCallback(
    (cheatId: string): CheatRowState =>
      rowStates[cheatId] ?? { enabled: false, value: 0, isFrozen: false, status: 'idle' },
    [rowStates],
  );

  const handleToggle = useCallback(
    (cheat: CheatDefinition) => {
      const current = getRowState(cheat.id);
      const nextEnabled = !current.enabled;

      setRowStates((prev) => ({
        ...prev,
        [cheat.id]: {
          ...current,
          enabled: nextEnabled,
          status: nextEnabled && cheat.requiresDiscovery ? 'discovering' : nextEnabled ? 'confirmed' : 'idle',
        },
      }));

      if (nextEnabled && cheat.requiresDiscovery) {
        onCheatDiscover(cheat.id);
      } else {
        onCheatToggle(cheat.id, nextEnabled, cheat.infiniteValue ?? 1);
      }
    },
    [getRowState, onCheatToggle, onCheatDiscover],
  );

  const handleFreeze = useCallback(
    (cheatId: string) => {
      const current = getRowState(cheatId);
      const nextFrozen = !current.isFrozen;
      setRowStates((prev) => ({
        ...prev,
        [cheatId]: { ...current, isFrozen: nextFrozen, status: nextFrozen ? 'frozen' : current.enabled ? 'confirmed' : 'idle' },
      }));
      onCheatFreeze(cheatId, nextFrozen);
    },
    [getRowState, onCheatFreeze],
  );

  const handleApplyValue = useCallback(
    (cheat: CheatDefinition) => {
      const value = pendingValues[cheat.id] ?? Number(cheat.defaultValue ?? 0);
      onValueApply?.(cheat.id, value);
      setRowStates((prev) => ({
        ...prev,
        [cheat.id]: { ...getRowState(cheat.id), enabled: true, value, status: 'confirmed' },
      }));
    },
    [pendingValues, onValueApply, getRowState],
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

  function renderToggleRow(cheat: CheatDefinition) {
    const state = getRowState(cheat.id);
    const disabled = !userConfirmedOffline;

    return (
      <div key={cheat.id} className={styles['cheat-row']}>
        <div className={styles['cheat-row-main']}>
          <span className={styles['bolt-icon']}>⚡</span>
          <span className={styles['cheat-row-name']}>{cheat.name}</span>
          {cheat.notes && (
            <span className={styles['info-icon']} title={cheat.notes}>
              ⓘ
            </span>
          )}
        </div>

        <div className={styles['cheat-row-controls']}>
          {state.enabled && state.status === 'discovering' && (
            <span className={`${styles['status-pill']} ${styles['status-discovering']}`}>DISCOVERING</span>
          )}
          {state.enabled && state.isFrozen && (
            <span className={`${styles['status-pill']} ${styles['status-frozen']}`}>❄ FROZEN</span>
          )}

          <button
            className={`${styles['off-on-toggle']} ${state.enabled ? styles['is-on'] : ''}`}
            disabled={disabled}
            onClick={() => handleToggle(cheat)}
          >
            <span className={styles['toggle-off-label']}>Off</span>
            <span className={styles['toggle-on-label']}>On</span>
          </button>

          {state.enabled && (
            <button
              className={`${styles['freeze-icon-btn']} ${state.isFrozen ? styles['active'] : ''}`}
              onClick={() => handleFreeze(cheat.id)}
              title="Freeze value (continuous re-write)"
              disabled={disabled}
            >
              ❄
            </button>
          )}

          <button className={styles['pin-icon-btn']} title="Pin to top">
            📌
          </button>
        </div>
      </div>
    );
  }

  function renderStepperRow(cheat: CheatDefinition) {
    const disabled = !userConfirmedOffline;
    const currentValue = pendingValues[cheat.id] ?? Number(cheat.defaultValue ?? 0);
    const min = cheat.normalValues?.min ?? 0;
    const max = cheat.normalValues?.max ?? 999999;

    const setValue = (v: number) => {
      const clamped = Math.max(min, Math.min(max, v));
      setPendingValues((prev) => ({ ...prev, [cheat.id]: clamped }));
    };

    return (
      <div key={cheat.id} className={styles['cheat-row']}>
        <div className={styles['cheat-row-main']}>
          <span className={styles['bolt-icon']}>⚡</span>
          <span className={styles['cheat-row-name']}>{cheat.name}</span>
        </div>

        <div className={styles['cheat-row-controls']}>
          <div className={styles['stepper']}>
            <button disabled={disabled} onClick={() => setValue(currentValue - 1)}>
              −
            </button>
            <span className={styles['stepper-value']}>{currentValue}</span>
            <button disabled={disabled} onClick={() => setValue(currentValue + 1)}>
              +
            </button>
          </div>
          <button
            className={styles['apply-check-btn']}
            disabled={disabled}
            onClick={() => handleApplyValue(cheat)}
            title="Apply value"
          >
            ✓
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles['menu-container']}>
      {/* Header banner with game art */}
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

      {/* Pinned section */}
      {pinnedCheats.length > 0 && (
        <section className={styles['cheat-section']}>
          <h2 className={styles['section-title']}>📌 Pinned</h2>
          <div className={styles['cheat-list']}>
            {pinnedCheats.map((cheat) =>
              isToggleCheat(cheat) ? renderToggleRow(cheat) : renderStepperRow(cheat),
            )}
          </div>
        </section>
      )}

      {/* Category sections */}
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
