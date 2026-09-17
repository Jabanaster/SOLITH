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

  // ROADMAP.md is intentionally NOT checked here. It is a phase/roadmap
  // planning document, not a version-bearing product surface, and requiring
  // it to duplicate the application version made a documentation file a
  // second hand-maintained copy of package.json's version — exactly the
  // coupling this suite exists to avoid everywhere else. The canonical
  // roadmap (Step 0.14 onward) identifies its baseline by certified git SHA
  // instead. See Docs/roadmap/STEP_0.14.1_ROADMAP_CONTRACT_REPAIR.md.
  //
  // Electron's own app.getVersion() (electron/main.ts) and the Settings ->
  // About UI (AboutSection.tsx) both read the version dynamically from the
  // packaged app metadata at runtime rather than holding a separate literal,
  // so neither can drift from package.json by construction and neither
  // needs a static string-match assertion here.

  const changelog = readText('CHANGELOG.md');
  assert.match(changelog, new RegExp(`## v${version.replace(/\./g, '\\.')}`));

  const indexHtml = readText('index.html');
  assert.match(indexHtml, /<title>Solith<\/title>/);
  assert.match(indexHtml, new RegExp(`content="Solith ${version.replace(/\./g, '\\.')}`));

  const nvmrc = readText('.nvmrc').trim();
  assert.equal(nvmrc, '22');
  assert.equal((pkg.engines as { node?: string })?.node, '>=22 <23');
});
