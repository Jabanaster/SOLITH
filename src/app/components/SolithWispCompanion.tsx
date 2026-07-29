import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  createWispMessage,
  DEFAULT_WISP_STATE,
  isWispActionAllowed,
  type WispAction,
  type WispActionKind,
  type WispForm,
  type WispMessage,
  wispReducer,
} from '../../core/companion/wisp.js';
import { WISP_FORM_ARTWORK } from '../assets/wisp/index.js';
import {
  DEFAULT_WISP_PREFERENCES,
  WISP_FORMS,
  clampWispPosition,
  parseWispPreferences,
  positionForPreset,
  type WispPosition,
  type WispPositionPreset,
  type WispPreferences,
} from '../wisp/preferences.js';

const POSITION_KEY = 'solith:wisp-position:v2';
const LEGACY_POSITION_KEY = 'solith:wisp-position:v1';
const QUIET_KEY = 'solith:wisp-quiet:v1';
const PREFERENCES_KEY = 'solith:wisp-preferences:v1';
const DRAG_THRESHOLD_PX = 4;
const WISP_SPRITE_BOUNDS = { width: 150, height: 150 };
const WISP_SAFE_PADDING = 12;
const WISP_CONTROLS_BOTTOM_SPACE = 360;

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
};

function defaultPosition(): WispPosition {
  if (typeof window === 'undefined') return { x: 0, y: 0 };
  return clampPosition({
    x: window.innerWidth - WISP_SPRITE_BOUNDS.width - 28,
    y: window.innerHeight - WISP_SPRITE_BOUNDS.height - 28,
  });
}

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
    if (!raw) {
      const legacyRaw = localStorage.getItem(LEGACY_POSITION_KEY);
      if (legacyRaw) {
        const legacy = JSON.parse(legacyRaw) as { corner?: string };
        return legacyPositionToCoordinates(legacy.corner);
      }
      return defaultPosition();
    }
    const parsed = JSON.parse(raw) as Partial<WispPosition>;
    if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
      return clampPosition({ x: Number(parsed.x), y: Number(parsed.y) });
    }
  } catch {
    // fall through to safe default
  }
  return defaultPosition();
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

function legacyPositionToCoordinates(corner: string | undefined): WispPosition {
  if (typeof window === 'undefined') return { x: 0, y: 0 };
  const maxX = window.innerWidth - WISP_SPRITE_BOUNDS.width - 28;
  const maxY = window.innerHeight - WISP_SPRITE_BOUNDS.height - 28;
  switch (corner) {
    case 'bottom-right':
      return clampPosition({ x: maxX, y: maxY });
    case 'top-left':
      return clampPosition({ x: 28, y: 28 });
    case 'top-right':
      return clampPosition({ x: maxX, y: 28 });
    case 'bottom-left':
    default:
      return clampPosition({ x: 28, y: maxY });
  }
}

function loadPreferences(): WispPreferences {
  try {
    return parseWispPreferences(localStorage.getItem(PREFERENCES_KEY));
  } catch {
    return { ...DEFAULT_WISP_PREFERENCES };
  }
}

function savePreferences(preferences: WispPreferences): void {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Persistence is best-effort in restricted renderer contexts.
  }
}

