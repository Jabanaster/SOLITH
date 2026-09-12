import styles from './TrainerLibraryPage.module.css';
import {
  TRAINER_LIBRARY_AVAILABILITY_FILTER_LABELS,
  TRAINER_LIBRARY_CATALOG_FILTER_LABELS,
  TRAINER_LIBRARY_LAUNCHER_FILTER_LABELS,
  TRAINER_LIBRARY_MODE_FILTER_LABELS,
  type TrainerLibraryAvailabilityFilter,
  type TrainerLibraryCatalogFilter,
  type TrainerLibraryLauncherFilter,
  type TrainerLibraryModeFilter,
} from '../../core/trainer-catalog/all-games-filters.js';

interface Chip {
  key: string;
  label: string;
  onRemove: () => void;
}

interface TrainerLibraryActiveFilterChipsProps {
  availabilityFilters: TrainerLibraryAvailabilityFilter[];
  onToggleAvailability: (filter: TrainerLibraryAvailabilityFilter) => void;
  catalogFilters: TrainerLibraryCatalogFilter[];
  onToggleCatalog: (filter: TrainerLibraryCatalogFilter) => void;
  launcherFilters: TrainerLibraryLauncherFilter[];
  onToggleLauncher: (filter: TrainerLibraryLauncherFilter) => void;
  modeFilters: TrainerLibraryModeFilter[];
  onToggleMode: (filter: TrainerLibraryModeFilter) => void;
  genreFilters: string[];
  onToggleGenre: (genre: string) => void;
  runningOnly: boolean;
  onToggleRunningOnly: () => void;
  needsReverifyOnly: boolean;
  onToggleNeedsReverifyOnly: () => void;
  onClearAll: () => void;
}

/**
 * Interactive replacement for the old text-only activeFilterSummary
 * (previously just a string baked into the header description). Every chip
 * removes exactly one active filter value via the same toggle handler the
 * (now-collapsed) filter buttons already used — no new filter-state
 * semantics, just a second, removable way to reach the identical toggle.
 */
export function TrainerLibraryActiveFilterChips({
  availabilityFilters,
  onToggleAvailability,
  catalogFilters,
  onToggleCatalog,
  launcherFilters,
  onToggleLauncher,
  modeFilters,
  onToggleMode,
  genreFilters,
  onToggleGenre,
  runningOnly,
  onToggleRunningOnly,
  needsReverifyOnly,
  onToggleNeedsReverifyOnly,
  onClearAll,
}: TrainerLibraryActiveFilterChipsProps) {
  const chips: Chip[] = [
    ...availabilityFilters.map((filter) => ({
      key: `availability:${filter}`,
      label: TRAINER_LIBRARY_AVAILABILITY_FILTER_LABELS[filter],
      onRemove: () => onToggleAvailability(filter),
    })),
    ...catalogFilters.map((filter) => ({
      key: `catalog:${filter}`,
      label: TRAINER_LIBRARY_CATALOG_FILTER_LABELS[filter],
      onRemove: () => onToggleCatalog(filter),
    })),
    ...launcherFilters.map((filter) => ({
      key: `launcher:${filter}`,
      label: TRAINER_LIBRARY_LAUNCHER_FILTER_LABELS[filter],
      onRemove: () => onToggleLauncher(filter),
    })),
    ...modeFilters.map((filter) => ({
      key: `mode:${filter}`,
      label: TRAINER_LIBRARY_MODE_FILTER_LABELS[filter],
      onRemove: () => onToggleMode(filter),
    })),
    ...genreFilters.map((genre) => ({
      key: `genre:${genre}`,
      label: genre,
      onRemove: () => onToggleGenre(genre),
    })),
    ...(runningOnly ? [{ key: 'running', label: 'Running', onRemove: onToggleRunningOnly }] : []),
    ...(needsReverifyOnly
      ? [{ key: 'needs-reverify', label: 'Needs re-verify', onRemove: onToggleNeedsReverifyOnly }]
      : []),
  ];

  if (chips.length === 0) return null;

  return (
    <div className={styles.activeFilterChips} aria-label="Active filters">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          className={styles.activeFilterChip}
          onClick={chip.onRemove}
          aria-label={`Remove filter: ${chip.label}`}
        >
          {chip.label} <span aria-hidden="true">×</span>
        </button>
      ))}
      <button type="button" className={styles.clearGenresBtn} onClick={onClearAll}>
        Clear all
      </button>
    </div>
  );
}
