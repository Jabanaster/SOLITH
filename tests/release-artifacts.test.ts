import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  findResourceForgeSetupArtifacts,
  getReleaseFiles,
  releaseArtifactPaths,
  sha256File,
} from '../scripts/release-artifact-utils.mjs';

function makeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'resourceforge-release-artifacts-'));
}

test('release artifact paths are versioned for ResourceForge 1.5.0', () => {
  const root = makeRoot();
  const pkg = { version: '1.5.0' };
  const paths = releaseArtifactPaths(root, pkg);

  assert.equal(path.basename(paths.installer), 'ResourceForge Setup 1.5.0.exe');
  assert.equal(path.basename(paths.executable), 'ResourceForge.exe');
  assert.equal(paths.unpackedHost.endsWith(path.join('app.asar.unpacked', 'dist-electron', 'host-entry.js')), true);

  fs.rmSync(root, { recursive: true, force: true });
});

test('release artifact listing finds ResourceForge setup artifacts', () => {
  const root = makeRoot();
  const dist = path.join(root, 'dist');
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, 'ResourceForge Setup 1.5.0.exe'), 'current');
  fs.writeFileSync(path.join(dist, 'ResourceForge Setup 1.4.0.exe'), 'stale');

  assert.deepEqual(findResourceForgeSetupArtifacts(root).sort(), [
    'ResourceForge Setup 1.4.0.exe',
    'ResourceForge Setup 1.5.0.exe',
  ]);

  fs.rmSync(root, { recursive: true, force: true });
});

test('release checksum helper returns sha256 for generated artifacts', () => {
  const root = makeRoot();
  const dist = path.join(root, 'dist');
  fs.mkdirSync(dist, { recursive: true });
  const installer = path.join(dist, 'ResourceForge Setup 1.5.0.exe');
  fs.writeFileSync(installer, 'resourceforge');

  const pkg = { version: '1.5.0' };
  assert.deepEqual(getReleaseFiles(root, pkg), [installer]);
  assert.equal(sha256File(installer), '550be7a3bf202837908830d04feeffd3f565b4b3c5f20a80142ebbda422103da');

  fs.rmSync(root, { recursive: true, force: true });
});
