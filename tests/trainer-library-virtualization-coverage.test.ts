import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { computeColumnCount } from '../src/app/components/VirtualCatalogGrid.tsx';
import { computeVisibleRowRange, CARD_HEIGHT, GRID_GAP, OVERSCAN_ROWS } from '../src/app/components/virtual-grid-math.ts';

/**
 * Personal Library Completion pass, Phase 2, Mission 15 — All Games
 * virtualization audit.
 *
 * Findings (source-verified, matches the Mission 15 brief's own prior
 * audit): VirtualCatalogGrid DOES cover the tab-driven flat "All Games"
 * browse path (flatAZView), including the Mission 12 real quality sort and
 * the prior UX pass's Sort control — sortedFlatEntries is built from
 * sortOption via sortTrainerLibraryFlatEntries before being handed to
 * VirtualCatalogGrid, so whichever sort is selected renders through the
 * virtualized path.
 *
 * REVERSAL NOTICE (2026-09-10, Personal Library Completion — Final Closure
 * Pass, Mission 5 REVERSAL): the "GAP CLOSED" note this file previously
 * carried recorded a decision the owner has since explicitly REJECTED. The
 * non-flat organizeLibrary section view's "All Other Games" section
 * previously rendered in bounded "Show N more" chunks
 * (trainer-library-section-chunking.ts) specifically because adapting
 * VirtualCatalogGrid to the page's own window scroll (rather than its own
 * internal `overflow: auto` + `scrollTop`) was judged too large a blast
 * radius at the time.
 *
 * That adaptation has now been done for real: VirtualCatalogGrid's row/
 * column windowing math was extracted into virtual-grid-math.ts (a shared,
 * pure module — see computeVisibleRowRange below), and a new
 * SectionVirtualGrid component (src/app/components/SectionVirtualGrid.tsx)
 * reuses that exact math while tracking the page's own window scroll via
 * use-window-scroll-virtualization.ts instead of an internal `scrollTop`.
 * VirtualCatalogGrid itself is unchanged in behavior for its existing
 * caller (the flat "All Games" view still owns its own scroll container) —
 * only its math was factored out, not its scroll strategy.
 *
 * The old "Show more" chunking module (trainer-library-section-chunking.ts)
 * and its pure-logic test are left in the repo, unused by the page, as a
 * record of the superseded approach — see that test file's own header.
 */
const ROOT = path.resolve(import.meta.dirname ?? '.', '..');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf-8').replace(/\r\n/g, '\n');
}

test('the flat "All Games" browse view (flatAZView) is virtualized via VirtualCatalogGrid', () => {
  const source = readSource('src/app/pages/TrainerLibraryPage.tsx');
  // Mission 3 (Personal Library Completion — Final Closure Pass) relaxed
  // this render gate from `!loading && favoriteFilteredEvidence.length > 0`
  // to just `favoriteFilteredEvidence.length > 0` so the fast path's
  // partial `entries` can paint immediately (see
  // tests/trainer-library-section-completeness.test.ts's reversal notice).
  const flatBlock = source.match(/\{favoriteFilteredEvidence\.length > 0 && flatAZView && \(([\s\S]*?)\n {6}\)\}/)?.[0] ?? '';
  assert.ok(flatBlock.length > 0, 'expected to find the flatAZView render block');
  assert.match(flatBlock, /<VirtualCatalogGrid/);
  assert.match(flatBlock, /items=\{sortedFlatEntries!\}/);
});

test('sortedFlatEntries (fed into VirtualCatalogGrid) is derived from sortOption via sortTrainerLibraryFlatEntries — sort and virtualization compose correctly', () => {
  const source = readSource('src/app/pages/TrainerLibraryPage.tsx');
  assert.match(source, /const sortedFlatEntries = flatSortedEntries && sortOption !== 'a-z'/);
  assert.match(source, /sortTrainerLibraryFlatEntries\(flatCatalogEntries, sortOption, sortContext\)/);
});

test('Mission 12\'s real trainer-quality accuracy map flows into the same sortContext used by the virtualized flat view', () => {
  const source = readSource('src/app/pages/TrainerLibraryPage.tsx');
  assert.match(source, /trainerAccuracyByCatalogGameId/);
  const sortContextBlock = source.match(/const sortContext: AllGamesSortContext[\s\S]*?\};/)?.[0] ?? '';
  assert.match(sortContextBlock, /trainerAccuracyByCatalogGameId,/);
});

