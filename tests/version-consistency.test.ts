import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readText(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function readJson(relPath: string): Record<string, unknown> {
  return JSON.parse(readText(relPath)) as Record<string, unknown>;
}

test('package.json is the single authoritative product version', () => {
  const pkg = readJson('package.json');
  const version = pkg.version;
  assert.equal(typeof version, 'string');
  assert.match(String(version), /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  // Current tree is still alpha — do not treat historical RC tags as the live SoT.
  assert.equal(version, '2.4.0-alpha.2');
  assert.equal(pkg.name, 'solith');
  assert.equal((pkg.build as { productName?: string })?.productName, 'Solith');
  assert.equal((pkg.build as { appId?: string })?.appId, 'com.solith.app');

  const nsis = (pkg.build as { nsis?: { artifactName?: string; uninstallDisplayName?: string } })?.nsis;
  assert.equal(nsis?.artifactName, 'Solith Setup ${version}.${ext}');
  assert.equal(nsis?.uninstallDisplayName, 'Solith');

  const lock = readJson('package-lock.json');
  assert.equal(lock.version, version);
  assert.equal((lock.packages as Record<string, { version?: string }>)?.['']?.version, version);

  const readme = readText('README.md');
  assert.match(readme, new RegExp(`solith@${version.replace(/\./g, '\\.')}`));
  assert.doesNotMatch(readme, /2\.4\.0-rc\.\d+/);

  const roadmap = readText('ROADMAP.md');
  assert.match(roadmap, new RegExp(`solith@${version.replace(/\./g, '\\.')}`));
  assert.match(roadmap, /Current Baseline \(Solith 2\.4\.0-alpha\.2\)/);
  assert.doesNotMatch(roadmap, /Current Baseline \(Solith 2\.4\.0-rc/);

  const changelog = readText('CHANGELOG.md');
  assert.match(changelog, new RegExp(`## v${version.replace(/\./g, '\\.')}`));

  const indexHtml = readText('index.html');
  assert.match(indexHtml, /<title>Solith<\/title>/);
  assert.match(indexHtml, new RegExp(`content="Solith ${version.replace(/\./g, '\\.')}`));

  const nvmrc = readText('.nvmrc').trim();
  assert.equal(nvmrc, '22');
  assert.equal((pkg.engines as { node?: string })?.node, '>=22 <23');
});
