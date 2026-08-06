import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import db, {
  BG3_ORPHAN_RECONCILIATION_ID,
  getBg3OrphanReconciliationResult,
  getCatalogOrphanReconciliationResult,
  getDb,
  reconcileBg3Orphan,
  reconcileCatalogOrphans,
  resetForTesting,
} from '../src/core/database/index.ts';

interface PairFixture {
  reconciliationId: string;
  orphanId: string;
  canonicalId: string;
  orphanDisplayName: string;
  orphanPackId: string;
  provider: string;
  proof:
    | { method: 'steamAppId'; canonicalSteamAppId: number }
    | { method: 'providerUrl'; sourceUrl: string };
}

const BG3: PairFixture = {
  reconciliationId: BG3_ORPHAN_RECONCILIATION_ID,
  orphanId: 'baldur-x27-s-gate-3',
  canonicalId: 'baldur-s-gate-3',
  orphanDisplayName: "Baldur&#x27;s Gate 3",
  orphanPackId: 'plitch-baldur-x27-s-gate-3',
  provider: 'plitch',
  proof: { method: 'steamAppId', canonicalSteamAppId: 1086940 },
};

const SEVEN_PAIRS: PairFixture[] = [
  {
    reconciliationId: 'no-mans-sky-html-entity-orphan-v1',
    orphanId: 'no-man-x27-s-sky',
    canonicalId: 'no-man-s-sky',
    orphanDisplayName: "No Man&#x27;s Sky",
    orphanPackId: 'plitch-no-man-x27-s-sky',
    provider: 'plitch',
    proof: { method: 'steamAppId', canonicalSteamAppId: 275850 },
  },
  {
    reconciliationId: 'gow-ragnarok-html-entity-orphan-v1',
    orphanId: 'god-of-war-ragnar-xf6-k',
    canonicalId: 'god-of-war-ragnar-k',
    orphanDisplayName: 'God of War Ragnar&#xF6;k',
    orphanPackId: 'plitch-god-of-war-ragnar-xf6-k',
    provider: 'plitch',
    proof: { method: 'steamAppId', canonicalSteamAppId: 2322010 },
  },
  {
    reconciliationId: 'spider-man-remastered-html-entity-orphan-v1',
    orphanId: 'marvel-x27-s-spider-man-remastered',
    canonicalId: 'marvel-s-spider-man-remastered',
    orphanDisplayName: "Marvel&#x27;s Spider-Man Remastered",
    orphanPackId: 'plitch-marvel-x27-s-spider-man-remastered',
    provider: 'plitch',
    proof: { method: 'steamAppId', canonicalSteamAppId: 1817070 },
  },
  {
    reconciliationId: 'dragons-dogma-2-html-entity-orphan-v1',
    orphanId: 'dragon-x27-s-dogma-2',
    canonicalId: 'dragon-s-dogma-2',
    orphanDisplayName: "Dragon&#x27;s Dogma 2",
    orphanPackId: 'plitch-dragon-x27-s-dogma-2',
    provider: 'plitch',
    proof: { method: 'steamAppId', canonicalSteamAppId: 2054970 },
  },
  {
    reconciliationId: 'miles-morales-html-entity-orphan-v1',
    orphanId: 'marvel-x2019-s-spider-man-miles-morales',
    canonicalId: 'marvel-s-spider-man-miles-morales',
    orphanDisplayName: 'Marvel&#x2019;s Spider-Man: Miles Morales',
    orphanPackId: 'plitch-marvel-x2019-s-spider-man-miles-morales',
    provider: 'plitch',
    proof: { method: 'steamAppId', canonicalSteamAppId: 1817190 },
  },
  {
    reconciliationId: 'dragons-dogma-dark-arisen-html-entity-orphan-v1',
    orphanId: 'dragon-x27-s-dogma-dark-arisen',
    canonicalId: 'dragon-s-dogma-dark-arisen',
    orphanDisplayName: "Dragon&#x27;s Dogma - Dark Arisen",
    orphanPackId: 'plitch-dragon-x27-s-dogma-dark-arisen',
    provider: 'plitch',
    proof: { method: 'steamAppId', canonicalSteamAppId: 367500 },
  },
  {
    reconciliationId: 'ac-black-flag-resynced-html-entity-orphan-v1',
    orphanId: 'assassin-8217-s-creed-black-flag-resynced',
    canonicalId: 'assassin-s-creed-black-flag-resynced',
    orphanDisplayName: 'Assassin&#8217;s Creed Black Flag Resynced',
    orphanPackId: 'fling-assassin-8217-s-creed-black-flag-resynced',
    provider: 'fling',
    proof: {
      method: 'providerUrl',
      sourceUrl: 'https://flingtrainer.com/trainer/assassins-creed-black-flag-resynced-trainer/',
    },
  },
];

