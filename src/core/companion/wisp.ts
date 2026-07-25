export type WispSeverity = 'info' | 'success' | 'warning' | 'error' | 'guard';

export type WispMood =
  | 'neutral'
  | 'curious'
  | 'focused'
  | 'excited'
  | 'proud'
  | 'sleepy'
  | 'concerned'
  | 'protective'
  | 'confused';

export type WispForm =
  | 'base'
  | 'crystal'
  | 'shield'
  | 'controller'
  | 'phoenix'
  | 'dragon'
  | 'scan'
  | 'success'
  | 'warning'
  | 'error';

export type WispActionKind =
  | 'begin_scan'
  | 'scan_now'
  | 'event_took_damage'
  | 'event_used_stamina'
  | 'event_gained_xp'
  | 'event_spent_gold'
  | 'event_picked_up_loot'
  | 'open_ocr_capture'
  | 'pause_watcher'
  | 'resume_watcher'
  | 'open_details'
  | 'dismiss'
  | 'hide';

export type WispBlockedActionKind =
  | 'execute_ct_script'
  | 'write_memory'
  | 'promote_l4'
  | 'attach_unspecified_process'
  | 'bypass_guard'
  | 'run_shell_command';

export type WispAction = {
  kind: WispActionKind;
  label: string;
  description?: string;
};

export type WispMessage = {
  id: string;
  title: string;
  body: string;
  source: string;
  severity: WispSeverity;
  timestamp: number;
  progress?: number;
  actions: WispAction[];
};

export type WispState = {
  visible: boolean;
  interactionOpen: boolean;
  form: WispForm;
  mood: WispMood;
  quietMode: boolean;
  message: WispMessage | null;
  bubbles: WispMessage[];
  messageHistory: WispMessage[];
};

export type WispEvent =
  | { type: 'message'; message: WispMessage }
  | { type: 'closeBubble'; id: string }
  | { type: 'clearBubbles' }
  | { type: 'dismiss' }
  | { type: 'hide' }
  | { type: 'show' }
  | { type: 'openInteraction' }
  | { type: 'closeInteraction' }
  | { type: 'toggleInteraction' }
  | { type: 'setQuietMode'; quietMode: boolean }
  | { type: 'setMood'; mood: WispMood }
  | { type: 'setForm'; form: WispForm };

export const SAFE_WISP_ACTIONS: ReadonlySet<WispActionKind> = new Set<WispActionKind>([
  'begin_scan',
  'scan_now',
  'event_took_damage',
  'event_used_stamina',
  'event_gained_xp',
  'event_spent_gold',
  'event_picked_up_loot',
  'open_ocr_capture',
  'pause_watcher',
  'resume_watcher',
  'open_details',
  'dismiss',
  'hide',
]);

export const BLOCKED_WISP_ACTIONS: ReadonlySet<WispBlockedActionKind> = new Set<WispBlockedActionKind>([
  'execute_ct_script',
  'write_memory',
  'promote_l4',
  'attach_unspecified_process',
  'bypass_guard',
  'run_shell_command',
]);

export const DEFAULT_WISP_STATE: WispState = {
  visible: true,
  interactionOpen: false,
  form: 'base',
  mood: 'curious',
  quietMode: false,
  message: null,
  bubbles: [],
  messageHistory: [],
};

export function createWispMessage(input: {
  title: string;
  body: string;
  source: string;
  severity?: WispSeverity;
  timestamp?: number;
  progress?: number;
  actions?: WispAction[];
}): WispMessage {
  return {
    id: `wisp_${stableMessageSlug(input.source)}_${input.timestamp ?? Date.now()}`,
    title: input.title,
    body: input.body,
    source: input.source,
    severity: input.severity ?? 'info',
    timestamp: input.timestamp ?? Date.now(),
    progress: clampProgress(input.progress),
    actions: sanitizeWispActions(input.actions ?? []),
  };
}

export function isWispActionAllowed(kind: string): kind is WispActionKind {
  return SAFE_WISP_ACTIONS.has(kind as WispActionKind);
}

export function isWispActionBlocked(kind: string): kind is WispBlockedActionKind {
  return BLOCKED_WISP_ACTIONS.has(kind as WispBlockedActionKind);
}

