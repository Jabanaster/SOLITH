import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { validatePathSafety } from '../src/core/safety/path-safety.ts';

// Independent security review, Finding 4 (MEDIUM) against frozen candidate
// ef254d1: electron/canonical-games-ipc.ts's 'launch-installation' handler
// called validatePathSafety(executablePath) with NO approvedRoots, which is
// a no-op containment check (src/core/safety/path-safety.ts:100 — the check
// only runs `if (approvedRoots.length > 0)`). Combined with shell.openPath,
// this made the handler an arbitrary local-executable-launch primitive for
// any .exe that happened to exist on disk, not just the installation's own
// executable. The fix binds validatePathSafety(executablePath,
// [installation.installPath]) — installation.installPath is trusted,
// main-process-owned data (install-discovery scans / the manual "add game"
// flow, never renderer-writable directly). These tests exercise that exact
// call shape directly against real on-disk fixtures (including a real
// symlink, so getCanonicalPath's fs.realpathSync resolution is genuinely
// exercised, not just string comparison).
//
// electron/main.ts's add-game/update-game handlers now perform the same
// containment check at persistence time (executablePath bound to the
// approved `path` root) — same underlying primitive, covered by the same
// scenarios below.

function mkInstallRoot(): { root: string; exePath: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-install-root-'));
  const exePath = path.join(root, 'Game.exe');
  fs.writeFileSync(exePath, 'not a real PE, just a fixture');
  return { root, exePath };
}

test('allows an executable genuinely contained in the approved installation root', () => {
  const { root, exePath } = mkInstallRoot();
  const result = validatePathSafety(exePath, [root]);
  assert.equal(result.safe, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('allows an executable in a nested subdirectory of the approved root (e.g. Binaries/Win64)', () => {
  const { root } = mkInstallRoot();
  const nested = path.join(root, 'Binaries', 'Win64');
  fs.mkdirSync(nested, { recursive: true });
  const exePath = path.join(nested, 'Game-Win64-Shipping.exe');
  fs.writeFileSync(exePath, 'fixture');

  const result = validatePathSafety(exePath, [root]);
  assert.equal(result.safe, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('rejects an executable outside the approved installation root (renderer swapped the stored executable)', () => {
  const { root } = mkInstallRoot();
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-unrelated-'));
  const unrelatedExe = path.join(outsideDir, 'unrelated.exe');
  fs.writeFileSync(unrelatedExe, 'fixture');

  const result = validatePathSafety(unrelatedExe, [root]);
  assert.equal(result.safe, false);
  assert.match(result.reason ?? '', /outside of approved/i);

  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outsideDir, { recursive: true, force: true });
});

test('rejects a sibling-prefix escape (approved "C:\\Games\\Foo" must not allow "C:\\Games\\FooBar")', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-sibling-'));
  const root = path.join(parent, 'Foo');
  const sibling = path.join(parent, 'FooBar');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(sibling, { recursive: true });
  const siblingExe = path.join(sibling, 'Game.exe');
  fs.writeFileSync(siblingExe, 'fixture');

  const result = validatePathSafety(siblingExe, [root]);
  assert.equal(result.safe, false);

  fs.rmSync(parent, { recursive: true, force: true });
});

test('rejects a traversal escape out of the approved installation root', () => {
  const { root } = mkInstallRoot();
  const traversal = path.join(root, '..', '..', 'Windows', 'System32', 'cmd.exe');

  const result = validatePathSafety(traversal, [root]);
  assert.equal(result.safe, false);

  fs.rmSync(root, { recursive: true, force: true });
});

test('rejects a symlink inside the approved root that resolves outside it (reparse/junction escape)', (t) => {
  const { root } = mkInstallRoot();
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-symlink-target-'));
  const outsideExe = path.join(outsideDir, 'real.exe');
  fs.writeFileSync(outsideExe, 'fixture');

  const linkPath = path.join(root, 'Disguised.exe');
  try {
    fs.symlinkSync(outsideExe, linkPath, 'file');
  } catch (error) {
    // Symlink creation requires elevated privileges on some Windows
    // configurations (no Developer Mode, no admin) — skip rather than
    // false-fail the suite on an environment limitation.
    t.skip(`symlink creation unavailable in this environment: ${String(error)}`);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
    return;
  }

  // The direct symlink-at-target check (path-safety.ts step 5) already
  // rejects this outright, independent of containment.
  const result = validatePathSafety(linkPath, [root]);
  assert.equal(result.safe, false);
  assert.match(result.reason ?? '', /symbolic link|junction/i);

  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outsideDir, { recursive: true, force: true });
});

test('rejects a Windows system executable regardless of any approved root', () => {
  const { root } = mkInstallRoot();
  const result = validatePathSafety('C:\\Windows\\System32\\cmd.exe', [root]);
  assert.equal(result.safe, false);
  assert.match(result.reason ?? '', /system directory/i);
  fs.rmSync(root, { recursive: true, force: true });
});

test('rejects a target inside Solith\'s own installation directory regardless of any approved root', () => {
  const { root } = mkInstallRoot();
  const solithOwnPath = path.join(process.cwd(), 'Solith.exe');
  const result = validatePathSafety(solithOwnPath, [root]);
  assert.equal(result.safe, false);
  assert.match(result.reason ?? '', /solith installation directory/i);
  fs.rmSync(root, { recursive: true, force: true });
});

test('a manually-added game executable (owner-approved root, no prior discovery) is allowed when contained', () => {
  // Mirrors electron/main.ts's add-game flow: the user picks `path` via a
  // file dialog (validated with no approvedRoots — there is nothing to
  // contain it to yet, it establishes the root), then executablePath must
  // be contained within that same, now-trusted root.
  const { root, exePath } = mkInstallRoot();
  const rootSafety = validatePathSafety(root);
  assert.equal(rootSafety.safe, true, 'the picked folder itself must pass the no-containment safety check');

  const executableSafety = validatePathSafety(exePath, [root]);
  assert.equal(executableSafety.safe, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('a manually-added game rejects an executablePath outside the picked root (persistence-time gap this finding closed)', () => {
  const { root } = mkInstallRoot();
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-manual-outside-'));
  const outsideExe = path.join(outsideDir, 'System32-lookalike.exe');
  fs.writeFileSync(outsideExe, 'fixture');

  const executableSafety = validatePathSafety(outsideExe, [root]);
  assert.equal(executableSafety.safe, false);

  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outsideDir, { recursive: true, force: true });
});