const ALL_PAIRS: PairFixture[] = [BG3, ...SEVEN_PAIRS];

function sourcesJsonFor(provider: string, url?: string): string {
  if (!url) return '[]';
  return JSON.stringify([{ provider, url, lastSyncedAt: '2026-08-04T10:48:40.000Z' }]);
}

function clearPairRows(pair: PairFixture): void {
  const raw = getDb();
  raw.run('DELETE FROM trainer_catalog_games WHERE catalogGameId IN (?, ?)', [pair.canonicalId, pair.orphanId]);
  raw.run('DELETE FROM trainer_mod_packs WHERE catalogGameId = ?', [pair.orphanId]);
  raw.run('DELETE FROM definition_feedback WHERE catalogGameId = ?', [pair.orphanId]);
  raw.run('DELETE FROM definition_update_queue WHERE catalogGameId = ?', [pair.orphanId]);
  raw.run('DELETE FROM catalog_reconciliation_log WHERE reconciliationId = ?', [pair.reconciliationId]);
}

function seedCanonical(pair: PairFixture, overrides: { steamAppId?: number | null; sourceUrl?: string } = {}): void {
  const steamAppId =
    pair.proof.method === 'steamAppId'
      ? overrides.steamAppId === undefined
        ? pair.proof.canonicalSteamAppId
        : overrides.steamAppId
      : null;
  const sourcesJson =
    pair.proof.method === 'providerUrl'
      ? sourcesJsonFor(pair.provider, overrides.sourceUrl === undefined ? pair.proof.sourceUrl : overrides.sourceUrl)
      : '[]';
  db.prepare(
    `INSERT INTO trainer_catalog_games (
      catalogGameId, displayName, steamAppId, executablesJson, categoriesJson,
      verificationStatus, sourcesJson, hasModPack, cheatCount, searchableText
    ) VALUES (?, ?, ?, '[]', '["RPG"]', 'verified', ?, 0, 0, ?)`,
  ).run(pair.canonicalId, `canonical ${pair.canonicalId}`, steamAppId, sourcesJson, `canonical ${pair.canonicalId}`);
}

function seedOrphan(
  pair: PairFixture,
  overrides: { displayName?: string; steamAppId?: number | null; sourceUrl?: string } = {},
): void {
  const sourcesJson =
    pair.proof.method === 'providerUrl'
      ? sourcesJsonFor(pair.provider, overrides.sourceUrl === undefined ? pair.proof.sourceUrl : overrides.sourceUrl)
      : '[]';
  db.prepare(
    `INSERT INTO trainer_catalog_games (
      catalogGameId, displayName, steamAppId, executablesJson, categoriesJson,
      verificationStatus, sourcesJson, hasModPack, cheatCount, searchableText
    ) VALUES (?, ?, ?, '["orphan.exe"]', '["Action"]', 'community', ?, 1, 4, ?)`,
  ).run(
    pair.orphanId,
    overrides.displayName ?? pair.orphanDisplayName,
    overrides.steamAppId === undefined ? null : overrides.steamAppId,
    sourcesJson,
    `orphan ${pair.orphanId}`,
  );
}

