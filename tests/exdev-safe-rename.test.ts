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

  // Only the first rename (the real src->dest attempt, simulating a genuine
  // cross-device boundary) reports EXDEV. The fallback's own final step —
  // renaming its same-directory-as-dest temp file into dest — is a true
  // same-device rename and must succeed, exactly as it would in production.
  const originalRename = fs.renameSync;
  let callCount = 0;
  (fs as any).renameSync = (...args: Parameters<typeof fs.renameSync>) => {
    callCount += 1;
    if (callCount === 1) {
      const error: NodeJS.ErrnoException = new Error('EXDEV: cross-device link not permitted (simulated)');
      error.code = 'EXDEV';
      throw error;
    }
    return originalRename(...args);
  };
  try {
    renameOrCopyAcrossDevices(src, dest);
  } finally {
    fs.renameSync = originalRename;
  }

  assert.equal(fs.readFileSync(dest, 'utf8'), 'hello world');
  // Deliberately does NOT delete src — that decision belongs to the caller.
  assert.equal(fs.existsSync(src), true);
  // No leftover temp file from the EXDEV fallback.
  const leftovers = fs.readdirSync(dir).filter((name) => name.includes('.exdev-'));
  assert.deepEqual(leftovers, []);
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

// FINDING-R3 (independent security review, d3397bb): the EXDEV fallback used
// to copy straight onto the final destination path, so a crash mid-copy
// could truncate a live target file. It now copies to a same-directory temp
// file and only replaces dest via a same-device atomic rename. These tests
// cover that specific hardening.

test('an existing destination remains intact when the EXDEV fallback temp copy fails', () => {
  const dir = mkTempDir();
  const src = path.join(dir, 'src.txt');
  const dest = path.join(dir, 'dest.txt');
  fs.writeFileSync(src, 'new content');
  fs.writeFileSync(dest, 'old content that must survive');

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

  assert.equal(fs.readFileSync(dest, 'utf8'), 'old content that must survive');
  const leftovers = fs.readdirSync(dir).filter((name) => name.includes('.exdev-'));
  assert.deepEqual(leftovers, [], 'no temp artifact should remain after a failed copy');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a crash between the temp copy and the final rename leaves the prior destination intact and cleans up the temp file', () => {
  const dir = mkTempDir();
  const src = path.join(dir, 'src.txt');
  const dest = path.join(dir, 'dest.txt');
  fs.writeFileSync(src, 'new content');
  fs.writeFileSync(dest, 'old content that must survive');

  const originalRename = fs.renameSync;
  let renameCallCount = 0;
  (fs as any).renameSync = (...args: Parameters<typeof fs.renameSync>) => {
    renameCallCount += 1;
    const error: NodeJS.ErrnoException = new Error(
      renameCallCount === 1
        ? 'EXDEV: cross-device link not permitted (simulated)'
        : 'EIO: simulated crash before the temp-to-dest rename completes',
    );
    error.code = renameCallCount === 1 ? 'EXDEV' : 'EIO';
    throw error;
  };
  try {
    assert.throws(() => renameOrCopyAcrossDevices(src, dest), /EIO/);
  } finally {
    fs.renameSync = originalRename;
  }

  // The real destination file is never touched by the fallback's copy step
  // (it copies to a temp file first), so a failure at the final rename must
  // leave the previously-existing dest completely unchanged.
  assert.equal(fs.readFileSync(dest, 'utf8'), 'old content that must survive');
  // The temp copy (the only thing the failed rename left behind) is cleaned up.
  const leftovers = fs.readdirSync(dir).filter((name) => name.includes('.exdev-'));
  assert.deepEqual(leftovers, [], 'the orphaned temp copy must be cleaned up on final-rename failure');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the destination is only replaced after the temp copy is fully verified on disk', () => {
  const dir = mkTempDir();
  const src = path.join(dir, 'src.txt');
  const dest = path.join(dir, 'dest.txt');
  fs.writeFileSync(src, 'verified content');

  const originalRename = fs.renameSync;
  const seenTempPaths: string[] = [];
  (fs as any).renameSync = (from: string, to: string) => {
    if (from === src) {
      const error: NodeJS.ErrnoException = new Error('EXDEV: cross-device link not permitted (simulated)');
      error.code = 'EXDEV';
      throw error;
    }
    // This is the final temp->dest step; assert the temp file it's renaming
    // from already has the fully-copied content on disk before dest is
    // ever touched.
    seenTempPaths.push(from);
    assert.equal(fs.readFileSync(from, 'utf8'), 'verified content');
    return originalRename(from, to);
  };
  try {
    renameOrCopyAcrossDevices(src, dest);
  } finally {
    fs.renameSync = originalRename;
  }

  assert.equal(seenTempPaths.length, 1, 'exactly one same-device rename should move the verified temp copy into dest');
  assert.equal(fs.readFileSync(dest, 'utf8'), 'verified content');
  fs.rmSync(dir, { recursive: true, force: true });
});
