import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CARD_HEIGHT,
  CARD_MIN_WIDTH,
  GRID_GAP,
  OVERSCAN_ROWS,
  computeColumnCount,
  computeVisibleRowRange,
} from './virtual-grid-math.js';

// Re-exported for backward compatibility — existing tests and call sites
// import computeColumnCount from this module. The real implementation now
// lives in virtual-grid-math.ts (Personal Library Completion — Final
// Closure Pass, Mission 5 reversal) so the "All Other Games" section's
// SectionVirtualGrid.tsx shares the exact same math instead of a second,
// independently-maintained copy.
export { computeColumnCount };

export interface VirtualCatalogGridProps<T> {
  items: T[];
  className?: string;
  gridClassName?: string;
  backToTopClassName?: string;
  backToTopLabel?: string;
  getKey: (item: T) => string;
  renderItem: (item: T) => React.ReactNode;
  onEndReached?: () => void;
  endReachedThresholdPx?: number;
  /** When true, renders a single column regardless of measured width — used for the library's "list" view mode. */
  forceSingleColumn?: boolean;
}

/**
 * Windowed grid for large trainer catalogs — only mounts visible rows (+ overscan).
 */
export function VirtualCatalogGrid<T>({
  items,
  className,
  gridClassName,
  backToTopClassName,
  backToTopLabel = 'Back to top',
  getKey,
  renderItem,
  onEndReached,
  endReachedThresholdPx = 480,
  forceSingleColumn = false,
}: VirtualCatalogGridProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 1200, height: 720 });
  const [scrollTop, setScrollTop] = useState(0);
  const endLockRef = useRef(false);

  const columnCount = useMemo(
    () => (forceSingleColumn ? 1 : computeColumnCount(viewport.width)),
    [forceSingleColumn, viewport.width],
  );

  const rowCount = Math.ceil(items.length / columnCount);
  const rowStride = CARD_HEIGHT + GRID_GAP;
  const totalHeight = rowCount > 0 ? rowCount * rowStride - GRID_GAP : 0;

  const { firstVisibleRow, lastVisibleRow } = useMemo(
    () => computeVisibleRowRange(scrollTop, viewport.height, rowStride, rowCount, OVERSCAN_ROWS),
    [scrollTop, viewport.height, rowStride, rowCount],
  );

  const visibleItems = useMemo(() => {
    const start = firstVisibleRow * columnCount;
    const end = lastVisibleRow * columnCount;
    return items.slice(start, end).map((item, index) => ({
      item,
      index: start + index,
    }));
  }, [items, firstVisibleRow, lastVisibleRow, columnCount]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setViewport({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(node);
    setViewport({ width: node.clientWidth, height: node.clientHeight });

    return () => observer.disconnect();
  }, []);

  const handleScroll = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    setScrollTop(node.scrollTop);

    if (!onEndReached) return;
    const remaining = node.scrollHeight - node.scrollTop - node.clientHeight;
    if (remaining <= endReachedThresholdPx) {
      if (endLockRef.current) return;
      endLockRef.current = true;
      onEndReached();
      window.setTimeout(() => {
        endLockRef.current = false;
      }, 400);
    }
  }, [onEndReached, endReachedThresholdPx]);

  const handleBackToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return (
    <div
      ref={scrollRef}
      className={className}
      onScroll={handleScroll}
      tabIndex={0}
      aria-label="Trainer catalog results"
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
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
      {scrollTop > 480 && (
        <button
          type="button"
          className={backToTopClassName}
          onClick={handleBackToTop}
          aria-label="Back to top of trainer catalog"
        >
          ↑ {backToTopLabel}
        </button>
      )}
    </div>
  );
}
