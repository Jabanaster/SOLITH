import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('security overrides pin fixed postcss, brace-expansion, fast-uri, xmldom, joi, and undici', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
    overrides?: Record<string, unknown>;
  };
  assert.equal(pkg.overrides?.postcss, '8.5.23');
  assert.equal(pkg.overrides?.['brace-expansion'], '5.0.9');
  // Personal Library Final Certification pass: bumped 3.1.5 -> 3.1.7 —
  // 3.1.5 itself was inside the vulnerable range (>=3.0.0 <3.1.6) for four
  // separate GHSA advisories discovered by npm audit during this pass; 3.1.7
  // is the newest patch still on the 3.x line ajv depends on (avoiding an
  // untested 3.x -> 4.x major jump).
  assert.equal(pkg.overrides?.['fast-uri'], '3.1.7');
  assert.equal(pkg.overrides?.undici, '7.29.0');
  // Added this pass — electron-builder's plist dependency pulled a
  // vulnerable @xmldom/xmldom (<=0.8.14, multiple GHSA XML-injection/ReDoS
  // advisories). Dev/build-time only (never bundled into the shipped app),
  // but pinned anyway since the fix is free.
  assert.equal(pkg.overrides?.['@xmldom/xmldom'], '0.9.12');
  // Added this pass — wait-on's joi dependency (<18.2.5) had a prototype-
  // pollution advisory. Dev-only (test tooling), pinned for the same reason.
  assert.equal(pkg.overrides?.joi, '18.2.8');
  assert.equal(
    (pkg.overrides?.['@electron/rebuild'] as Record<string, string> | undefined)?.undici,
    '6.28.0',
  );
});

test('npm audit reports zero vulnerabilities under the locked tree', () => {
  let output: string;
  try {
    output = execFileSync('npm', ['audit', '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
      shell: true,
    });
  } catch (error) {
    // npm audit exits NON-ZERO (by design) whenever it finds ANY
    // vulnerability — that is normal CLI behavior, not a broken command.
    // execFileSync throws on any non-zero exit, but the JSON report is
    // still written to stdout; the previous version of this test let that
    // exception propagate uncaught, which surfaced a real finding as an
    // opaque "Command failed: npm audit --json" test-harness error instead
    // of an actionable assertion diff. Recovering stdout here fixes that
    // harness bug without weakening what the test actually verifies — a
    // genuine finding still fails the assertions below with a clear diff.
    const stdout = (error as { stdout?: unknown }).stdout;
    if (typeof stdout !== 'string' || stdout.length === 0) throw error;
    output = stdout;
  }
  const audit = JSON.parse(output) as {
    metadata?: { vulnerabilities?: { total?: number; high?: number; critical?: number } };
  };
  assert.equal(audit.metadata?.vulnerabilities?.total ?? -1, 0);
  assert.equal(audit.metadata?.vulnerabilities?.high ?? -1, 0);
  assert.equal(audit.metadata?.vulnerabilities?.critical ?? -1, 0);
});
