import type { WispForm } from '../../core/companion/wisp.js';

export type WispPosition = { x: number; y: number };
export type WispPositionPreset =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'center';
export type WispAnimationIntensity = 'off' | 'reduced' | 'normal';

export type WispPreferences = {
  form: WispForm;
  scale: number;
  opacity: number;
  reducedMotion: boolean;
  animationIntensity: WispAnimationIntensity;
  rememberPosition: boolean;
  rememberForm: boolean;
};

export const WISP_FORMS: readonly WispForm[] = [
  'base',
  'controller',
  'crystal',
  'dragon',
  'error',
  'phoenix',
  'scan',
  'shield',
  'success',
  'warning',
];

export const DEFAULT_WISP_PREFERENCES: WispPreferences = {
  form: 'base',
  scale: 1,
  opacity: 1,
  reducedMotion: false,
  animationIntensity: 'normal',
  rememberPosition: true,
  rememberForm: true,
};

export function isWispForm(value: unknown): value is WispForm {
  return typeof value === 'string' && WISP_FORMS.includes(value as WispForm);
}

export function parseWispPreferences(raw: string | null): WispPreferences {
  if (!raw) return { ...DEFAULT_WISP_PREFERENCES };
  try {
    const value = JSON.parse(raw) as Partial<WispPreferences>;
    return {
      form: isWispForm(value.form) ? value.form : DEFAULT_WISP_PREFERENCES.form,
      scale: clampFinite(value.scale, 0.75, 1.5, DEFAULT_WISP_PREFERENCES.scale),
      opacity: clampFinite(value.opacity, 0.5, 1, DEFAULT_WISP_PREFERENCES.opacity),
      reducedMotion: typeof value.reducedMotion === 'boolean' ? value.reducedMotion : false,
      animationIntensity:
        value.animationIntensity === 'off' ||
        value.animationIntensity === 'reduced' ||
        value.animationIntensity === 'normal'
          ? value.animationIntensity
          : DEFAULT_WISP_PREFERENCES.animationIntensity,
      rememberPosition: typeof value.rememberPosition === 'boolean' ? value.rememberPosition : true,
      rememberForm: typeof value.rememberForm === 'boolean' ? value.rememberForm : true,
    };
  } catch {
    return { ...DEFAULT_WISP_PREFERENCES };
  }
}

export function clampWispPosition(
  position: WispPosition,
  viewport: { width: number; height: number },
  sprite: { width: number; height: number },
  padding: number,
): WispPosition {
  const minX = padding;
  const minY = padding;
  const maxX = Math.max(minX, viewport.width - sprite.width - padding);
  const maxY = Math.max(minY, viewport.height - sprite.height - padding);
  return {
    x: Math.min(Math.max(finiteOr(position.x, minX), minX), maxX),
    y: Math.min(Math.max(finiteOr(position.y, minY), minY), maxY),
  };
}

export function positionForPreset(
  preset: WispPositionPreset,
  viewport: { width: number; height: number },
  sprite: { width: number; height: number },
  padding: number,
): WispPosition {
  const left = padding;
  const top = padding;
  const right = viewport.width - sprite.width - padding;
  const bottom = viewport.height - sprite.height - padding;
  const centerX = (viewport.width - sprite.width) / 2;
  const centerY = (viewport.height - sprite.height) / 2;
  const candidate = {
    'top-left': { x: left, y: top },
    'top-right': { x: right, y: top },
    'bottom-left': { x: left, y: bottom },
    'bottom-right': { x: right, y: bottom },
    center: { x: centerX, y: centerY },
  }[preset];
  return clampWispPosition(candidate, viewport, sprite, padding);
}

function clampFinite(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
