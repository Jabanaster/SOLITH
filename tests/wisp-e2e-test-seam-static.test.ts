import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Phase 2 remediation, Gap A — proves the Wisp E2E controlled-activation seam
 * is absent (fails closed) outside SOLITH_TEST_BUILD=1, matching the exact
 * convention tests/live-memory/gate2-1-test-build-hooks.test.ts already
 * established for this codebase's other test-only production seams.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

test('__setE2EControlledAddress throws when SOLITH_TEST_BUILD is unset, and installs no globalThis hook', async () => {
  delete process.env.SOLITH_TEST_BUILD;
  const mod = await import(`../electron/adaptive-wisp-e2e-controlled-fixture.ts?static_absence=${Date.now()}`);
  assert.throws(() => mod.__setE2EControlledAddress({ address: 1000n, dataType: 'int32' }), /SOLITH_TEST_BUILD=1/);
  assert.equal((globalThis as Record<string, unknown>).__solithSetE2EControlledAddress, undefined);
});

test('resolveE2EControlledAddress and buildControlledE2EWispProfileIfLinked and createE2EAugmentedEntryLookup all no-op when SOLITH_TEST_BUILD is unset', async () => {
  delete process.env.SOLITH_TEST_BUILD;
  const mod = await import(`../electron/adaptive-wisp-e2e-controlled-fixture.ts?static_absence2=${Date.now()}`);

  assert.equal(mod.resolveE2EControlledAddress('canonical:x', mod.E2E_CONTROLLED_ENTRY_ID), null);
  assert.equal(mod.buildControlledE2EWispProfileIfLinked('canonical:x'), null);

  const base = { resolveEntry: () => ({ id: 'base-entry', label: 'Base', dataType: 'int32', enabled: true }) };
  const augmented = mod.createE2EAugmentedEntryLookup(base);
  assert.equal(augmented, base, 'outside a test build, the augmented lookup must be the exact same object reference as base — no wrapping at all');
});

test('registerWispE2ETestIpc throws when SOLITH_TEST_BUILD is unset (source-level static check)', () => {
  // electron/wisp-e2e-test-ipc.ts imports the real `electron` module and
  // cannot be imported directly from a plain Node test process — verified
  // statically instead, matching the established convention (see
  // gate2-1-test-build-hooks.test.ts's own third test, same rationale).
  const source = fs.readFileSync(path.join(REPO_ROOT, 'electron', 'wisp-e2e-test-ipc.ts'), 'utf8');
  assert.match(source, /const IS_TEST_BUILD = process\.env\.SOLITH_TEST_BUILD === '1';/);
  assert.match(
    source,
    /export function registerWispE2ETestIpc\(\): void \{\s*\n\s*if \(!IS_TEST_BUILD\) \{\s*\n\s*throw new Error\('registerWispE2ETestIpc is only available when SOLITH_TEST_BUILD=1\.'\);/,
  );
});

test('main.ts only registers the Wisp E2E test IPC when SOLITH_TEST_BUILD=1 (source-level static check)', () => {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'electron', 'main.ts'), 'utf8');
  assert.match(
    source,
    /if \(process\.env\.SOLITH_TEST_BUILD === '1'\) \{\s*\n\s*registerWispE2ETestIpc\(\);\s*\n\s*\}/,
  );
});

test('preload.ts only exposes the Wisp E2E test methods when SOLITH_TEST_BUILD=1 (source-level static check)', () => {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'electron', 'preload.ts'), 'utf8');
  assert.match(source, /process\.env\.SOLITH_TEST_BUILD === '1'\s*\n\s*\?\s*\{\s*\n\s*wispE2ETestActivateSlot:/);
});
