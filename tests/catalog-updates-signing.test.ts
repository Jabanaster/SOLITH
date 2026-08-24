import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { canonicalizeForSigning } from '../src/core/catalog-updates/canonical.ts';
import { verifySignedCatalogUpdate, TRUSTED_CATALOG_UPDATE_PUBLIC_KEY_PEM } from '../src/core/catalog-updates/signing.ts';
import { isAcceptableUpdateVersion } from '../src/core/catalog-updates/version-gate.ts';
import { shouldCheckForCatalogUpdate, CATALOG_UPDATE_COOLDOWN_MS } from '../src/core/catalog-updates/cooldown.ts';
import type { CatalogUpdateManifest, SignedCatalogUpdatePackage } from '../src/core/catalog-updates/types.ts';

// Ephemeral test-only Ed25519 keypair, generated fresh per test run — never
// the production catalog signing key. verifySignedCatalogUpdate calls below
// pass TEST_PUBLIC_KEY_PEM explicitly rather than relying on the embedded
// production trust root, since the production private key never enters
// this repository (see signing.ts's doc comment).
const testKeyPair = crypto.generateKeyPairSync('ed25519');
const TEST_PRIVATE_KEY_PEM = testKeyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const TEST_PUBLIC_KEY_PEM = testKeyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();

function manifest(overrides: Partial<CatalogUpdateManifest> = {}): CatalogUpdateManifest {
  return {
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    notice: 'Catalog updated — 1 game added.',
    records: [{ kind: 'add', catalogGameId: 'test-game', patch: { displayName: 'Test Game' } }],
    ...overrides,
  };
}

function signManifest(m: CatalogUpdateManifest, privateKeyPem = TEST_PRIVATE_KEY_PEM): SignedCatalogUpdatePackage {
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const payload = Buffer.from(canonicalizeForSigning(m), 'utf8');
  const signature = crypto.sign(null, payload, privateKey).toString('base64');
  return { manifest: m, signature };
}

describe('canonicalizeForSigning', () => {
  test('is deterministic regardless of key insertion order', () => {
    const a = { b: 1, a: 2, nested: { z: 1, y: 2 } };
    const b = { a: 2, nested: { y: 2, z: 1 }, b: 1 };
    assert.equal(canonicalizeForSigning(a), canonicalizeForSigning(b));
  });

  test('preserves array order (arrays are not reordered, only object keys)', () => {
    assert.notEqual(canonicalizeForSigning([1, 2, 3]), canonicalizeForSigning([3, 2, 1]));
  });
});

describe('verifySignedCatalogUpdate', () => {
  test('valid signature is accepted', () => {
    const pkg = signManifest(manifest());
    assert.equal(verifySignedCatalogUpdate(pkg, TEST_PUBLIC_KEY_PEM), true);
  });

  test('a modified payload after signing is rejected', () => {
    const pkg = signManifest(manifest());
    const tampered: SignedCatalogUpdatePackage = { ...pkg, manifest: { ...pkg.manifest, version: 999 } };
    assert.equal(verifySignedCatalogUpdate(tampered, TEST_PUBLIC_KEY_PEM), false);
  });

  test('a signature from an unknown key is rejected', () => {
    const otherKeyPair = crypto.generateKeyPairSync('ed25519');
    const otherPrivatePem = otherKeyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const pkg = signManifest(manifest(), otherPrivatePem);
    assert.equal(verifySignedCatalogUpdate(pkg, TEST_PUBLIC_KEY_PEM), false);
  });

  test('a malformed base64 signature is rejected, not thrown', () => {
    const pkg = signManifest(manifest());
    assert.equal(verifySignedCatalogUpdate({ ...pkg, signature: 'not-valid-base64-!!!' }, TEST_PUBLIC_KEY_PEM), false);
  });

  test('an empty signature is rejected', () => {
    const pkg = signManifest(manifest());
    assert.equal(verifySignedCatalogUpdate({ ...pkg, signature: '' }, TEST_PUBLIC_KEY_PEM), false);
  });

  test('a non-Ed25519 public key (e.g. RSA) is rejected outright', () => {
    const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const rsaPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const pkg = signManifest(manifest());
    assert.equal(verifySignedCatalogUpdate(pkg, rsaPem), false);
  });

  test('a malformed public key PEM fails closed rather than throwing', () => {
    const pkg = signManifest(manifest());
    assert.doesNotThrow(() => verifySignedCatalogUpdate(pkg, 'not a pem at all'));
    assert.equal(verifySignedCatalogUpdate(pkg, 'not a pem at all'), false);
  });

  test('the embedded trust root is a real, valid Ed25519 public key', () => {
    const key = crypto.createPublicKey(TRUSTED_CATALOG_UPDATE_PUBLIC_KEY_PEM);
    assert.equal(key.asymmetricKeyType, 'ed25519');
  });
});

describe('isAcceptableUpdateVersion', () => {
  test('a strictly greater version is accepted', () => {
    assert.equal(isAcceptableUpdateVersion(2, 1), true);
  });

  test('the same version is rejected (replay)', () => {
    assert.equal(isAcceptableUpdateVersion(1, 1), false);
  });

  test('a lower version is rejected (downgrade)', () => {
    assert.equal(isAcceptableUpdateVersion(1, 2), false);
  });

  test('applying the same version twice is safe (second attempt rejected as replay)', () => {
    assert.equal(isAcceptableUpdateVersion(5, 5), false);
  });

  test('a non-integer version is rejected', () => {
    assert.equal(isAcceptableUpdateVersion(1.5, 1), false);
  });
});

describe('shouldCheckForCatalogUpdate', () => {
  test('checks when there is no recorded last success', () => {
    assert.equal(shouldCheckForCatalogUpdate(null, new Date('2026-01-02T00:00:00.000Z')), true);
  });

  test('skips when the last success was less than the cooldown ago', () => {
    const now = new Date('2026-01-02T00:00:00.000Z');
    const last = new Date(now.getTime() - CATALOG_UPDATE_COOLDOWN_MS / 2).toISOString();
    assert.equal(shouldCheckForCatalogUpdate(last, now), false);
  });

  test('checks again once the cooldown has fully elapsed', () => {
    const now = new Date('2026-01-02T00:00:00.000Z');
    const last = new Date(now.getTime() - CATALOG_UPDATE_COOLDOWN_MS).toISOString();
    assert.equal(shouldCheckForCatalogUpdate(last, now), true);
  });

  test('a malformed lastSuccessAt fails open (checks) rather than skipping forever', () => {
    assert.equal(shouldCheckForCatalogUpdate('not-a-timestamp', new Date()), true);
  });
});
