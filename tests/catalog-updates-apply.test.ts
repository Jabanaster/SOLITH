import { after as afterAll, before as beforeAll, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { resetForTesting } from '../src/core/database/index.ts';
import { applySignedCatalogUpdate } from '../src/core/catalog-updates/apply.ts';
import { canonicalizeForSigning } from '../src/core/catalog-updates/canonical.ts';
import { getCatalogUpdateState, listCatalogUpdateHistory, updateCatalogUpdateState } from '../src/core/catalog-updates/store.ts';
import { getCatalogEntry } from '../src/core/trainer-catalog/store.ts';
import { filterEligibleForTrainerLibrary } from '../src/core/trainer-catalog/eligibility-classification.ts';
import type { CatalogUpdateManifest, SignedCatalogUpdatePackage } from '../src/core/catalog-updates/types.ts';

const TEST_PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIH/bSebUQjeRKoZXCROjazY+igPtKM3c363sA+svTRHe
-----END PRIVATE KEY-----
`;

function manifest(overrides: Partial<CatalogUpdateManifest> = {}): CatalogUpdateManifest {
  return {
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    notice: 'Catalog updated — 1 game added.',
    records: [{ kind: 'add', catalogGameId: 'signed-game-1', patch: { displayName: 'Signed Game One' } }],
    ...overrides,
  };
}

function sign(m: CatalogUpdateManifest, privateKeyPem = TEST_PRIVATE_KEY_PEM): SignedCatalogUpdatePackage {
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const payload = Buffer.from(canonicalizeForSigning(m), 'utf8');
  return { manifest: m, signature: crypto.sign(null, payload, privateKey).toString('base64') };
}

describe('applySignedCatalogUpdate', () => {
  beforeAll(async () => {
    await resetForTesting();
  });
  afterAll(async () => {
    await resetForTesting();
  });

  test('a validly signed, version-1 manifest is applied and the entry appears', () => {
    const result = applySignedCatalogUpdate(sign(manifest()));
    assert.equal(result.status, 'applied');
    assert.equal(result.version, 1);
    const entry = getCatalogEntry('signed-game-1');
    assert.ok(entry);
    assert.equal(entry!.displayName, 'Signed Game One');
    assert.equal(getCatalogUpdateState().currentVersion, 1);
    assert.ok(getCatalogUpdateState().lastSuccessAt);
  });

  test('a replayed (already-applied) version is rejected, catalog unchanged', () => {
    const before = getCatalogEntry('signed-game-1');
    const result = applySignedCatalogUpdate(sign(manifest({ version: 1 })));
    assert.equal(result.status, 'rejected');
    assert.match(result.rejectReason ?? '', /replay/i);
    assert.deepEqual(getCatalogEntry('signed-game-1'), before);
  });

  test('a downgrade (lower than current version) is rejected', () => {
    applySignedCatalogUpdate(sign(manifest({ version: 5, records: [{ kind: 'add', catalogGameId: 'g5', patch: { displayName: 'G5' } }] })));
    assert.equal(getCatalogUpdateState().currentVersion, 5);
    const result = applySignedCatalogUpdate(sign(manifest({ version: 2 })));
    assert.equal(result.status, 'rejected');
    assert.match(result.rejectReason ?? '', /downgrade/i);
    assert.equal(getCatalogUpdateState().currentVersion, 5, 'a rejected downgrade must not move the version backward');
  });

  test('an unsigned/invalid signature is rejected and never touches the catalog', () => {
    const pkg = sign(manifest({ version: 6, records: [{ kind: 'add', catalogGameId: 'never-written', patch: { displayName: 'X' } }] }));
    const tampered: SignedCatalogUpdatePackage = { ...pkg, signature: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
    const result = applySignedCatalogUpdate(tampered);
    assert.equal(result.status, 'rejected');
    assert.match(result.rejectReason ?? '', /signature/i);
    assert.equal(getCatalogEntry('never-written'), null);
  });

  test('a payload altered after signing is rejected', () => {
    const pkg = sign(manifest({ version: 6, records: [{ kind: 'add', catalogGameId: 'tamper-target', patch: { displayName: 'Original' } }] }));
    const tampered: SignedCatalogUpdatePackage = {
      ...pkg,
      manifest: { ...pkg.manifest, records: [{ kind: 'add', catalogGameId: 'tamper-target', patch: { displayName: 'Injected' } }] },
    };
    const result = applySignedCatalogUpdate(tampered);
    assert.equal(result.status, 'rejected');
    assert.equal(getCatalogEntry('tamper-target'), null);
  });

  test('a malformed manifest (fails schema) is rejected without ever reaching signature verification', () => {
    const result = applySignedCatalogUpdate({ manifest: { version: 6 }, signature: 'x' });
    assert.equal(result.status, 'rejected');
    assert.match(result.rejectReason ?? '', /malformed/i);
  });

  test('atomicity: a manifest containing one invalid record applies NONE of its records', () => {
    const before = getCatalogEntry('signed-game-1');
    const mixed = manifest({
      version: 7,
      records: [
        { kind: 'correct', catalogGameId: 'signed-game-1', patch: { displayName: 'Should Not Apply' } },
        // no displayName and no existing row for this id — invalid 'add'
        { kind: 'add', catalogGameId: 'brand-new-invalid' },
      ],
    });
    const result = applySignedCatalogUpdate(sign(mixed));
    assert.equal(result.status, 'rejected');
    assert.deepEqual(getCatalogEntry('signed-game-1'), before, 'the valid record in a rejected manifest must not be partially applied');
    assert.equal(getCatalogEntry('brand-new-invalid'), null);
    assert.equal(getCatalogUpdateState().currentVersion, 5, 'version must not advance on a rejected manifest');
  });

  test('bundledSnapshotOnly mode rejects every signed update, even a valid one', () => {
    updateCatalogUpdateState({ bundledSnapshotOnly: true });
    const result = applySignedCatalogUpdate(sign(manifest({ version: 8, records: [{ kind: 'add', catalogGameId: 'blocked-by-snapshot-mode', patch: { displayName: 'X' } }] })));
    assert.equal(result.status, 'rejected');
    assert.match(result.rejectReason ?? '', /bundled-snapshot-only/i);
    assert.equal(getCatalogEntry('blocked-by-snapshot-mode'), null);
    updateCatalogUpdateState({ bundledSnapshotOnly: false });
  });

  test('a blocked-revoked record actually excludes the entry from the eligible Trainer Library set', () => {
    applySignedCatalogUpdate(sign(manifest({ version: 9, records: [{ kind: 'add', catalogGameId: 'later-blocked', patch: { displayName: 'Later Blocked', antiCheat: 'none' } }] })));
    assert.ok(filterEligibleForTrainerLibrary([getCatalogEntry('later-blocked')!]).length === 1);

    applySignedCatalogUpdate(sign(manifest({ version: 10, records: [{ kind: 'blocked-revoked', catalogGameId: 'later-blocked', patch: { catalogExclusionFlags: ['unsupported-delisted'] } }] })));
    const entry = getCatalogEntry('later-blocked')!;
    assert.deepEqual(entry.catalogExclusionFlags, ['unsupported-delisted']);
    assert.equal(filterEligibleForTrainerLibrary([entry]).length, 0, 'a blocked-revoked record must actually exclude the title, not just set a flag nobody reads');
  });

  test('a record that would trigger the reused identity-review collision gate rejects the whole manifest instead of silently skipping it', () => {
    applySignedCatalogUpdate(
      sign(manifest({ version: 11, records: [{ kind: 'add', catalogGameId: 'identity-guarded', patch: { displayName: 'Guarded Title' } }] })),
    );
    const before = getCatalogEntry('identity-guarded');
    assert.equal(before!.displayName, 'Guarded Title');

    // Renaming an existing catalogGameId is exactly what the reused
    // identity-review gate (src/core/trainer-catalog/identity-review.ts) is
    // designed to catch — this must defer, and this pipeline must treat a
    // deferral as a rejection of the entire manifest, never a silent no-op.
    const result = applySignedCatalogUpdate(
      sign(manifest({ version: 12, records: [{ kind: 'correct', catalogGameId: 'identity-guarded', patch: { displayName: 'Suspiciously Different Title' } }] })),
    );
    assert.equal(result.status, 'rejected');
    assert.match(result.rejectReason ?? '', /identity review/i);
    assert.deepEqual(getCatalogEntry('identity-guarded'), before);
    assert.equal(getCatalogUpdateState().currentVersion, 11, 'version must not advance when a record defers to identity review');
  });

  test('merge-alias records are rejected outright (not yet supported), not silently no-op\'d', () => {
    const result = applySignedCatalogUpdate(
      sign(manifest({ version: 13, records: [{ kind: 'merge-alias', catalogGameId: 'alias-a', mergeIntoCatalogGameId: 'canonical-b' }] })),
    );
    assert.equal(result.status, 'rejected');
    assert.match(result.rejectReason ?? '', /merge-alias/i);
  });

  test('ROADMAP §5.10: an artwork-metadata record can only ever change the entry\'s URL fields, never anything in the artwork_cache rights table', async () => {
    const { listAllArtworkCacheEntries } = await import('../src/core/artwork-cache/store.ts');
    const before = listAllArtworkCacheEntries().length;
    applySignedCatalogUpdate(
      sign(
        manifest({
          version: 14,
          records: [{ kind: 'artwork-metadata', catalogGameId: 'signed-game-1', patch: { headerUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1/header.jpg' } }],
        }),
      ),
    );
    assert.equal(getCatalogEntry('signed-game-1')!.headerUrl, 'https://cdn.cloudflare.steamstatic.com/steam/apps/1/header.jpg');
    assert.equal(listAllArtworkCacheEntries().length, before, 'catalog-updates must never write to the artwork_cache table itself');
  });
});