function seedOrphanModPack(pair: PairFixture, packId: string = pair.orphanPackId): void {
  db.prepare(
    `INSERT INTO trainer_mod_packs (
      packId, catalogGameId, payloadJson, verificationStatus, sourceProvider, syncedAt
    ) VALUES (?, ?, '{}', 'community', ?, datetime('now'))`,
  ).run(packId, pair.orphanId, pair.provider);
}

function seedFullyValidPair(pair: PairFixture): void {
  clearPairRows(pair);
  seedCanonical(pair);
  seedOrphan(pair);
  seedOrphanModPack(pair);
}

describe('reconcileBg3Orphan (legacy call-site compatibility)', () => {
  before(async () => {
    await resetForTesting(':memory:');
  });

  test('applies when canonical row, exact orphan row, and exact orphan mod pack all match', () => {
    seedFullyValidPair(BG3);

    reconcileBg3Orphan();

    const result = getBg3OrphanReconciliationResult();
    assert.deepEqual(result, { status: 'applied', reconciliationId: BG3_ORPHAN_RECONCILIATION_ID });

    const raw = getDb();
    assert.equal(raw.exec('SELECT * FROM trainer_catalog_games WHERE catalogGameId = ?', [BG3.orphanId]).length, 0);
    assert.equal(raw.exec('SELECT * FROM trainer_mod_packs WHERE packId = ?', [BG3.orphanPackId]).length, 0);

    const canonicalRows = raw.exec(
      'SELECT catalogGameId, steamAppId FROM trainer_catalog_games WHERE catalogGameId = ?',
      [BG3.canonicalId],
    );
    assert.equal(canonicalRows[0].values[0][0], BG3.canonicalId);
    assert.equal(canonicalRows[0].values[0][1], 1086940);

    const logRows = raw.exec(
      'SELECT reconciliationId, catalogGameId FROM catalog_reconciliation_log WHERE reconciliationId = ?',
      [BG3_ORPHAN_RECONCILIATION_ID],
    );
    assert.equal(logRows.length, 1);
    assert.equal(logRows[0].values.length, 1);
  });

  test('idempotent: second run on an already-clean database is a safe no-op', () => {
    seedFullyValidPair(BG3);

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
    clearPairRows(BG3);
    seedOrphan(BG3);
    seedOrphanModPack(BG3);

    reconcileBg3Orphan();

    const result = getBg3OrphanReconciliationResult();
    assert.equal(result?.status, 'blocked');
    assert.match((result as { reason: string }).reason, /canonical/i);

    const raw = getDb();
    assert.equal(raw.exec('SELECT * FROM trainer_catalog_games WHERE catalogGameId = ?', [BG3.orphanId]).length, 1);
    assert.equal(raw.exec('SELECT * FROM trainer_mod_packs WHERE packId = ?', [BG3.orphanPackId]).length, 1);
  });

  test('rolls back fully if deletion fails partway through the transaction', () => {
    seedFullyValidPair(BG3);

    const raw = getDb();
    raw.run(`
      CREATE TRIGGER IF NOT EXISTS force_bg3_rollback_test
      BEFORE DELETE ON trainer_catalog_games
      WHEN OLD.catalogGameId = '${BG3.orphanId}'
      BEGIN
        SELECT RAISE(ABORT, 'forced failure for rollback test');
      END;
    `);

    assert.throws(() => reconcileBg3Orphan());

    raw.run('DROP TRIGGER IF EXISTS force_bg3_rollback_test');

    assert.equal(raw.exec('SELECT * FROM trainer_catalog_games WHERE catalogGameId = ?', [BG3.orphanId]).length, 1);
    assert.equal(raw.exec('SELECT * FROM trainer_mod_packs WHERE packId = ?', [BG3.orphanPackId]).length, 1);
    assert.equal(
      raw.exec('SELECT * FROM catalog_reconciliation_log WHERE reconciliationId = ?', [BG3_ORPHAN_RECONCILIATION_ID])
        .length,
      0,
    );
  });
});