test("Mission 5 REVERSAL: every library section (including 'All Other Games') renders through SectionVirtualGrid, not chunked 'Show more' rendering or a bare unbounded map", () => {
  const source = readSource('src/app/pages/TrainerLibraryPage.tsx');
  const nonFlatBlock = source.match(/\{favoriteFilteredEvidence\.length > 0 && !flatAZView && \(([\s\S]*?)\n {6}\)\}/)?.[0] ?? '';
  assert.ok(nonFlatBlock.length > 0, 'expected to find the non-flat section-view render block');
  assert.doesNotMatch(nonFlatBlock, /\{games\.map\(\(g\) => renderLibraryCard\(g\)\)\}/, 'the old bare unbounded map must be gone');
  assert.doesNotMatch(nonFlatBlock, /clampSectionVisibleCount\(/, 'the rejected chunking approach must not be wired back in');
  assert.doesNotMatch(nonFlatBlock, /Show more \(/, 'the "Show N more" button UX is exactly what the owner rejected — see this file\'s header comment');
  assert.match(nonFlatBlock, /<SectionVirtualGrid/);
  assert.match(nonFlatBlock, /items=\{games\}/);
});

test('Mission 5 REVERSAL: the chunking module is no longer imported into the page (left in the repo, unused, as a record of the superseded approach)', () => {
  const source = readSource('src/app/pages/TrainerLibraryPage.tsx');
  assert.doesNotMatch(source, /from '\.\/trainer-library-section-chunking\.js'/);
  assert.ok(fs.existsSync(path.join(ROOT, 'src/app/pages/trainer-library-section-chunking.ts')), 'the module itself should still exist, just unused');
});

test('VirtualCatalogGrid computeColumnCount is a pure, deterministic function of container width (sanity check, no rendering required)', () => {
  assert.equal(computeColumnCount(1200), 3);
  assert.equal(computeColumnCount(300), 1);
  assert.equal(computeColumnCount(Number.NaN), 1);
  assert.equal(computeColumnCount(Number.POSITIVE_INFINITY), 1);
});

test('Mission 5 REVERSAL: computeVisibleRowRange keeps the mounted row window bounded no matter how large the underlying section is — the real proof behind "no giant DOM" for a thousands-of-games section', () => {
  const columnCount = 4;
  const rowStride = CARD_HEIGHT + GRID_GAP;
  const viewportHeight = 900; // a generous desktop viewport
  const maxPossibleVisibleRows = Math.ceil(viewportHeight / rowStride) + OVERSCAN_ROWS * 2 + 1;

  for (const totalGames of [150, 6800, 100_000]) {
    const rowCount = Math.ceil(totalGames / columnCount);
    // Simulate scrolling through the entire section in large jumps and
    // assert the mounted row window (and therefore mounted DOM node count)
    // never grows past a small constant bound, regardless of totalGames.
    for (let scrollTop = 0; scrollTop <= rowCount * rowStride; scrollTop += rowStride * 25) {
      const { firstVisibleRow, lastVisibleRow } = computeVisibleRowRange(
        scrollTop,
        viewportHeight,
        rowStride,
        rowCount,
        OVERSCAN_ROWS,
      );
      const mountedRows = lastVisibleRow - firstVisibleRow;
      const mountedCards = mountedRows * columnCount;
      assert.ok(
        mountedRows <= maxPossibleVisibleRows,
        `mounted row window (${mountedRows}) must never exceed the viewport+overscan bound (${maxPossibleVisibleRows}) for a ${totalGames}-game section`,
      );
      assert.ok(
        mountedCards <= maxPossibleVisibleRows * columnCount,
        `mounted card count (${mountedCards}) must stay bounded regardless of the ${totalGames}-game section's real size`,
      );
    }
  }
});

test('Mission 5 REVERSAL: filtering/sorting narrows the FULL underlying array before it ever reaches virtualization, so a filter applied mid-scroll still operates on the complete dataset', () => {
  const source = readSource('src/app/pages/TrainerLibraryPage.tsx');
  // organizedLibrary is built from favoriteFilteredEvidence (itself derived
  // from the full loaded entries via filterTrainerLibraryEntries and the
  // quick-tab/search narrowing above it) BEFORE any section is handed to
  // SectionVirtualGrid — virtualization only changes what is MOUNTED from
  // `games`, never what is INCLUDED in it.
  assert.match(source, /const organizedLibrary = organizeLibrary\(favoriteFilteredEvidence\);/);
  const nonFlatBlock = source.match(/\{favoriteFilteredEvidence\.length > 0 && !flatAZView && \(([\s\S]*?)\n {6}\)\}/)?.[0] ?? '';
  assert.match(nonFlatBlock, /const games = organizedLibrary\.sections\[sectionKey\];/);
  assert.match(nonFlatBlock, /<SectionVirtualGrid[\s\S]*?items=\{games\}/);
});
