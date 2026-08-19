import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// 180px produced 10-11 columns at 2560px wide — cards that narrow read as a
// wall of near-identical tiles rather than distinct game entries. Raised to
// 300px so cards stay wide enough to carry a readable title, a short cover
// band, and one clear action at every breakpoint. Column count is derived
// from container width only (no fixed cap) so wide viewports use the full
// available width instead of leaving unused space beyond a capped count.
const CARD_MIN_WIDTH = 300;
// Re-measured after round 3: the cover band shrank from a 16:9 band (~169px
// at 300px wide) to a fixed 96px compact banner, and the card content lost
// its redundant tagline line — total rendered height is well under the
// previous 300px estimate.
const CARD_HEIGHT = 250;
const GRID_GAP = 20;
const OVERSCAN_ROWS = 2;

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
}: VirtualCatalogGridProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 1200, height: 720 });
  const [scrollTop, setScrollTop] = useState(0);
  const endLockRef = useRef(false);

  const columnCount = useMemo(() => computeColumnCount(viewport.width), [viewport.width]);

  const rowCount = Math.ceil(items.length / columnCount);
  const rowStride = CARD_HEIGHT + GRID_GAP;
  const totalHeight = rowCount > 0 ? rowCount * rowStride - GRID_GAP : 0;

  const firstVisibleRow = Math.max(0, Math.floor(scrollTop / rowStride) - OVERSCAN_ROWS);
  const visibleRowCount =
    Math.ceil(viewport.height / rowStride) + OVERSCAN_ROWS * 2 + 1;
  const lastVisibleRow = Math.min(rowCount, firstVisibleRow + visibleRowCount);

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
