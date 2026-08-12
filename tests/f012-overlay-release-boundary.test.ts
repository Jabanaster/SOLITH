import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('F-012 Release Exclusion — Compiled Production Output Security Boundary', () => {
  const root = process.cwd();
  const distElectron = path.join(root, 'dist-electron');
  const manifestPath = path.join(distElectron, 'solith-build-manifest.json');
  const mainJsPath = path.join(distElectron, 'main.js');
  const preloadCjsPath = path.join(distElectron, 'preload.cjs');

  assert.ok(fs.existsSync(manifestPath), 'Production solith-build-manifest.json must exist');
  assert.ok(fs.existsSync(mainJsPath), 'dist-electron/main.js must exist');
  assert.ok(fs.existsSync(preloadCjsPath), 'dist-electron/preload.cjs must exist');

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.buildMode, 'production');
  assert.equal(manifest.wispOverlayEnabled, false);

  const mainJs = fs.readFileSync(mainJsPath, 'utf8');
  const preloadCjs = fs.readFileSync(preloadCjsPath, 'utf8');

  const forbiddenChannels = [
    'wisp-overlay-toggle',
    'wisp-overlay-hide',
    'wisp-overlay-set-expanded',
    'wisp-overlay-move-by',
    'wisp-overlay-set-interactive',
    'registerWispOverlayIpc',
    'showWispOverlay',
  ];

  for (const channel of forbiddenChannels) {
    assert.equal(mainJs.includes(channel), false, `main.js must not contain channel string "${channel}"`);
    assert.equal(preloadCjs.includes(channel), false, `preload.cjs must not contain channel string "${channel}"`);
  }
});
