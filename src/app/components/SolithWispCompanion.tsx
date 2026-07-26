import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  createWispMessage,
  DEFAULT_WISP_STATE,
  isWispActionAllowed,
  type WispAction,
  type WispActionKind,
  type WispMessage,
  wispReducer,
} from '../../core/companion/wisp.js';
import { WISP_FORM_ARTWORK } from '../assets/wisp/index.js';

const POSITION_KEY = 'solith:wisp-position:v1';
const QUIET_KEY = 'solith:wisp-quiet:v1';
const DRAG_THRESHOLD_PX = 4;

type WispPosition = {
  corner: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
};

type DragState = {
  pointerId: number;
  lastX: number;
  lastY: number;
  totalX: number;
  totalY: number;
};

const DEFAULT_POSITION: WispPosition = { corner: 'bottom-right' };

const QUICK_ACTIONS: WispAction[] = [
  { kind: 'scan_now', label: 'Scan now', description: 'Start an approved read-only scan.' },
  { kind: 'event_took_damage', label: 'Took damage' },
  { kind: 'event_used_stamina', label: 'Used stamina' },
  { kind: 'event_gained_xp', label: 'Gained XP' },
  { kind: 'event_spent_gold', label: 'Spent gold' },
  { kind: 'event_picked_up_loot', label: 'Picked up loot' },
  { kind: 'open_ocr_capture', label: 'Open OCR' },
  { kind: 'pause_watcher', label: 'Pause watcher' },
];

function loadPosition(): WispPosition {
  try {
    const raw = localStorage.getItem(POSITION_KEY);
    if (!raw) return DEFAULT_POSITION;
    const parsed = JSON.parse(raw) as Partial<WispPosition>;
    if (
      parsed.corner === 'bottom-right' ||
      parsed.corner === 'bottom-left' ||
      parsed.corner === 'top-right' ||
      parsed.corner === 'top-left'
    ) {
      return { corner: parsed.corner };
    }
  } catch {
    // fall through to safe default
  }
  return DEFAULT_POSITION;
}

function savePosition(position: WispPosition): void {
  try {
    localStorage.setItem(POSITION_KEY, JSON.stringify(position));
  } catch {
    // local-only preference best effort
  }
}

function loadQuietMode(): boolean {
  try {
    return localStorage.getItem(QUIET_KEY) === '1';
  } catch {
    return false;
  }
}

function saveQuietMode(quietMode: boolean): void {
  try {
    localStorage.setItem(QUIET_KEY, quietMode ? '1' : '0');
  } catch {
    // local-only preference best effort
  }
}

function nextCorner(corner: WispPosition['corner']): WispPosition['corner'] {
  switch (corner) {
    case 'bottom-right':
      return 'bottom-left';
    case 'bottom-left':
      return 'top-left';
    case 'top-left':
      return 'top-right';
    case 'top-right':
      return 'bottom-right';
  }
}

