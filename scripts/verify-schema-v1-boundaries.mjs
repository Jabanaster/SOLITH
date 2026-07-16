/**
 * Phase 5 — schema.v1 hard boundary checks (import bans + deleted-catalog drift).
 *
 * Execution domains must not import presentation-only cheat-system SoT
 * (`games.ts` / `ALL_GAMES`). Deleted legacy catalog paths must not reappear.
 *
 * Presentation catalogs (`src/core/cheat-system/games.ts`, game-profiles support
 * matrix) remain allowed for UI / seed materialization outside execute domains.
 *
 * Exit 0 on PASS, 1 on FAIL.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Domains that must never import ALL_GAMES / cheat-system/games as execute SoT. */
const EXECUTE_DOMAINS = [
  path.join(ROOT, 'src', 'core', 'live-memory'),
  path.join(ROOT, 'src', 'core', 'trainer-host'),
];

/** Also scan Electron IPC that wires execute paths. */
const EXECUTE_IPC_GLOBS = [
  path.join(ROOT, 'electron', 'live-memory-ipc.ts'),
  path.join(ROOT, 'electron', 'trainer-host'),
];

/** Paths that must remain deleted after Phase 4. */
const MUST_STAY_DELETED = [
  path.join(ROOT, 'src', 'core', 'live-memory', 'live-control-catalog.ts'),
  path.join(ROOT, 'src', 'core', 'game-profiles', 'profiles', 'stardew-valley.json'),
  path.join(ROOT, 'tests', 'live-memory', 'live-control-catalog.test.ts'),
];

function walkTsFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  const st = fs.statSync(dir);
  if (st.isFile()) {
    if (/\.(ts|tsx|mts|cts)$/.test(dir)) out.push(dir);
    return out;
  }
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'dist-electron') continue;
    walkTsFiles(path.join(dir, name), out);
  }
  return out;
}

function collectExecuteFiles() {
  const files = [];
  for (const domain of EXECUTE_DOMAINS) {
    walkTsFiles(domain, files);
  }
  for (const p of EXECUTE_IPC_GLOBS) {
    walkTsFiles(p, files);
  }
  return [...new Set(files)];
}

function scanFileForForbidden(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const hits = [];
  // ALL_GAMES alone is too noisy in comments — require import-ish context for ALL_GAMES
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;

    if (/from\s+['"][^'"]*cheat-system\/games/.test(line) || /import\s*\(\s*['"][^'"]*cheat-system\/games/.test(line)) {
      hits.push({ line: i + 1, text: trimmed, rule: 'cheat-system/games import' });
    }
    if (/\bALL_GAMES\b/.test(line) && /(import|from|require)\b/.test(line)) {
      hits.push({ line: i + 1, text: trimmed, rule: 'ALL_GAMES import' });
    }
    if (/live-control-catalog/.test(line) && /(import|from|require)\b/.test(line)) {
      hits.push({ line: i + 1, text: trimmed, rule: 'deleted live-control-catalog import' });
    }
    if (/stardew-valley\.json/.test(line) && /(import|from|require)\b/.test(line)) {
      hits.push({ line: i + 1, text: trimmed, rule: 'deleted stardew-valley.json import' });
    }
  }
  return hits;
}

/**
 * Repo-wide: no imports of deleted legacy catalog modules (any domain).
 */
function scanRepoForDeletedImports() {
  const roots = [
    path.join(ROOT, 'src'),
    path.join(ROOT, 'electron'),
    path.join(ROOT, 'tests'),
  ];
  const files = [];
  for (const r of roots) walkTsFiles(r, files);
  const failures = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*\/\//.test(line) || /^\s*\*/.test(line)) continue;
      if (
        /(import|from|require)\b/.test(line) &&
        (/live-control-catalog/.test(line) || /profiles\/stardew-valley\.json/.test(line))
      ) {
        failures.push({
          file: path.relative(ROOT, file),
          line: i + 1,
          text: line.trim(),
          rule: 'import of deleted legacy catalog',
        });
      }
    }
  }
  return failures;
}

export function runSchemaV1BoundaryChecks({ silent = false } = {}) {
  const failures = [];

  for (const deleted of MUST_STAY_DELETED) {
    if (fs.existsSync(deleted)) {
      failures.push({
        file: path.relative(ROOT, deleted),
        line: 0,
        text: 'file exists',
        rule: 'deleted legacy catalog must stay deleted',
      });
    }
  }

  for (const file of collectExecuteFiles()) {
    const hits = scanFileForForbidden(file);
    for (const hit of hits) {
      failures.push({
        file: path.relative(ROOT, file),
        line: hit.line,
        text: hit.text,
        rule: hit.rule,
      });
    }
  }

  failures.push(...scanRepoForDeletedImports());

  if (!silent) {
    if (failures.length === 0) {
      console.log('PASS: schema.v1 boundary checks');
      console.log('  - execute domains free of ALL_GAMES / cheat-system/games imports');
      console.log('  - deleted legacy catalogs remain absent');
      console.log('  - presentation catalogs (cheat-system / support-matrix) not treated as orphans');
    } else {
      console.error('FAIL: schema.v1 boundary violations:');
      for (const f of failures) {
        console.error(`  [${f.rule}] ${f.file}:${f.line}  ${f.text}`);
      }
    }
  }

  return { ok: failures.length === 0, failures };
}

const isMain =
  process.argv[1] &&
  path.normalize(path.resolve(process.argv[1])) === path.normalize(fileURLToPath(import.meta.url));
if (isMain) {
  const result = runSchemaV1BoundaryChecks();
  process.exit(result.ok ? 0 : 1);
}
