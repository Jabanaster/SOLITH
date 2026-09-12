/**
 * Canonical list of every navigable View id. This is the single source of
 * truth App.tsx's `View` type must stay a literal alias of — any view added
 * to one and not the other is a compile error via the exhaustiveness check
 * below, not a silent runtime gap.
 */
export const ALL_VIEWS = [
  'library', 'trainer', 'saves', 'data', 'discovery-lab', 'trainer-research',
  'recipes', 'proposal-inspector', 'backups', 'journal', 'locations', 'compatibility',
  'session-monitor', 'controls', 'live-memory', 'trainer-library',
  'catalog-save-controls', 'trainer-deck', 'registry-explorer', 'ct-library',
  'linked-libraries',
  'home', 'my-games', 'game-detail',
  // Discovery Master Pass: the enormous provider-neutral game-universe
  // browser + trainer-building entry point (NOT the legacy 'discovery-lab'
  // save-diffing tool above, which owns the old 'discovery' id's former
  // meaning) — see nav-views.ts's APP_SIDEBAR_VIEWS comment for why both
  // exist as distinct ids.
  'discovery', 'community',
  'settings',
] as const;

export type View = (typeof ALL_VIEWS)[number];

/**
 * Runtime allowlist check for a View id sourced from untrusted persisted or
 * IPC-derived data (e.g. a notification's `action.view`). Never trust such a
 * value through a bare `as View` cast — validate it here first.
 */
export function isValidView(value: string): value is View {
  return (ALL_VIEWS as readonly string[]).includes(value);
}

/**
 * Views that belong to the personal-library-first flow (Visual Library 2.0)
 * and are navigated via `<AppSidebar>` rather than the legacy
 * `<aside className="sidebar">` nav. App.tsx renders EXACTLY ONE of the two
 * nav surfaces for any given view — never both — by checking membership in
 * this list. Every view in ALL_VIEWS not listed here falls through to the
 * legacy sidebar, so the two lists partition ALL_VIEWS by construction (an
 * if/else on this membership check, not a second independent condition).
 *
 * Membership rationale:
 * - `home` / `my-games` / `discovery` / `community` / `backups` /
 *   `trainer-library` / `ct-library` / `linked-libraries`: AppSidebar's own
 *   static nav destinations — `home`/`my-games`/`discovery`/`community`/
 *   `backups` are the owner's five primary product destinations (Discovery
 *   Master Pass section 1); the other three are pre-existing personal-
 *   library-flow destinations kept as-is pending the Stage 4 nav
 *   consolidation audit.
 * - `game-detail`: reached only from Home/My Games game-card selection.
 * - `trainer-deck` / `catalog-save-controls`: reached only from
 *   TrainerLibraryPage's launch flow or GameDetailPage.
 * - `live-memory`: reached from TrainerDeckPage/GameDetailPage's "open live
 *   trainer" action; also listed (as a secondary entry point) in the legacy
 *   sidebar's Advanced section for users already in that nav — navigating
 *   there switches the sidebar to AppSidebar, which is expected, not a bug.
 *
 * `discovery-lab` (the legacy save-diffing/candidate-scanning tool) is
 * deliberately NOT here — it stays on the legacy NAV_SECTIONS nav until
 * Stage 3/4 relocates it into Trainer Deck -> Advanced's "Discover Values"
 * step, where it conceptually belongs.
 */
export const APP_SIDEBAR_VIEWS: readonly View[] = [
  'home',
  'my-games',
  'discovery',
  'community',
  'backups',
  'trainer-library',
  'ct-library',
  'linked-libraries',
  'game-detail',
  'trainer-deck',
  'catalog-save-controls',
  'live-memory',
];
