import React, { useState, useEffect, useCallback } from 'react';
import type { TrainerItem } from '../../shared/types/index.js';
import { TrainerCard, type TrainerCardState } from '../components/TrainerCard.js';
import { ApplyDialog } from '../components/ApplyDialog.js';
import { ContextPanel } from '../components/ContextPanel.js';
import {
  localTrainerServiceFailureMessage,
  operationFailedBeforeWriteMessage,
  userSafeErrorDetail,
} from '../reliability-messages.js';

interface TrainerPageProps {
  gameId: string;
  category: string;
  onBack: () => void;
}

interface ApplyPending {
  item: TrainerItem;
  value: any;
}

const ALLOWED_CATEGORIES = [
  'PLAYER', 'HEALTH', 'STAMINA', 'MANA', 'INVENTORY', 'CURRENCY',
  'EXPERIENCE', 'SKILLS', 'ATTRIBUTES', 'EQUIPMENT', 'WEAPONS', 'ARMOR',
  'WORLD', 'DIFFICULTY', 'GAME', 'VIDEO', 'AUDIO', 'ACCESSIBILITY',
  'MISCELLANEOUS', 'STATS', 'ENEMIES', 'UNLOCKS', 'VOICE', 'DISCOVERY',
];

function normalizeCategory(cat: string): string {
  const upper = cat.toUpperCase();
  return ALLOWED_CATEGORIES.includes(upper) ? upper : 'MISCELLANEOUS';
}

function deriveCardState(
  item: TrainerItem,
  transient: TrainerCardState | null,
  gameRunning: boolean
): TrainerCardState {
  if (transient && ['APPLYING', 'APPLIED', 'RESTORED', 'FAILED'].includes(transient)) {
    return transient;
  }
  const statusStr = (item.status ?? '').toLowerCase();
  if (item.risk === 'Blocked' || statusStr === 'blocked') return 'BLOCKED';
  if (statusStr === 'needs rescan') return 'NEEDS_RESCAN';
  if (statusStr === 'broken') return 'BROKEN';
  if (gameRunning) return 'GAME_RUNNING';
  return 'READY';
}