function actionMessage(kind: WispActionKind): WispMessage {
  const common = {
    source: 'companion-action',
    severity: 'info' as const,
  };
  switch (kind) {
    case 'scan_now':
    case 'begin_scan':
      return createWispMessage({
        ...common,
        source: 'analysis-runtime',
        title: 'Read-only scan requested',
        body: 'I will route this through Solith’s approved read-only workflow. No writes or CT scripts are available from the Wisp.',
        progress: 12,
        actions: [{ kind: 'open_details', label: 'Open details' }, { kind: 'dismiss', label: 'Dismiss' }],
      });
    case 'event_took_damage':
      return createWispMessage({
        ...common,
        title: 'Damage event marked',
        body: 'I marked a decrease event for the correlation watcher to compare against recent candidate deltas.',
      });
    case 'event_used_stamina':
      return createWispMessage({
        ...common,
        title: 'Stamina use marked',
        body: 'I marked a stamina-spend event. Regen drift should be handled by the recent-delta lookback.',
      });
    case 'event_gained_xp':
      return createWispMessage({
        ...common,
        title: 'XP gain marked',
        body: 'I marked an increase event for XP candidates.',
      });
    case 'event_spent_gold':
      return createWispMessage({
        ...common,
        title: 'Gold spend marked',
        body: 'I marked a resource decrease event for gold/currency candidates.',
      });
    case 'event_picked_up_loot':
      return createWispMessage({
        ...common,
        title: 'Loot pickup marked',
        body: 'I marked an inventory/material increase event.',
      });
    case 'open_ocr_capture':
      return createWispMessage({
        ...common,
        source: 'ocr-fallback',
        title: 'OCR assist requested',
        body: 'Open the relevant menu and select a small region. OCR is local-only and used as read-only tie-break evidence.',
      });
    case 'pause_watcher':
      return createWispMessage({
        ...common,
        title: 'Watcher pause requested',
        body: 'The companion can pause read-only telemetry; it cannot disable safety gates or approve writes.',
      });
    case 'resume_watcher':
      return createWispMessage({
        ...common,
        title: 'Watcher resume requested',
        body: 'Read-only telemetry can resume through the approved watcher path.',
      });
    case 'open_details':
      return createWispMessage({
        ...common,
        title: 'Details stay in Solith',
        body: 'Open-details routing will use an approved app panel, not an arbitrary shell command.',
      });
    case 'dismiss':
    case 'hide':
      return createWispMessage({
        title: 'Solith Wisp is here',
        body: 'Tap the Wisp when you need scan help, OCR, or a read-only event marker.',
        source: 'companion',
        severity: 'info',
      });
  }
}

