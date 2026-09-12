/**
 * Personal Library — Home-page shelf selectors (Visual Library 2.0, Step 2).
 *
 * Pure, deterministic slicing functions over PersonalLibraryGame[]
 * (src/core/personal-library/model.ts). No I/O, no React, no side effects —
 * every function here is just an array transform, which is what keeps these
 * cheaply unit-testable in isolation from the real stores that produce the
 * evidence these games are projected from.
 *
 * Hard rule (owner-specified): a shelf/hero only appears when it has real,
 * meaningful data behind it. Every selector below returns an empty array
 * (or `undefined` for the hero) when nothing qualifies — never a fabricated
 * placeholder/"featured" entry.
 */

import type { PersonalLibraryGame } from './model.js';
import { sortByPersonalLibraryPriority } from '../trainer-catalog/personal-priority-comparator.js';

/**
 * Home hero: the game the user is currently running, if any; otherwise the
 * single highest personal-priority game in the list. Returns `undefined`
 * when the input is empty — the hero section must not render a fabricated
 * "featured" game.
 *
 * A running game always wins over a higher-priority-but-not-running game,
 * matching personal-priority-comparator.ts's own RUNNING > * tier ordering.
 */
export function selectRunningOrTopPriorityGame(
  games: PersonalLibraryGame[],
): PersonalLibraryGame | undefined {
  if (games.length === 0) return undefined;

  const running = games.find((game) => game.running);
  if (running) return running;

  return sortByPersonalLibraryPriority(games)[0];
}

/**
 * "My Games" shelf: installed games, priority-sorted, capped to `limit`.
 * Games that are not installed never appear here.
 */
export function selectMyGamesShelf(
  games: PersonalLibraryGame[],
  limit: number,
): PersonalLibraryGame[] {
  const installed = games.filter((game) => game.installed);
  return sortByPersonalLibraryPriority(installed).slice(0, limit);
}

/**
 * "Trainers Ready" shelf: games where a usable trainer actually exists
 * (trainerAvailability is anything other than 'NONE'), priority-sorted and
 * capped to `limit`.
 */
export function selectTrainersReadyShelf(
  games: PersonalLibraryGame[],
  limit: number,
): PersonalLibraryGame[] {
  const withTrainer = games.filter((game) => game.trainerAvailability !== 'NONE');
  return sortByPersonalLibraryPriority(withTrainer).slice(0, limit);
}

/**
 * "Locally Verified" shelf: games whose trainerAccuracy is exactly
 * 'LOCALLY_VERIFIED' (src/core/trainer-catalog/trainer-accuracy.ts) —
 * a real local validation-receipt PASS that is still valid. Any other
 * accuracy state (including 'NONE') is excluded.
 */
export function selectLocallyVerifiedShelf(
  games: PersonalLibraryGame[],
  limit: number,
): PersonalLibraryGame[] {
  const verified = games.filter((game) => game.trainerAccuracy === 'LOCALLY_VERIFIED');
  return sortByPersonalLibraryPriority(verified).slice(0, limit);
}

/**
 * "Recently Detected" shelf: games whose install evidence was detected
 * within the projector's recency window (model.ts's `recentlyDetected`
 * field), priority-sorted and capped to `limit`.
 */
export function selectRecentlyDetectedShelf(
  games: PersonalLibraryGame[],
  limit: number,
): PersonalLibraryGame[] {
  const recent = games.filter((game) => game.recentlyDetected);
  return sortByPersonalLibraryPriority(recent).slice(0, limit);
}

/**
 * "Needs Reverify" shelf: games whose trainerAccuracy is exactly
 * 'NEEDS_REVERIFY' — a prior LOCALLY_VERIFIED receipt that evidence has
 * since invalidated (see trainer-accuracy.ts's needsReverify rules).
 */
export function selectNeedsReverifyShelf(
  games: PersonalLibraryGame[],
  limit: number,
): PersonalLibraryGame[] {
  const needsReverify = games.filter((game) => game.trainerAccuracy === 'NEEDS_REVERIFY');
  return sortByPersonalLibraryPriority(needsReverify).slice(0, limit);
}
