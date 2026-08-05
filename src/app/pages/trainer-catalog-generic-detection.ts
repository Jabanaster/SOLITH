import type { TrainerCatalogEntry } from '../../core/trainer-catalog/types.js';

/**
 * Detects catalog entries that never got real per-game data — remote-sync
 * imports with no curated reference fall through to a fixed fallback in
 * src/core/trainer-catalog/sync/remote-sync.ts: categories always
 * ['Action', 'Single Player'], cheatCount always 4 (commonCheats.length).
 * That fallback is never persisted as a flag, so this is a runtime
 * heuristic — matched narrowly against the exact fallback shape.
 *
 * Conservative by design: a false positive here (a real curated entry
 * mislabeled generic) suppresses legitimate metadata the owner already
 * confirmed exists, which is worse than a false negative (a genuinely
 * generic entry left showing its fallback metadata unchanged — a missed
 * cleanup, not a misrepresentation). Every check below is a requirement to
 * flag "generic" — any one failing means "leave it alone."
 */

const KNOWN_GENERIC_ONLY_PROVIDERS = new Set(['fling', 'mrantifun', 'plitch', 'remote-listing']);

export function isGenericTemplateEntry(entry: TrainerCatalogEntry): boolean {
  // A verified entry is never generic, regardless of shape — belt and
  // suspenders against a false positive on the tier that matters most.
  if (entry.verificationStatus === 'verified') return false;

  const categories = entry.categories;
  if (categories.length !== 2 || categories[0] !== 'Action' || categories[1] !== 'Single Player') {
    return false;
  }

  if (entry.cheatCount !== 4) return false;

  // Any curated-provider source (bundled/user/ct-import/solith-hub/
  // community/fearless) present anywhere on the entry means it isn't a
  // bare remote-sync fallback, even if the shape otherwise matches.
  if (entry.sources.length === 0) return false;
  const allKnownGenericOnly = entry.sources.every((s) => KNOWN_GENERIC_ONLY_PROVIDERS.has(s.provider));
  if (!allKnownGenericOnly) return false;

  return true;
}
