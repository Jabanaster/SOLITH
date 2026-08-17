/**
 * A real catalog update must only notify once catalog sync has succeeded at
 * least once before. The first-ever successful sync is initialization, not
 * an update the user should be told about.
 */
export function shouldNotifyCatalogUpdate(params: {
  hasSyncedBefore: boolean;
  importedCount: number;
}): boolean {
  if (!params.hasSyncedBefore) return false;
  return params.importedCount > 0;
}
