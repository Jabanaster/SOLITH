import React, { useMemo } from 'react';
import {
  CARD_HEIGHT,
  CARD_MIN_WIDTH,
  GRID_GAP,
  OVERSCAN_ROWS,
  computeColumnCount,
  computeVisibleRowRange,
} from './virtual-grid-math.js';
import { useWindowScrollVirtualization } from './use-window-scroll-virtualization.js';

export interface SectionVirtualGridProps<T> {
  items: T[];
  gridClassName?: string;
  getKey: (item: T) => string;
  renderItem: (item: T) => React.ReactNode;
  ariaLabel?: string;
  /**
   * When true, renders a single column regardless of measured width — used
   * for the library's "list" view mode. Windowing math (row math, overscan)
   * is otherwise identical; only the column count input changes.
   */
  forceSingleColumn?: boolean;
}

/**
 * Windowed grid for large trainer catalog sections that must stay inside the
 * page's own natural scroll — no nested `overflow: auto` scrollbox.
 *
 * This is the "All Other Games" section's real virtualization (Personal
 * Library Completion — Final Closure Pass, Mission 5 reversal), replacing
 * the earlier `trainer-library-section-chunking.ts` "Show N more" chunking.
 * It shares its row/column windowing math with the flat "All Games" view's
 * VirtualCatalogGrid (see virtual-grid-math.ts) and only swaps out HOW
 * scroll position is measured: VirtualCatalogGrid owns its own scroll
 * container and reads `element.scrollTop`; this component stays in the
 * page's normal flow and reads its own bounding-rect offset from the
 * viewport instead (see use-window-scroll-virtualization.ts for why that is
 * an equivalent, real technique, not an approximation).
 */
export function SectionVirtualGrid<T>({
  items,
  gridClassName,
  getKey,
  renderItem,
  ariaLabel,
  forceSingleColumn = false,
}: SectionVirtualGridProps<T>) {
  const { containerRef, scrollTop, viewportHeight, containerWidth } = useWindowScrollVirtualization();

  const columnCount = useMemo(
    () => (forceSingleColumn ? 1 : computeColumnCount(containerWidth)),
    [forceSingleColumn, containerWidth],
  );
  const rowCount = Math.ceil(items.length / columnCount);
  const rowStride = CARD_HEIGHT + GRID_GAP;
  const totalHeight = rowCount > 0 ? rowCount * rowStride - GRID_GAP : 0;

  const { firstVisibleRow, lastVisibleRow } = useMemo(
    () => computeVisibleRowRange(scrollTop, viewportHeight, rowStride, rowCount, OVERSCAN_ROWS),
    [scrollTop, viewportHeight, rowStride, rowCount],
  );

  const visibleItems = useMemo(() => {
    const start = firstVisibleRow * columnCount;
    const end = lastVisibleRow * columnCount;
    return items.slice(start, end).map((item, index) => ({
      item,
      index: start + index,
    }));
  }, [items, firstVisibleRow, lastVisibleRow, columnCount]);

  return (
    // `overflow: hidden` is load-bearing, not cosmetic: `totalHeight` is
    // computed from the fixed CARD_HEIGHT/GRID_GAP constants (virtual-grid-
    // math.ts), not from the actual rendered height of this section's cards.
    // When a section has very few rows, any mismatch between that assumed
    // row height and a card's real rendered height (wrapped title text, a
    // taller cover image, etc.) let the absolutely-positioned grid below
    // spill past this wrapper's bottom edge. The wrapper's own box was still
    // only `totalHeight` tall, so the *next* section's header rendered
    // directly in that same screen position — the overflowing (but visually
    // near-invisible, un-hit-tested-looking) grid content sat on top of it in
    // the stacking order and silently absorbed the click meant for the next
    // section's collapse/expand toggle button (confirmed: a real Playwright
    // click did nothing while a raw `.click()` DOM-dispatch, which bypasses
    // hit-testing, worked). Clipping to the wrapper's own box guarantees a
    // section can never visually or interactively extend into its neighbor,
    // regardless of how card content height drifts from the estimate.
    <div
      ref={containerRef}
      style={{ position: 'relative', height: totalHeight, overflow: 'hidden' }}
      role="group"
      aria-label={ariaLabel}
    >
      <div
        className={gridClassName}
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${columnCount}, minmax(${CARD_MIN_WIDTH}px, 1fr))`,
          gap: GRID_GAP,
          position: 'absolute',
          top: firstVisibleRow * rowStride,
          left: 0,
          right: 0,
        }}
      >
        {visibleItems.map(({ item }) => (
          <div key={getKey(item)} style={{ minHeight: CARD_HEIGHT }}>
            {renderItem(item)}
          </div>
        ))}
      </div>
    </div>
  );
}

export default SectionVirtualGrid;
