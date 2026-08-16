import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('security overrides pin fixed postcss and brace-expansion', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
    overrides?: Record<string, string>;
  };
  assert.equal(pkg.overrides?.postcss, '8.5.23');
  assert.equal(pkg.overrides?.['brace-expansion'], '5.0.9');
});

test('npm audit reports zero vulnerabilities under the locked tree', () => {
  const output = execFileSync('npm', ['audit', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: true,
  });
  const audit = JSON.parse(output) as {
    metadata?: { vulnerabilities?: { total?: number; high?: number; critical?: number } };
  };
  assert.equal(audit.metadata?.vulnerabilities?.total ?? -1, 0);
  assert.equal(audit.metadata?.vulnerabilities?.high ?? -1, 0);
  assert.equal(audit.metadata?.vulnerabilities?.critical ?? -1, 0);
});