export function sanitizeWispActions(actions: WispAction[]): WispAction[] {
  return actions.filter((action) => isWispActionAllowed(action.kind));
}

export function getWispFormForMessage(message: WispMessage): WispForm {
  if (message.source.includes('ocr')) return 'scan';
  if (message.source.includes('correlation') || message.source.includes('analysis')) return 'dragon';
  if (message.source.includes('game') || message.source.includes('library')) return 'controller';
  if (message.source.includes('backup') || message.source.includes('recovery')) return 'phoenix';
  if (message.severity === 'success') return 'success';
  if (message.severity === 'warning' || message.severity === 'guard') return 'warning';
  if (message.severity === 'error') return 'error';
  return 'base';
}

export function getWispMoodForMessage(message: WispMessage): WispMood {
  if (message.severity === 'success') return 'proud';
  if (message.severity === 'warning' || message.severity === 'guard') return 'protective';
  if (message.severity === 'error') return 'concerned';
  if (message.source.includes('scan') || message.source.includes('ocr')) return 'focused';
  return 'curious';
}

export function wispReducer(state: WispState, event: WispEvent): WispState {
  switch (event.type) {
    case 'message': {
      const message = {
        ...event.message,
        actions: sanitizeWispActions(event.message.actions),
      };
      return {
        ...state,
        visible: true,
        interactionOpen: false,
        form: getWispFormForMessage(message),
        mood: getWispMoodForMessage(message),
        message,
        bubbles: [message, ...state.bubbles.filter((bubble) => bubble.id !== message.id)].slice(0, 3),
        messageHistory: [message, ...state.messageHistory].slice(0, 50),
      };
    }
    case 'closeBubble': {
      const bubbles = state.bubbles.filter((bubble) => bubble.id !== event.id);
      return {
        ...state,
        message: state.message?.id === event.id ? bubbles[0] ?? null : state.message,
        bubbles,
        form: bubbles[0] ? getWispFormForMessage(bubbles[0]) : 'base',
        mood: bubbles[0] ? getWispMoodForMessage(bubbles[0]) : state.quietMode ? 'sleepy' : 'curious',
      };
    }
    case 'clearBubbles':
      return {
        ...state,
        message: null,
        bubbles: [],
        form: 'base',
        mood: state.quietMode ? 'sleepy' : 'curious',
      };
    case 'dismiss':
      return {
        ...state,
        message: null,
        bubbles: [],
        interactionOpen: false,
        form: 'base',
        mood: state.quietMode ? 'sleepy' : 'curious',
      };
    case 'hide':
      return {
        ...state,
        visible: false,
        interactionOpen: false,
        form: 'crystal',
        mood: 'sleepy',
      };
    case 'show':
      return {
        ...state,
        visible: true,
        form: state.message ? getWispFormForMessage(state.message) : 'base',
        mood: state.message ? getWispMoodForMessage(state.message) : 'curious',
      };
    case 'openInteraction':
      return {
        ...state,
        visible: true,
        interactionOpen: true,
        form: state.message ? getWispFormForMessage(state.message) : 'controller',
        mood: 'curious',
      };
    case 'closeInteraction':
      return {
        ...state,
        interactionOpen: false,
        form: state.message ? getWispFormForMessage(state.message) : 'base',
        mood: state.message ? getWispMoodForMessage(state.message) : 'curious',
      };
    case 'toggleInteraction':
      return wispReducer(state, { type: state.interactionOpen ? 'closeInteraction' : 'openInteraction' });
    case 'setQuietMode':
      return {
        ...state,
        quietMode: event.quietMode,
        mood: event.quietMode ? 'sleepy' : state.mood,
      };
    case 'setMood':
      return { ...state, mood: event.mood };
    case 'setForm':
      return { ...state, form: event.form };
    default:
      return state;
  }
}

function clampProgress(progress: number | undefined): number | undefined {
  if (progress === undefined) return undefined;
  if (!Number.isFinite(progress)) return undefined;
  return Math.min(100, Math.max(0, progress));
}

function stableMessageSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'solith';
}
