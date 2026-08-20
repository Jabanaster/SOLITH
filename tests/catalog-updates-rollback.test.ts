import { after as afterAll, before as beforeAll, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { resetForTesting } from '../src/core/database/index.ts';
import { applySignedCatalogUpdate } from '../src/core/catalog-updates/apply.ts';
import { rollbackCatalogUpdate } from '../src/core/catalog-updates/rollback.ts';
import { canonicalizeForSigning } from '../src/core/catalog-updates/canonical.ts';
import { getCatalogUpdateState, listCatalogUpdateHistory } from '../src/core/catalog-updates/store.ts';
import { getCatalogEntry, upsertCatalogEntry } from '../src/core/trainer-catalog/store.ts';
import type { CatalogUpdateManifest, SignedCatalogUpdatePackage } from '../src/core/catalog-updates/types.ts';

const TEST_PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIH/bSebUQjeRKoZXCROjazY+igPtKM3c363sA+svTRHe
-----END PRIVATE KEY-----
`;

function sign(m: CatalogUpdateManifest): SignedCatalogUpdatePackage {
  const privateKey = crypto.createPrivateKey(TEST_PRIVATE_KEY_PEM);
  const payload = Buffer.from(canonicalizeForSigning(m), 'utf8');
  return { manifest: m, signature: crypto.sign(null, payload, privateKey).toString('base64') };
}

describe('rollbackCatalogUpdate', () => {
  beforeAll(async () => {
    await resetForTesting();
  });
  afterAll(async () => {
    await resetForTesting();
  });

  test('restores a corrected field to its exact pre-update value', () => {
    // Corrects cheatCount, not displayName/steamAppId — either of those
    // triggers a genuine identity-review collision candidate under the
    // reused eligibility/identity gate (see the dedicated test below) and
    // would defer rather than apply directly.
    upsertCatalogEntry({
      catalogGameId: 'rollback-target',
      displayName: 'Stable Title',
      executables: [],
      categories: [],
      verificationStatus: 'community',
      sources: [],
      hasModPack: false,
      cheatCount: 3,
      searchableText: 'stable title',
    });

    applySignedCatalogUpdate(
      sign({
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        notice: 'correction',
        records: [{ kind: 'correct', catalogGameId: 'rollback-target', patch: { cheatCount: 12 } }],
      }),
    );
    assert.equal(getCatalogEntry('rollback-target')!.cheatCount, 12);

    const historyId = listCatalogUpdateHistory()[0].id;
    const result = rollbackCatalogUpdate(historyId);
    assert.equal(result.success, true);
    assert.equal(result.restoredCount, 1);
    assert.equal(getCatalogEntry('rollback-target')!.cheatCount, 3);
    assert.equal(getCatalogUpdateState().currentVersion, 0);
  });

  test('rolling back an update that added a brand-new entry deletes it', () => {
    applySignedCatalogUpdate(
      sign({
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        notice: 'new game',
        records: [{ kind: 'add', catalogGameId: 'was-brand-new', patch: { displayName: 'New Game' } }],
      }),
    );
    assert.ok(getCatalogEntry('was-brand-new'));

    const historyId = listCatalogUpdateHistory()[0].id;
    const result = rollbackCatalogUpdate(historyId);
    assert.equal(result.success, true);
    assert.equal(getCatalogEntry('was-brand-new'), null, 'a rolled-back add must remove the entry entirely, not leave a stub');
  });

  test('rolling back a non-existent history id fails cleanly', () => {
    const result = rollbackCatalogUpdate(999999);
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /no such/i);
  });

  test('rolling back an already-rolled-back entry is refused', () => {
    applySignedCatalogUpdate(
      sign({ version: 1, createdAt: '2026-01-01T00:00:00.000Z', notice: 'x', records: [{ kind: 'add', catalogGameId: 'double-rollback', patch: { displayName: 'X' } }] }),
    );
    const historyId = listCatalogUpdateHistory()[0].id;
    assert.equal(rollbackCatalogUpdate(historyId).success, true);
    const second = rollbackCatalogUpdate(historyId);
    assert.equal(second.success, false);
    assert.match(second.error ?? '', /not 'applied'/);
  });

  test('rolling back a rejected entry (never applied) is refused', () => {
    applySignedCatalogUpdate({ manifest: { version: 999 } as unknown as CatalogUpdateManifest, signature: 'x' });
    const rejected = listCatalogUpdateHistory().find((entry) => entry.status === 'rejected');
    assert.ok(rejected);
    const result = rollbackCatalogUpdate(rejected!.id);
    assert.equal(result.success, false);
  });

  test('rolling back a superseded (non-latest) update out of order is refused', () => {
    applySignedCatalogUpdate(
      sign({ version: 1, createdAt: '2026-01-01T00:00:00.000Z', notice: 'a', records: [{ kind: 'add', catalogGameId: 'first-of-two', patch: { displayName: 'A' } }] }),
    );
    const firstHistoryId = listCatalogUpdateHistory()[0].id;
    applySignedCatalogUpdate(
      sign({ version: 2, createdAt: '2026-01-02T00:00:00.000Z', notice: 'b', records: [{ kind: 'add', catalogGameId: 'second-of-two', patch: { displayName: 'B' } }] }),
    );
    const result = rollbackCatalogUpdate(firstHistoryId);
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /most recently applied/i);
  });
});
