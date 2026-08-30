import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * MP-P0.1 (SOLITH_SECURITY_ROADMAP.md's Master Implementation Plan) —
 * "A production installation cannot be switched into a weaker development
 * trust model by environment variable or command-line argument."
 *
 * Every site that decides whether to load the dev-server origin, open
 * DevTools, or honor a test-only override must route through
 * `electron/runtime-trust.ts`'s `isDevRuntime()`/`isCompatTestRuntime()`
 * (which gate on `!app.isPackaged`), never re-derive `--dev`/`SOLITH_DEV`/
 * `--compat-test` locally — a local re-derivation is exactly how the
 * original ungated `--dev` bypass existed undetected.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ELECTRON_DIR = path.join(ROOT, 'electron');

const FILES_THAT_MUST_USE_THE_SHARED_HELPER = ['main.ts', 'trainer-overlay.ts', 'wisp-overlay.ts'];

// A local, ungated re-derivation of the same override flags — this is the
// exact pattern that must never reappear outside runtime-trust.ts itself.
const FORBIDDEN_UNGATED_PATTERN = /process\.argv\.includes\(\s*['"]--dev['"]\s*\)|process\.env\.SOLITH_DEV\s*===\s*['"]1['"]|process\.argv\.includes\(\s*['"]--compat-test['"]\s*\)/;

describe('Packaged-runtime boundary (MP-P0.1) — dev/test overrides must be gated on !app.isPackaged', () => {
  test('runtime-trust.ts gates every override on app.isPackaged', () => {
    const contents = fs.readFileSync(path.join(ELECTRON_DIR, 'runtime-trust.ts'), 'utf8');
    assert.ok(contents.includes('!app.isPackaged'), 'isDevRuntime()/isCompatTestRuntime() must gate on !app.isPackaged');
    assert.ok(/export function isDevRuntime/.test(contents), 'expected isDevRuntime() to be exported');
    assert.ok(/export function isCompatTestRuntime/.test(contents), 'expected isCompatTestRuntime() to be exported');
  });

  for (const file of FILES_THAT_MUST_USE_THE_SHARED_HELPER) {
    test(`${file} contains no ungated re-derivation of --dev/SOLITH_DEV/--compat-test`, () => {
      const contents = fs.readFileSync(path.join(ELECTRON_DIR, file), 'utf8');
      assert.ok(!FORBIDDEN_UNGATED_PATTERN.test(contents), `${file} must call isDevRuntime()/isCompatTestRuntime() from runtime-trust.ts, not re-derive the flag locally`);
    });

    test(`${file} imports the shared runtime-trust helper`, () => {
      const contents = fs.readFileSync(path.join(ELECTRON_DIR, file), 'utf8');
      assert.ok(/from ['"]\.\/runtime-trust\.js['"]/.test(contents), `${file} must import from ./runtime-trust.js`);
    });
  }

  test('ELECTRON_USER_DATA_PATH override in main.ts is gated on !app.isPackaged', () => {
    const contents = fs.readFileSync(path.join(ELECTRON_DIR, 'main.ts'), 'utf8');
    assert.ok(
      /!app\.isPackaged\s*&&\s*process\.env\.ELECTRON_USER_DATA_PATH/.test(contents),
      'a packaged production build must never honor ELECTRON_USER_DATA_PATH to redirect its userData directory',
    );
  });
});
