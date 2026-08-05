import type { TrainerCatalogEntry } from '../../core/trainer-catalog/types.js';
import { isGenericTemplateEntry } from './trainer-catalog-generic-detection.js';

/**
 * Default ("installed first") catalog ordering — Candidate C from the
 * round-4 corrective pass: verification-tier priority, then a deterministic
 * provider/title-lane interleave within the generic tier only.
 *
 * Why interleave instead of a plain tier+alphabetical sort: alphabetical
 * sort alone clusters same-provider scrape batches (e.g. thirteen
 * "12 Labours of Hercules" entries from one mrantifun listing) into one
 * uninterrupted run. Grouping by provider then title-lane and emitting
 * round-robin breaks up both causes of clustering without randomness — the
 * same catalog state always produces the same order.
 */

type Tier = 0 | 1 | 2 | 3; // 0 installed, 1 verified, 2 curated/community, 3 generic

function tierOf(entry: TrainerCatalogEntry, installedIds: Set<string>): Tier {
  if (installedIds.has(entry.catalogGameId)) return 0;
  if (entry.verificationStatus === 'verified') return 1;
  if (!isGenericTemplateEntry(entry)) return 2;
  return 3;
}

function providerKey(entry: TrainerCatalogEntry): string {
  return entry.sources[0]?.provider ?? 'unknown';
}

// A single leading character collapses too many real titles into one lane
// (many scraped generic titles start with a digit — "007 First Light",
// "10 Miles To Safety", "112 Operator" all lead with different digits but
// would share a lane at length 1 far too often at low-thousands scale).
// Four normalized characters is still a literal, visible title prefix (not
// a hash) and separates most distinct titles while remaining deterministic.
// It does NOT separate same-franchise numbered-sequel titles that share an
// identical prefix (e.g. "12 Labours of Hercules I" vs "...II" vs "...III")
// — no prefix-based lane can, since their only difference is a suffix; that
// specific pattern needs franchise/variant grouping (deferred, Phase 3).
const TITLE_LANE_LENGTH = 4;

function titleLane(displayName: string): string {
  const alnumChars = displayName.match(/[\p{L}\p{N}]/gu) ?? [];
  return alnumChars.slice(0, TITLE_LANE_LENGTH).join('').toUpperCase() || '?';
}

function interleaveByBucket(tierEntries: TrainerCatalogEntry[]): TrainerCatalogEntry[] {
  const buckets = new Map<string, TrainerCatalogEntry[]>();
  const bucketOrder: string[] = [];
  for (const entry of tierEntries) {
    const key = `${providerKey(entry)}::${titleLane(entry.displayName)}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
      bucketOrder.push(key);
    }
    bucket.push(entry);
  }
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => a.displayName.localeCompare(b.displayName));
  }
  const result: TrainerCatalogEntry[] = [];
  for (let row = 0; result.length < tierEntries.length; row += 1) {
    for (const key of bucketOrder) {
      const bucket = buckets.get(key)!;
      if (row < bucket.length) result.push(bucket[row]);
    }
  }
  return result;
}

/**
 * Pure — returns a new array, never mutates `entries`. Same input always
 * produces the same output.
 */
export function orderCatalogDefault(
  entries: TrainerCatalogEntry[],
  installedIds: Set<string>,
): TrainerCatalogEntry[] {
  const tiers: TrainerCatalogEntry[][] = [[], [], [], []];
  for (const entry of entries) {
    tiers[tierOf(entry, installedIds)].push(entry);
  }
  return tiers.flatMap((tierEntries) => interleaveByBucket(tierEntries));
}
