/**
 * Pure SHA256-based dedup helper, extracted from bulk-merge-ct-repos.mjs so
 * the dedup behavior itself (not just its downstream effect on shard files)
 * can be unit-tested directly.
 */

/**
 * Returns only the tables in `newTables` whose sourceSha256 is not already
 * present in `existingTables`. Order preserved; no mutation of either input.
 */
export function dedupeNewTablesBySha256(existingTables, newTables) {
  const existingHashes = new Set((existingTables ?? []).map((t) => t.sourceSha256));
  return (newTables ?? []).filter((t) => !existingHashes.has(t.sourceSha256));
}
