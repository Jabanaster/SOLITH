import { getGameById } from '../games/index.js';
import { getCatalogEntry } from '../trainer-catalog/store.js';
import { getInstallPathForCatalogGame } from '../install-discovery/store.js';

export interface DiscoveryContext {
  gameId: string;
  displayName: string;
  installPath?: string;
}

/** Resolve a display name and optional install folder for save discovery. */
export function resolveDiscoveryContext(gameId: string): DiscoveryContext | null {
  const registered = getGameById(gameId);
  if (registered) {
    return {
      gameId,
      displayName: registered.name,
      installPath: registered.path,
    };
  }

  const catalog = getCatalogEntry(gameId);
  if (catalog) {
    return {
      gameId,
      displayName: catalog.displayName,
      installPath: getInstallPathForCatalogGame(gameId),
    };
  }

  return null;
}
