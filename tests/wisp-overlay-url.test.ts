import test from 'node:test';
import assert from 'node:assert/strict';
import { getWispOverlayUrl } from '../electron/wisp-overlay-url.js';

test('getWispOverlayUrl — constructs valid file URL on Windows and Unix paths', () => {
  // 1. Windows path test
  const winDir = 'G:\\ACTIVE_PROJECTS\\solith-v1-security-integration\\dist-electron-test';
  const winUrl = getWispOverlayUrl(winDir, false);
  assert.equal(winUrl.startsWith('file:///'), true, 'Windows file URL must start with file:///');
  assert.equal(winUrl.includes('\\'), false, 'Windows file URL must not contain backslashes');
  assert.equal(winUrl.endsWith('#wisp-overlay'), true, 'File URL hash must be #wisp-overlay');

  // 2. Unix path test
  const unixDir = '/home/user/solith/dist-electron';
  const unixUrl = getWispOverlayUrl(unixDir, false);
  assert.equal(unixUrl.startsWith('file:///'), true, 'Unix file URL must start with file:///');
  assert.equal(unixUrl.endsWith('#wisp-overlay'), true, 'Unix hash must be #wisp-overlay');

  // 3. Dev mode URL test
  const devUrl = getWispOverlayUrl(winDir, true);
  assert.equal(devUrl, 'http://localhost:3000/#wisp-overlay');

  // 4. Space handling test
  const spaceDir = 'C:\\Program Files\\Solith App\\dist-electron';
  const spaceUrl = getWispOverlayUrl(spaceDir, false);
  assert.equal(spaceUrl.includes('Program%20Files'), true, 'Spaces must be percent-encoded');
  assert.equal(spaceUrl.includes('\\'), false, 'No backslashes in space URL');
});
