/**
 * Shared "this is not a game name" guard for CT ingestion tooling
 * (merge-ct-tables.mjs, bulk-merge-ct-repos.mjs). A folder or directory
 * basename matching this is a generic container (a repo's own name, a
 * scratch/tools folder, a bare "tables"/"data" dump) — never trust it as a
 * game display name, even when files are genuinely found inside it.
 *
 * Grown reactively from real pollution found in the roster:
 *   - "tables" / "cheatengine-tables-master" / "cheatenginetables-master"
 *     entered via merge-ct-tables.mjs's `--dir` fallback
 *     (path.basename(dir) used as the game name with no validation).
 */
const GENERIC_CONTAINER_NAMES = new Set([
  'cheat-tables', 'cheat tables', 'tables', 'table', 'vault',
  'zz_tools', 'zz tools', 'zz_others', 'zz others',
  'users scripts', 'scripts', 'data', 'ct', 'files',
  'cheatengine-tables-master', 'cheatenginetables-master',
]);

const JUNK_NAME_PATTERN = /cheat.?engine.?tutorial|^tutorial|cheat.?engine.?tables?[-_ ]?(master|main)$/i;

export function isGenericContainerName(name) {
  const key = name.toLowerCase().trim();
  return GENERIC_CONTAINER_NAMES.has(key) || JUNK_NAME_PATTERN.test(name);
}
