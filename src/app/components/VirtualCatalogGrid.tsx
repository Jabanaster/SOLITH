import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const CARD_MIN_WIDTH = 180;
const CARD_HEIGHT = 390;
const GRID_GAP = 16;
const OVERSCAN_ROWS = 2;

export interface VirtualCatalogGridProps<T> {
  items: T[];
  className?: string;
  gridClassName?: string;
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
  getKey,
  renderItem,
  onEndReached,
  endReachedThresholdPx = 480,
}: VirtualCatalogGridProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 1200, height: 720 });
  const [scrollTop, setScrollTop] = useState(0);
  const endLockRef = useRef(false);

  const columnCount = useMemo(
    () => Math.max(1, Math.floor((viewport.width + GRID_GAP) / (CARD_MIN_WIDTH + GRID_GAP))),
    [viewport.width],
  );

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

  return (
    <div ref={scrollRef} className={className} onScroll={handleScroll}>
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
    </div>
  );
}
