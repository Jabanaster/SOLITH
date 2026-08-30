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

  // Found during the P0.1 global trust-boundary audit: SOLITH_PRIVILEGED_CONSENT
  // gated the human-in-the-loop consent dialog for memory writes/freezes/injector
  // launches by env var alone, with zero app.isPackaged check.
  test('SOLITH_PRIVILEGED_CONSENT auto-approve/auto-deny is gated on !app.isPackaged', () => {
    const contents = fs.readFileSync(path.join(ELECTRON_DIR, 'privileged-consent-dialog.ts'), 'utf8');
    assert.ok(
      /app\.isPackaged\s*\?\s*''\s*:\s*\(process\.env\.SOLITH_PRIVILEGED_CONSENT/.test(contents),
      'a packaged production build must never honor SOLITH_PRIVILEGED_CONSENT to auto-approve/auto-deny the privileged consent dialog',
    );
  });

  test('SOLITH_CONSENT_TTL_MS override is gated on !app.isPackaged', () => {
    const contents = fs.readFileSync(path.join(ELECTRON_DIR, 'privileged-consent-dialog.ts'), 'utf8');
    assert.ok(
      /app\.isPackaged\s*\?\s*NaN\s*:\s*Number\(process\.env\.SOLITH_CONSENT_TTL_MS/.test(contents),
      'a packaged production build must never honor SOLITH_CONSENT_TTL_MS to extend the consent token TTL',
    );
  });

  test('SOLITH_TEST_BUILD test-only seams in live-memory-ipc.ts are gated on !app.isPackaged', () => {
    const contents = fs.readFileSync(path.join(ELECTRON_DIR, 'live-memory-ipc.ts'), 'utf8');
    assert.ok(
      /app\.isPackaged\s*\|\|\s*process\.env\.SOLITH_TEST_BUILD\s*!==\s*'1'/.test(contents),
      '__testHasSessionForOwner must throw when app.isPackaged, regardless of SOLITH_TEST_BUILD',
    );
    assert.ok(
      /!app\.isPackaged\s*&&\s*process\.env\.SOLITH_TEST_BUILD\s*===\s*'1'/.test(contents),
      'IS_TEST_BUILD / the __solithTestHasSessionForOwner global attach must require !app.isPackaged',
    );
  });

  test('preload.ts e2eTrainerState fixture requires the main-process-relayed SOLITH_PACKAGED gate', () => {
    const contents = fs.readFileSync(path.join(ELECTRON_DIR, 'preload.ts'), 'utf8');
    assert.ok(
      /SOLITH_PACKAGED\s*!==\s*'1'/.test(contents),
      'NODE_ENV=test alone is not a safe production gate for e2eTrainerState — preload.ts must also check SOLITH_PACKAGED',
    );
  });

  test('main.ts relays app.isPackaged to preload via SOLITH_PACKAGED before window/preload creation', () => {
    const contents = fs.readFileSync(path.join(ELECTRON_DIR, 'main.ts'), 'utf8');
    assert.ok(
      /process\.env\.SOLITH_PACKAGED\s*=\s*app\.isPackaged\s*\?\s*'1'\s*:\s*'0'/.test(contents),
      'main.ts must set process.env.SOLITH_PACKAGED so the sandboxed preload can know it is running inside a real packaged install',
    );
  });
});
