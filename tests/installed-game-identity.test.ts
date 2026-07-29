import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import initSqlJs from 'sql.js';
import db, {
  closeDatabaseSafely,
  getInstalledGameIdentityMigrationReport,
  resetForTesting,
} from '../src/core/database/index.ts';
import {
  createInstallIdentity,
  createLegacyInstallIdentity,
  createPreviewCandidateId,
  sameConcreteInstall,
} from '../src/core/install-discovery/identity.ts';
import {
  commitInstallDiscoveryRecords,
  listInstalledGamesWithCatalog,
  previewInstallDiscoveryScan,
} from '../src/core/install-discovery/index.ts';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-install-identity-'));

function gameFixture(root: string, name: string): { installPath: string; executablePath: string } {
  const installPath = path.join(root, name);
  const executablePath = path.join(installPath, `${name.replace(/\s/g, '')}.exe`);
  fs.mkdirSync(path.join(installPath, 'Data'), { recursive: true });
  fs.writeFileSync(executablePath, 'MZ');
  return { installPath, executablePath };
}

async function writeLegacyDatabase(
  target: string,
  rows: Array<{
    id: string;
    platform: string;
    installPath: string;
    executablePath?: string;
    steamAppId?: number;
  }>,
): Promise<void> {
  const SQL = await initSqlJs();
  const legacy = new SQL.Database();
  legacy.run(`
    CREATE TABLE installed_games (
      id TEXT PRIMARY KEY,
      catalog_game_id TEXT,
      platform TEXT NOT NULL,
      install_path TEXT NOT NULL,
      executable_path TEXT,
      display_name TEXT,
      steam_app_id INTEGER,
      detected_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    )
  `);
  const insert = legacy.prepare(`
    INSERT INTO installed_games (
      id, platform, install_path, executable_path, steam_app_id, detected_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of rows) {
    insert.run([
      row.id,
      row.platform,
      row.installPath,
      row.executablePath ?? null,
      row.steamAppId ?? null,
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    ]);
  }
  insert.free();
  fs.writeFileSync(target, Buffer.from(legacy.export()));
  legacy.close();
}

after(async () => {
  await closeDatabaseSafely();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('installed-game identity', () => {
  test('preview identity distinguishes games under one broad root and persisted identity is deterministic', () => {
    const first = gameFixture(tempRoot, 'Alpha Game');
    const second = gameFixture(tempRoot, 'Beta Game');
    const alpha = { platform: 'manual' as const, ...first };
    const beta = { platform: 'manual' as const, ...second };

    assert.notEqual(createPreviewCandidateId(alpha), createPreviewCandidateId(beta));
    assert.notEqual(createInstallIdentity(alpha).installIdentity, createInstallIdentity(beta).installIdentity);
    assert.equal(createPreviewCandidateId(alpha), createPreviewCandidateId({ ...alpha }));
    assert.equal(createInstallIdentity(alpha).installIdentity, createInstallIdentity({ ...alpha }).installIdentity);
  });

  test('same executable from multiple sources is recognized while same title at another path stays separate', () => {
    const first = gameFixture(tempRoot, 'Shared Executable');
    const other = gameFixture(tempRoot, 'Shared Executable Copy');
    const manual = createInstallIdentity({ platform: 'manual', ...first });
    const epic = createInstallIdentity({ platform: 'epic', ...first });
    const separate = createInstallIdentity({ platform: 'manual', ...other });

    assert.equal(sameConcreteInstall(manual, epic), 'same_executable_path');
    assert.equal(sameConcreteInstall(manual, separate), undefined);
  });

  test('launcher identity includes install path and legacy identities are namespaced and stable', () => {
    const first = createInstallIdentity({
      platform: 'steam',
      installPath: 'C:\\Games\\One',
      steamAppId: 123,
    });
    const second = createInstallIdentity({
      platform: 'steam',
      installPath: 'D:\\Games\\One',
      steamAppId: 123,
    });
    const legacyA = createLegacyInstallIdentity('manual', 'D:\\Games', 'row-a');
    const legacyB = createLegacyInstallIdentity('manual', 'D:\\Games', 'row-b');

    assert.notEqual(first.installIdentity, second.installIdentity);
    assert.match(legacyA.installIdentity, /^legacy:manual:/);
    assert.notEqual(legacyA.installIdentity, legacyB.installIdentity);
    assert.equal(legacyA.installIdentity, createLegacyInstallIdentity('manual', 'D:\\Games', 'row-a').installIdentity);
  });

  test('migration preserves colliding and ambiguous legacy rows without merging', async () => {
    const databasePath = path.join(tempRoot, 'legacy-collision.sqlite');
    const concrete = gameFixture(tempRoot, 'Migrated Game');
    await writeLegacyDatabase(databasePath, [
      { id: 'legacy-a', platform: 'manual', installPath: 'D:\\Games', executablePath: concrete.executablePath },
      { id: 'legacy-b', platform: 'epic', installPath: 'D:\\OtherRoot', executablePath: concrete.executablePath },
      { id: 'legacy-c', platform: 'manual', installPath: 'C:\\BroadRoot' },
      { id: 'legacy-d', platform: 'manual', installPath: 'C:\\BroadRoot' },
    ]);

    await resetForTesting(databasePath, { preserveExisting: true });
    const rows = listInstalledGamesWithCatalog();
    const report = getInstalledGameIdentityMigrationReport();

    assert.equal(rows.length, 4);
    assert.equal(new Set(rows.map((row) => row.installIdentity)).size, 4);
    assert.equal(rows.filter((row) => row.identityStatus === 'ambiguous').length, 4);
    assert.equal(rows.every((row) => row.needsReverification), true);
    assert.equal(report.collisions, 2);
    assert.equal(report.ambiguous, 4);
  });

  test('migration is idempotent and creates the identity-only unique index', async () => {
    const databasePath = path.join(tempRoot, 'legacy-idempotent.sqlite');
    const fixture = gameFixture(tempRoot, 'Idempotent Game');
    await writeLegacyDatabase(databasePath, [
      { id: 'legacy-one', platform: 'manual', installPath: fixture.installPath, executablePath: fixture.executablePath },
    ]);

    await resetForTesting(databasePath, { preserveExisting: true });
    const first = listInstalledGamesWithCatalog();
    await closeDatabaseSafely();
    await resetForTesting(databasePath, { preserveExisting: true });
    const second = listInstalledGamesWithCatalog();
    const indexes = db.prepare(`PRAGMA index_list(installed_games)`).all() as Array<{ name: string; unique: number }>;

    assert.deepEqual(second, first);
    assert.ok(indexes.some((index) => index.name === 'idx_installed_games_identity' && Number(index.unique) === 1));
    assert.equal(indexes.some((index) => index.name.includes('platform') && index.name.includes('install')), false);
  });

  test('failed migration rolls back and leaves the legacy table and rows usable', async () => {
    const databasePath = path.join(tempRoot, 'legacy-rollback.sqlite');
    const fixture = gameFixture(tempRoot, 'Rollback Game');
    await writeLegacyDatabase(databasePath, [
      { id: 'legacy-rollback', platform: 'manual', installPath: fixture.installPath, executablePath: fixture.executablePath },
    ]);

    const SQL = await initSqlJs();
    const legacy = new SQL.Database(fs.readFileSync(databasePath));
    legacy.run('CREATE TABLE index_name_blocker (value TEXT)');
    legacy.run('CREATE UNIQUE INDEX idx_installed_games_identity ON index_name_blocker(value)');
    fs.writeFileSync(databasePath, Buffer.from(legacy.export()));
    legacy.close();

    await assert.rejects(() => resetForTesting(databasePath, { preserveExisting: true }));
    const columns = db.prepare('PRAGMA table_info(installed_games)').all() as Array<{ name: string }>;
    const rows = db.prepare('SELECT id, install_path AS installPath FROM installed_games').all() as Array<{
      id: string;
      installPath: string;
    }>;
    assert.equal(columns.some((column) => column.name === 'install_identity'), false);
    assert.deepEqual(rows, [{ id: 'legacy-rollback', installPath: fixture.installPath }]);

    await resetForTesting();
  });

  test('ambiguous broad-root legacy row does not suppress a verified candidate', async () => {
    const databasePath = path.join(tempRoot, 'legacy-does-not-suppress.sqlite');
    const root = path.join(tempRoot, 'broad-root');
    const fixture = gameFixture(root, 'New Verified Game');
    await writeLegacyDatabase(databasePath, [
      { id: 'legacy-root', platform: 'manual', installPath: root },
    ]);
    await resetForTesting(databasePath, { preserveExisting: true });

    const preview = previewInstallDiscoveryScan({
      offlineRootsOnly: true,
      steamInstallPath: path.join(tempRoot, 'missing-steam'),
      userSelectedRoots: [root],
    });
    const candidate = preview.records.find((record) => record.executablePath === fixture.executablePath);
    assert.ok(candidate);
    assert.equal(candidate.duplicate, false);
    assert.equal(commitInstallDiscoveryRecords([candidate]).added, 1);
    assert.equal(listInstalledGamesWithCatalog().length, 2);
  });

  test('two games under one root render independently, commit independently, and rescan as exact duplicates', async () => {
    await resetForTesting();
    const root = path.join(tempRoot, 'multi-game-root');
    gameFixture(root, 'First Game');
    gameFixture(root, 'Second Game');
    const options = {
      offlineRootsOnly: true,
      steamInstallPath: path.join(tempRoot, 'missing-steam'),
      userSelectedRoots: [root],
    };

    const preview = previewInstallDiscoveryScan(options);
    assert.equal(preview.records.length, 2);
    assert.equal(new Set(preview.records.map((record) => record.previewCandidateId)).size, 2);
    assert.deepEqual(commitInstallDiscoveryRecords(preview.records), { added: 2, skipped: 0, rejected: 0 });

    const repeated = previewInstallDiscoveryScan(options);
    assert.equal(repeated.records.every((record) => record.duplicate), true);
    assert.equal(repeated.records.every((record) => record.duplicateReason === 'same_executable_path'), true);
  });

  test('Trainer Library keys and selection state use previewCandidateId rather than persisted or broad-root identity', () => {
    const source = fs.readFileSync(
      path.resolve('src/app/pages/TrainerLibraryPage.tsx'),
      'utf8',
    );
    assert.match(source, /key=\{record\.previewCandidateId\}/);
    assert.match(source, /selectedDiscoveryIds\.has\(record\.previewCandidateId\)/);
    assert.doesNotMatch(source, /key=\{record\.id\}/);
  });
});
