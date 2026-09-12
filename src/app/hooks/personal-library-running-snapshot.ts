/**
 * Pure "Running" state reducer for usePersonalLibraryGames.ts's sidebar
 * mini-section. Shared by BOTH the mount-time snapshot fetch
 * (`get-current-detected-process` — the existing in-memory
 * catalog-process-watch.ts `lastDetection`, read once on mount so the
 * sidebar doesn't sit empty until the next poll's event fires) and the live
 * `onCatalogProcessDetected` event subscription, so the
 * detection -> GameCardData mapping and the "clear on no detection" rule
 * live in exactly one place instead of being duplicated across the two
 * effects. Split out so it's unit-testable in plain Node (`node --test`)
 * without React or a DOM — mirrors personal-library-my-games.ts's existing
 * pattern (see that file's header).
 */
import type { GameCardData } from '../components/game-card-status.js';

/** Minimal shape both the snapshot IPC and the live event payload satisfy. */
export interface RunningProcessDetection {
  catalogGameId: string;
  displayName: string;
}

export interface RunningGameState {
  runningCatalogGameId: string | null;
  runningGame: GameCardData | null;
}

export const EMPTY_RUNNING_STATE: RunningGameState = {
  runningCatalogGameId: null,
  runningGame: null,
};

/**
 * Builds a running GameCardData from a bare catalogGameId/displayName pair
 * — all the snapshot IPC and the live event payload actually carry, never a
 * full TrainerCatalogEntry lookup. trainerAvailability/trainerAccuracy stay
 * at the honest 'NONE' floor here (no catalog data was fetched) — this only
 * reflects "is running right now", matching the fidelity the hook already
 * had for this section before the split.
 */
export function toRunningGameCardData(
  detection: RunningProcessDetection,
  overrides: Partial<GameCardData> = {},
): GameCardData {
  return {
    gameId: detection.catalogGameId,
    title: detection.displayName,
    running: true,
    installed: false,
    owned: 'unknown',
    favorite: false,
    launchers: [],
    trainerAvailability: 'NONE',
    trainerAccuracy: 'NONE',
    ...overrides,
  };
}

/**
 * Reduces a detection payload (from either the snapshot IPC or the live
 * event) plus the previous running state into the next running state.
 *
 * A null/undefined detection, or one missing `catalogGameId` (how "no
 * process currently detected" / "the process exited" is represented by both
 * the snapshot IPC's `detection: null` and a live event reporting no match),
 * clears the running state — it never leaves a stale entry behind.
 */
export function deriveRunningGameState(
  detection: RunningProcessDetection | null | undefined,
  prev: RunningGameState,
): RunningGameState {
  if (!detection || !detection.catalogGameId) {
    return EMPTY_RUNNING_STATE;
  }
  const favorite =
    prev.runningCatalogGameId === detection.catalogGameId ? (prev.runningGame?.favorite ?? false) : false;
  return {
    runningCatalogGameId: detection.catalogGameId,
    runningGame: toRunningGameCardData(detection, { favorite }),
  };
}
