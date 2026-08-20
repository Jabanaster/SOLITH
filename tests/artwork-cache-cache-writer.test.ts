import { describe, test, after as afterAll } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeArtworkFileAtomic } from '../src/core/artwork-cache/cache-writer.ts';

const tempDirs: string[] = [];
function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-artwork-cache-test-'));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('writeArtworkFileAtomic', () => {
  test('writes the file, returns the exact path and byte size, and creates the cache dir', () => {
    const cacheDir = path.join(makeTempDir(), 'nested', 'cache');
    const data = Buffer.from('fake-jpeg-bytes');
    const result = writeArtworkFileAtomic({ cacheDir, cacheKey: 'game__header', extension: 'jpg', data, rightsClass: 'user-provided' });
    assert.equal(result.localPath, path.join(cacheDir, 'game__header.jpg'));
    assert.equal(result.sizeBytes, data.byteLength);
    assert.equal(fs.readFileSync(result.localPath).toString(), 'fake-jpeg-bytes');
  });

  test('leaves no temp file behind after a successful write', () => {
    const cacheDir = makeTempDir();
    writeArtworkFileAtomic({ cacheDir, cacheKey: 'x', extension: 'png', data: Buffer.from('a'), rightsClass: 'solith-owned' });
    const entries = fs.readdirSync(cacheDir);
    assert.deepEqual(entries, ['x.png']);
  });

  test('a second write overwrites the same target path (refresh case)', () => {
    const cacheDir = makeTempDir();
    writeArtworkFileAtomic({ cacheDir, cacheKey: 'g', extension: 'jpg', data: Buffer.from('old'), rightsClass: 'explicitly-licensed' });
    writeArtworkFileAtomic({ cacheDir, cacheKey: 'g', extension: 'jpg', data: Buffer.from('new-data'), rightsClass: 'explicitly-licensed' });
    const localPath = path.join(cacheDir, 'g.jpg');
    assert.equal(fs.readFileSync(localPath).toString(), 'new-data');
    assert.deepEqual(fs.readdirSync(cacheDir), ['g.jpg']);
  });

  test('retains the old cached file when a write to a read-only target directory fails', () => {
    const cacheDir = makeTempDir();
    writeArtworkFileAtomic({ cacheDir, cacheKey: 'g', extension: 'jpg', data: Buffer.from('original'), rightsClass: 'user-provided' });
    const localPath = path.join(cacheDir, 'g.jpg');

    let writeFailed = false;
    try {
      fs.chmodSync(cacheDir, 0o444);
      try {
        writeArtworkFileAtomic({ cacheDir, cacheKey: 'g', extension: 'jpg', data: Buffer.from('replacement'), rightsClass: 'user-provided' });
      } catch {
        writeFailed = true;
      }
    } finally {
      fs.chmodSync(cacheDir, 0o755);
    }

    if (writeFailed) {
      assert.equal(fs.readFileSync(localPath).toString(), 'original', 'old file must survive a failed refresh');
    }
  });

  test('cross-game / cross-kind keys never collide in the same directory', () => {
    const cacheDir = makeTempDir();
    writeArtworkFileAtomic({ cacheDir, cacheKey: 'game-a__header', extension: 'jpg', data: Buffer.from('a-header'), rightsClass: 'solith-owned' });
    writeArtworkFileAtomic({ cacheDir, cacheKey: 'game-a__cover', extension: 'jpg', data: Buffer.from('a-cover'), rightsClass: 'solith-owned' });
    writeArtworkFileAtomic({ cacheDir, cacheKey: 'game-b__header', extension: 'jpg', data: Buffer.from('b-header'), rightsClass: 'solith-owned' });
    assert.equal(fs.readFileSync(path.join(cacheDir, 'game-a__header.jpg')).toString(), 'a-header');
    assert.equal(fs.readFileSync(path.join(cacheDir, 'game-a__cover.jpg')).toString(), 'a-cover');
    assert.equal(fs.readFileSync(path.join(cacheDir, 'game-b__header.jpg')).toString(), 'b-header');
  });

  describe('persistent-cache rights gate', () => {
    test('solith-owned artwork may be persisted', () => {
      const cacheDir = makeTempDir();
      const result = writeArtworkFileAtomic({ cacheDir, cacheKey: 'k', extension: 'jpg', data: Buffer.from('x'), rightsClass: 'solith-owned' });
      assert.ok(fs.existsSync(result.localPath));
    });

    test('explicitly-licensed artwork may be persisted', () => {
      const cacheDir = makeTempDir();
      const result = writeArtworkFileAtomic({ cacheDir, cacheKey: 'k', extension: 'jpg', data: Buffer.from('x'), rightsClass: 'explicitly-licensed' });
      assert.ok(fs.existsSync(result.localPath));
    });

    test('user-provided artwork may be persisted', () => {
      const cacheDir = makeTempDir();
      const result = writeArtworkFileAtomic({ cacheDir, cacheKey: 'k', extension: 'jpg', data: Buffer.from('x'), rightsClass: 'user-provided' });
      assert.ok(fs.existsSync(result.localPath));
    });

    test('remote-unverified-rights artwork is rejected — the writer itself refuses, no file is created', () => {
      const cacheDir = makeTempDir();
      assert.throws(() =>
        writeArtworkFileAtomic({ cacheDir, cacheKey: 'k', extension: 'jpg', data: Buffer.from('x'), rightsClass: 'remote-unverified-rights' }),
      );
      assert.deepEqual(fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir) : [], []);
    });

    test('a rejected write never leaves a temp file behind either', () => {
      const cacheDir = makeTempDir();
      try {
        writeArtworkFileAtomic({ cacheDir, cacheKey: 'k', extension: 'jpg', data: Buffer.from('x'), rightsClass: 'remote-unverified-rights' });
      } catch {
        // expected
      }
      const entries = fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir) : [];
      assert.deepEqual(entries, []);
    });
  });
});