function clampPosition(position: WispPosition): WispPosition {
  if (typeof window === 'undefined') return position;
  return clampWispPosition(
    position,
    { width: window.innerWidth, height: window.innerHeight },
    WISP_SPRITE_BOUNDS,
    WISP_SAFE_PADDING,
  );
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

type WispNavigationTarget = 'library' | 'trainer-library' | 'ct-library';

type SolithWispCompanionProps = {
  overlayMode?: boolean;
  currentPage?: string;
  onNavigate?: (target: WispNavigationTarget) => void;
};

export function SolithWispCompanion({
  overlayMode = false,
  currentPage = 'Solith',
  onNavigate,
}: SolithWispCompanionProps) {
  const [preferences, setPreferences] = useState(loadPreferences);
  const [state, dispatch] = useReducer(wispReducer, {
    ...DEFAULT_WISP_STATE,
    quietMode: loadQuietMode(),
    form: preferences.form,
    preferredForm: preferences.form,
  });
  const [position, setPosition] = useState(loadPosition);
  const [quickInput, setQuickInput] = useState('');
  const [reaction, setReaction] = useState<'idle' | 'ack' | 'thinking' | 'dismissed'>('idle');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('Wisp ready in offline companion mode');
  const dragRef = useRef<DragState | null>(null);
  const creatureRef = useRef<HTMLButtonElement>(null);

  const artwork = WISP_FORM_ARTWORK[state.form];
  const overlayExpanded = overlayMode && state.visible && (state.interactionOpen || state.bubbles.length > 0);
  const interactionPlacement =
    !overlayMode && typeof window !== 'undefined'
      ? [
          position.x > window.innerWidth - 520 ? 'solith-wisp--controls-left' : 'solith-wisp--controls-right',
          position.y > window.innerHeight - WISP_CONTROLS_BOTTOM_SPACE ? 'solith-wisp--controls-above' : 'solith-wisp--controls-below',
        ].join(' ')
      : '';
  const positionClass = overlayMode ? 'solith-wisp--overlay' : `solith-wisp--app ${interactionPlacement}`;
  const appPositionStyle = overlayMode
    ? undefined
    : ({
        '--wisp-x': `${position.x}px`,
        '--wisp-y': `${position.y}px`,
        '--wisp-scale': preferences.scale,
        '--wisp-opacity': preferences.opacity,
      } as React.CSSProperties);

  const visibleActions = useMemo(() => {
    if (state.message?.actions.length) return state.message.actions;
    return QUICK_ACTIONS.slice(0, 6);
  }, [state.message]);

  useEffect(() => {
    if (!overlayMode) return;
    void window.electronAPI?.wispOverlaySetExpanded?.({ expanded: overlayExpanded });
  }, [overlayExpanded, overlayMode]);

  useEffect(() => {
    if (!overlayMode) return;
    const setInteractive = (event: PointerEvent | FocusEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const interactive = Boolean(target?.closest('[data-wisp-interactive="true"]'));
      void window.electronAPI?.wispOverlaySetInteractive?.({ interactive });
    };
    const clearInteractive = () => {
      void window.electronAPI?.wispOverlaySetInteractive?.({ interactive: false });
    };
    window.addEventListener('pointermove', setInteractive, { passive: true });
    window.addEventListener('pointerdown', setInteractive, { passive: true });
    window.addEventListener('focusin', setInteractive);
    window.addEventListener('pointerleave', clearInteractive);
    window.addEventListener('blur', clearInteractive);
    clearInteractive();
    return () => {
      window.removeEventListener('pointermove', setInteractive);
      window.removeEventListener('pointerdown', setInteractive);
      window.removeEventListener('focusin', setInteractive);
      window.removeEventListener('pointerleave', clearInteractive);
      window.removeEventListener('blur', clearInteractive);
      clearInteractive();
    };
  }, [overlayMode]);

  useEffect(() => {
    if (overlayMode) return;
    const handleResize = () => {
      setPosition((current) => {
        const next = clampPosition(current);
        if (next.x === current.x && next.y === current.y) return current;
        savePosition(next);
        return next;
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [overlayMode]);

  useEffect(() => {
    savePreferences(preferences);
  }, [preferences]);

  useEffect(() => {
    if (!state.interactionOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      dispatch({ type: 'closeInteraction' });
      setSettingsOpen(false);
      setHelpOpen(false);
      setAnnouncement('Wisp controls closed');
      window.setTimeout(() => creatureRef.current?.focus(), 0);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [state.interactionOpen]);

  if (!state.visible) {
    return (
      <button
        type="button"
        className={`solith-wisp-restore ${overlayMode ? 'solith-wisp-restore--overlay' : 'solith-wisp-restore--app'}`}
        data-wisp-interactive="true"
        style={appPositionStyle}
        onClick={() => {
          dispatch({ type: 'show' });
          setAnnouncement('Wisp restored');
        }}
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
      setAnnouncement('Wisp hidden');
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
    setSettingsOpen(false);
    setHelpOpen(false);
    setAnnouncement(state.interactionOpen ? 'Wisp controls closed' : 'Wisp opened in offline companion mode');
    pulse('ack');
  };

  const resetPosition = () => {
    if (overlayMode) return;
    const next = defaultPosition();
    setPosition(next);
    savePosition(next);
    pulse('ack');
    setAnnouncement('Wisp position reset');
  };

  const applyPositionPreset = (preset: WispPositionPreset) => {
    if (overlayMode || typeof window === 'undefined') return;
    const next = positionForPreset(
      preset,
      { width: window.innerWidth, height: window.innerHeight },
      WISP_SPRITE_BOUNDS,
      WISP_SAFE_PADDING,
    );
    setPosition(next);
    if (preferences.rememberPosition) savePosition(next);
    setAnnouncement(`Wisp moved to ${preset.replace('-', ' ')}`);
  };

  const updatePreferences = (next: Partial<WispPreferences>) => {
    setPreferences((current) => ({ ...current, ...next }));
  };

  const selectForm = (form: WispForm) => {
    dispatch({ type: 'selectForm', form });
    updatePreferences({ form });
    setAnnouncement(`Wisp form changed to ${form}`);
  };

  const restoreDefaults = () => {
    const next = { ...DEFAULT_WISP_PREFERENCES };
    setPreferences(next);
    dispatch({ type: 'selectForm', form: next.form });
    resetPosition();
    setAnnouncement('Wisp preferences restored to defaults');
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

  const startDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.screenX,
      startY: event.screenY,
      lastX: event.screenX,
      lastY: event.screenY,
      moved: false,
    };
  };

  const moveDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.screenX - drag.lastX;
    const deltaY = event.screenY - drag.lastY;
    const totalDistance = Math.hypot(event.screenX - drag.startX, event.screenY - drag.startY);
    if (totalDistance >= DRAG_THRESHOLD_PX) {
      drag.moved = true;
    }
    drag.lastX = event.screenX;
    drag.lastY = event.screenY;
    if (deltaX !== 0 || deltaY !== 0) {
      if (overlayMode) {
        void window.electronAPI?.wispOverlayMoveBy?.({ deltaX, deltaY });
      } else {
        setPosition((current) => {
          const next = clampPosition({ x: current.x + deltaX, y: current.y + deltaY });
          savePosition(next);
          return next;
        });
      }
    }
  };

  const endDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    if (!drag.moved) {
      openInteraction();
    }
  };

  return (
    <aside
      className={`solith-wisp ${positionClass} solith-wisp--${state.mood} solith-wisp--reaction-${reaction}${state.interactionOpen ? ' solith-wisp--interacting' : ''}${state.message ? ' solith-wisp--has-bubble' : ''}${preferences.reducedMotion || preferences.animationIntensity === 'off' ? ' solith-wisp--reduced-motion' : ''}${preferences.animationIntensity === 'reduced' ? ' solith-wisp--reduced-animation' : ''}`}
      style={appPositionStyle}
      aria-label="Solith Wisp companion"
    >
      <span className="sr-only" aria-live="polite">{announcement}</span>
      <button
        ref={creatureRef}
        type="button"
        className="solith-wisp__creature"
        data-wisp-interactive="true"
        onClick={undefined}
        onDoubleClick={resetPosition}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          openInteraction();
        }}
        aria-expanded={state.interactionOpen}
        aria-controls="solith-wisp-controls"
        aria-label="Solith Wisp. Press Enter or Space to open controls. Drag to move."
        title="Drag Wisp to move it. Click to talk. Double-click to reset position."
      >
        <span className="solith-wisp__aura" aria-hidden="true" />
        <img
          src={artwork}
          alt=""
          decoding="async"
          draggable={false}
          onError={() => {
            if (state.form !== 'base') {
              dispatch({ type: 'setForm', form: 'base' });
              setAnnouncement('Wisp image unavailable. Base form restored.');
            }
          }}
        />
        <span className="solith-wisp__eyes" aria-hidden="true" />
        <span className="solith-wisp__shadow" aria-hidden="true" />
      </button>

      <div className="solith-wisp__bubble-stack" aria-live="polite">
        {state.bubbles.map((bubble) => (
          <section
            key={bubble.id}
            className={`solith-wisp__bubble solith-wisp__bubble--${bubble.severity}`}
            data-wisp-interactive="true"
          >
            <header className="solith-wisp__header">
              <div>
                <span className={`solith-wisp__severity solith-wisp__severity--${bubble.severity}`} />
                <strong>{bubble.title}</strong>
                <small>{bubble.source}</small>
              </div>
              <button type="button" data-wisp-interactive="true" onClick={() => closeBubble(bubble.id)} aria-label={`Close ${bubble.title}`}>
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
                    data-wisp-interactive="true"
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
        <div id="solith-wisp-controls" className="solith-wisp__response-orbit" aria-label="Solith Wisp quick controls">
          <button type="button" className="solith-wisp__response-chip" data-wisp-interactive="true" onClick={toggleOverlayWindow}>
            {overlayMode ? 'Close overlay' : 'Open overlay'}
          </button>
          <button
            type="button"
            className="solith-wisp__response-chip"
            data-wisp-interactive="true"
            onClick={toggleQuietMode}
            aria-pressed={state.quietMode}
          >
            {state.quietMode ? 'Quiet mode on' : 'Quiet mode off'}
          </button>
          <button type="button" className="solith-wisp__response-chip" data-wisp-interactive="true" onClick={() => executeAction('hide')}>
            Hide Wisp
          </button>
          <button
            type="button"
            className="solith-wisp__response-chip"
            data-wisp-interactive="true"
            aria-expanded={settingsOpen}
            aria-controls="solith-wisp-settings"
            onClick={() => setSettingsOpen((open) => !open)}
          >
            Settings
          </button>
          <button
            type="button"
            className="solith-wisp__response-chip"
            data-wisp-interactive="true"
            aria-expanded={helpOpen}
            aria-controls="solith-wisp-help"
            onClick={() => setHelpOpen((open) => !open)}
          >
            Help
          </button>
          <div className="solith-wisp__offline-status" role="status" data-wisp-interactive="true">
            <strong>Offline companion mode</strong>
            <span>No active trainer session · Current page: {currentPage}</span>
          </div>
          {!overlayMode && onNavigate && (
            <div className="solith-wisp__response-group" aria-label="Offline navigation">
              <button type="button" className="solith-wisp__response-chip" data-wisp-interactive="true" onClick={() => onNavigate('library')}>Game Library</button>
              <button type="button" className="solith-wisp__response-chip" data-wisp-interactive="true" onClick={() => onNavigate('trainer-library')}>Trainer Library</button>
              <button type="button" className="solith-wisp__response-chip" data-wisp-interactive="true" onClick={() => onNavigate('ct-library')}>CT Library</button>
            </div>
          )}

          {helpOpen && (
            <section id="solith-wisp-help" className="solith-wisp__settings" data-wisp-interactive="true" aria-label="How to use Wisp">
              <strong>How to use Wisp</strong>
              <p>Click Wisp to open controls. Drag the character to move it. Use Settings for keyboard position presets, forms, scale, opacity, and motion.</p>
              <p>Hide removes the character but leaves a reachable restore button. Escape closes controls and returns focus to Wisp.</p>
              <p>Offline mode offers navigation only. Trainer controls appear only after a supported, certified session is connected.</p>
              <p>The desktop overlay is a fallback. Xbox Game Bar remains a separate prototype and certification phase.</p>
            </section>
          )}

          {settingsOpen && (
            <section id="solith-wisp-settings" className="solith-wisp__settings" data-wisp-interactive="true" aria-label="Wisp settings">
              <label>
                Form
                <select value={preferences.form} onChange={(event) => selectForm(event.target.value as WispForm)}>
                  {WISP_FORMS.map((form) => <option key={form} value={form}>{form}</option>)}
                </select>
              </label>
              <label>
                Scale {Math.round(preferences.scale * 100)}%
                <input type="range" min="0.75" max="1.5" step="0.05" value={preferences.scale} onChange={(event) => updatePreferences({ scale: Number(event.target.value) })} />
              </label>
              <label>
                Opacity {Math.round(preferences.opacity * 100)}%
                <input type="range" min="0.5" max="1" step="0.05" value={preferences.opacity} onChange={(event) => updatePreferences({ opacity: Number(event.target.value) })} />
              </label>
              <label>
                Animation
                <select value={preferences.animationIntensity} onChange={(event) => updatePreferences({ animationIntensity: event.target.value as WispPreferences['animationIntensity'] })}>
                  <option value="off">Off</option>
                  <option value="reduced">Reduced</option>
                  <option value="normal">Normal</option>
                </select>
              </label>
              <label className="solith-wisp__setting-check">
                <input type="checkbox" checked={preferences.reducedMotion} onChange={(event) => updatePreferences({ reducedMotion: event.target.checked })} />
                Reduced motion
              </label>
              <div className="solith-wisp__position-presets" aria-label="Keyboard position presets">
                {(['top-left', 'top-right', 'center', 'bottom-left', 'bottom-right'] as const).map((preset) => (
                  <button key={preset} type="button" onClick={() => applyPositionPreset(preset)}>{preset.replace('-', ' ')}</button>
                ))}
              </div>
              <button type="button" onClick={restoreDefaults}>Restore defaults</button>
            </section>
          )}

          <div className="solith-wisp__response-group">
            {visibleActions.map((action) => (
              <button
                key={action.kind}
                type="button"
                className="solith-wisp__response-chip"
                data-wisp-interactive="true"
                onClick={() => executeAction(action.kind)}
                title={action.description}
              >
                {action.label}
              </button>
            ))}
          </div>

          <div className="solith-wisp__response-input-chip" data-wisp-interactive="true">
            <input
              data-wisp-interactive="true"
              value={quickInput}
              onChange={(event) => setQuickInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitQuickInput();
              }}
              placeholder="try: spent gold"
              aria-label="Send a safe Solith Wisp command"
            />
            <button type="button" data-wisp-interactive="true" onClick={submitQuickInput}>Send</button>
          </div>

          <button
            type="button"
            className="solith-wisp__response-chip solith-wisp__response-chip--ghost"
            data-wisp-interactive="true"
            onClick={() => dispatch({ type: 'closeInteraction' })}
          >
            Close
          </button>
        </div>
      )}
    </aside>
  );
}
