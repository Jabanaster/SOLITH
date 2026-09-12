import styles from './TrainerLibraryPage.module.css';
import {
  TRAINER_LIBRARY_SORT_LABELS,
  TRAINER_LIBRARY_SORT_OPTION_ORDER,
  type TrainerLibrarySortOption,
} from './trainer-library-sort-options.js';

/**
 * Owner-directed reversal of the Mission 3/24 sort-mode freeze (see
 * tests/trainer-library-sort-ui.test.ts). A native <select> is used
 * deliberately — it is fully keyboard operable and screen-reader friendly
 * with zero custom ARIA wiring, unlike a hand-rolled listbox.
 *
 * Scope: applies to the flat "All Games"/Flat A-Z browse view only — see
 * trainer-library-sort-options.ts's header comment.
 */
export function TrainerLibrarySortMenu({
  value,
  onChange,
}: {
  value: TrainerLibrarySortOption;
  onChange: (option: TrainerLibrarySortOption) => void;
}) {
  return (
    <label className={styles.sortMenu}>
      <span className={styles.sortMenuLabel}>Sort</span>
      <select
        className={styles.sortMenuSelect}
        value={value}
        aria-label="Sort trainer library"
        onChange={(e) => onChange(e.target.value as TrainerLibrarySortOption)}
      >
        {TRAINER_LIBRARY_SORT_OPTION_ORDER.map((option) => (
          <option key={option} value={option}>
            {TRAINER_LIBRARY_SORT_LABELS[option]}
          </option>
        ))}
      </select>
    </label>
  );
}
