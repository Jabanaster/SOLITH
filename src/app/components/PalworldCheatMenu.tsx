import React, { useState, useCallback } from 'react';
import styles from './PalworldCheatMenu.module.css';
import { PALWORLD_CHEATS, getAllCategories } from '../../core/live-memory/palworld-cheats.js';
import type { CheatDefinition } from '../../core/live-memory/palworld-cheats.js';

interface CheatToggleState {
  [cheatId: string]: {
    isEnabled: boolean;
    value: number;
    isFrozen: boolean;
    status: 'idle' | 'discovering' | 'confirmed' | 'frozen' | 'error';
    error: string | null;
  };
}

interface PalworldCheatMenuProps {
  userConfirmedOffline: boolean;
  onCheatToggle: (cheatId: string, enabled: boolean, value: number) => void;
  onCheatFreeze: (cheatId: string, enabled: boolean) => void;
  onCheatDiscover: (cheatId: string) => void;
}

export const PalworldCheatMenu: React.FC<PalworldCheatMenuProps> = ({
  userConfirmedOffline,
  onCheatToggle,
  onCheatFreeze,
  onCheatDiscover,
}) => {
  const [toggleStates, setToggleStates] = useState<CheatToggleState>({});

  const getCheatState = (cheatId: string) => {
    return toggleStates[cheatId] ?? {
      isEnabled: false,
      value: 0,
      isFrozen: false,
      status: 'idle' as const,
      error: null,
    };
  };

  const handleToggleCheat = useCallback(
    (cheat: CheatDefinition) => {
      const state = getCheatState(cheat.id);
      const newEnabled = !state.isEnabled;

      setToggleStates((prev) => ({
        ...prev,
        [cheat.id]: {
          ...prev[cheat.id],
          isEnabled: newEnabled,
          status: newEnabled && cheat.requiresDiscovery ? 'discovering' : (newEnabled ? 'confirmed' : 'idle'),
        },
      }));

      if (newEnabled && cheat.requiresDiscovery) {
        onCheatDiscover(cheat.id);
      } else {
        onCheatToggle(cheat.id, newEnabled, cheat.infiniteValue);
      }
    },
    [toggleStates, onCheatToggle, onCheatDiscover],
  );

  const handleFreezeToggle = useCallback(
    (cheatId: string) => {
      const state = getCheatState(cheatId);
      const newFrozen = !state.isFrozen;

      setToggleStates((prev) => ({
        ...prev,
        [cheatId]: {
          ...prev[cheatId],
          isFrozen: newFrozen,
          status: newFrozen ? 'frozen' : (prev[cheatId]?.isEnabled ? 'confirmed' : 'idle'),
        },
      }));

      onCheatFreeze(cheatId, newFrozen);
    },
    [toggleStates, onCheatFreeze],
  );

  const categories = getAllCategories();

  if (!userConfirmedOffline) {
    return (
      <div className={styles['cheat-menu-disabled']}>
        <p>Enable the offline confirmation above to access cheats.</p>
      </div>
    );
  }

  return (
    <div className={styles['cheat-menu-container']}>
      <h2>Palworld Cheats</h2>
      <p className={styles['cheat-menu-subtitle']}>
        Select cheats to enable. Toggle "Freeze" to maintain infinite values.
      </p>

      {categories.map((category) => {
        const cheatsByCategory = PALWORLD_CHEATS.filter((c) => c.category === category);

        return (
          <section key={category} className={styles['cheat-category']}>
            <h3>{category}</h3>
            <div className={styles['cheat-grid']}>
              {cheatsByCategory.map((cheat) => {
                const state = getCheatState(cheat.id);

                return (
                  <div key={cheat.id} className={styles['cheat-card']}>
                    <label className={styles['cheat-toggle']}>
                      <input
                        type="checkbox"
                        checked={state.isEnabled}
                        onChange={() => handleToggleCheat(cheat)}
                        disabled={!userConfirmedOffline}
                      />
                      <span className={styles['cheat-name']}>{cheat.name}</span>
                    </label>

                    <p className={styles['cheat-description']}>{cheat.description}</p>

                    {state.isEnabled && (
                      <div className={styles['cheat-controls']}>
                        <span className={`${styles['status-badge']} ${styles[`status-${state.status}`]}`}>
                          {state.status.toUpperCase()}
                        </span>

                        <button
                          className={`${styles['freeze-btn']} ${state.isFrozen ? styles['frozen'] : ''}`}
                          onClick={() => handleFreezeToggle(cheat.id)}
                          title="Toggle freeze (maintain infinite value)"
                        >
                          {state.isFrozen ? '❄️ FROZEN' : 'Freeze'}
                        </button>
                      </div>
                    )}

                    {state.error && <p className={styles['cheat-error']}>{state.error}</p>}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
};
