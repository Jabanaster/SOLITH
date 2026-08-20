/** ROADMAP §5.5 "skip redundant automatic check if last success < ~24h". */
export const CATALOG_UPDATE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * A missing or unparseable `lastSuccessAt` fails OPEN (checks) rather than
 * silently skipping forever — the cooldown exists to avoid redundant
 * network chatter, not to ever permanently suppress catalog growth.
 */
export function shouldCheckForCatalogUpdate(lastSuccessAt: string | null, now: Date): boolean {
  if (!lastSuccessAt) return true;
  const last = Date.parse(lastSuccessAt);
  if (Number.isNaN(last)) return true;
  return now.getTime() - last >= CATALOG_UPDATE_COOLDOWN_MS;
}
