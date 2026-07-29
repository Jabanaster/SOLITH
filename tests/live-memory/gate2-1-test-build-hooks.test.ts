import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Gate 2.1: proves the two test-only production seams (PID-identity override,
// forced cleanup-failure injection) are absent (fail closed) in a normal
// process, and only become usable when SOLITH_TEST_BUILD=1 is explicitly set.
// This is what "documented and tested as absent from the normal packaged
// build" means for these seams (see Gate2_1 authorization).

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

test('process-identity override seam throws when SOLITH_TEST_BUILD is unset', async () => {
  delete process.env.SOLITH_TEST_BUILD;
  const mod = await import('../../src/core/live-memory/windows-process-identity.ts');
  assert.throws(
    () => mod.__setTestProcessIdentityOverride(999999, null),
    /SOLITH_TEST_BUILD=1/,
  );
  assert.throws(
    () => mod.__clearTestProcessIdentityOverrides(),
    /SOLITH_TEST_BUILD=1/,
  );
  assert.equal((globalThis as Record<string, unknown>).__solithSetTestProcessIdentityOverride, undefined);
  assert.equal((globalThis as Record<string, unknown>).__solithQueryWindowsProcessIdentity, undefined);
  assert.equal((globalThis as Record<string, unknown>).__solithCompareProcessIdentity, undefined);
});

test('process-identity override seam works and is scoped when SOLITH_TEST_BUILD=1', async () => {
  process.env.SOLITH_TEST_BUILD = '1';
  const mod = await import(`../../src/core/live-memory/windows-process-identity.ts?gate2_1=${1}`);
  const fakeIdentity = {
    pid: 424242,
    executableName: 'gate2-1-fake.exe',
    executablePath: 'C:\\gate2-1-fake.exe',
    startTimeIso: new Date(0).toISOString(),
    volumeSerialNumber: null,
    fileIndex: null,
    exeSha256: null,
  };
  mod.__setTestProcessIdentityOverride(424242, fakeIdentity);
  const result = mod.queryWindowsProcessIdentity(424242);
  assert.deepEqual(result, fakeIdentity);

  const globalQuery = (globalThis as Record<string, unknown>).__solithQueryWindowsProcessIdentity as
    | ((pid: number) => unknown)
    | undefined;
  assert.ok(globalQuery, 'globalThis.__solithQueryWindowsProcessIdentity must be present when SOLITH_TEST_BUILD=1');
  assert.deepEqual(globalQuery!(424242), fakeIdentity);

  const globalCompare = (globalThis as Record<string, unknown>).__solithCompareProcessIdentity as
    | ((expected: unknown, live: unknown) => unknown)
    | undefined;
  assert.ok(globalCompare, 'globalThis.__solithCompareProcessIdentity must be present when SOLITH_TEST_BUILD=1');

  mod.__clearTestProcessIdentityOverrides();
  delete process.env.SOLITH_TEST_BUILD;
});

test('cleanup-failure injection seam source is gated behind SOLITH_TEST_BUILD (static check)', () => {
  // electron/live-memory-ipc.ts imports the real `electron` module and
  // cannot be imported directly from a plain Node test process (same
  // constraint documented by the existing electron-boundary-static.test.ts
  // pattern) — verified statically instead, matching that established
  // convention in this repo.
  const source = fs.readFileSync(path.join(REPO_ROOT, 'electron', 'live-memory-ipc.ts'), 'utf8');
  assert.match(source, /const IS_TEST_BUILD = process\.env\.SOLITH_TEST_BUILD === '1';/);
  assert.match(
    source,
    /export function __setTestForcedCleanupFailureStep[\s\S]{0,200}throw new Error\('__setTestForcedCleanupFailureStep is only available when SOLITH_TEST_BUILD=1\.'\)/,
  );
  assert.match(
    source,
    /if \(IS_TEST_BUILD\) \{\s*\n\s*\(globalThis as Record<string, unknown>\)\.__solithSetTestForcedCleanupFailureStep/,
  );
  assert.match(
    source,
    /revokeConsentTokens: \(\) => \{\s*\n\s*maybeThrowForTestInjectedCleanupFailure\('revoke_consent_tokens'\);/,
  );
  assert.match(
    source,
    /export function __testHasSessionForOwner[\s\S]{0,200}throw new Error\('__testHasSessionForOwner is only available when SOLITH_TEST_BUILD=1\.'\)/,
  );
});
