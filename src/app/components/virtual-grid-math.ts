/**
 * Shared pure windowing math for the trainer catalog's virtualized grids.
 *
 * Extracted from VirtualCatalogGrid.tsx (Personal Library Completion —
 * Final Closure Pass, Mission 5 reversal) so the flat "All Games" view's
 * own-scroll-container grid and the "All Other Games" section's
 * window-scroll grid share ONE windowing implementation instead of two
 * independently-maintained copies of the same row/column arithmetic. See
 * VirtualCatalogGrid.tsx and SectionVirtualGrid.tsx for the two render-site
 * consumers, and use-window-scroll-virtualization.ts for the window-scroll
 * position tracking that feeds this module's functions in the section case.
 */

// 180px produced 10-11 columns at 2560px wide — cards that narrow read as a
// wall of near-identical tiles rather than distinct game entries. Raised to
// 300px so cards stay wide enough to carry a readable title, a short cover
// band, and one clear action at every breakpoint. Column count is derived
// from container width only (no fixed cap) so wide viewports use the full
// available width instead of leaving unused space beyond a capped count.
export const CARD_MIN_WIDTH = 300;
// Re-measured after round 3: the cover band shrank from a 16:9 band (~169px
// at 300px wide) to a fixed 96px compact banner, and the card content lost
// its redundant tagline line — total rendered height is well under the
// previous 300px estimate.
export const CARD_HEIGHT = 250;
export const GRID_GAP = 20;
export const OVERSCAN_ROWS = 2;

/**
 * Pure so it can be unit-tested without rendering the component.
 * Guards against non-finite input (NaN/±Infinity) — a ResizeObserver
 * contentRect.width should never produce one, but Math.max(1, NaN) is NaN
 * and would otherwise propagate into gridTemplateColumns/rowCount as a
 * broken, non-numeric render.
 */
export function computeColumnCount(containerWidth: number): number {
  if (!Number.isFinite(containerWidth)) return 1;
  return Math.max(1, Math.floor((containerWidth + GRID_GAP) / (CARD_MIN_WIDTH + GRID_GAP)));
}

export interface VisibleRowRange {
  firstVisibleRow: number;
  lastVisibleRow: number;
}

/**
 * Given how far the user has scrolled into the grid's own content
 * (`scrollTop` — an internal `element.scrollTop` for a self-scrolling
 * container, or a computed "how far past this element's top the viewport
 * has scrolled" value for a window-scrolling one — see
 * use-window-scroll-virtualization.ts), returns the [first, last) row range
 * that should be mounted, including overscan on both sides. Pure and
 * independent of DOM/ResizeObserver/scroll-event plumbing so both scroll
 * strategies (and their tests) can share it.
 */
export function computeVisibleRowRange(
  scrollTop: number,
  viewportHeight: number,
  rowStride: number,
  rowCount: number,
  overscanRows: number = OVERSCAN_ROWS,
): VisibleRowRange {
  const safeScrollTop = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0;
  const safeViewportHeight = Number.isFinite(viewportHeight) ? Math.max(0, viewportHeight) : 0;
  const firstVisibleRow = Math.max(0, Math.floor(safeScrollTop / rowStride) - overscanRows);
  const visibleRowCount = Math.ceil(safeViewportHeight / rowStride) + overscanRows * 2 + 1;
  const lastVisibleRow = Math.min(rowCount, firstVisibleRow + visibleRowCount);
  return { firstVisibleRow, lastVisibleRow };
}
