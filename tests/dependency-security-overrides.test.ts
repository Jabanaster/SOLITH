import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('security overrides pin fixed postcss, brace-expansion, fast-uri, and undici', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
    overrides?: Record<string, unknown>;
  };
  assert.equal(pkg.overrides?.postcss, '8.5.23');
  assert.equal(pkg.overrides?.['brace-expansion'], '5.0.9');
  assert.equal(pkg.overrides?.['fast-uri'], '3.1.7');
  assert.equal(pkg.overrides?.undici, '7.29.0');
  assert.equal(
    (pkg.overrides?.['@electron/rebuild'] as Record<string, string> | undefined)?.undici,
    '6.28.0',
  );
});

test('npm audit reports zero vulnerabilities under the locked tree', () => {
  // `npm audit` exits non-zero whenever any vulnerability is found, which is
  // its normal, documented behavior rather than a tool failure. spawnSync
  // (unlike execFileSync) does not throw on a non-zero child exit, so stdout
  // is always available to assert against — the same pattern already used by
  // tests/schema-v1-boundaries.test.ts for a spawned repository script.
  const result = spawnSync('npm', ['audit', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: true,
  });
  assert.equal(result.error, undefined, String(result.error));
  const audit = JSON.parse(result.stdout) as {
    metadata?: { vulnerabilities?: { total?: number; high?: number; critical?: number } };
  };
  const v = audit.metadata?.vulnerabilities;
  assert.equal(v?.total ?? -1, 0, JSON.stringify(v));
  assert.equal(v?.high ?? -1, 0, JSON.stringify(v));
  assert.equal(v?.critical ?? -1, 0, JSON.stringify(v));
});
