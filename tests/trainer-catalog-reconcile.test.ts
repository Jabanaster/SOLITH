import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import db, {
  BG3_ORPHAN_RECONCILIATION_ID,
  getBg3OrphanReconciliationResult,
  getDb,
  reconcileBg3Orphan,
  resetForTesting,
} from '../src/core/database/index.ts';

const CANONICAL_ID = 'baldur-s-gate-3';
const CANONICAL_STEAM_APP_ID = 1086940;
const ORPHAN_ID = 'baldur-x27-s-gate-3';
const ORPHAN_DISPLAY_NAME = "Baldur&#x27;s Gate 3";
const ORPHAN_PACK_ID = 'plitch-baldur-x27-s-gate-3';

function clearBg3Rows(): void {
  const raw = getDb();
  raw.run('DELETE FROM trainer_catalog_games WHERE catalogGameId IN (?, ?)', [CANONICAL_ID, ORPHAN_ID]);
  raw.run('DELETE FROM trainer_mod_packs WHERE catalogGameId = ?', [ORPHAN_ID]);
  raw.run('DELETE FROM definition_feedback WHERE catalogGameId = ?', [ORPHAN_ID]);
  raw.run('DELETE FROM definition_update_queue WHERE catalogGameId = ?', [ORPHAN_ID]);
  raw.run('DELETE FROM catalog_reconciliation_log WHERE reconciliationId = ?', [BG3_ORPHAN_RECONCILIATION_ID]);
}

function seedCanonical(): void {
  db.prepare(
    `INSERT INTO trainer_catalog_games (
      catalogGameId, displayName, steamAppId, executablesJson, categoriesJson,
      verificationStatus, sourcesJson, hasModPack, cheatCount, searchableText
    ) VALUES (?, ?, ?, '[]', '["RPG"]', 'verified', '[]', 0, 0, ?)`,
  ).run(CANONICAL_ID, "Baldur's Gate 3", CANONICAL_STEAM_APP_ID, "baldur's gate 3");
}

function seedOrphan(overrides: { displayName?: string; steamAppId?: number | null } = {}): void {
  db.prepare(
    `INSERT INTO trainer_catalog_games (
      catalogGameId, displayName, steamAppId, executablesJson, categoriesJson,
      verificationStatus, sourcesJson, hasModPack, cheatCount, searchableText
    ) VALUES (?, ?, ?, '["Baldurx27sGate3.exe"]', '["RPG","Action"]', 'community', '[]', 1, 4, ?)`,
  ).run(
    ORPHAN_ID,
    overrides.displayName ?? ORPHAN_DISPLAY_NAME,
    overrides.steamAppId === undefined ? null : overrides.steamAppId,
    'baldur gate 3 orphan',
  );
}

function seedOrphanModPack(packId: string = ORPHAN_PACK_ID): void {
  db.prepare(
    `INSERT INTO trainer_mod_packs (
      packId, catalogGameId, payloadJson, verificationStatus, sourceProvider, syncedAt
    ) VALUES (?, ?, '{}', 'community', 'plitch', datetime('now'))`,
  ).run(packId, ORPHAN_ID);
}

