import { useEffect, useRef, useState } from 'react';
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

interface TrainerLibraryFiltersPopoverProps {
  availabilityFilters: TrainerLibraryAvailabilityFilter[];
  onToggleAvailability: (filter: TrainerLibraryAvailabilityFilter) => void;
  catalogFilters: TrainerLibraryCatalogFilter[];
  onToggleCatalog: (filter: TrainerLibraryCatalogFilter) => void;
  launcherFilters: TrainerLibraryLauncherFilter[];
  onToggleLauncher: (filter: TrainerLibraryLauncherFilter) => void;
  modeFilters: TrainerLibraryModeFilter[];
  onToggleMode: (filter: TrainerLibraryModeFilter) => void;
  genreFilters: string[];
  genreOptions: readonly string[];
  onToggleGenre: (genre: string) => void;
  runningOnly: boolean;
  onToggleRunningOnly: () => void;
  needsReverifyOnly: boolean;
  onToggleNeedsReverifyOnly: () => void;
  activeCount: number;
  onClearAll: () => void;
}

/**
 * Owner-directed redesign: the 7 always-visible filter-chip-rows are
 * collapsed into this one popover. Every option/label/state variable it
 * touches is the exact pre-existing one from all-games-filters.ts / the
 * page's own running/needsReverify/genre state — this component only moves
 * the markup, it does not change filter semantics (tests/trainer-library-
 * filters-ui.test.mjs pins those semantics and must still pass unchanged).
 *
 * Filtering itself stays instant/live, same as before — there is no
 * separate "Apply" step; closing the popover does not discard anything.
 */
export function TrainerLibraryFiltersPopover({
  availabilityFilters,
  onToggleAvailability,
  catalogFilters,
  onToggleCatalog,
  launcherFilters,
  onToggleLauncher,
  modeFilters,
  onToggleMode,
  genreFilters,
  genreOptions,
  onToggleGenre,
  runningOnly,
  onToggleRunningOnly,
  needsReverifyOnly,
  onToggleNeedsReverifyOnly,
  activeCount,
  onClearAll,
}: TrainerLibraryFiltersPopoverProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    // Mission 19 accessibility — focus must return to the trigger, not be
    // dropped, when the popover closes via Escape or the Clear-all action.
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [open]);

  return (
    <div className={styles.filtersPopoverWrap}>
      <button
        type="button"
        ref={triggerRef}
        className={styles.filtersTrigger}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="trainer-library-filters-panel"
        onClick={() => setOpen((v) => !v)}
      >
        {activeCount > 0 ? `Filters (${activeCount})` : 'Filters'} ▾
      </button>
      {open && (
        <div
          id="trainer-library-filters-panel"
          ref={panelRef}
          className={styles.filtersPanel}
          role="region"
          aria-label="Trainer Library filters"
        >
          <div className={styles.filtersPanelHeader}>
            <span>Filters</span>
            <button type="button" className={styles.clearGenresBtn} onClick={onClearAll}>
              Clear all
            </button>
          </div>

          <div className={styles.filterSection}>
            <span className={styles.filterLabel}>Availability</span>
            <div className={styles.filters}>
              {(Object.entries(TRAINER_LIBRARY_AVAILABILITY_FILTER_LABELS) as Array<[TrainerLibraryAvailabilityFilter, string]>).map(
                ([filter, label]) => (
                  <button
                    key={filter}
                    type="button"
                    className={availabilityFilters.includes(filter) ? styles.filterActive : styles.filterBtn}
                    onClick={() => onToggleAvailability(filter)}
                    aria-pressed={availabilityFilters.includes(filter)}
                  >
                    {label}
                  </button>
                ),
              )}
            </div>
          </div>

          <div className={styles.filterSection}>
            <span className={styles.filterLabel}>Trainer / Catalog</span>
            <div className={styles.filters}>
              {(Object.entries(TRAINER_LIBRARY_CATALOG_FILTER_LABELS) as Array<[TrainerLibraryCatalogFilter, string]>).map(
                ([filter, label]) => (
                  <button
                    key={filter}
                    type="button"
                    className={catalogFilters.includes(filter) ? styles.filterActive : styles.filterBtn}
                    onClick={() => onToggleCatalog(filter)}
                    aria-pressed={catalogFilters.includes(filter)}
                  >
                    {label}
                  </button>
                ),
              )}
            </div>
          </div>

          <div className={styles.filterSection}>
            <span className={styles.filterLabel}>Status</span>
            <div className={styles.filters}>
              <button
                type="button"
                className={runningOnly ? styles.filterActive : styles.filterBtn}
                onClick={onToggleRunningOnly}
                aria-pressed={runningOnly}
              >
                Running
              </button>
              <button
                type="button"
                className={needsReverifyOnly ? styles.filterActive : styles.filterBtn}
                onClick={onToggleNeedsReverifyOnly}
                aria-pressed={needsReverifyOnly}
              >
                Needs re-verify
              </button>
            </div>
          </div>

          <div className={styles.filterSection}>
            <span className={styles.filterLabel}>Launcher</span>
            <div className={styles.filters}>
              {(Object.entries(TRAINER_LIBRARY_LAUNCHER_FILTER_LABELS) as Array<[TrainerLibraryLauncherFilter, string]>).map(
                ([filter, label]) => (
                  <button
                    key={filter}
                    type="button"
                    className={launcherFilters.includes(filter) ? styles.filterActive : styles.filterBtn}
                    onClick={() => onToggleLauncher(filter)}
                    aria-pressed={launcherFilters.includes(filter)}
                  >
                    {label}
                  </button>
                ),
              )}
            </div>
          </div>

          <div className={styles.filterSection}>
            <span className={styles.filterLabel}>Mode</span>
            <div className={styles.filters}>
              {(Object.entries(TRAINER_LIBRARY_MODE_FILTER_LABELS) as Array<[TrainerLibraryModeFilter, string]>).map(
                ([filter, label]) => (
                  <button
                    key={filter}
                    type="button"
                    className={modeFilters.includes(filter) ? styles.filterActive : styles.filterBtn}
                    onClick={() => onToggleMode(filter)}
                    aria-pressed={modeFilters.includes(filter)}
                  >
                    {label}
                  </button>
                ),
              )}
            </div>
          </div>

          <div className={styles.filterSection}>
            <span className={styles.filterLabel}>Genre</span>
            <div className={styles.genreFilters}>
              {genreOptions.map((genre) => (
                <button
                  key={genre}
                  type="button"
                  className={genreFilters.includes(genre) ? styles.genreChipActive : styles.genreChip}
                  onClick={() => onToggleGenre(genre)}
                  aria-pressed={genreFilters.includes(genre)}
                >
                  {genre}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
