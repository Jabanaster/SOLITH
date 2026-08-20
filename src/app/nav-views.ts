/**
 * Canonical list of every navigable View id. This is the single source of
 * truth App.tsx's `View` type must stay a literal alias of — any view added
 * to one and not the other is a compile error via the exhaustiveness check
 * below, not a silent runtime gap.
 */
export const ALL_VIEWS = [
  'library', 'trainer', 'saves', 'data', 'discovery', 'trainer-research',
  'recipes', 'backups', 'journal', 'locations', 'compatibility',
  'session-monitor', 'controls', 'live-memory', 'trainer-library',
  'catalog-save-controls', 'trainer-deck', 'registry-explorer', 'ct-library',
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
