import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  findProductSetupArtifacts,
  findRepoRoot,
  getReleaseFiles,
  readPackageMetadata,
  releaseArtifactPaths,
  sha256File,
} from '../scripts/release-artifact-utils.mjs';

function makeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'resourceforge-release-artifacts-'));
}

test('release artifact paths follow package productName (Solith 2.0.0)', () => {
  const root = makeRoot();
  const pkg = readPackageMetadata(findRepoRoot(import.meta.url));
  const paths = releaseArtifactPaths(root, pkg);

  assert.equal(path.basename(paths.installer), 'Solith Setup 2.0.0.exe');
  assert.equal(path.basename(paths.executable), 'Solith.exe');
  assert.equal(paths.unpackedHost.endsWith(path.join('app.asar.unpacked', 'dist-electron', 'host-entry.js')), true);

  fs.rmSync(root, { recursive: true, force: true });
});

test('release artifact listing finds Solith setup artifacts', () => {
  const root = makeRoot();
  const dist = path.join(root, 'dist');
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, 'Solith Setup 2.0.0.exe'), 'current');
  fs.writeFileSync(path.join(dist, 'Solith Setup 1.9.0.exe'), 'stale');

  const pkg = { version: '2.0.0', build: { productName: 'Solith' } };
  assert.deepEqual(findProductSetupArtifacts(root, pkg).sort(), [
    'Solith Setup 1.9.0.exe',
    'Solith Setup 2.0.0.exe',
  ]);

  fs.rmSync(root, { recursive: true, force: true });
});

test('release checksum helper returns sha256 for generated artifacts', () => {
  const root = makeRoot();
  const dist = path.join(root, 'dist');
  fs.mkdirSync(dist, { recursive: true });
  const installer = path.join(dist, 'Solith Setup 2.0.0.exe');
  fs.writeFileSync(installer, 'resourceforge');

  const pkg = { version: '2.0.0', build: { productName: 'Solith' } };
  assert.deepEqual(getReleaseFiles(root, pkg), [installer]);
  assert.equal(sha256File(installer), '550be7a3bf202837908830d04feeffd3f565b4b3c5f20a80142ebbda422103da');

  fs.rmSync(root, { recursive: true, force: true });
});
