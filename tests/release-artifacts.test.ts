import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'solith-release-artifacts-'));
}

test('release artifact paths follow package productName and version', () => {
  const root = makeRoot();
  const pkg = readPackageMetadata(findRepoRoot(import.meta.url));
  const paths = releaseArtifactPaths(root, pkg);

  assert.equal(path.basename(paths.installer), `Solith Setup ${pkg.version}.exe`);
  assert.equal(path.basename(paths.executable), 'Solith.exe');
  assert.equal(paths.unpackedHost.endsWith(path.join('app.asar.unpacked', 'dist-electron', 'host-entry.js')), true);

  fs.rmSync(root, { recursive: true, force: true });
});

test('release artifact listing finds Solith setup artifacts', () => {
  const root = makeRoot();
  const dist = path.join(root, 'dist');
  fs.mkdirSync(dist, { recursive: true });
  const pkg = readPackageMetadata(findRepoRoot(import.meta.url));
  const currentSetup = `Solith Setup ${pkg.version}.exe`;
  const staleSetup = 'Solith Setup 1.9.0.exe';
  fs.writeFileSync(path.join(dist, currentSetup), 'current');
  fs.writeFileSync(path.join(dist, staleSetup), 'stale');

  assert.deepEqual(findProductSetupArtifacts(root, pkg).sort(), [
    staleSetup,
    currentSetup,
  ].sort());

  fs.rmSync(root, { recursive: true, force: true });
});

test('release checksum helper returns sha256 for generated artifacts', () => {
  const root = makeRoot();
  const dist = path.join(root, 'dist');
  fs.mkdirSync(dist, { recursive: true });
  const pkg = readPackageMetadata(findRepoRoot(import.meta.url));
  const installer = path.join(dist, `Solith Setup ${pkg.version}.exe`);
  const content = 'solith';
  fs.writeFileSync(installer, content);

  const expectedSha = crypto.createHash('sha256').update(content).digest('hex');
  assert.deepEqual(getReleaseFiles(root, pkg), [installer]);
  assert.equal(sha256File(installer), expectedSha);

  fs.rmSync(root, { recursive: true, force: true });
});
