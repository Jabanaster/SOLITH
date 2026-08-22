import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { atomicWriteFileSync } from '../src/core/database/index.ts';

// Reproduces a real failure observed on 2026-08-21 during Phase 1 manual
// certification: on a machine where AppData\Roaming sits under OneDrive
// Files-On-Demand, Windows' renameSync reported EXDEV for a rename between
// two files in the SAME directory, because the cloud filter driver can place
// sibling files on different underlying extents. rename() cannot cross that
// boundary but copy+delete can, so atomicWriteFileSync must fall back to it
// instead of losing the write entirely.

test('atomicWriteFileSync falls back to copy+delete when renameSync reports EXDEV, even same-directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-exdev-test-'));
  const targetPath = path.join(dir, 'solith.db');

  const originalRename = fs.renameSync;
  (fs as any).renameSync = () => {
    const error: NodeJS.ErrnoException = new Error('EXDEV: cross-device link not permitted (simulated)');
    error.code = 'EXDEV';
    throw error;
  };

  try {
    atomicWriteFileSync(targetPath, Buffer.from('hello world'));
  } finally {
    fs.renameSync = originalRename;
  }

  assert.equal(fs.readFileSync(targetPath, 'utf8'), 'hello world');

  const leftoverTempFiles = fs.readdirSync(dir).filter((name) => name.endsWith('.tmp'));
  assert.deepEqual(leftoverTempFiles, [], 'no leaked temp file should remain after the fallback succeeds');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('atomicWriteFileSync still rejects non-EXDEV rename failures', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-exdev-test-'));
  const targetPath = path.join(dir, 'solith.db');

  const originalRename = fs.renameSync;
  (fs as any).renameSync = () => {
    const error: NodeJS.ErrnoException = new Error('EACCES: permission denied (simulated)');
    error.code = 'EACCES';
    throw error;
  };

  try {
    assert.throws(() => atomicWriteFileSync(targetPath, Buffer.from('x')), /EACCES/);
  } finally {
    fs.renameSync = originalRename;
  }

  assert.equal(fs.existsSync(targetPath), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
