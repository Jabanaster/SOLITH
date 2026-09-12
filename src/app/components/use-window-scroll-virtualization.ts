import { useCallback, useEffect, useRef, useState } from 'react';

export interface WindowScrollVirtualizationState {
  /** How far the user has scrolled past this element's own top edge (never negative). */
  scrollTop: number;
  /** The browser's visible viewport height — the window equivalent of a self-scrolling container's clientHeight. */
  viewportHeight: number;
  /** The element's own measured content width, for column-count math. */
  containerWidth: number;
}

/**
 * Tracks virtualization inputs for an element that lives in the page's own
 * natural (document/window) scroll flow, rather than owning its own
 * `overflow: auto` scroll container.
 *
 * Engineering note (Personal Library Completion — Final Closure Pass,
 * Mission 5 reversal): VirtualCatalogGrid's original windowing was tied to
 * `element.scrollTop` fired from its own `onScroll` handler — that binds it
 * to being its own scroll container. It is NOT fundamentally tied to that,
 * though: the same "how far down has the user scrolled past this content's
 * top" quantity can be computed for a plain in-flow element from
 * `element.getBoundingClientRect().top` relative to the viewport instead of
 * from an internal scrollTop. When a normally-flowing element's top has
 * scrolled above the viewport, `getBoundingClientRect().top` goes negative
 * by exactly the distance scrolled into it — `-rect.top` is the window-scroll
 * equivalent of `element.scrollTop`. That is exactly what this hook computes,
 * driven by `window`'s own `scroll`/`resize` events (rAF-throttled) instead
 * of the element's own `onScroll`, plus a ResizeObserver for width (same
 * purpose as VirtualCatalogGrid's, just measuring a non-scrolling element).
 *
 * This works correctly even as sibling content above the container changes
 * height (collapsing/expanding another library section, for example),
 * because the bounding-rect read happens fresh on every scroll/resize tick
 * rather than caching a one-time document-coordinate offset.
 */
export function useWindowScrollVirtualization(): WindowScrollVirtualizationState & {
  containerRef: React.RefObject<HTMLDivElement | null>;
} {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<WindowScrollVirtualizationState>({
    scrollTop: 0,
    viewportHeight: typeof window === 'undefined' ? 720 : window.innerHeight,
    containerWidth: 1200,
  });
  const rafRef = useRef<number | null>(null);

  const measure = useCallback(() => {
    const node = containerRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    setState({
      scrollTop: Math.max(0, -rect.top),
      viewportHeight: window.innerHeight,
      containerWidth: rect.width,
    });
  }, []);

  const scheduleMeasure = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      measure();
    });
  }, [measure]);

  useEffect(() => {
    measure();
    // `capture: true` is load-bearing, not a style preference: the app shell
    // (src/app/styles/index.css's `.content-area`) scrolls via its own
    // `overflow-y: auto` region (`<main class="content-area">`), not the
    // document/window — a 'scroll' event fired on that div does NOT bubble
    // to `window` (native DOM scroll events never bubble past their target).
    // A bubble-phase `window.addEventListener('scroll', ...)` therefore never
    // fires for real user scrolling and this hook's `scrollTop` freezes at
    // whatever the first incidental remeasure (mount / resize /
    // ResizeObserver tick) produced — confirmed by direct reproduction:
    // scrolling `.content-area` from 0% to 100% never changed the mounted
    // row window. Listening in the CAPTURE phase on `window` still sees every
    // scroll event in the document, including ones whose target is a nested
    // scrollable element, because the capture phase walks window -> ... ->
    // target regardless of that event's own `bubbles` flag.
    window.addEventListener('scroll', scheduleMeasure, { passive: true, capture: true });
    window.addEventListener('resize', scheduleMeasure);

    const node = containerRef.current;
    let observer: ResizeObserver | undefined;
    if (node && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(scheduleMeasure);
      observer.observe(node);
    }

    return () => {
      window.removeEventListener('scroll', scheduleMeasure, { capture: true });
      window.removeEventListener('resize', scheduleMeasure);
      observer?.disconnect();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [measure, scheduleMeasure]);

  return { containerRef, ...state };
}
