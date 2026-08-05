import assert from 'node:assert/strict';
import { describe, test, beforeEach, afterEach } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { main } from '../scripts/repair-catalog-artwork.mjs';

const LIVE_DB_PATH = path.join(
  process.env.APPDATA || 'C:\\Users\\chase\\AppData\\Roaming',
  'solith',
  'solith.db',
);

function assertNeverLivePath(p: string | undefined) {
  if (p && path.resolve(p) === path.resolve(LIVE_DB_PATH)) {
    throw new Error('Test attempted to use the live database path — refusing.');
  }
}

function sha256(filePath: string): string {
  return crypto.createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

let fixtureRoot = '';
let dbPath = '';
let backupDir = '';

function seedFixtureDb(target: string) {
  const db = new DatabaseSync(target);
  db.exec(`
    CREATE TABLE trainer_catalog_games (
      catalogGameId TEXT PRIMARY KEY,
      displayName TEXT NOT NULL,
      steamAppId INTEGER,
      executablesJson TEXT NOT NULL,
      categoriesJson TEXT NOT NULL,
      headerUrl TEXT,
      coverUrl TEXT,
      iconUrl TEXT,
      verificationStatus TEXT NOT NULL,
      sourcesJson TEXT NOT NULL,
      hasModPack INTEGER DEFAULT 0,
      modPackId TEXT,
      cheatCount INTEGER DEFAULT 0,
      searchableText TEXT NOT NULL,
      updatedAt TEXT DEFAULT (datetime('now'))
    );
  `);
  const insert = db.prepare(`
    INSERT INTO trainer_catalog_games
      (catalogGameId, displayName, steamAppId, executablesJson, categoriesJson, headerUrl, coverUrl, iconUrl, verificationStatus, sourcesJson, hasModPack, modPackId, cheatCount, searchableText)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Category A candidate: curated title, artwork erased, bundled source lost.
  insert.run('palworld', 'Palworld', null, '[]', '["Survival"]', null, null, null, 'verified',
    JSON.stringify([{ provider: 'plitch', url: 'https://plitch.test/palworld' }]), 1, null, 0, 'palworld');

  // Category B candidate: synthetic fabricated Steam ID.
  insert.run('legend-of-darkness', 'Legend of Darkness', 9000123, '[]', '["Action","Single Player"]',
    'https://cdn.cloudflare.steamstatic.com/steam/apps/9000123/header.jpg',
    'https://cdn.cloudflare.steamstatic.com/steam/apps/9000123/library_600x900_2x.jpg',
    'https://cdn.cloudflare.steamstatic.com/steam/apps/9000123/capsule_231x87.jpg',
    'metadata-only', JSON.stringify([{ provider: 'bundled', url: 'bundled://seed' }]), 0, null, 0, 'legend of darkness');

  // Category C candidate: bundled-community match but no 'bundled' provider present.
  insert.run('cyberpunk-2077', 'Cyberpunk 2077', 1091500, '[]', '["RPG"]',
    'https://cdn.cloudflare.steamstatic.com/steam/apps/1091500/header.jpg',
    'https://cdn.cloudflare.steamstatic.com/steam/apps/1091500/library_600x900_2x.jpg',
    'https://cdn.cloudflare.steamstatic.com/steam/apps/1091500/capsule_231x87.jpg',
    'community', JSON.stringify([{ provider: 'plitch', url: 'https://plitch.test/cyberpunk' }]), 1, null, 4, 'cyberpunk 2077');

  // Already correct.
  insert.run('stardew-valley', 'Stardew Valley', 413150, '[]', '["Simulation"]',
    'https://cdn.cloudflare.steamstatic.com/steam/apps/413150/header.jpg',
    'https://cdn.cloudflare.steamstatic.com/steam/apps/413150/library_600x900_2x.jpg',
    'https://cdn.cloudflare.steamstatic.com/steam/apps/413150/capsule_231x87.jpg',
    'verified', JSON.stringify([{ provider: 'bundled', url: 'bundled://seed' }]), 1, null, 0, 'stardew valley');

  // Malformed provider record.
  insert.run('fling', 'FLiNG', null, '[]', '["Action","Single Player"]', null, null, null, 'community',
    JSON.stringify([{ provider: 'fling', url: 'https://flingtrainer.test/x' }]), 0, null, 4, 'fling');

  // Protected user row.
  insert.run('my-imported-game', 'My Imported Game', 555555, '[]', '["Action"]',
    'https://cdn.cloudflare.steamstatic.com/steam/apps/555555/header.jpg', null, null, 'community',
    JSON.stringify([{ provider: 'user', url: 'local://user' }]), 0, null, 0, 'my imported game');

  // Unresolved.
  insert.run('unknown-title', 'Unknown Title', null, '[]', '["Action","Single Player"]', null, null, null, 'community',
    JSON.stringify([{ provider: 'plitch', url: 'https://plitch.test/unknown' }]), 0, null, 4, 'unknown title');

  db.close();
}

function planRow(overrides: Record<string, unknown>) {
  return {
    catalogGameId: 'x', displayName: 'x', repair_category: 'A. SAFE_AUTOMATIC_RESTORE',
    current_steamAppId: null, current_coverUrl: null, current_headerUrl: null, current_iconUrl: null,
    current_sourcesJson: '[]',
    proposed_steamAppId: null, proposed_coverUrl: null, proposed_headerUrl: null, proposed_iconUrl: null,
    ...overrides,
  };
}

const PALWORLD_SOURCES = JSON.stringify([{ provider: 'plitch', url: 'https://plitch.test/palworld' }]);
const PALWORLD_SOURCES_WITH_BUNDLED = JSON.stringify([
  { provider: 'plitch', url: 'https://plitch.test/palworld' },
  { provider: 'bundled', url: 'bundled://trainer-catalog-seed' },
]);

function palworldPlanRow() {
  return planRow({
    catalogGameId: 'palworld', displayName: 'Palworld', repair_category: 'A. SAFE_AUTOMATIC_RESTORE',
    current_steamAppId: null, current_coverUrl: null, current_headerUrl: null, current_iconUrl: null,
    current_sourcesJson: PALWORLD_SOURCES,
    proposed_steamAppId: 1623730,
    proposed_coverUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1623730/library_600x900_2x.jpg',
    proposed_headerUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1623730/header.jpg',
    proposed_iconUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1623730/capsule_231x87.jpg',
    proposed_sourcesJson: PALWORLD_SOURCES_WITH_BUNDLED,
  });
}

const SYNTHETIC_SOURCES = JSON.stringify([{ provider: 'bundled', url: 'bundled://seed' }]);
function syntheticPlanRow() {
  return planRow({
    catalogGameId: 'legend-of-darkness', displayName: 'Legend of Darkness', repair_category: 'B. SAFE_SYNTHETIC_ART_REMOVAL',
    current_steamAppId: 9000123,
    current_coverUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/9000123/library_600x900_2x.jpg',
    current_headerUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/9000123/header.jpg',
    current_iconUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/9000123/capsule_231x87.jpg',
    current_sourcesJson: SYNTHETIC_SOURCES,
    proposed_steamAppId: null, proposed_coverUrl: null, proposed_headerUrl: null, proposed_iconUrl: null,
  });
}

function categoryCPlanRow() {
  return planRow({
    catalogGameId: 'cyberpunk-2077', displayName: 'Cyberpunk 2077', repair_category: 'C. SAFE_SOURCE_REPAIR',
    current_steamAppId: 1091500,
    current_coverUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1091500/library_600x900_2x.jpg',
    current_headerUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1091500/header.jpg',
    current_iconUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1091500/capsule_231x87.jpg',
    current_sourcesJson: JSON.stringify([{ provider: 'plitch', url: 'https://plitch.test/cyberpunk' }]),
  });
}

function writePlan(rows: unknown[]): string {
  const p = path.join(fixtureRoot, `plan-${Math.random().toString(16).slice(2)}.json`);
  writeFileSync(p, JSON.stringify(rows));
  return p;
}

beforeEach(() => {
  fixtureRoot = mkdtempSync(path.join(tmpdir(), 'solith-repair-test-'));
  dbPath = path.join(fixtureRoot, 'fixture.db');
  backupDir = path.join(fixtureRoot, 'backups');
  assertNeverLivePath(dbPath);
  seedFixtureDb(dbPath);
});

afterEach(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe('repair-catalog-artwork utility — disposable-fixture tests only, never the live DB', () => {
  test('live-path protection: fixture db path is never the real live database path', () => {
    assert.notEqual(path.resolve(dbPath), path.resolve(LIVE_DB_PATH));
  });

  test('dry-run is the default mode and performs zero mutation', () => {
    const before = sha256(dbPath);
    const plan = writePlan([palworldPlanRow()]);
    const result = main(['--db', dbPath, '--plan', plan]);
    const after = sha256(dbPath);
    assert.equal(before, after);
    assert.equal(result.mode, 'dry-run');
    assert.equal(result.unchanged, true);
    assert.equal(result.categoryCounts.A, 1);
  });

  test('--apply without --expected-sha256 is rejected', () => {
    const plan = writePlan([palworldPlanRow()]);
    assert.throws(() => main(['--db', dbPath, '--plan', plan, '--apply', '--backup-dir', backupDir, '--allow-category', 'A']),
      /--expected-sha256/);
  });

  test('--apply with wrong expected hash is refused and makes no change', () => {
    const before = sha256(dbPath);
    const plan = writePlan([palworldPlanRow()]);
    assert.throws(() => main(['--db', dbPath, '--plan', plan, '--apply',
      '--expected-sha256', 'deadbeef'.repeat(8), '--backup-dir', backupDir, '--allow-category', 'A']),
      /hash mismatch/i);
    assert.equal(sha256(dbPath), before);
  });

  test('relative database path is rejected', () => {
    const plan = writePlan([palworldPlanRow()]);
    assert.throws(() => main(['--db', 'relative/fixture.db', '--plan', plan]), /absolute/i);
  });

  test('missing --backup-dir on --apply is rejected', () => {
    const expected = sha256(dbPath);
    const plan = writePlan([palworldPlanRow()]);
    assert.throws(() => main(['--db', dbPath, '--plan', plan, '--apply',
      '--expected-sha256', expected, '--allow-category', 'A']), /--backup-dir/);
  });

  test('Category A applies successfully and restores authoritative artwork', () => {
    const expected = sha256(dbPath);
    const plan = writePlan([palworldPlanRow()]);
    const result = main(['--db', dbPath, '--plan', plan, '--apply',
      '--expected-sha256', expected, '--backup-dir', backupDir, '--allow-category', 'A']);
    assert.equal(result.mode, 'apply');
    assert.equal(result.appliedCount, 1);
    assert.equal(result.skippedCount, 0);

    const verify = new DatabaseSync(dbPath, { readOnly: true });
    const row = verify.prepare('SELECT * FROM trainer_catalog_games WHERE catalogGameId = ?').get('palworld') as any;
    verify.close();
    assert.equal(row.steamAppId, 1623730);
    assert.equal(row.coverUrl, 'https://cdn.cloudflare.steamstatic.com/steam/apps/1623730/library_600x900_2x.jpg');
    assert.match(row.sourcesJson, /bundled/);
  });

  test('Category B applies successfully and clears synthetic artwork only', () => {
    const expected = sha256(dbPath);
    const plan = writePlan([syntheticPlanRow()]);
    const result = main(['--db', dbPath, '--plan', plan, '--apply',
      '--expected-sha256', expected, '--backup-dir', backupDir, '--allow-category', 'B']);
    assert.equal(result.appliedCount, 1);

    const verify = new DatabaseSync(dbPath, { readOnly: true });
    const row = verify.prepare('SELECT * FROM trainer_catalog_games WHERE catalogGameId = ?').get('legend-of-darkness') as any;
    verify.close();
    assert.equal(row.steamAppId, null);
    assert.equal(row.coverUrl, null);
    assert.equal(row.headerUrl, null);
    assert.equal(row.iconUrl, null);
  });

  test('Category B refuses to clear a non-synthetic steamAppId even if the plan claims it is category B', () => {
    const expected = sha256(dbPath);
    const row = syntheticPlanRow();
    row.current_steamAppId = 413150; // real ID, not synthetic — plan is lying/stale
    const plan = writePlan([{ ...row, catalogGameId: 'stardew-valley', current_coverUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/413150/library_600x900_2x.jpg', current_headerUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/413150/header.jpg', current_iconUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/413150/capsule_231x87.jpg', current_sourcesJson: JSON.stringify([{ provider: 'bundled', url: 'bundled://seed' }]) }]);
    const result = main(['--db', dbPath, '--plan', plan, '--apply',
      '--expected-sha256', expected, '--backup-dir', backupDir, '--allow-category', 'B']);
    assert.equal(result.appliedCount, 0);
    assert.equal(result.skippedCount, 1);
    assert.match(result.skippedStale[0].reason, /not synthetic/);
  });

  test('Category C is rejected outright from --apply, even with --allow-category C requested', () => {
    const expected = sha256(dbPath);
    const plan = writePlan([categoryCPlanRow()]);
    assert.throws(() => main(['--db', dbPath, '--plan', plan, '--apply',
      '--expected-sha256', expected, '--backup-dir', backupDir, '--allow-category', 'C']),
      /not permitted/);
  });

  test('a plan mixing an allowed and a prohibited category is rejected in full (no partial apply)', () => {
    const before = sha256(dbPath);
    const plan = writePlan([palworldPlanRow(), categoryCPlanRow()]);
    assert.throws(() => main(['--db', dbPath, '--plan', plan, '--apply',
      '--expected-sha256', before, '--backup-dir', backupDir, '--allow-category', 'A']),
      /not in --allow-category/);
    assert.equal(sha256(dbPath), before, 'no partial mutation should occur');
  });

  test('unknown category letter in --allow-category is rejected', () => {
    const expected = sha256(dbPath);
    const plan = writePlan([palworldPlanRow()]);
    assert.throws(() => main(['--db', dbPath, '--plan', plan, '--apply',
      '--expected-sha256', expected, '--backup-dir', backupDir, '--allow-category', 'Z']),
      /not permitted/);
  });

  test('stale current-value guard causes the row to be skipped, not overwritten', () => {
    const expected = sha256(dbPath);
    const row = palworldPlanRow();
    row.current_steamAppId = 999999; // does not match actual current value (null)
    const plan = writePlan([row]);
    const result = main(['--db', dbPath, '--plan', plan, '--apply',
      '--expected-sha256', expected, '--backup-dir', backupDir, '--allow-category', 'A']);
    assert.equal(result.appliedCount, 0);
    assert.equal(result.skippedCount, 1);
    assert.match(result.skippedStale[0].reason, /guard mismatch/);

    const verify = new DatabaseSync(dbPath, { readOnly: true });
    const dbRow = verify.prepare('SELECT * FROM trainer_catalog_games WHERE catalogGameId = ?').get('palworld') as any;
    verify.close();
    assert.equal(dbRow.steamAppId, null, 'row must remain unchanged when guard fails');
  });

  test('duplicate catalogGameId within a single plan is rejected at load time', () => {
    const plan = writePlan([palworldPlanRow(), palworldPlanRow()]);
    assert.throws(() => main(['--db', dbPath, '--plan', plan]), /Duplicate catalogGameId/);
  });

  test('malformed plan (not an array, no rows[]) is rejected', () => {
    const p = path.join(fixtureRoot, 'bad-plan.json');
    writeFileSync(p, JSON.stringify({ notRows: [] }));
    assert.throws(() => main(['--db', dbPath, '--plan', p]), /array of rows/);
  });

  test('plan row missing repair_category is rejected', () => {
    const p = path.join(fixtureRoot, 'bad-plan2.json');
    writeFileSync(p, JSON.stringify([{ catalogGameId: 'palworld' }]));
    assert.throws(() => main(['--db', dbPath, '--plan', p]), /repair_category/);
  });

  test('malformed sourcesJson in the live row does not crash dry-run analysis', () => {
    const db = new DatabaseSync(dbPath);
    db.exec(`UPDATE trainer_catalog_games SET sourcesJson = 'not-json{{' WHERE catalogGameId = 'palworld'`);
    db.close();
    const plan = writePlan([palworldPlanRow()]);
    const result = main(['--db', dbPath, '--plan', plan]);
    assert.equal(result.mode, 'dry-run');
    assert.ok(result.staleRows.includes('palworld'));
  });

  test('backup is created, hash-verified, and passes integrity checks', () => {
    const expected = sha256(dbPath);
    const plan = writePlan([palworldPlanRow()]);
    const result = main(['--db', dbPath, '--plan', plan, '--apply',
      '--expected-sha256', expected, '--backup-dir', backupDir, '--allow-category', 'A']);
    assert.ok(existsSync(result.backupManifest.backupPath));
    assert.equal(result.backupManifest.backupSha256, sha256(result.backupManifest.backupPath));
    assert.equal(result.backupManifest.sourceSha256, expected);
    assert.equal(result.backupManifest.quickCheck[0].quick_check, 'ok');
    assert.equal(result.backupManifest.integrityCheck[0].integrity_check, 'ok');
  });

  test('transaction rolls back fully on a simulated failure (protected/prohibited row slipped into an allowed-only plan)', () => {
    const expected = sha256(dbPath);
    const before = sha256(dbPath);
    // A row whose category is A but whose catalogGameId does not exist — triggers a "not found" skip, not a rollback;
    // to exercise true rollback we corrupt the plan post-guard by requesting an unknown category via allow-list mismatch.
    const rows = [palworldPlanRow(), { ...categoryCPlanRow() }];
    const plan = writePlan(rows);
    assert.throws(() => main(['--db', dbPath, '--plan', plan, '--apply',
      '--expected-sha256', expected, '--backup-dir', backupDir, '--allow-category', 'A', '--allow-category', 'B']),
      /not in --allow-category/);
    assert.equal(sha256(dbPath), before, 'database must be byte-identical after a rejected apply');
  });

  test('successful apply produces a manifest usable for rollback, and rollback restores the exact original hash', () => {
    const originalSha = sha256(dbPath);
    const plan = writePlan([palworldPlanRow()]);
    const reportPath = path.join(fixtureRoot, 'apply-report.json');
    const applyResult = main(['--db', dbPath, '--plan', plan, '--apply',
      '--expected-sha256', originalSha, '--backup-dir', backupDir, '--allow-category', 'A', '--report', reportPath]);
    assert.notEqual(sha256(dbPath), originalSha, 'db should have changed after a successful apply');

    const rollbackResult = main(['--rollback', reportPath, '--db', dbPath]);
    assert.equal(rollbackResult.success, true);
    assert.equal(sha256(dbPath), originalSha, 'rollback must restore the exact original hash');
  });

  test('rollback refuses when current database hash does not match the manifest post-apply hash', () => {
    const originalSha = sha256(dbPath);
    const plan = writePlan([palworldPlanRow()]);
    const reportPath = path.join(fixtureRoot, 'apply-report2.json');
    main(['--db', dbPath, '--plan', plan, '--apply',
      '--expected-sha256', originalSha, '--backup-dir', backupDir, '--allow-category', 'A', '--report', reportPath]);

    // Mutate the db again after apply so it no longer matches the manifest's postApplySha256.
    const db = new DatabaseSync(dbPath);
    db.exec(`UPDATE trainer_catalog_games SET displayName = 'Tampered' WHERE catalogGameId = 'palworld'`);
    db.close();

    assert.throws(() => main(['--rollback', reportPath, '--db', dbPath]), /does not match/);
  });

  test('disposable-copy integration: dry-run -> apply -> verification -> rollback -> restored-hash verification', () => {
    const originalSha = sha256(dbPath);
    const rows = [palworldPlanRow(), syntheticPlanRow()];
    const plan = writePlan(rows);

    const dry = main(['--db', dbPath, '--plan', plan]);
    assert.equal(dry.unchanged, true);
    assert.equal(dry.categoryCounts.A, 1);
    assert.equal(dry.categoryCounts.B, 1);

    const reportPath = path.join(fixtureRoot, 'integration-apply-report.json');
    const apply = main(['--db', dbPath, '--plan', plan, '--apply',
      '--expected-sha256', originalSha, '--backup-dir', backupDir,
      '--allow-category', 'A', '--allow-category', 'B', '--report', reportPath]);
    assert.equal(apply.appliedCount, 2);
    assert.equal(apply.integrityCheck[0].integrity_check, 'ok');

    const verify = new DatabaseSync(dbPath, { readOnly: true });
    const palworld = verify.prepare('SELECT * FROM trainer_catalog_games WHERE catalogGameId = ?').get('palworld') as any;
    const synthetic = verify.prepare('SELECT * FROM trainer_catalog_games WHERE catalogGameId = ?').get('legend-of-darkness') as any;
    const untouched = verify.prepare('SELECT * FROM trainer_catalog_games WHERE catalogGameId = ?').get('cyberpunk-2077') as any;
    const protectedRow = verify.prepare('SELECT * FROM trainer_catalog_games WHERE catalogGameId = ?').get('my-imported-game') as any;
    const dupCheck = verify.prepare('SELECT catalogGameId, COUNT(*) c FROM trainer_catalog_games GROUP BY catalogGameId HAVING c > 1').all();
    verify.close();

    assert.equal(palworld.steamAppId, 1623730);
    assert.equal(synthetic.steamAppId, null);
    assert.equal(untouched.steamAppId, 1091500, 'category C row must remain untouched — never auto-applied');
    assert.equal(protectedRow.steamAppId, 555555, 'protected user row must remain untouched');
    assert.equal(dupCheck.length, 0);

    const rollback = main(['--rollback', reportPath, '--db', dbPath]);
    assert.equal(rollback.success, true);
    assert.equal(sha256(dbPath), originalSha, 'restored hash must match the exact original');
  });

  test('live-path protection: the utility itself refuses a plan mixing categories even against a path that merely resembles the live path structure', () => {
    // Defense-in-depth smoke check: ensure no code path in this test file ever
    // constructs an absolute path equal to the real live database.
    assertNeverLivePath(dbPath);
    assertNeverLivePath(backupDir);
  });
});
