import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * Core Product Completion — Mission 9 (Offline Safety Acknowledgment pass).
 * Proves the safety-acknowledgment UX layer (policy.ts, its persisted
 * settings keys, and the IPC handlers) is never referenced by any runtime
 * authorization/safety-gate module. The acknowledgment is UX, never
 * authorization — this test is the static regression guard for that
 * boundary, so any future change that wires safetyAckState into an
 * authorization decision fails loudly here instead of silently shipping.
 */
const ROOT = path.resolve(import.meta.dirname ?? '.', '..');

const RUNTIME_AUTHORIZATION_FILES = [
  'src/core/runtime/protected-target-guard.ts',
  'src/core/runtime/write-policy.ts',
  'src/core/runtime/runtime-policy.ts',
  'src/core/live-memory/online-guard.ts',
  'src/core/live-memory/live-memory-session.ts',
  'src/core/live-memory/trainer-deck-read.ts',
  'src/core/live-memory/read-preflight.ts',
  'src/core/live-memory/read-preflight-production-adapter.ts',
  'src/core/live-memory/attach-catalog-verification.ts',
  'src/core/live-memory/process-watcher.ts',
  'src/core/live-memory/zero-input-prepare.ts',
  'electron/live-memory-ipc.ts',
];

const FORBIDDEN_PATTERNS = [
  /safety-acknowledgment/i,
  /safetyAckPolicyVersion/,
  /safetyAckAt/,
  /safetyReminderDismissedAt/,
  /evaluateSafetyAckState/,
  /getSafetyAckState/,
  /recordSafetyAcknowledgment/,
];

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf-8');
}

for (const relativePath of RUNTIME_AUTHORIZATION_FILES) {
  test(`${relativePath} never references the safety-acknowledgment UX layer`, () => {
    const fullPath = path.join(ROOT, relativePath);
    if (!fs.existsSync(fullPath)) {
      assert.fail(`expected runtime authorization file to exist: ${relativePath}`);
    }
    const source = readSource(relativePath);
    for (const pattern of FORBIDDEN_PATTERNS) {
      assert.doesNotMatch(
        source,
        pattern,
        `${relativePath} must never reference the safety-acknowledgment UX layer (matched ${pattern})`,
      );
    }
  });
}

test('the safety-acknowledgment policy module itself never imports any runtime authorization module', () => {
  const source = readSource('src/core/safety-acknowledgment/policy.ts');
  for (const authFile of RUNTIME_AUTHORIZATION_FILES) {
    const moduleSpecifierGuess = path.basename(authFile).replace(/\.ts$/, '');
    assert.doesNotMatch(
      source,
      new RegExp(`from ['"].*${moduleSpecifierGuess}`),
      `policy.ts must not import from ${authFile}`,
    );
  }
  // The module should have zero imports at all — it is a pure, standalone evaluator.
  assert.doesNotMatch(source, /^import /m);
});

test('the safety-acknowledgment IPC handlers only call settings-module functions, never a live-memory/authorization module', () => {
  const source = readSource('electron/main.ts');
  const startIdx = source.indexOf("handleGuarded('get-safety-ack-state'");
  const endMarker = "handleGuarded('record-safety-reminder-dismissal'";
  const endIdx = source.indexOf(endMarker);
  assert.ok(startIdx >= 0 && endIdx >= 0, 'expected to find the safety-ack IPC handlers');
  // Slice through to the end of the third handler's closing `});`.
  const afterThird = source.indexOf('});', source.indexOf('});', endIdx) + 3);
  const handlersBlock = source.slice(startIdx, afterThird + 3);
  assert.doesNotMatch(handlersBlock, /live-memory|protected-target|write-policy|runtime-policy|AuthorityService/i);
  assert.match(handlersBlock, /core\/settings\/index\.js/);
});
