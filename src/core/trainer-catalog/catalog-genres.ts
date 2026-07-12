/**
 * Canonical optional genre filters for Trainer Library browse UI.
 * Matched case-insensitively against each entry's `categories` array.
 */
export const CATALOG_GENRE_FILTERS = [
  'Action',
  'RPG',
  'Fighting',
  'Shooter',
  'Horror',
  'Survival',
  'Strategy',
  'Simulation',
  'Sports',
  'Racing',
  'Adventure',
  'Indie',
  'Roguelike',
  'Open World',
  'Platformer',
  'Puzzle',
  'Sandbox',
] as const;

export type CatalogGenreFilter = (typeof CATALOG_GENRE_FILTERS)[number];

/** Normalize user/filter input to a canonical genre label when possible. */
export function normalizeGenreFilter(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  const match = CATALOG_GENRE_FILTERS.find((g) => g.toLowerCase() === lower);
  return match ?? trimmed;
}

export function normalizeGenreFilterList(values: string[] | undefined): string[] {
  if (!values?.length) return [];
  const out = new Set<string>();
  for (const value of values) {
    const normalized = normalizeGenreFilter(value);
    if (normalized) out.add(normalized);
  }
  return [...out];
}

/** SQL LIKE pattern for a category token inside categoriesJson. */
export function categoryJsonLikePattern(category: string): string {
  return `%"${category.replace(/"/g, '')}"%`;
}

export function entryMatchesGenreFilters(
  categories: string[],
  selected: string[],
): boolean {
  if (selected.length === 0) return true;
  const normalizedEntry = categories.map((c) => c.toLowerCase());
  return selected.some((filter) => {
    const needle = filter.toLowerCase();
    return normalizedEntry.some(
      (c) => c === needle || c.includes(needle) || needle.includes(c),
    );
  });
}
