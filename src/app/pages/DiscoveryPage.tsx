import React, { useCallback, useEffect, useState } from 'react';
import styles from './DiscoveryPage.module.css';
import { GameCard } from '../components/GameCard.js';
import type { DiscoveryCatalogEntry } from '../../core/discovery-catalog/types.js';
import type { LinkedLibraryProvider } from '../../core/install-discovery/provider-capabilities.js';
import { parseYear, toGameCardData, MIN_RELEASE_YEAR, MAX_RELEASE_YEAR } from './discovery-page-helpers.js';

/**
 * Discovery — the provider-neutral game-universe browser (Discovery Master
 * Pass, Stage 2).
 *
 * Reuses GameCard for visual consistency with Home/My Games, but NEVER
 * passes an artworkUrl here — Discovery Master Pass section 7/20 is
 * explicit: a game the user has not favorited/installed/owned must never
 * trigger bulk artwork downloads, so every Discovery result shows the
 * branded fallback until it becomes personal (favoriting already triggers
 * the real, cached, provider-trusted artwork fetch — see Stage 1/2's
 * usePersonalLibraryGames.ts / artwork-cache-ipc.ts changes). The favorite
 * toggle is rendered as a sibling overlay button, not nested inside
 * GameCard's own `role="button"` article — nesting an interactive <button>
 * inside another interactive element is invalid and would double-fire
 * navigation on every favorite click.
 *
 * Card activation (click/Enter/Space, via GameCard's own semantics)
 * navigates to game-detail via `onSelectGame` — GameDetailPage's Stage 2
 * identity-resolution fix (game-detail-discovery-fallback.ts) makes this
 * work correctly for a Discovery-only game with no personal-library
 * evidence, not just an already-favorited one.
 *
 * Only Steam/Epic/GOG are offered as provider filters — the three sources
 * with a real bulk catalog sync path (section 4/61); Ubisoft/EA/Xbox/
 * Battle.net are not offered here since no bulk catalog exists for them.
 *
 * No genre dropdown: genresJson is a JSON-encoded array column with no
 * distinct-values index, and computing one would mean scanning the entire
 * table client-side at 100k+ scale — not a bounded query. Genre is exposed
 * as a free-text filter instead (the real substring match the schema
 * already supports), which is honest about what the data model provides.
 */

const PROVIDER_OPTIONS: { value: '' | LinkedLibraryProvider; label: string }[] = [
  { value: '', label: 'All providers' },
  { value: 'steam', label: 'Steam' },
  { value: 'epic', label: 'Epic' },
  { value: 'gog', label: 'GOG' },
];

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'title-asc', label: 'A – Z' },
  { value: 'title-desc', label: 'Z – A' },
  { value: 'release-desc', label: 'Newest release' },
  { value: 'release-asc', label: 'Oldest release' },
];

type SortOption = 'title-asc' | 'title-desc' | 'release-desc' | 'release-asc';

const PAGE_SIZE = 48;
const SEARCH_DEBOUNCE_MS = 250;

export interface DiscoveryPageProps {
  onSelectGame: (gameId: string) => void;
}

interface DiscoveryCardState {
  entry: DiscoveryCatalogEntry;
  favorite: boolean;
  favoriteBusy: boolean;
}

