import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  hashExecutableFileSHA256,
  resetInstalledExecutableHashCacheForTesting,
} from '../../src/core/live-memory/installed-exe-hash.js';

describe('installed executable hashing', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    resetInstalledExecutableHashCacheForTesting();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('returns the full-file SHA-256 digest', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-exe-hash-'));
    tempDirs.push(dir);
    const exe = path.join(dir, 'Demo.exe');
    const content = Buffer.concat([
      Buffer.from('MZ'),
      Buffer.alloc(2 * 1024 * 1024, 0x5a),
      Buffer.from('full-file-tail'),
    ]);
    fs.writeFileSync(exe, content);

    const expected = createHash('sha256').update(content).digest('hex');
    assert.equal(hashExecutableFileSHA256(exe), expected);
  });

  test('returns null for missing files', () => {
    assert.equal(
      hashExecutableFileSHA256(path.join(os.tmpdir(), 'missing-solith-game.exe')),
      null,
    );
  });
});