export function SolithWispCompanion({ overlayMode = false }: { overlayMode?: boolean }) {
  const [state, dispatch] = useReducer(wispReducer, {
    ...DEFAULT_WISP_STATE,
    quietMode: loadQuietMode(),
  });
  const [position, setPosition] = useState(loadPosition);
  const [quickInput, setQuickInput] = useState('');
  const [reaction, setReaction] = useState<'idle' | 'ack' | 'thinking' | 'dismissed'>('idle');
  const dragRef = useRef<DragState | null>(null);

  const artwork = WISP_FORM_ARTWORK[state.form];
  const positionClass = overlayMode ? 'solith-wisp--overlay' : `solith-wisp--${position.corner}`;
  const overlayExpanded = overlayMode && state.visible && (state.interactionOpen || state.bubbles.length > 0);

  const visibleActions = useMemo(() => {
    if (state.message?.actions.length) return state.message.actions;
    return QUICK_ACTIONS.slice(0, 6);
  }, [state.message]);

  useEffect(() => {
    if (!overlayMode) return;
    void window.electronAPI?.wispOverlaySetExpanded?.({ expanded: overlayExpanded });
  }, [overlayExpanded, overlayMode]);

  if (!state.visible) {
    return (
      <button
        type="button"
        className={`solith-wisp-restore ${overlayMode ? 'solith-wisp-restore--overlay' : `solith-wisp-restore--${position.corner}`}`}
        onClick={() => dispatch({ type: 'show' })}
        title="Wake Solith Wisp"
        aria-label="Wake Solith Wisp"
      >
        ✦
      </button>
    );
  }

  const pulse = (next: typeof reaction) => {
    setReaction(next);
    window.setTimeout(() => setReaction('idle'), 900);
  };

  const executeAction = (kind: WispActionKind) => {
    if (!isWispActionAllowed(kind)) return;
    if (kind === 'dismiss') {
      dispatch({ type: 'dismiss' });
      pulse('dismissed');
      return;
    }
    if (kind === 'hide') {
      dispatch({ type: 'hide' });
      return;
    }
    dispatch({ type: 'message', message: actionMessage(kind) });
    dispatch({ type: 'closeInteraction' });
    pulse(kind === 'scan_now' || kind === 'open_ocr_capture' ? 'thinking' : 'ack');
  };

  const closeBubble = (messageId: string) => {
    dispatch({ type: 'closeBubble', id: messageId });
    pulse('dismissed');
  };

  const openInteraction = () => {
    dispatch({ type: 'toggleInteraction' });
    pulse('ack');
  };

  const cyclePosition = () => {
    if (overlayMode) return;
    const next = { corner: nextCorner(position.corner) };
    setPosition(next);
    savePosition(next);
    pulse('ack');
  };

  const toggleQuietMode = () => {
    const next = !state.quietMode;
    saveQuietMode(next);
    dispatch({ type: 'setQuietMode', quietMode: next });
  };

  const toggleOverlayWindow = async () => {
    if (overlayMode) {
      await window.electronAPI?.wispOverlayHide?.();
      return;
    }
    const result = await window.electronAPI?.wispOverlayToggle?.();
    dispatch({
      type: 'message',
      message: createWispMessage({
        title: result?.success ? 'Wisp overlay toggled' : 'Overlay unavailable',
        body: result?.success
          ? 'I opened the separate Wisp window so you can keep the companion visible while playing.'
          : 'The overlay bridge is only available inside the Electron shell.',
        source: 'companion-overlay',
        severity: result?.success ? 'success' : 'warning',
        actions: [{ kind: 'dismiss', label: 'Dismiss' }],
      }),
    });
    dispatch({ type: 'closeInteraction' });
    pulse(result?.success ? 'ack' : 'dismissed');
  };

  const submitQuickInput = () => {
    const normalized = quickInput.trim().toLowerCase();
    if (!normalized) return;
    const command =
      normalized.includes('damage') ? 'event_took_damage'
      : normalized.includes('stamina') ? 'event_used_stamina'
      : normalized.includes('xp') ? 'event_gained_xp'
      : normalized.includes('gold') || normalized.includes('spent') ? 'event_spent_gold'
      : normalized.includes('loot') || normalized.includes('item') ? 'event_picked_up_loot'
      : normalized.includes('ocr') ? 'open_ocr_capture'
      : normalized.includes('scan') ? 'scan_now'
      : null;

    if (command) {
      executeAction(command);
      setQuickInput('');
      return;
    }

    dispatch({
      type: 'message',
      message: createWispMessage({
        title: 'I need a safer command',
        body: 'Try: scan, took damage, used stamina, gained XP, spent gold, picked up loot, or OCR.',
        source: 'companion-command',
        severity: 'guard',
        actions: [{ kind: 'dismiss', label: 'Dismiss' }],
      }),
    });
    pulse('dismissed');
  };

  const handleCreaturePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!overlayMode || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      lastX: event.screenX,
      lastY: event.screenY,
      totalX: 0,
      totalY: 0,
    };
  };

  const handleCreaturePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!overlayMode || !drag || drag.pointerId !== event.pointerId) return;

    const deltaX = Math.round(event.screenX - drag.lastX);
    const deltaY = Math.round(event.screenY - drag.lastY);
    if (deltaX === 0 && deltaY === 0) return;

    drag.lastX = event.screenX;
    drag.lastY = event.screenY;
    drag.totalX += Math.abs(deltaX);
    drag.totalY += Math.abs(deltaY);

    void window.electronAPI?.wispOverlayMoveBy?.({ deltaX, deltaY });
  };

  const handleCreaturePointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (!overlayMode) return;
    const movedEnough = drag ? drag.totalX + drag.totalY >= DRAG_THRESHOLD_PX : false;
    if (!movedEnough) openInteraction();
  };

  const handleCreaturePointerCancel = (event: React.PointerEvent<HTMLButtonElement>) => {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleCreatureClick = () => {
    if (!overlayMode) openInteraction();
  };

  return (
    <aside
      className={`solith-wisp ${positionClass} solith-wisp--${state.mood} solith-wisp--reaction-${reaction}${state.interactionOpen ? ' solith-wisp--interacting' : ''}${state.message ? ' solith-wisp--has-bubble' : ''}`}
      aria-label="Solith Wisp companion"
    >
      <button
        type="button"
        className="solith-wisp__creature"
        onClick={handleCreatureClick}
        onDoubleClick={cyclePosition}
        onPointerDown={handleCreaturePointerDown}
        onPointerMove={handleCreaturePointerMove}
        onPointerUp={handleCreaturePointerUp}
        onPointerCancel={handleCreaturePointerCancel}
        title={overlayMode ? 'Drag me, or click to talk to Solith Wisp.' : 'Click to talk to Solith Wisp. Double-click to move corners.'}
      >
        <span className="solith-wisp__aura" aria-hidden="true" />
        <img src={artwork} alt="" decoding="async" draggable={false} />
        <span className="solith-wisp__eyes" aria-hidden="true" />
        <span className="solith-wisp__shadow" aria-hidden="true" />
      </button>

      <div className="solith-wisp__bubble-stack" aria-live="polite">
        {state.bubbles.map((bubble) => (
          <section key={bubble.id} className={`solith-wisp__bubble solith-wisp__bubble--${bubble.severity}`}>
            <header className="solith-wisp__header">
              <div>
                <span className={`solith-wisp__severity solith-wisp__severity--${bubble.severity}`} />
                <strong>{bubble.title}</strong>
                <small>{bubble.source}</small>
              </div>
              <button type="button" onClick={() => closeBubble(bubble.id)} aria-label={`Close ${bubble.title}`}>
                ×
              </button>
            </header>

            <p>{bubble.body}</p>

            {typeof bubble.progress === 'number' && (
              <div className="solith-wisp__progress" aria-label={`Progress ${bubble.progress}%`}>
                <span style={{ width: `${bubble.progress}%` }} />
              </div>
            )}

            {bubble.actions.length > 0 && (
              <div className="solith-wisp__message-actions" aria-label="Solith Wisp message actions">
                {bubble.actions.map((action) => (
                  <button
                    key={action.kind}
                    type="button"
                    onClick={() => executeAction(action.kind)}
                    title={action.description}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>

      {state.interactionOpen && (
        <div className="solith-wisp__response-orbit" aria-label="Solith Wisp safe quick actions">
          <button
            type="button"
            className="solith-wisp__response-chip solith-wisp__response-chip--primary"
            onClick={toggleOverlayWindow}
          >
            {overlayMode ? 'Close overlay' : 'Open overlay'}
          </button>
          <button
            type="button"
            className="solith-wisp__response-chip"
            onClick={toggleQuietMode}
            aria-pressed={state.quietMode}
          >
            {state.quietMode ? 'Quiet mode on' : 'Quiet mode off'}
          </button>
          <button
            type="button"
            className="solith-wisp__response-chip"
            onClick={() => executeAction('hide')}
          >
            Hide Wisp
          </button>
          {visibleActions.slice(0, 6).map((action) => (
            <button
              key={action.kind}
              type="button"
              className="solith-wisp__response-chip"
              onClick={() => executeAction(action.kind)}
              title={action.description}
            >
              {action.label}
            </button>
          ))}
          <form
            className="solith-wisp__response-input-chip"
            onSubmit={(event) => {
              event.preventDefault();
              submitQuickInput();
            }}
          >
            <input
              value={quickInput}
              onChange={(event) => setQuickInput(event.target.value)}
              placeholder="try: spent gold"
              aria-label="Send a safe Solith Wisp command"
            />
            <button type="submit">Send</button>
          </form>
          <button
            type="button"
            className="solith-wisp__response-chip solith-wisp__response-chip--ghost"
            onClick={() => dispatch({ type: 'closeInteraction' })}
          >
            Close
          </button>
        </div>
      )}
    </aside>
  );
}
