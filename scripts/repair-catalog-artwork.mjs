#!/usr/bin/env node
/**
 * Guard-railed Trainer Catalog artwork reconciliation utility.
 *
 * Consumes a repair plan (the shape produced by the artwork-reconciliation
 * dry run — see Docs/Security/Evidence or the ad hoc dry-run output) and
 * either previews it (--dry-run, default) or applies it under strict
 * guards (--apply): SHA-256 precondition, per-row current-value guards,
 * a single transaction, backup-before-mutation, and post-apply integrity
 * checks. Categories A and B are the only categories this tool will ever
 * write — C/D/E/F/G/H are always rejected from --apply and, for C, are
 * only ever exported for manual review.
 *
 * Usage:
 *   node scripts/repair-catalog-artwork.mjs --db <path> --plan <repair-plan.json> [--dry-run]
 *   node scripts/repair-catalog-artwork.mjs --db <path> --plan <repair-plan.json> --apply \
 *     --expected-sha256 <hash> --backup-dir <dir> --allow-category A --allow-category B
 *   node scripts/repair-catalog-artwork.mjs --rollback <manifest-path>
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const ALLOWED_APPLY_CATEGORIES = new Set(['A', 'B']);
const CATEGORY_PREFIXES = {
  A: 'A. SAFE_AUTOMATIC_RESTORE',
  B: 'B. SAFE_SYNTHETIC_ART_REMOVAL',
  C: 'C. SAFE_SOURCE_REPAIR',
  D: 'D. ALREADY_CORRECT',
  E: 'E. AMBIGUOUS_IDENTITY',
  F: 'F. UNRESOLVED_NO_METADATA',
  G: 'G. MALFORMED_PROVIDER_RECORD',
  H: 'H. USER_OR_IMPORTED_PROTECTED',
};
const SYNTHETIC_THRESHOLD = 9_000_000;

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { allowCategories: [], apply: false, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    switch (a) {
      case '--db': args.db = argv[++i]; break;
      case '--plan': args.plan = argv[++i]; break;
      case '--dry-run': args.dryRun = true; break;
      case '--apply': args.apply = true; break;
      case '--backup-dir': args.backupDir = argv[++i]; break;
      case '--expected-sha256': args.expectedSha256 = argv[++i]; break;
      case '--allow-category': args.allowCategories.push(argv[++i]); break;
      case '--rollback': args.rollback = argv[++i]; break;
      case '--report': args.report = argv[++i]; break;
      case '--only': (args.only ??= []).push(argv[++i]); break;
      default:
        throw new UsageError(`Unknown argument: ${a}`);
    }
  }
  return args;
}

class UsageError extends Error {}
class GuardError extends Error {}

// ---------------------------------------------------------------------------
// Path / hash helpers
// ---------------------------------------------------------------------------

function assertAbsolutePath(label, p) {
  if (!p || p.trim() === '') throw new UsageError(`${label} must not be empty`);
  if (!path.isAbsolute(p)) throw new UsageError(`${label} must be an absolute path, got: ${p}`);
  return p;
}

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function fileMeta(filePath) {
  if (!fs.existsSync(filePath)) return { exists: false };
  const st = fs.statSync(filePath);
  return { exists: true, size: st.size, mtime: st.mtime.toISOString(), sha256: sha256File(filePath) };
}

function walShmSiblings(dbPath) {
  return { wal: `${dbPath}-wal`, shm: `${dbPath}-shm` };
}

// ---------------------------------------------------------------------------
// Plan loading / validation
// ---------------------------------------------------------------------------

function loadPlan(planPath) {
  const raw = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const rows = Array.isArray(raw) ? raw : raw.rows;
  if (!Array.isArray(rows)) throw new UsageError('Plan must be a JSON array of rows, or {rows: [...]}');
  const seen = new Set();
  for (const row of rows) {
    if (!row.catalogGameId || typeof row.catalogGameId !== 'string') {
      throw new UsageError(`Plan row missing catalogGameId: ${JSON.stringify(row)}`);
    }
    if (seen.has(row.catalogGameId)) {
      throw new UsageError(`Duplicate catalogGameId in plan: ${row.catalogGameId}`);
    }
    seen.add(row.catalogGameId);
    if (!row.repair_category) throw new UsageError(`Plan row missing repair_category: ${row.catalogGameId}`);
    const letter = row.repair_category.trim()[0];
    if (!CATEGORY_PREFIXES[letter]) {
      throw new UsageError(`Plan row has unknown category "${row.repair_category}": ${row.catalogGameId}`);
    }
  }
  return rows;
}

function categoryLetter(row) {
  return row.repair_category.trim()[0];
}

// ---------------------------------------------------------------------------
// Dry run (read-only preview — no mutation, no backup, no transaction)
// ---------------------------------------------------------------------------

function runDryRun(args) {
  const dbPath = assertAbsolutePath('--db', args.db);
  if (!fs.existsSync(dbPath)) throw new UsageError(`Database not found: ${dbPath}`);
  const before = fileMeta(dbPath);
  const { wal, shm } = walShmSiblings(dbPath);
  const walBefore = fileMeta(wal);
  const shmBefore = fileMeta(shm);

  const plan = loadPlan(assertAbsolutePath('--plan', args.plan));
  const byCategory = {};
  for (const row of plan) {
    const letter = categoryLetter(row);
    (byCategory[letter] ??= []).push(row);
  }

  const db = new DatabaseSync(dbPath, { readOnly: true });
  const rowById = new Map();
  const stmt = db.prepare(
    'SELECT catalogGameId, displayName, steamAppId, coverUrl, headerUrl, iconUrl, sourcesJson, verificationStatus FROM trainer_catalog_games WHERE catalogGameId = ?',
  );
  const staleRows = [];
  const missingRows = [];
  for (const row of plan) {
    const current = stmt.get(row.catalogGameId);
    if (!current) { missingRows.push(row.catalogGameId); continue; }
    rowById.set(row.catalogGameId, current);
    if (!currentValuesMatch(row, current)) staleRows.push(row.catalogGameId);
  }
  db.close();

  const after = fileMeta(dbPath);
  const walAfter = fileMeta(wal);
  const shmAfter = fileMeta(shm);

  const result = {
    mode: 'dry-run',
    database: dbPath,
    preAnalysisWalExists: walBefore.exists,
    preAnalysisShmExists: shmBefore.exists,
    before, after,
    unchanged: before.sha256 === after.sha256 && before.size === after.size && before.mtime === after.mtime,
    walUnchanged: JSON.stringify(walBefore) === JSON.stringify(walAfter),
    shmUnchanged: JSON.stringify(shmBefore) === JSON.stringify(shmAfter),
    planRowCount: plan.length,
    categoryCounts: Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, v.length])),
    staleRows,
    missingRows,
  };
  writeReport(args.report, result);
  result.exitCode = result.unchanged ? 0 : 1;
  return result;
}

function currentValuesMatch(planRow, dbRow) {
  const fields = ['steamAppId', 'coverUrl', 'headerUrl', 'iconUrl', 'sourcesJson'];
  for (const f of fields) {
    const expectedKey = `current_${f}`;
    if (!(expectedKey in planRow)) continue;
    const expected = planRow[expectedKey];
    const actual = dbRow[f];
    if ((expected ?? null) !== (actual ?? null)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

function createBackup(dbPath, backupDir) {
  assertAbsolutePath('--backup-dir', backupDir);
  const { wal, shm } = walShmSiblings(dbPath);
  if (fs.existsSync(wal) || fs.existsSync(shm)) {
    throw new GuardError('Refusing to back up: WAL/SHM sidecar files present — checkpoint or close the writer first so the backup is consistent.');
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(backupDir, `backup-${stamp}`);
  if (fs.existsSync(dir)) throw new GuardError(`Backup directory already exists, refusing to overwrite: ${dir}`);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, path.basename(dbPath));
  fs.copyFileSync(dbPath, dest);

  const sourceSha = sha256File(dbPath);
  const backupSha = sha256File(dest);
  if (sourceSha !== backupSha) {
    throw new GuardError(`Backup hash mismatch immediately after copy (source ${sourceSha} != backup ${backupSha}) — aborting.`);
  }

  // Verify the backup opens read-only and passes integrity/quick checks.
  const verifyDb = new DatabaseSync(dest, { readOnly: true });
  const quick = verifyDb.prepare('PRAGMA quick_check').all();
  const integrity = verifyDb.prepare('PRAGMA integrity_check').all();
  verifyDb.close();
  const quickOk = quick.length === 1 && quick[0].quick_check === 'ok';
  const integrityOk = integrity.length === 1 && integrity[0].integrity_check === 'ok';
  if (!quickOk || !integrityOk) {
    throw new GuardError(`Backup failed integrity verification: quick_check=${JSON.stringify(quick)} integrity_check=${JSON.stringify(integrity)}`);
  }

  const manifest = {
    createdAt: new Date().toISOString(),
    sourcePath: dbPath,
    sourceSha256: sourceSha,
    backupPath: dest,
    backupSha256: backupSha,
    backupSize: fs.statSync(dest).size,
    quickCheck: quick,
    integrityCheck: integrity,
  };
  fs.writeFileSync(path.join(dir, 'backup-manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

function runApply(args) {
  const dbPath = assertAbsolutePath('--db', args.db);
  if (!fs.existsSync(dbPath)) throw new UsageError(`Database not found: ${dbPath}`);
  if (!args.expectedSha256) throw new UsageError('--apply requires --expected-sha256');
  if (!args.backupDir) throw new UsageError('--apply requires --backup-dir');
  if (args.allowCategories.length === 0) throw new UsageError('--apply requires at least one --allow-category (A or B only)');
  for (const c of args.allowCategories) {
    if (!ALLOWED_APPLY_CATEGORIES.has(c)) {
      throw new UsageError(`--allow-category ${c} is not permitted for --apply. Only A and B may ever be auto-applied.`);
    }
  }

  const { wal, shm } = walShmSiblings(dbPath);
  if (fs.existsSync(wal) || fs.existsSync(shm)) {
    throw new GuardError('Refusing to apply: WAL/SHM sidecar files present — an active writer may exist. Close the application first.');
  }

  const actualSha = sha256File(dbPath);
  if (actualSha !== args.expectedSha256) {
    throw new GuardError(`Database hash mismatch. Expected ${args.expectedSha256}, got ${actualSha}. Refusing to apply — re-run --dry-run against the current database first.`);
  }

  const plan = loadPlan(assertAbsolutePath('--plan', args.plan));
  const allowSet = new Set(args.allowCategories);
  const scoped = args.only ? plan.filter((r) => args.only.includes(r.catalogGameId)) : plan;

  for (const row of scoped) {
    const letter = categoryLetter(row);
    if (!allowSet.has(letter)) {
      throw new GuardError(`Plan contains category ${letter} (${row.catalogGameId}) which is not in --allow-category. Refusing to apply any part of this plan.`);
    }
  }

  const backupManifest = createBackup(dbPath, args.backupDir);

  const db = new DatabaseSync(dbPath);
  const applied = [];
  const skippedStale = [];
  let rolledBack = false;

  try {
    db.exec('BEGIN IMMEDIATE');

    const preCount = db.prepare('SELECT COUNT(*) AS c FROM trainer_catalog_games').get().c;
    const preIds = new Set(db.prepare('SELECT catalogGameId FROM trainer_catalog_games').all().map((r) => r.catalogGameId));

    const selectStmt = db.prepare(
      'SELECT catalogGameId, steamAppId, coverUrl, headerUrl, iconUrl, sourcesJson FROM trainer_catalog_games WHERE catalogGameId = ?',
    );
    const updateStmt = db.prepare(`
      UPDATE trainer_catalog_games
      SET steamAppId = ?, coverUrl = ?, headerUrl = ?, iconUrl = ?, sourcesJson = ?, updatedAt = datetime('now')
      WHERE catalogGameId = ?
        AND steamAppId IS ?
        AND coverUrl IS ?
        AND headerUrl IS ?
        AND iconUrl IS ?
        AND sourcesJson = ?
    `);

    for (const row of scoped) {
      const current = selectStmt.get(row.catalogGameId);
      if (!current) { skippedStale.push({ catalogGameId: row.catalogGameId, reason: 'row not found' }); continue; }
      if (!currentValuesMatch(row, current)) {
        skippedStale.push({ catalogGameId: row.catalogGameId, reason: 'current-value guard mismatch' });
        continue;
      }
      const letter = categoryLetter(row);
      let newSteamAppId, newCover, newHeader, newIcon, newSources;
      if (letter === 'A') {
        newSteamAppId = row.proposed_steamAppId ?? null;
        newCover = row.proposed_coverUrl ?? null;
        newHeader = row.proposed_headerUrl ?? null;
        newIcon = row.proposed_iconUrl ?? null;
        newSources = row.proposed_sourcesJson ?? current.sourcesJson;
      } else if (letter === 'B') {
        if (current.steamAppId != null && current.steamAppId < SYNTHETIC_THRESHOLD) {
          skippedStale.push({ catalogGameId: row.catalogGameId, reason: 'steamAppId is not synthetic — refusing category B write' });
          continue;
        }
        newSteamAppId = null;
        newCover = null;
        newHeader = null;
        newIcon = null;
        newSources = current.sourcesJson;
      } else {
        // unreachable — filtered above — defensive stop.
        throw new GuardError(`Internal error: category ${letter} reached the apply loop`);
      }

      const info = updateStmt.run(
        newSteamAppId, newCover, newHeader, newIcon, newSources, row.catalogGameId,
        current.steamAppId, current.coverUrl, current.headerUrl, current.iconUrl, current.sourcesJson,
      );
      if (info.changes !== 1) {
        skippedStale.push({ catalogGameId: row.catalogGameId, reason: 'update affected 0 rows (race since guard check)' });
        continue;
      }
      applied.push({ catalogGameId: row.catalogGameId, category: letter });
    }

    const postCount = db.prepare('SELECT COUNT(*) AS c FROM trainer_catalog_games').get().c;
    const postIds = new Set(db.prepare('SELECT catalogGameId FROM trainer_catalog_games').all().map((r) => r.catalogGameId));
    if (postCount !== preCount) throw new GuardError(`Row count changed during apply: ${preCount} -> ${postCount}`);
    if (preIds.size !== postIds.size || [...preIds].some((id) => !postIds.has(id))) {
      throw new GuardError('Catalog identity set changed during apply — refusing to commit.');
    }
    const dupCheck = db.prepare('SELECT catalogGameId, COUNT(*) AS c FROM trainer_catalog_games GROUP BY catalogGameId HAVING c > 1').all();
    if (dupCheck.length > 0) throw new GuardError(`Duplicate catalogGameId introduced: ${JSON.stringify(dupCheck)}`);
    const collisionCheck = db.prepare(
      "SELECT steamAppId, COUNT(DISTINCT catalogGameId) AS c FROM trainer_catalog_games WHERE steamAppId IS NOT NULL GROUP BY steamAppId HAVING c > 1",
    ).all();
    if (collisionCheck.length > 0) throw new GuardError(`steamAppId collision introduced: ${JSON.stringify(collisionCheck)}`);

    const quick = db.prepare('PRAGMA quick_check').all();
    if (!(quick.length === 1 && quick[0].quick_check === 'ok')) {
      throw new GuardError(`Post-mutation quick_check failed: ${JSON.stringify(quick)}`);
    }

    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* no active transaction */ }
    rolledBack = true;
    db.close();
    const manifest = {
      mode: 'apply-failed', rolledBack: true, error: err.message,
      backupManifest, appliedBeforeFailure: applied, skippedStale,
      exitCode: 1,
    };
    writeReport(args.report, manifest);
    return manifest;
  }

  const integrity = db.prepare('PRAGMA integrity_check').all();
  db.close();

  const postSha = sha256File(dbPath);
  const manifest = {
    mode: 'apply', appliedAt: new Date().toISOString(), database: dbPath,
    preApplySha256: actualSha, postApplySha256: postSha,
    backupManifest, applied, skippedStale,
    appliedCount: applied.length, skippedCount: skippedStale.length,
    integrityCheck: integrity, rolledBack, exitCode: 0,
  };
  writeReport(args.report, manifest);
  return manifest;
}

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

