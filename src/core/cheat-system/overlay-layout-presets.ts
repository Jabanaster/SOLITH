/**
 * Per-game overlay window layout presets (position + size).
 */

export interface OverlayLayoutPreset {
  width: number;
  height: number;
  /** Pixels from right edge of work area */
  marginRight: number;
  /** Pixels from top of work area */
  marginTop: number;
}

const DEFAULT_PRESET: OverlayLayoutPreset = {
  width: 380,
  height: 560,
  marginRight: 20,
  marginTop: 48,
};

/** Game-specific overlay layouts — tuned for 1080p; safe on ultrawide (margin from right edge). */
export const OVERLAY_LAYOUT_PRESETS: Record<string, OverlayLayoutPreset> = {
  palworld: { width: 400, height: 620, marginRight: 16, marginTop: 40 },
  'stardew-valley': { width: 360, height: 520, marginRight: 24, marginTop: 56 },
  atomfall: { width: 400, height: 600, marginRight: 20, marginTop: 48 },
  avowed: { width: 420, height: 640, marginRight: 12, marginTop: 36 },
  undisputed: { width: 340, height: 480, marginRight: 28, marginTop: 64 },
  dredge: { width: 360, height: 540, marginRight: 20, marginTop: 48 },
  'crimson-desert': { width: 400, height: 600, marginRight: 16, marginTop: 44 },
  // Bundled live-memory titles — 7 curated presets
};

export function getOverlayLayoutPreset(gameId?: string | null): OverlayLayoutPreset {
  if (!gameId) return DEFAULT_PRESET;
  return OVERLAY_LAYOUT_PRESETS[gameId] ?? DEFAULT_PRESET;
}
