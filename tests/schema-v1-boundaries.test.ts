/**
 * Phase 5 — schema.v1 boundary script smoke test.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'verify-schema-v1-boundaries.mjs');

describe('Phase 5 schema.v1 boundary verifier', () => {
  test('verify-schema-v1-boundaries exits 0 on current tree', () => {
    const result = spawnSync(process.execPath, [SCRIPT], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /PASS: schema\.v1 boundary checks/);
  });
});