describe('reconcileCatalogOrphans — table-driven, all eight authorized pairs', () => {
  before(async () => {
    await resetForTesting(':memory:');
  });

  for (const pair of ALL_PAIRS) {
    describe(`pair: ${pair.reconciliationId}`, () => {
      test('applies when canonical row, exact orphan row, and exact orphan mod pack all match', () => {
        seedFullyValidPair(pair);

        reconcileCatalogOrphans();

        const result = getCatalogOrphanReconciliationResult(pair.reconciliationId);
        assert.deepEqual(result, { status: 'applied', reconciliationId: pair.reconciliationId });

        const raw = getDb();
        assert.equal(
          raw.exec('SELECT * FROM trainer_catalog_games WHERE catalogGameId = ?', [pair.orphanId]).length,
          0,
        );
        assert.equal(raw.exec('SELECT * FROM trainer_mod_packs WHERE packId = ?', [pair.orphanPackId]).length, 0);
        assert.equal(
          raw.exec('SELECT * FROM trainer_catalog_games WHERE catalogGameId = ?', [pair.canonicalId]).length,
          1,
        );

        const logRows = raw.exec(
          'SELECT reconciliationId, catalogGameId FROM catalog_reconciliation_log WHERE reconciliationId = ?',
          [pair.reconciliationId],
        );
        assert.equal(logRows.length, 1);
      });

      test('idempotent: second run on an already-clean database is a safe no-op', () => {
        seedFullyValidPair(pair);

        reconcileCatalogOrphans();
        assert.equal(getCatalogOrphanReconciliationResult(pair.reconciliationId)?.status, 'applied');

        const raw = getDb();
        const logCountAfterFirstRun = raw.exec(
          'SELECT COUNT(*) FROM catalog_reconciliation_log WHERE reconciliationId = ?',
          [pair.reconciliationId],
        )[0].values[0][0];

        reconcileCatalogOrphans();
        assert.deepEqual(getCatalogOrphanReconciliationResult(pair.reconciliationId), { status: 'already-clean' });

        const logCountAfterSecondRun = raw.exec(
          'SELECT COUNT(*) FROM catalog_reconciliation_log WHERE reconciliationId = ?',
          [pair.reconciliationId],
        )[0].values[0][0];
        assert.equal(logCountAfterSecondRun, logCountAfterFirstRun);
      });

      test('blocks and leaves data untouched when canonical row is missing', () => {
        clearPairRows(pair);
        seedOrphan(pair);
        seedOrphanModPack(pair);

        reconcileCatalogOrphans();

        const result = getCatalogOrphanReconciliationResult(pair.reconciliationId);
        assert.equal(result?.status, 'blocked');
        assert.match((result as { reason: string }).reason, /canonical/i);

        const raw = getDb();
        assert.equal(
          raw.exec('SELECT * FROM trainer_catalog_games WHERE catalogGameId = ?', [pair.orphanId]).length,
          1,
        );
        assert.equal(raw.exec('SELECT * FROM trainer_mod_packs WHERE packId = ?', [pair.orphanPackId]).length, 1);
      });

      test('blocks when canonical proof does not match', () => {
        clearPairRows(pair);
        if (pair.proof.method === 'steamAppId') {
          seedCanonical(pair, { steamAppId: 999999 });
        } else {
          seedCanonical(pair, { sourceUrl: 'https://example.com/different-page/' });
        }
        seedOrphan(pair);
        seedOrphanModPack(pair);

        reconcileCatalogOrphans();

        const result = getCatalogOrphanReconciliationResult(pair.reconciliationId);
        assert.equal(result?.status, 'blocked');

        const raw = getDb();
        assert.equal(
          raw.exec('SELECT * FROM trainer_catalog_games WHERE catalogGameId = ?', [pair.orphanId]).length,
          1,
        );
      });

      if (pair.proof.method === 'providerUrl') {
        test('blocks when orphan source URL does not match (provider-URL proof pair only)', () => {
          seedFullyValidPair(pair);
          const raw = getDb();
          raw.run('UPDATE trainer_catalog_games SET sourcesJson = ? WHERE catalogGameId = ?', [
            sourcesJsonFor(pair.provider, 'https://example.com/other-listing/'),
            pair.orphanId,
          ]);

          reconcileCatalogOrphans();

          const result = getCatalogOrphanReconciliationResult(pair.reconciliationId);
          assert.equal(result?.status, 'blocked');
          assert.equal(
            raw.exec('SELECT * FROM trainer_catalog_games WHERE catalogGameId = ?', [pair.orphanId]).length,
            1,
          );
        });
      }

      test('blocks and leaves data untouched when orphan has a definition_feedback reference', () => {
        seedFullyValidPair(pair);
        const raw = getDb();
        raw.run(`INSERT INTO definition_feedback (catalogGameId, featureId, rating) VALUES (?, 'health', 1)`, [
          pair.orphanId,
        ]);

        reconcileCatalogOrphans();

        const result = getCatalogOrphanReconciliationResult(pair.reconciliationId);
        assert.equal(result?.status, 'blocked');
        assert.match((result as { reason: string }).reason, /definition_feedback/i);
        assert.equal(
          raw.exec('SELECT * FROM trainer_catalog_games WHERE catalogGameId = ?', [pair.orphanId]).length,
          1,
        );
      });

      test('blocks and leaves data untouched when orphan has a definition_update_queue reference', () => {
        seedFullyValidPair(pair);
        const raw = getDb();
        raw.run(`INSERT INTO definition_update_queue (catalogGameId, reason) VALUES (?, 'test')`, [pair.orphanId]);

        reconcileCatalogOrphans();

        const result = getCatalogOrphanReconciliationResult(pair.reconciliationId);
        assert.equal(result?.status, 'blocked');
        assert.match((result as { reason: string }).reason, /definition_update_queue/i);
      });

      test('blocks and leaves data untouched when orphan mod pack has an unexpected packId', () => {
        clearPairRows(pair);
        seedCanonical(pair);
        seedOrphan(pair);
        seedOrphanModPack(pair, `${pair.orphanPackId}-unexpected`);

        reconcileCatalogOrphans();

        const result = getCatalogOrphanReconciliationResult(pair.reconciliationId);
        assert.equal(result?.status, 'blocked');
        assert.match((result as { reason: string }).reason, /trainer_mod_packs/i);

        const raw = getDb();
        assert.equal(
          raw.exec('SELECT * FROM trainer_catalog_games WHERE catalogGameId = ?', [pair.orphanId]).length,
          1,
        );
      });

      test('blocks and leaves data untouched when orphan has more than one dependent mod pack', () => {
        clearPairRows(pair);
        seedCanonical(pair);
        seedOrphan(pair);
        seedOrphanModPack(pair);
        seedOrphanModPack(pair, `${pair.orphanPackId}-extra`);

        reconcileCatalogOrphans();

        const result = getCatalogOrphanReconciliationResult(pair.reconciliationId);
        assert.equal(result?.status, 'blocked');
      });

      test('blocks without fuzzy matching when the orphan displayName does not match exactly', () => {
        clearPairRows(pair);
        seedCanonical(pair);
        seedOrphan(pair, { displayName: `${pair.orphanDisplayName} (Definitive Edition)` });
        seedOrphanModPack(pair);

        reconcileCatalogOrphans();

        const result = getCatalogOrphanReconciliationResult(pair.reconciliationId);
        assert.equal(result?.status, 'blocked');
        assert.match((result as { reason: string }).reason, /displayName/);
      });

      test('blocks when the orphan already carries a non-null steamAppId', () => {
        clearPairRows(pair);
        seedCanonical(pair);
        seedOrphan(pair, { steamAppId: 999 });
        seedOrphanModPack(pair);

        reconcileCatalogOrphans();

        const result = getCatalogOrphanReconciliationResult(pair.reconciliationId);
        assert.equal(result?.status, 'blocked');
        assert.match((result as { reason: string }).reason, /steamAppId/);
      });

      test('reports already-clean when the orphan row was never present', () => {
        clearPairRows(pair);
        seedCanonical(pair);

        reconcileCatalogOrphans();

        assert.deepEqual(getCatalogOrphanReconciliationResult(pair.reconciliationId), { status: 'already-clean' });
      });

      test('rolls back fully if deletion fails partway through the transaction', () => {
        seedFullyValidPair(pair);

        const raw = getDb();
        raw.run(`
          CREATE TRIGGER IF NOT EXISTS force_pair_rollback_test
          BEFORE DELETE ON trainer_catalog_games
          WHEN OLD.catalogGameId = '${pair.orphanId}'
          BEGIN
            SELECT RAISE(ABORT, 'forced failure for rollback test');
          END;
        `);

        assert.throws(() => reconcileCatalogOrphans());

        raw.run('DROP TRIGGER IF EXISTS force_pair_rollback_test');

        assert.equal(
          raw.exec('SELECT * FROM trainer_catalog_games WHERE catalogGameId = ?', [pair.orphanId]).length,
          1,
        );
        assert.equal(raw.exec('SELECT * FROM trainer_mod_packs WHERE packId = ?', [pair.orphanPackId]).length, 1);
        assert.equal(
          raw.exec('SELECT * FROM catalog_reconciliation_log WHERE reconciliationId = ?', [pair.reconciliationId])
            .length,
          0,
        );
      });
    });
  }

  test('mixed-group execution: valid pairs apply, blocked pair stays untouched, clean pair stays untouched, per-pair results are accurate', () => {
    const valid = SEVEN_PAIRS[0];
    const blocked = SEVEN_PAIRS[1];
    const alreadyClean = SEVEN_PAIRS[2];

    clearPairRows(valid);
    seedCanonical(valid);
    seedOrphan(valid);
    seedOrphanModPack(valid);

    clearPairRows(blocked);
    seedOrphan(blocked);
    seedOrphanModPack(blocked);
    // canonical row intentionally missing for `blocked`

    clearPairRows(alreadyClean);
    seedCanonical(alreadyClean);
    // no orphan row for `alreadyClean`

    for (const other of ALL_PAIRS) {
      if (other === valid || other === blocked || other === alreadyClean) continue;
      clearPairRows(other);
    }

    reconcileCatalogOrphans();

    assert.deepEqual(getCatalogOrphanReconciliationResult(valid.reconciliationId), {
      status: 'applied',
      reconciliationId: valid.reconciliationId,
    });
    const blockedResult = getCatalogOrphanReconciliationResult(blocked.reconciliationId);
    assert.equal(blockedResult?.status, 'blocked');
    assert.deepEqual(getCatalogOrphanReconciliationResult(alreadyClean.reconciliationId), {
      status: 'already-clean',
    });

    const raw = getDb();
    assert.equal(raw.exec('SELECT * FROM trainer_catalog_games WHERE catalogGameId = ?', [valid.orphanId]).length, 0);
    assert.equal(
      raw.exec('SELECT * FROM trainer_catalog_games WHERE catalogGameId = ?', [blocked.orphanId]).length,
      1,
    );
  });

  test('BG3 regression: reconcileCatalogOrphans preserves the original BG3-only reconciliation behavior', () => {
    seedFullyValidPair(BG3);
    for (const other of SEVEN_PAIRS) clearPairRows(other);

    reconcileCatalogOrphans();

    assert.deepEqual(getCatalogOrphanReconciliationResult(BG3_ORPHAN_RECONCILIATION_ID), {
      status: 'applied',
      reconciliationId: BG3_ORPHAN_RECONCILIATION_ID,
    });
    const raw = getDb();
    assert.equal(raw.exec('SELECT * FROM trainer_catalog_games WHERE catalogGameId = ?', [BG3.orphanId]).length, 0);
  });
});
