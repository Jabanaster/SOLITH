import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { SignedCatalogUpdatePackageSchema, MAX_CATALOG_UPDATE_RECORDS } from '../src/core/catalog-updates/manifest-schema.ts';

function validPackage() {
  return {
    manifest: {
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      notice: 'Catalog updated — 1 game added.',
      records: [{ kind: 'add', catalogGameId: 'a-game', patch: { displayName: 'A Game' } }],
    },
    signature: 'c29tZS1zaWduYXR1cmU=',
  };
}

describe('SignedCatalogUpdatePackageSchema', () => {
  test('accepts a well-formed package', () => {
    const result = SignedCatalogUpdatePackageSchema.safeParse(validPackage());
    assert.equal(result.success, true);
  });

  test('rejects an empty records array', () => {
    const pkg = validPackage();
    pkg.manifest.records = [];
    assert.equal(SignedCatalogUpdatePackageSchema.safeParse(pkg).success, false);
  });

  test('rejects a record count over the bounded limit', () => {
    const pkg = validPackage();
    pkg.manifest.records = Array.from({ length: MAX_CATALOG_UPDATE_RECORDS + 1 }, (_, i) => ({
      kind: 'add' as const,
      catalogGameId: `game-${i}`,
      patch: { displayName: `Game ${i}` },
    }));
    assert.equal(SignedCatalogUpdatePackageSchema.safeParse(pkg).success, false);
  });

  test('rejects an unknown record kind', () => {
    const pkg = validPackage();
    (pkg.manifest.records[0] as unknown as { kind: string }).kind = 'execute-script';
    assert.equal(SignedCatalogUpdatePackageSchema.safeParse(pkg).success, false);
  });

  test('rejects a negative or zero version', () => {
    const pkg = validPackage();
    pkg.manifest.version = 0;
    assert.equal(SignedCatalogUpdatePackageSchema.safeParse(pkg).success, false);
  });

  test('rejects a patch field not on the allowlist (strict schema)', () => {
    const pkg = validPackage();
    (pkg.manifest.records[0].patch as Record<string, unknown>).arbitraryScript = 'rm -rf /';
    assert.equal(SignedCatalogUpdatePackageSchema.safeParse(pkg).success, false);
  });

  test('rejects an invalid antiCheat enum value', () => {
    const pkg = validPackage();
    (pkg.manifest.records[0].patch as Record<string, unknown>).antiCheat = 'totally-fine-trust-me';
    assert.equal(SignedCatalogUpdatePackageSchema.safeParse(pkg).success, false);
  });

  test('rejects a non-http(s) headerUrl scheme', () => {
    const pkg = validPackage();
    (pkg.manifest.records[0].patch as Record<string, unknown>).headerUrl = 'javascript:alert(1)';
    assert.equal(SignedCatalogUpdatePackageSchema.safeParse(pkg).success, false);
  });

  test('rejects a plain http:// headerUrl (https-only)', () => {
    const pkg = validPackage();
    (pkg.manifest.records[0].patch as Record<string, unknown>).headerUrl = 'http://example.com/header.jpg';
    assert.equal(SignedCatalogUpdatePackageSchema.safeParse(pkg).success, false);
  });

  test('accepts a well-formed https headerUrl', () => {
    const pkg = validPackage();
    (pkg.manifest.records[0].patch as Record<string, unknown>).headerUrl = 'https://example.com/header.jpg';
    assert.equal(SignedCatalogUpdatePackageSchema.safeParse(pkg).success, true);
  });

  test('has no field anywhere for artwork rights class or license assertion (ROADMAP §5.10)', () => {
    const pkg = validPackage();
    for (const forbidden of ['rightsClass', 'isLicensed', 'solithOwned', 'explicitlyLicensed']) {
      const withForbidden = JSON.parse(JSON.stringify(pkg));
      (withForbidden.manifest.records[0].patch as Record<string, unknown>)[forbidden] = true;
      assert.equal(
        SignedCatalogUpdatePackageSchema.safeParse(withForbidden).success,
        false,
        `schema must reject an injected "${forbidden}" field`,
      );
    }
  });

  test('rejects a top-level field not on the allowlist', () => {
    const pkg = validPackage() as Record<string, unknown>;
    pkg.extraField = 'anything';
    assert.equal(SignedCatalogUpdatePackageSchema.safeParse(pkg).success, false);
  });
});