export function DiscoveryPage({ onSelectGame }: DiscoveryPageProps) {
  const [text, setText] = useState('');
  const [provider, setProvider] = useState<'' | LinkedLibraryProvider>('');
  const [genre, setGenre] = useState('');
  const [releaseYearMinInput, setReleaseYearMinInput] = useState('');
  const [releaseYearMaxInput, setReleaseYearMaxInput] = useState('');
  const [sort, setSort] = useState<SortOption>('title-asc');
  const [cards, setCards] = useState<DiscoveryCardState[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);

  const runSearch = useCallback(
    async (
      searchText: string,
      searchProvider: '' | LinkedLibraryProvider,
      searchGenre: string,
      releaseYearMin: number | undefined,
      releaseYearMax: number | undefined,
      searchSort: SortOption,
      pageOffset: number,
    ) => {
      const api = (window as any).electronAPI;
      if (!api?.discoveryCatalogSearch) {
        setErrored(true);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const result = await api.discoveryCatalogSearch({
          text: searchText.trim() || undefined,
          provider: searchProvider || undefined,
          genre: searchGenre.trim() || undefined,
          releaseYearMin,
          releaseYearMax,
          sort: searchSort,
          limit: PAGE_SIZE,
          offset: pageOffset,
        });
        if (!result?.success || !Array.isArray(result.entries)) {
          setErrored(true);
          return;
        }
        setErrored(false);
        const entries = result.entries as DiscoveryCatalogEntry[];
        setHasMore(entries.length === PAGE_SIZE);

        const favoriteFlags = await Promise.all(
          entries.map(async (entry) => {
            try {
              const favResult = await api.isFavoriteGame?.({ canonicalGameId: entry.solithGameId });
              return Boolean(favResult?.success && favResult.isFavorite);
            } catch {
              return false;
            }
          }),
        );

        const nextCards: DiscoveryCardState[] = entries.map((entry, index) => ({
          entry,
          favorite: favoriteFlags[index] ?? false,
          favoriteBusy: false,
        }));

        setCards((prev) => (pageOffset === 0 ? nextCards : [...prev, ...nextCards]));
      } catch {
        setErrored(true);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Debounced re-search from offset 0 whenever any filter/sort changes.
  useEffect(() => {
    const releaseYearMin = parseYear(releaseYearMinInput);
    const releaseYearMax = parseYear(releaseYearMaxInput);
    const handle = setTimeout(() => {
      setOffset(0);
      void runSearch(text, provider, genre, releaseYearMin, releaseYearMax, sort, 0);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [text, provider, genre, releaseYearMinInput, releaseYearMaxInput, sort, runSearch]);

  const handleLoadMore = () => {
    const nextOffset = offset + PAGE_SIZE;
    setOffset(nextOffset);
    void runSearch(text, provider, genre, parseYear(releaseYearMinInput), parseYear(releaseYearMaxInput), sort, nextOffset);
  };

  const handleToggleFavorite = async (solithGameId: string) => {
    const api = (window as any).electronAPI;
    if (!api?.favoriteGame || !api?.unfavoriteGame) return;
    const current = cards.find((card) => card.entry.solithGameId === solithGameId);
    if (!current) return;
    setCards((prev) =>
      prev.map((card) => (card.entry.solithGameId === solithGameId ? { ...card, favoriteBusy: true } : card)),
    );
    try {
      const result = current.favorite
        ? await api.unfavoriteGame({ canonicalGameId: solithGameId })
        : await api.favoriteGame({ canonicalGameId: solithGameId });
      const nowFavorite = result?.success ? Boolean(result.isFavorite) : current.favorite;
      setCards((prev) =>
        prev.map((card) =>
          card.entry.solithGameId === solithGameId ? { ...card, favorite: nowFavorite, favoriteBusy: false } : card,
        ),
      );
    } catch {
      setCards((prev) =>
        prev.map((card) => (card.entry.solithGameId === solithGameId ? { ...card, favoriteBusy: false } : card)),
      );
    }
  };

  return (
    <div className={styles.page} data-testid="discovery-page">
      <div className={styles.hero}>
        <h1 className={styles.title}>Discovery</h1>
        <p className={styles.subtitle}>Search SOLITH&rsquo;s game universe — find a game, see if a trainer exists, or build one.</p>
      </div>

      <div className={styles.controls}>
        <input
          type="search"
          className={styles.searchInput}
          placeholder="Search by title…"
          value={text}
          onChange={(event) => setText(event.target.value)}
          aria-label="Search Discovery"
          data-testid="discovery-search-input"
        />
        <select
          className={styles.selectInput}
          value={provider}
          onChange={(event) => setProvider(event.target.value as '' | LinkedLibraryProvider)}
          aria-label="Filter by provider"
          data-testid="discovery-provider-select"
        >
          {PROVIDER_OPTIONS.map((option) => (
            <option key={option.value || 'all'} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <input
          type="text"
          className={styles.textInput}
          placeholder="Genre…"
          value={genre}
          onChange={(event) => setGenre(event.target.value)}
          aria-label="Filter by genre"
          data-testid="discovery-genre-input"
        />
        <input
          type="number"
          className={styles.yearInput}
          placeholder="From year"
          value={releaseYearMinInput}
          onChange={(event) => setReleaseYearMinInput(event.target.value)}
          aria-label="Earliest release year"
          data-testid="discovery-year-min-input"
          min={MIN_RELEASE_YEAR}
          max={MAX_RELEASE_YEAR}
        />
        <input
          type="number"
          className={styles.yearInput}
          placeholder="To year"
          value={releaseYearMaxInput}
          onChange={(event) => setReleaseYearMaxInput(event.target.value)}
          aria-label="Latest release year"
          data-testid="discovery-year-max-input"
          min={MIN_RELEASE_YEAR}
          max={MAX_RELEASE_YEAR}
        />
        <select
          className={styles.selectInput}
          value={sort}
          onChange={(event) => setSort(event.target.value as SortOption)}
          aria-label="Sort results"
          data-testid="discovery-sort-select"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {errored ? (
        <div className={styles.emptyState} data-testid="discovery-error">
          <p>Discovery catalog is unavailable right now. Try again shortly.</p>
        </div>
      ) : cards.length === 0 && !loading ? (
        <div className={styles.emptyState} data-testid="discovery-empty">
          <p>No games found. Try a different search, provider, or filter.</p>
        </div>
      ) : (
        <div className={styles.gridLayout} data-testid="discovery-results">
          {cards.map(({ entry, favorite, favoriteBusy }) => (
            <div key={entry.solithGameId} className={styles.cardWrap}>
              <GameCard game={toGameCardData(entry, favorite)} mode="grid" onSelect={onSelectGame} />
              <button
                type="button"
                className={styles.favoriteOverlay}
                disabled={favoriteBusy}
                onClick={() => handleToggleFavorite(entry.solithGameId)}
                aria-pressed={favorite}
                aria-label={favorite ? `Unfavorite ${entry.title}` : `Favorite ${entry.title}`}
                data-testid="discovery-favorite-button"
              >
                {favorite ? '★' : '☆'}
              </button>
            </div>
          ))}
        </div>
      )}

      {loading && cards.length === 0 ? (
        <div className={styles.emptyState} data-testid="discovery-loading">
          <p>Loading…</p>
        </div>
      ) : null}

      {cards.length > 0 && hasMore ? (
        <div className={styles.footer}>
          <button
            type="button"
            className={styles.loadMoreButton}
            onClick={handleLoadMore}
            disabled={loading}
            data-testid="discovery-load-more"
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default DiscoveryPage;
