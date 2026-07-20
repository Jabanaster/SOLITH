import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { compileSolithCtRegistry } from '../src/core/registry/compile-ct-registry.ts';
import { REGISTRY_SCHEMA_VERSION } from '../src/core/registry/schema.ts';
import {
  assertValidRegistryArtifact,
  validateRegistryArtifact,
} from '../src/core/registry/validate-registry.ts';

const SAMPLE_CT = `<?xml version="1.0" encoding="utf-8"?>
<CheatTable>
  <CheatTableTitle>Avowed</CheatTableTitle>
  <CheatEntries>
    <CheatEntry>
      <Description>"Health Script"</Description>
      <CheatScript>[ENABLE]
aobscanmodule(playerHealth,Avowed-Win64-Shipping.exe,48 8B ?? 89)
[DISABLE]</CheatScript>
    </CheatEntry>
  </CheatEntries>
</CheatTable>`;

async function compileFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-registry-schema-'));
  const ctPath = path.join(dir, 'Avowed.CT');
  fs.writeFileSync(ctPath, SAMPLE_CT, 'utf8');
  return {
    ctPath,
    registry: await compileSolithCtRegistry(ctPath, {
      game: 'Avowed',
      title: 'Avowed',
      compiledAt: '2026-07-20T00:00:00.000Z',
    }),
  };
}

describe('registry schema validation', () => {
  test('adds versioned metadata with source hash and counts', async () => {
    const { ctPath, registry } = await compileFixture();

    assert.equal(registry.artifact.schemaVersion, REGISTRY_SCHEMA_VERSION);
    assert.equal(registry.artifact.generatedAt, '2026-07-20T00:00:00.000Z');
    assert.equal(registry.artifact.source.filename, 'Avowed.CT');
    assert.equal(registry.artifact.source.path, path.resolve(ctPath));
    assert.equal(
      registry.artifact.source.sha256,
      crypto.createHash('sha256').update(SAMPLE_CT, 'utf8').digest('hex'),
    );
    assert.deepEqual(registry.artifact.counts, {
      pointers: 0,
      scripts: 1,
      aobSignatures: 1,
      rejections: 1,
      warnings: 0,
      duplicates: 0,
    });
  });

  test('accepts valid artifacts with runtime validation', async () => {
    const { registry } = await compileFixture();
    const result = validateRegistryArtifact(registry);

    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
    assert.doesNotThrow(() => assertValidRegistryArtifact(registry));
  });

  test('rejects malformed artifacts cleanly', async () => {
    const { registry } = await compileFixture();
    const malformed = {
      ...registry,
      artifact: {
        ...registry.artifact,
        source: { ...registry.artifact.source, sha256: 'nope' },
      },
      aobSignatures: [{ ...registry.aobSignatures[0], executable: true }],
    };

    const result = validateRegistryArtifact(malformed);
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /sha256/);
    assert.match(result.errors.join('\n'), /executable must be false/);
    assert.throws(() => assertValidRegistryArtifact(malformed), /Invalid registry artifact/);
  });

  test('rejects unsupported schema versions', async () => {
    const { registry } = await compileFixture();
    const unsupported = {
      ...registry,
      artifact: { ...registry.artifact, schemaVersion: 999 },
    };

    const result = validateRegistryArtifact(unsupported);
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /artifact.schemaVersion/);
  });
});
