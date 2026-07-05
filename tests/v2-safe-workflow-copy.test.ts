import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname ?? '.', '..');
const README_PATH = path.join(ROOT, 'README.md');
const DISCOVERY_LAB_PATH = path.join(ROOT, 'src', 'app', 'pages', 'DiscoveryLab.tsx');
const BACKUPS_PATH = path.join(ROOT, 'src', 'app', 'pages', 'Backups.tsx');
const COMPATIBILITY_PATH = path.join(ROOT, 'src', 'app', 'pages', 'CompatibilityDashboard.tsx');

function read(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8');
}

describe('V2 safe support workflow copy', () => {
  test('README explains local/offline catalog, advisory diff, and evidence-based support matrix', () => {
    const readme = read(README_PATH).toLowerCase();
    assert.match(readme, /profile catalog is local\/offline/);
    assert.match(readme, /imported profiles are review-required/);
    assert.match(readme, /save diff is advisory/);
    assert.match(readme, /support matrix reports are evidence-based/);
    assert.match(readme, /rollback dashboard is visibility\/verification only/);
    assert.match(readme, /unsupported writes remain blocked/);
    assert.match(readme, /no remote calls are used/);
  });

  test('UI copy keeps advisory and blocked guarantees explicit', () => {
    const discovery = read(DISCOVERY_LAB_PATH).toLowerCase();
    const backups = read(BACKUPS_PATH).toLowerCase();
    const compatibility = read(COMPATIBILITY_PATH).toLowerCase();

    assert.match(discovery, /discovery remains advisory/);
    assert.match(discovery, /unsupported sections stay blocked/);
    assert.match(backups, /does not perform silent restore/);
    assert.match(compatibility, /support matrix output is local and evidence-based/);
    assert.match(compatibility, /imported profiles require review/);
    assert.match(compatibility, /do not automatically create executable write support/);
  });

  test('Backups page avoids rendering raw full target path text in table rows', () => {
    const backups = read(BACKUPS_PATH);
    assert.equal(backups.includes('{backup.filePath}'), false);
    assert.match(backups, /Recorded local target file/);
  });

  test('copy does not imply forbidden online or memory/process capabilities', () => {
    const bundle = [
      read(README_PATH),
      read(DISCOVERY_LAB_PATH),
      read(BACKUPS_PATH),
      read(COMPATIBILITY_PATH),
    ].join(' ').toLowerCase();

    assert.equal(bundle.includes('supports online multiplayer'), false);
    assert.equal(bundle.includes('memory editing support'), false);
    assert.equal(bundle.includes('process injection support'), false);
    assert.equal(bundle.includes('debugger attachment support'), false);
    assert.equal(bundle.includes('supports anti-cheat bypass'), false);
  });
});
