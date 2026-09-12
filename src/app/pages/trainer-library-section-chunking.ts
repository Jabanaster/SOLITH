/**
 * REVERSAL NOTICE (2026-09-10, Personal Library Completion — Final Closure
 * Pass, Mission 5 REVERSAL): the owner has explicitly REJECTED the chunked
 * "Show N more" approach documented below as a permanent solution. It has
 * been replaced in TrainerLibraryPage.tsx by real virtualization
 * (SectionVirtualGrid, src/app/components/SectionVirtualGrid.tsx) reusing
 * the same windowing architecture as the flat "All Games" view's
 * VirtualCatalogGrid (see virtual-grid-math.ts for the shared math and
 * use-window-scroll-virtualization.ts for the window-scroll adaptation).
 * This module is no longer imported by TrainerLibraryPage.tsx. It is left
 * in place, unused, purely as a record of the superseded approach — its
 * pure functions are still exercised by tests/trainer-library-section-
 * chunking.test.ts in isolation, but that test proves this module's OWN
 * logic, not anything about the current render path. See
 * tests/trainer-library-virtualization-coverage.test.ts for the current
 * proof of what actually renders "All Other Games" today.
 *
 * Trainer Library — chunked ("Show N more") rendering for the non-flat
 * section hierarchy's card lists (Personal Library Completion — Final
 * Closure Pass, Mission 5).
 *
 * The expanded "All Other Games" section (library-sections.ts's 'other'
 * section, where most of the ~6,800-entry catalog lands once nothing is
 * installed/owned/favorited) used to render every item directly via a bare
 * `.map()` once expanded — thousands of simultaneously-mounted card DOM
 * nodes with no bound (see tests/trainer-library-virtualization-coverage.test.ts's
 * prior "KNOWN GAP" documentation).
 *
 * The obvious fix — reusing VirtualCatalogGrid (already used by the flat
 * "All Games" view) — was investigated and rejected for this call site:
 * VirtualCatalogGrid virtualizes against ITS OWN internal scroll container
 * (a ResizeObserver on its own div, using that div's own `scrollTop`), not
 * the page's document/window scroll position. Reusing it here would nest a
 * fixed-height `overflow: auto` scroll box for one section inside the
 * page's existing natural page scroll — a second, inner scrollbar the owner
 * explicitly rejected ("a single natural page scroll experience"). Adapting
 * VirtualCatalogGrid itself to track window-scroll instead of its own
 * internal scrollTop is a real, non-trivial rework (every visible-range
 * calculation, its ResizeObserver, and its own scroll-container callers —
 * the flat "All Games" view — would all need re-verification), too large a
 * blast-radius change for this pass to make with confidence.
 *
 * Instead: simple chunked/incremental rendering. A section renders only its
 * first `INITIAL_SECTION_VISIBLE_COUNT` games; a "Show N more" control grows
 * that count by `SECTION_VISIBLE_STEP` at a time. This keeps a single
 * natural page scroll (no nested scrollbox at all) while keeping the number
 * of simultaneously-mounted card DOM nodes bounded regardless of how many
 * thousand games are in the underlying section — see
 * tests/trainer-library-section-chunking.test.ts for the proof, and
 * tests/trainer-library-virtualization-coverage.test.ts for the updated
 * "gap closed" note.
 */

export const INITIAL_SECTION_VISIBLE_COUNT = 150;
export const SECTION_VISIBLE_STEP = 150;

/**
 * The number of games from a section's list that should actually be
 * rendered right now. Never exceeds the section's real length (so a
 * previously-grown count survives a shrinking data set, e.g. after a
 * search, without ever slicing past the end) and never negative.
 */
export function clampSectionVisibleCount(totalGames: number, requestedVisibleCount: number): number {
  const bounded = Math.max(0, requestedVisibleCount);
  return Math.min(totalGames, bounded);
}

/**
 * The next requested visible count after a "Show more" click — grows by
 * SECTION_VISIBLE_STEP from wherever it currently is, never past the
 * section's real length (so the resulting button never claims there is
 * more to show than actually exists).
 */
export function nextSectionVisibleCount(totalGames: number, currentVisibleCount: number): number {
  return Math.min(totalGames, currentVisibleCount + SECTION_VISIBLE_STEP);
}

/** How many additional games the next "Show more" click will reveal — for the button's own label. */
export function remainingAfterVisible(totalGames: number, currentVisibleCount: number): number {
  return Math.max(0, totalGames - currentVisibleCount);
}
