import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { renameOrCopyAcrossDevices } from '../src/core/safety/exdev-safe-rename.ts';

// Independent security review, Finding 3 (MEDIUM) against frozen candidate
// ef254d1: the EXDEV fallback in atomicWriteFileSync could destroy the only
// recoverable copy of a write if the fallback copy itself failed partway
// (disk full, lock, a throttled cloud filter driver) — its `finally` block
// unconditionally deleted the temp file regardless of whether the copy had
// actually succeeded. This is the shared primitive now used by every
// EXDEV-prone rename in the codebase (database persistence, save-editor
// atomic writes, backup manifest saves, backup/rollback restores, trainer
// save-field writes) — these tests prove ITS contract directly: never touch
// `src` on failure, so every caller's own "when is src recoverable"
// decision stays intact.

function mkTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'solith-exdev-rename-test-'));
}

test('renames normally when there is no EXDEV failure', () => {
  const dir = mkTempDir();
  const src = path.join(dir, 'src.txt');
  const dest = path.join(dir, 'dest.txt');
  fs.writeFileSync(src, 'hello');

  renameOrCopyAcrossDevices(src, dest);

  assert.equal(fs.existsSync(src), false, 'a real rename removes the source');
  assert.equal(fs.readFileSync(dest, 'utf8'), 'hello');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('falls back to copy when renameSync reports EXDEV, leaving both src and dest intact', () => {
  const dir = mkTempDir();
  const src = path.join(dir, 'src.txt');
  const dest = path.join(dir, 'dest.txt');
  fs.writeFileSync(src, 'hello world');

  const originalRename = fs.renameSync;
  (fs as any).renameSync = () => {
    const error: NodeJS.ErrnoException = new Error('EXDEV: cross-device link not permitted (simulated)');
    error.code = 'EXDEV';
    throw error;
  };
  try {
    renameOrCopyAcrossDevices(src, dest);
  } finally {
    fs.renameSync = originalRename;
  }

  assert.equal(fs.readFileSync(dest, 'utf8'), 'hello world');
  // Deliberately does NOT delete src — that decision belongs to the caller.
  assert.equal(fs.existsSync(src), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('propagates a non-EXDEV rename failure without touching src or creating dest', () => {
  const dir = mkTempDir();
  const src = path.join(dir, 'src.txt');
  const dest = path.join(dir, 'dest.txt');
  fs.writeFileSync(src, 'hello');

  const originalRename = fs.renameSync;
  (fs as any).renameSync = () => {
    const error: NodeJS.ErrnoException = new Error('EACCES: permission denied (simulated)');
    error.code = 'EACCES';
    throw error;
  };
  try {
    assert.throws(() => renameOrCopyAcrossDevices(src, dest), /EACCES/);
  } finally {
    fs.renameSync = originalRename;
  }

  assert.equal(fs.existsSync(src), true, 'src must survive a non-EXDEV rename failure');
  assert.equal(fs.existsSync(dest), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('when the EXDEV fallback copy itself fails, the error propagates and src is left untouched for recovery', () => {
  const dir = mkTempDir();
  const src = path.join(dir, 'src.txt');
  const dest = path.join(dir, 'dest.txt');
  fs.writeFileSync(src, 'the only good copy');

  const originalRename = fs.renameSync;
  const originalCopy = fs.copyFileSync;
  (fs as any).renameSync = () => {
    const error: NodeJS.ErrnoException = new Error('EXDEV: cross-device link not permitted (simulated)');
    error.code = 'EXDEV';
    throw error;
  };
  (fs as any).copyFileSync = () => {
    throw new Error('ENOSPC: no space left on device (simulated)');
  };
  try {
    assert.throws(() => renameOrCopyAcrossDevices(src, dest), /ENOSPC/);
  } finally {
    fs.renameSync = originalRename;
    fs.copyFileSync = originalCopy;
  }

  // The invariant this whole finding is about: a failed fallback must never
  // destroy the only recoverable copy of the data.
  assert.equal(fs.existsSync(src), true, 'src (the only known-good copy) must survive a failed fallback copy');
  assert.equal(fs.readFileSync(src, 'utf8'), 'the only good copy');
  fs.rmSync(dir, { recursive: true, force: true });
});
