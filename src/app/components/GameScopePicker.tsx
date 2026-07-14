import React, { useEffect, useState } from 'react';

export interface GameScopeOption {
  id: string;
  name: string;
  source: 'registered' | 'catalog';
}

interface GameScopePickerProps {
  value: string | null;
  onChange: (gameId: string, name: string) => void;
  label?: string;
  hint?: string;
}

export const GameScopePicker: React.FC<GameScopePickerProps> = ({
  value,
  onChange,
  label = 'Select game',
  hint,
}) => {
  const [options, setOptions] = useState<GameScopeOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const next: GameScopeOption[] = [];
      try {
        const games = await window.electronAPI?.getGames?.();
        if (Array.isArray(games)) {
          for (const g of games) {
            next.push({ id: g.id, name: g.name, source: 'registered' });
          }
        }
        const installs = await window.electronAPI?.installDiscoveryList?.();
        if (installs?.success && installs.catalogGameIds?.length) {
          await window.electronAPI?.trainerCatalogSeed?.();
          for (const catalogGameId of installs.catalogGameIds) {
            if (next.some((o) => o.id === catalogGameId)) continue;
            const search = await window.electronAPI?.trainerCatalogSearch?.({
              query: catalogGameId,
              limit: 1,
              offset: 0,
            });
            const entry = search?.entries?.[0];
            next.push({
              id: catalogGameId,
              name: entry?.displayName ?? catalogGameId,
              source: 'catalog',
            });
          }
        }
      } catch {
        // browser mode
      }
      if (!cancelled) {
        setOptions(next);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="game-scope-picker glass">
      <label htmlFor="game-scope-select">{label}</label>
      {hint && <p className="game-scope-picker__hint">{hint}</p>}
      {loading ? (
        <select id="game-scope-select" disabled>
          <option>Loading games…</option>
        </select>
      ) : options.length === 0 ? (
        <p className="game-scope-picker__empty">
          No games registered yet. Add a game from <strong>Game Library</strong> or scan installed games in{' '}
          <strong>Trainer Library</strong>.
        </p>
      ) : (
        <select
          id="game-scope-select"
          value={value ?? ''}
          onChange={(e) => {
            const id = e.target.value;
            const opt = options.find((o) => o.id === id);
            if (id && opt) onChange(id, opt.name);
          }}
        >
          <option value="">— Choose game —</option>
          {options.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.name}
              {opt.source === 'catalog' ? ' (installed)' : ''}
            </option>
          ))}
        </select>
      )}
    </div>
  );
};