const TrainerPage: React.FC<TrainerPageProps> = ({ gameId, category }) => {
  const e2eState = (window as any).electronAPI?.e2eTrainerState as TrainerCardState | null;
  const fixtureItem: TrainerItem = {
    id: 'e2e-renderer-card', name: 'Renderer Test Item', description: 'E2E state fixture',
    category: 'PLAYER', source: 'fixture.json', target: 'fixture.json', path: 'player.hp',
    risk: 'Safe', status: e2eState === 'NEEDS_RESCAN' ? 'Needs Rescan' : e2eState === 'BROKEN' ? 'Broken' : 'Ready',
    confidence: 100, currentValue: 100, inputType: 'number', min: 0, max: 999,
  };
  const fixtureTransient = e2eState && ['APPLYING', 'FAILED'].includes(e2eState)
    ? { [fixtureItem.id]: e2eState }
    : {};
  const [items, setItems] = useState<TrainerItem[]>(e2eState ? [fixtureItem] : []);
  const [loading, setLoading] = useState(!e2eState);
  const [gameRunning, setGameRunning] = useState(e2eState === 'GAME_RUNNING');
  const [gameRunningEvidence, setGameRunningEvidence] = useState(
    e2eState === 'GAME_RUNNING' ? 'E2E renderer process evidence' : ''
  );

  const [values, setValues] = useState<Record<string, any>>(e2eState ? { [fixtureItem.id]: 101 } : {});
  const [transientStates, setTransientStates] = useState<Record<string, TrainerCardState>>(fixtureTransient);
  const [backupIds, setBackupIds] = useState<Record<string, string>>({});
  const [lastOpMessages, setLastOpMessages] = useState<Record<string, string>>({});

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [applyPending, setApplyPending] = useState<ApplyPending | null>(null);
  const [applyBusy, setApplyBusy] = useState(false);

  const apiAvailable = typeof window !== 'undefined' && !!(window as any).electronAPI;

  const loadItems = useCallback(async () => {
    if (e2eState) return;
    if (!apiAvailable) { setLoading(false); return; }
    setLoading(true);
    try {
      const result = await (window as any).electronAPI.getRecipes(gameId);
      if (Array.isArray(result)) {
        setItems(result);
        setValues(prev => {
          const init: Record<string, any> = {};
          result.forEach((r: TrainerItem) => {
            if (!(r.id in prev)) init[r.id] = r.currentValue ?? '';
          });
          return { ...init, ...prev };
        });
      }
    } catch (e) {
      console.error('[TrainerPage] loadItems error:', e);
    } finally {
      setLoading(false);
    }
  }, [gameId, apiAvailable, e2eState]);

  const checkGameRunning = useCallback(async () => {
    if (e2eState) return;
    if (!apiAvailable) return;
    try {
      const result = await (window as any).electronAPI.checkGameRunning(gameId);
      setGameRunning(result?.running ?? false);
      setGameRunningEvidence(result?.evidence ?? '');
    } catch {
      setGameRunning(false);
    }
  }, [gameId, apiAvailable, e2eState]);

  useEffect(() => {
    loadItems();
    checkGameRunning();
  }, [loadItems, checkGameRunning]);

  const handleValueChange = (itemId: string, val: any) => {
    setValues(prev => ({ ...prev, [itemId]: val }));
  };

  const handleApplyClick = (item: TrainerItem) => {
    const val = values[item.id];
    if (val === undefined || val === '' || val === null) return;
    setApplyPending({ item, value: val });
  };

  const handleDialogCancel = useCallback(() => {
    if (!applyBusy) {
      setApplyPending(null);
    }
  }, [applyBusy]);

  const handleApplyConfirm = async () => {
    if (!applyPending || !apiAvailable) { setApplyPending(null); return; }
    const { item, value } = applyPending;
    setApplyBusy(true);

    setTransientStates(prev => ({ ...prev, [item.id]: 'APPLYING' }));

    try {
      const proposal = await (window as any).electronAPI.createProposalForEdit(
        gameId,
        item.target ?? item.source ?? '',
        item.path ?? '',
        item.currentValue,
        value,
        item.id
      );

      if (!proposal) {
        setTransientStates(prev => ({ ...prev, [item.id]: 'FAILED' }));
        setLastOpMessages(prev => ({ ...prev, [item.id]: operationFailedBeforeWriteMessage() }));
        return;
      }

      const res = await (window as any).electronAPI.applyProposal(proposal);

      if (res?.success) {
        setTransientStates(prev => ({ ...prev, [item.id]: 'APPLIED' }));
        const backupId = res?.backup?.id ?? res?.backupId;
        if (backupId) {
          setBackupIds(prev => ({ ...prev, [item.id]: backupId }));
        }
        const ts = new Date().toLocaleTimeString();
        setLastOpMessages(prev => ({
          ...prev, [item.id]: `Applied at ${ts} — backup created`
        }));
        await loadItems();
      } else {
        setTransientStates(prev => ({ ...prev, [item.id]: 'FAILED' }));
        setLastOpMessages(prev => ({
          ...prev, [item.id]: operationFailedBeforeWriteMessage()
        }));
      }
    } catch (e) {
      console.error('[TrainerPage] apply error:', userSafeErrorDetail(e));
      setTransientStates(prev => ({ ...prev, [item.id]: 'FAILED' }));
      setLastOpMessages(prev => ({ ...prev, [item.id]: operationFailedBeforeWriteMessage() }));
    } finally {
      setApplyBusy(false);
      setApplyPending(null);
    }
  };

  const handleRestore = async (backupId: string) => {
    if (!apiAvailable || !selectedId) return;
    const sid = selectedId;
    setTransientStates(prev => ({ ...prev, [sid]: 'APPLYING' }));
    try {
      const res = await (window as any).electronAPI.restoreBackup(backupId);
      if (res?.success) {
        setTransientStates(prev => ({ ...prev, [sid]: 'RESTORED' }));
        const ts = new Date().toLocaleTimeString();
        setLastOpMessages(prev => ({ ...prev, [sid]: `Restored at ${ts}` }));
        await loadItems();
      } else {
        setTransientStates(prev => ({ ...prev, [sid]: 'FAILED' }));
        setLastOpMessages(prev => ({
          ...prev, [sid]: operationFailedBeforeWriteMessage()
        }));
      }
    } catch (e) {
      setTransientStates(prev => ({ ...prev, [sid]: 'FAILED' }));
    }
  };

  const selectedItem = items.find(i => i.id === selectedId) ?? null;

  const filteredItems = category === 'all'
    ? items
    : items.filter(i => normalizeCategory(i.category) === normalizeCategory(category));

  if (!apiAvailable) {
    return (
      <div className="trainer-no-api">
        <div className="no-api-box glass">
          <h3>Read-Only Preview</h3>
          <p>
            {localTrainerServiceFailureMessage()} Solith must run inside Electron to apply trainer changes.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="trainer-loading">
        <div className="loading-spinner" aria-hidden="true" />
        <span>Loading trainer items…</span>
      </div>
    );
  }

  return (
    <div className="trainer-page-v2">
      {gameRunning && (
        <div className="game-running-banner" role="alert">
          <span className="banner-icon" aria-hidden="true">⚠</span>
          <strong>Game is running</strong>
          <span>{gameRunningEvidence}</span>
          <span className="banner-note">Close the game before applying changes to avoid data loss.</span>
        </div>
      )}

      <div className="trainer-main-area">
        <div className="trainer-cards-region" aria-label="Trainer items">
          {filteredItems.length === 0 ? (
            <div className="empty-state glass">
              <h3>No trainer items</h3>
              <p>
                Open <strong>Workshop Mode</strong> → <strong>Discovery Lab</strong> or{' '}
                <strong>Save Editor</strong> to scan and build trainer recipes.
              </p>
            </div>
          ) : (
            filteredItems.map(item => {
              const cardState = deriveCardState(
                item, transientStates[item.id] ?? null, gameRunning
              );
              return (
                <TrainerCard
                  key={item.id}
                  item={item}
                  state={cardState}
                  value={values[item.id]}
                  selected={selectedId === item.id}
                  onSelect={() => setSelectedId(item.id === selectedId ? null : item.id)}
                  onValueChange={val => handleValueChange(item.id, val)}
                  onApply={() => handleApplyClick(item)}
                />
              );
            })
          )}
        </div>

        <ContextPanel
          item={selectedItem}
          value={selectedItem ? values[selectedItem.id] : undefined}
          cardState={selectedItem
            ? deriveCardState(selectedItem, transientStates[selectedItem.id] ?? null, gameRunning)
            : null}
          lastBackupId={selectedItem ? (backupIds[selectedItem.id] ?? null) : null}
          lastOpMessage={selectedItem ? (lastOpMessages[selectedItem.id] ?? null) : null}
          onRestore={handleRestore}
        />
      </div>

      {applyPending && (
        <ApplyDialog
          item={applyPending.item}
          value={applyPending.value}
          onConfirm={handleApplyConfirm}
          onCancel={handleDialogCancel}
          isBusy={applyBusy}
        />
      )}
    </div>
  );
};

export default TrainerPage;
