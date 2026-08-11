import { test, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname ?? '.', '..');
const distElectron = path.join(root, 'dist-electron');
const distElectronTest = path.join(root, 'dist-electron-test');

describe('F-005 Compile-Time Dead-Code Elimination (DCE)', () => {
  it('production build compiles with consent override disabled and zero bypass strings', () => {
    // Run production build with contaminated environment variables explicitly set
    execFileSync('npm', ['run', 'build:electron'], {
      cwd: root,
      env: {
        ...process.env,
        SOLITH_TEST_BUILD: '1',
        SOLITH_PRIVILEGED_CONSENT: 'auto-approve',
        NODE_ENV: 'test',
      },
      shell: true,
      stdio: 'pipe',
    });

    const mainJs = path.join(distElectron, 'main.js');
    assert.ok(fs.existsSync(mainJs), 'dist-electron/main.js must exist after production build');

    const content = fs.readFileSync(mainJs, 'utf8');

    // Assert build marker is production
    assert.ok(content.includes('__SOLITH_PRODUCTION_BUILD_MARKER__'), 'Production bundle must contain production build marker');
    assert.ok(!content.includes('__SOLITH_TEST_BUILD_MARKER__'), 'Production bundle must NOT contain test build marker');

    // Assert dead-code elimination physically removed all bypass strings and branches
    assert.ok(!content.includes('SOLITH_PRIVILEGED_CONSENT'), 'Production bundle must NOT contain string SOLITH_PRIVILEGED_CONSENT');
    assert.ok(!content.includes('auto-approve'), 'Production bundle must NOT contain string auto-approve');
    assert.ok(!content.includes('auto-deny'), 'Production bundle must NOT contain string auto-deny');
  });

  it('test build compiles with consent override enabled into dist-electron-test', () => {
    execFileSync('npm', ['run', 'build:electron:test'], {
      cwd: root,
      shell: true,
      stdio: 'pipe',
    });

    const testMainJs = path.join(distElectronTest, 'main.js');
    assert.ok(fs.existsSync(testMainJs), 'dist-electron-test/main.js must exist after test build');

    const content = fs.readFileSync(testMainJs, 'utf8');
    assert.ok(content.includes('__SOLITH_TEST_BUILD_MARKER__'), 'Test bundle must contain test build marker');
    assert.ok(content.includes('SOLITH_PRIVILEGED_CONSENT'), 'Test bundle must retain string SOLITH_PRIVILEGED_CONSENT');
  });

  it('verify-production-security-boundaries script passes on production build', () => {
    const result = execFileSync('node', ['scripts/verify-production-security-boundaries.mjs'], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.ok(result.includes('PASS: Verified'), 'Pre-package security boundary verifier must pass');
  });
});