describe('reconcileBg3Orphan', () => {
  before(async () => {
    await resetForTesting(':memory:');
  });

  test('applies when canonical row, exact orphan row, and exact orphan mod pack all match', () => {
    clearBg3Rows();
    seedCanonical();
    seedOrphan();
    seedOrphanModPack();

    reconcileBg3Orphan();

    const result = getBg3OrphanReconciliationResult();
    assert.deepEqual(result, { status: 'applied', reconciliationId: BG3_ORPHAN_RECONCILIATION_ID });

    const raw = getDb();
    assert.equal(
      raw.exec('SELECT * FROM trainer_catalog_games WHERE catalogGameId = ?', [ORPHAN_ID]).length,
      0,
    );
    assert.equal(
      raw.exec('SELECT * FROM trainer_mod_packs WHERE packId = ?', [ORPHAN_PACK_ID]).length,
      0,
    );

    const canonicalRows = raw.exec('SELECT catalogGameId, displayName, steamAppId FROM trainer_catalog_games WHERE catalogGameId = ?', [CANONICAL_ID]);
    assert.equal(canonicalRows[0].values[0][0], CANONICAL_ID);
    assert.equal(canonicalRows[0].values[0][1], "Baldur's Gate 3");
    assert.equal(canonicalRows[0].values[0][2], CANONICAL_STEAM_APP_ID);

    const logRows = raw.exec(
      'SELECT reconciliationId, catalogGameId FROM catalog_reconciliation_log WHERE reconciliationId = ?',
      [BG3_ORPHAN_RECONCILIATION_ID],
    );
    assert.equal(logRows.length, 1);
    assert.equal(logRows[0].values.length, 1);
  });

  test('idempotent: second run on an already-clean database is a safe no-op', () => {
    clearBg3Rows();
    seedCanonical();
    seedOrphan();
    seedOrphanModPack();

    reconcileBg3Orphan();
    assert.equal(getBg3OrphanReconciliationResult()?.status, 'applied');

    const raw = getDb();
    const logCountAfterFirstRun = raw.exec(
      'SELECT COUNT(*) FROM catalog_reconciliation_log WHERE reconciliationId = ?',
      [BG3_ORPHAN_RECONCILIATION_ID],
    )[0].values[0][0];

    reconcileBg3Orphan();
    assert.deepEqual(getBg3OrphanReconciliationResult(), { status: 'already-clean' });

    const logCountAfterSecondRun = raw.exec(
      'SELECT COUNT(*) FROM catalog_reconciliation_log WHERE reconciliationId = ?',
      [BG3_ORPHAN_RECONCILIATION_ID],
    )[0].values[0][0];
    assert.equal(logCountAfterSecondRun, logCountAfterFirstRun);
  });

  test('blocks and leaves data untouched when canonical row is missing', () => {
    clearBg3Rows();
    seedOrphan();
    seedOrphanModPack();

    reconcileBg3Orphan();

    const result = getBg3OrphanReconciliationResult();
    assert.equal(result?.status, 'blocked');
    assert.match((result as { reason: string }).reason, /canonical/i);

    const raw = getDb();
    assert.equal(raw.exec('SELECT * FROM trainer_catalog_games WHERE catalogGameId = ?', [ORPHAN_ID]).length, 1);
    assert.equal(raw.exec('SELECT * FROM trainer_mod_packs WHERE packId = ?', [ORPHAN_PACK_ID]).length, 1);
  });

  test('blocks and leaves data untouched when orphan has a definition_feedback reference', () => {
    clearBg3Rows();
    seedCanonical();
    seedOrphan();
    seedOrphanModPack();
    const raw = getDb();
    raw.run(
      `INSERT INTO definition_feedback (catalogGameId, featureId, rating) VALUES (?, 'health', 1)`,
      [ORPHAN_ID],
    );

    reconcileBg3Orphan();

    const result = getBg3OrphanReconciliationResult();
    assert.equal(result?.status, 'blocked');
    assert.match((result as { reason: string }).reason, /definition_feedback/i);
    assert.equal(raw.exec('SELECT * FROM trainer_catalog_games WHERE catalogGameId = ?', [ORPHAN_ID]).length, 1);
  });

  test('blocks and leaves data untouched when orphan has a definition_update_queue reference', () => {
    clearBg3Rows();
    seedCanonical();
    seedOrphan();
    seedOrphanModPack();
    const raw = getDb();
    raw.run(
      `INSERT INTO definition_update_queue (catalogGameId, reason) VALUES (?, 'test')`,
      [ORPHAN_ID],
    );

    reconcileBg3Orphan();

    const result = getBg3OrphanReconciliationResult();
    assert.equal(result?.status, 'blocked');
    assert.match((result as { reason: string }).reason, /definition_update_queue/i);
    assert.equal(raw.exec('SELECT * FROM trainer_catalog_games WHERE catalogGameId = ?', [ORPHAN_ID]).length, 1);
  });

  test('blocks and leaves data untouched when orphan mod pack has an unexpected packId', () => {
    clearBg3Rows();
    seedCanonical();
    seedOrphan();
    seedOrphanModPack('some-other-pack-id');

    reconcileBg3Orphan();

    const result = getBg3OrphanReconciliationResult();
    assert.equal(result?.status, 'blocked');
    assert.match((result as { reason: string }).reason, /trainer_mod_packs/i);

    const raw = getDb();
    assert.equal(raw.exec('SELECT * FROM trainer_catalog_games WHERE catalogGameId = ?', [ORPHAN_ID]).length, 1);
    assert.equal(raw.exec('SELECT * FROM trainer_mod_packs WHERE packId = ?', ['some-other-pack-id']).length, 1);
  });

  test('blocks without fuzzy matching when the orphan displayName does not match exactly', () => {
    clearBg3Rows();
    seedCanonical();
    seedOrphan({ displayName: "Baldur's Gate 3 (Definitive Edition)" });
    seedOrphanModPack();

    reconcileBg3Orphan();

    const result = getBg3OrphanReconciliationResult();
    assert.equal(result?.status, 'blocked');
    assert.match((result as { reason: string }).reason, /displayName/);

    const raw = getDb();
    assert.equal(raw.exec('SELECT * FROM trainer_catalog_games WHERE catalogGameId = ?', [ORPHAN_ID]).length, 1);
  });

  test('blocks when the orphan already carries a non-null steamAppId', () => {
    clearBg3Rows();
    seedCanonical();
    seedOrphan({ steamAppId: 999 });
    seedOrphanModPack();

    reconcileBg3Orphan();

    const result = getBg3OrphanReconciliationResult();
    assert.equal(result?.status, 'blocked');
    assert.match((result as { reason: string }).reason, /steamAppId/);
  });

  test('reports already-clean when the orphan row was never present', () => {
    clearBg3Rows();
    seedCanonical();

    reconcileBg3Orphan();

    assert.deepEqual(getBg3OrphanReconciliationResult(), { status: 'already-clean' });
  });

  test('rolls back fully if deletion fails partway through the transaction', () => {
    clearBg3Rows();
    seedCanonical();
    seedOrphan();
    seedOrphanModPack();

    const raw = getDb();
    raw.run(`
      CREATE TRIGGER IF NOT EXISTS force_bg3_rollback_test
      BEFORE DELETE ON trainer_catalog_games
      WHEN OLD.catalogGameId = '${ORPHAN_ID}'
      BEGIN
        SELECT RAISE(ABORT, 'forced failure for rollback test');
      END;
    `);

    assert.throws(() => reconcileBg3Orphan());

    raw.run('DROP TRIGGER IF EXISTS force_bg3_rollback_test');

    assert.equal(raw.exec('SELECT * FROM trainer_catalog_games WHERE catalogGameId = ?', [ORPHAN_ID]).length, 1);
    assert.equal(raw.exec('SELECT * FROM trainer_mod_packs WHERE packId = ?', [ORPHAN_PACK_ID]).length, 1);
    assert.equal(
      raw.exec('SELECT * FROM catalog_reconciliation_log WHERE reconciliationId = ?', [BG3_ORPHAN_RECONCILIATION_ID]).length,
      0,
    );
  });
});