function runRollback(args) {
  const manifestPath = assertAbsolutePath('--rollback', args.rollback);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.mode !== 'apply') throw new UsageError('Rollback manifest must be a successful apply manifest');

  const dbPath = args.db ? assertAbsolutePath('--db (override)', args.db) : manifest.database;
  if (!fs.existsSync(dbPath)) throw new UsageError(`Database not found: ${dbPath}`);

  const currentSha = sha256File(dbPath);
  if (currentSha !== manifest.postApplySha256) {
    throw new GuardError(`Current database hash (${currentSha}) does not match the manifest's recorded post-apply hash (${manifest.postApplySha256}). Refusing to roll back — the database may have changed since the apply this manifest describes.`);
  }

  const backupPath = manifest.backupManifest.backupPath;
  const backupSha = sha256File(backupPath);
  if (backupSha !== manifest.backupManifest.backupSha256) {
    throw new GuardError(`Backup file hash (${backupSha}) does not match the manifest's recorded backup hash (${manifest.backupManifest.backupSha256}). Refusing to roll back from a possibly-corrupted backup.`);
  }

  fs.copyFileSync(backupPath, dbPath);
  const restoredSha = sha256File(dbPath);
  if (restoredSha !== manifest.backupManifest.sourceSha256) {
    throw new GuardError(`Restored database hash (${restoredSha}) does not match the original pre-apply hash (${manifest.backupManifest.sourceSha256}) — restore is inconsistent.`);
  }

  const verifyDb = new DatabaseSync(dbPath, { readOnly: true });
  const quick = verifyDb.prepare('PRAGMA quick_check').all();
  const integrity = verifyDb.prepare('PRAGMA integrity_check').all();
  verifyDb.close();

  const report = {
    mode: 'rollback', rolledBackAt: new Date().toISOString(), database: dbPath,
    restoredFrom: backupPath, restoredSha256: restoredSha,
    quickCheck: quick, integrityCheck: integrity,
    success: restoredSha === manifest.backupManifest.sourceSha256,
  };
  report.exitCode = report.success ? 0 : 1;
  writeReport(args.report, report);
  return report;
}

// ---------------------------------------------------------------------------
// Report writing
// ---------------------------------------------------------------------------

function writeReport(reportPath, obj) {
  if (!reportPath) return;
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(obj, null, 2));
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function main(argv) {
  const args = parseArgs(argv);
  if (args.rollback) return runRollback(args);
  if (args.apply) return runApply(args);
  return runDryRun(args); // dry-run is the default even if --dry-run wasn't passed explicitly
}

function isMainModule() {
  if (!process.argv[1]) return false;
  const thisFile = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  return path.resolve(process.argv[1]) === path.resolve(thisFile);
}

if (isMainModule()) {
  try {
    const result = main(process.argv.slice(2));
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.exitCode ?? 0);
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`Usage error: ${err.message}`);
      process.exit(2);
    }
    if (err instanceof GuardError) {
      console.error(`Guard refused: ${err.message}`);
      process.exit(3);
    }
    throw err;
  }
}
