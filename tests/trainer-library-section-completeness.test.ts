import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * Certification-pass findings, caught by the real-Electron fixture test
 * (tests/electron-personal-library.e2e.test.ts) rather than any prior unit
 * test — both are real product bugs in the frozen section hierarchy, not
 * test-only issues:
 *
 * 1. `load()` only fetched the COMPLETE catalog candidate set
 *    (fetchAllCandidatePages) when a derived filter was active; with no
 *    filters, the section view silently built every section from only the
 *    first PAGE_SIZE (120) rows of a single catalog page — most visibly
 *    undercounting "All Other Games", which has no infinite-scroll of its
 *    own (unlike the flat A-Z view's VirtualCatalogGrid).
 * 2. Switching to the Favorites-only view did not force open a
 *    collapsed-by-default section containing the favorited game — search
 *    already overrode collapse (Mission 4/11) but Favorites-only did not,
 *    so a favorite living in "All Other Games" (the common case, since most
 *    catalog entries land there) was invisible even in its own dedicated view.
 *
 * REVERSAL NOTICE (2026-09-10, Personal Library Completion — Final Closure
 * Pass, Mission 3): `load()` still calls `fetchAllCandidatePages` for the
 * COMPLETE candidate set on every load, exactly as test 1 above already
 * proves — that guarantee is untouched. What changed is TIMING, not
 * completeness: the page no longer BLOCKS all rendering until that full
 * fetch resolves. A new fast-path effect resolves Running/Installed/Owned/
 * Favorites-relevant catalog metadata from already-fast, small-result local
 * sources (installDiscoveryList, listFavorites, the new
 * trainerCatalogListOwned) via the existing single-entry trainerCatalogGet,
 * and adopts it as a first-paint `entries` value ONLY when nothing has
 * rendered yet (`prev.length === 0`). The full fetch above always still
 * runs to completion and unconditionally overwrites `entries` with the
 * complete set once it lands (`setEntries(all)`, unconditional — see
 * fetchAllCandidatePages), so every section ends up exactly as complete as
 * before; games only became visible SOONER, never less completely. The
 * render gates that used to read `!loading` were relaxed to
 * `favoriteFilteredEvidence.length > 0` (see TrainerLibraryPage.tsx's own
 * comment at the render site) specifically so the fast path's partial
 * `entries` can paint immediately instead of waiting behind the same
 * `loading` flag the full fetch also uses.
 */
const ROOT = path.resolve(import.meta.dirname ?? '.', '..');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf-8').replace(/\r\n/g, '\n');
}

test('load() always fetches the complete catalog candidate set for the section hierarchy, never a single paginated page', () => {
  const source = readSource('src/app/pages/TrainerLibraryPage.tsx');
  const loadBody = source.match(/const load = useCallback\(async \([\s\S]*?\n {2}\}, \[fetchAllCandidatePages, query, tierFilter, genreFilters\]\);/)?.[0] ?? '';
  assert.ok(loadBody.length > 0, 'expected to find the load() callback');
  assert.match(loadBody, /await fetchAllCandidatePages\(searchQuery, tier, genres\);/);
  // The old conditional single-page fallback must be gone — it was the root
  // cause of sections silently undercounting/dropping real games.
  assert.doesNotMatch(loadBody, /hasDerivedFilters/);
  assert.doesNotMatch(loadBody, /await fetchPage\(searchQuery, 0, false, tier, genres/);
});

test('Favorites-only view forces open every collapsed-by-default section, exactly like an active search does', () => {
  const source = readSource('src/app/pages/TrainerLibraryPage.tsx');
  assert.match(source, /const forceSectionsExpanded = isSearchActive \|\| showFavoritesOnly;/);
  assert.match(source, /LIBRARY_SECTIONS_COLLAPSED_BY_DEFAULT\.has\(sectionKey\) && !forceSectionsExpanded/);
});

test('Mission 3: a fast-path effect resolves Running/Installed/Owned/Favorites evidence from small, already-fast local sources, never a bulk/full-scan endpoint', () => {
  const source = readSource('src/app/pages/TrainerLibraryPage.tsx');
  assert.match(source, /api\.installDiscoveryList\?\.\(\) \?\? Promise\.resolve\(undefined\)/);
  assert.match(source, /api\.listFavorites\?\.\(\) \?\? Promise\.resolve\(undefined\)/);
  assert.match(source, /api\.trainerCatalogListOwned\?\.\(\) \?\? Promise\.resolve\(undefined\)/);
  // Resolves catalog metadata for just that small id set via the existing
  // single-entry get — never a new bulk/batch endpoint.
  assert.match(source, /api\.trainerCatalogGet!\(\{ catalogGameId \}\)/);
});

test('Mission 3: the fast path only adopts its result as a first-paint shortcut — it can never clobber a more complete fetch that already landed', () => {
  const source = readSource('src/app/pages/TrainerLibraryPage.tsx');
  assert.match(source, /setEntries\(\(prev\) => \(prev\.length === 0 \? fastEntries : prev\)\)/);
});

test('Mission 3: the full candidate fetch unconditionally overwrites `entries` with the complete set once it lands, regardless of what the fast path already rendered', () => {
  const source = readSource('src/app/pages/TrainerLibraryPage.tsx');
  const fetchAllBody =
    source.match(/const fetchAllCandidatePages = useCallback\(async \([\s\S]*?\n {2}\}, \[\]\);/)?.[0] ?? '';
  assert.ok(fetchAllBody.length > 0, 'expected to find the fetchAllCandidatePages callback');
  assert.match(fetchAllBody, /setEntries\(all\);/);
  assert.match(fetchAllBody, /setCatalogFullyLoaded\(true\);/);
});

test('Mission 3: rendering the section hierarchy no longer waits on the `loading` flag — it renders as soon as any evidence exists (fast or full)', () => {
  const source = readSource('src/app/pages/TrainerLibraryPage.tsx');
  assert.match(source, /\{favoriteFilteredEvidence\.length > 0 && !flatAZView && \(/);
  assert.doesNotMatch(source, /\{!loading && favoriteFilteredEvidence\.length > 0 && !flatAZView && \(/);
});
