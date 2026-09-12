/**
 * Pure status-label logic for GameCard, extracted into its own CSS-free
 * module for direct unit-testability — mirrors the existing convention in
 * this codebase (see src/app/pages/trainer-card-fallback-artwork.ts and
 * trainer-library-verification-state.ts, both pulled out of their page
 * component for the same reason: a component file that imports a CSS module
 * cannot be imported by the plain `tsx --test` runner used here, since Node's
 * ESM loader has no CSS loader registered).
 */
import type { PersonalLibraryGame } from '../../core/personal-library/model.js';
import type { TrainerAccuracyState } from '../../core/trainer-catalog/trainer-accuracy.js';
import type { InstallPlatform } from '../../core/install-discovery/types.js';

export type GameCardData = Pick<
  PersonalLibraryGame,
  | 'gameId'
  | 'title'
  | 'running'
  | 'installed'
  | 'owned'
  | 'favorite'
  | 'launchers'
  | 'trainerAvailability'
  | 'trainerAccuracy'
  | 'artworkUrl'
>;

/**
 * Launcher display names — same wording as the existing LAUNCHER_LABELS map
 * in src/app/routes/GameLibrary.tsx, reused verbatim here rather than
 * reinvented for this card.
 */
export const LAUNCHER_LABELS: Record<InstallPlatform, string> = {
  steam: 'Steam',
  epic: 'Epic',
  gog: 'GOG',
  xbox: 'Xbox',
  ubisoft: 'Ubisoft Connect',
  ea: 'EA app',
  battlenet: 'Battle.net',
  manual: 'Standalone',
};

/**
 * Concise trainer-accuracy wording for the card's secondary line.
 *
 * LOCALLY_VERIFIED / EXACT_VERSION_MATCH / STRONG_MATCH / NEEDS_REVERIFY
 * reuse the EXACT label text already established by TrainerLibraryPage.tsx's
 * TRAINER_ACCURACY_BADGE_LABELS map (that file's own comment marks it as the
 * one real computeTrainerAccuracy-driven label set — do not re-derive from
 * title text). That map intentionally excludes INCOMPATIBLE and NONE (its
 * own "5 of 7 states are worth a badge" comment); this card needs a label
 * for every accuracy state it can be handed, so VERSION_UNKNOWN maps to
 * "Trainer Ready" (a trainer exists and nothing says it's wrong, just
 * unverified yet — this exact phrase is one of the concise examples
 * specified for this card) and INCOMPATIBLE to "Incompatible" — both new
 * wording only where the existing map has none.
 */
export const TRAINER_ACCURACY_LABELS: Partial<Record<TrainerAccuracyState, string>> = {
  LOCALLY_VERIFIED: 'Locally Verified',
  EXACT_VERSION_MATCH: 'Exact Match',
  STRONG_MATCH: 'Strong Match',
  VERSION_UNKNOWN: 'Trainer Ready',
  NEEDS_REVERIFY: 'Needs Reverify',
  INCOMPATIBLE: 'Incompatible',
};

export const NO_TRAINER_LABEL = 'No Trainer';

/**
 * Personal-priority ordering (owner's explicit rule): Running > Installed >
 * Owned > neither. Exactly one of these ever renders — never stacked.
 * Ownership-honesty discipline (see OwnershipStatus doc in model.ts): only
 * ever returns an "Owned" label for owned === true, NEVER for 'unknown' or
 * false.
 */
export function primaryStatusLabel(game: GameCardData): string | null {
  const launcherSuffix = game.launchers.length > 0 ? ` · ${LAUNCHER_LABELS[game.launchers[0]]}` : '';
  if (game.running) return `Running${launcherSuffix}`;
  if (game.installed) return `Installed${launcherSuffix}`;
  if (game.owned === true) return 'Owned';
  return null;
}

export function trainerStatusLabel(game: GameCardData): string {
  if (game.trainerAvailability === 'NONE') return NO_TRAINER_LABEL;
  return TRAINER_ACCURACY_LABELS[game.trainerAccuracy] ?? NO_TRAINER_LABEL;
}
