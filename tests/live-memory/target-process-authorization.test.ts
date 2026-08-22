import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { LiveMemorySession } from '../../src/core/live-memory/live-memory-session.js';
import { FakeMemoryDriver } from '../fixtures/fake-memory-driver.js';
import type { RemoteConnectionEvidence } from '../../src/core/live-memory/types.js';
import { _clearActiveFreezesForTests } from '../../src/core/live-memory/freeze-concurrency-registry.js';
import {
  assessTargetProcessAuthorization,
  BLOCKED_TARGET_PROCESS_PATTERNS,
} from '../../src/core/runtime/protected-target-guard.js';

// Independent security review, Finding 2 (HIGH) against frozen candidate
// ef254d1: BLOCKED_PROCESS_PATTERNS in src/app/live-memory/process-picker.ts
// only filtered the renderer's process-picker UI list. LiveMemorySession.attach()
// — the actual main-process attach boundary, reached by both the
// 'live-memory-attach' and 'live-memory-zero-input-prepare' IPC handlers —
// enforced no equivalent policy, so a renderer bypassing the UI (or a
// compromised renderer) could request attachment directly to a critical
// Windows process or to Solith's own process. These tests prove the
// server-side check is real, independent of the renderer, and fails closed
// before any process handle is even opened.

beforeEach(() => {
  _clearActiveFreezesForTests();
});

const CLEAN_EVIDENCE: RemoteConnectionEvidence = {
  availability: 'available',
  remoteConnectionCount: 0,
  observedAt: '2026-08-21T00:00:00.000Z',
};

function makeSession(driver: FakeMemoryDriver) {
  const session = new LiveMemorySession(driver);
  session._injectRemoteConnectionObserver(async () => CLEAN_EVIDENCE);
  return session;
}

const BLOCKED_SYSTEM_EXECUTABLES = [
  'svchost.exe',
  'lsass.exe',
  'winlogon.exe',
  'csrss.exe',
  'dwm.exe',
  'explorer.exe',
  'taskmgr.exe',
  'services.exe',
];

describe('LiveMemorySession.attach — Finding 2 server-side target authorization', () => {
  test('rejects attach when target PID is Solith\'s own process (self-target), before opening any handle', async () => {
    const driver = new FakeMemoryDriver();
    const session = makeSession(driver);

    const result = await session.attach({ pid: process.pid, executableName: 'demo.exe' }, true);

    assert.equal(result.success, false);
    assert.match(result.error ?? '', /own process/i);
    assert.equal(driver.isOpen(), false);
    assert.equal(session.isAttached(), false);
  });

  test('rejects attach when target executable name is Solith itself, even at a different PID', async () => {
    const driver = new FakeMemoryDriver();
    const session = makeSession(driver);
    const foreignPid = process.pid === 999999 ? 999998 : 999999;

    const result = await session.attach({ pid: foreignPid, executableName: 'Solith.exe' }, true);

    assert.equal(result.success, false);
    assert.match(result.error ?? '', /protected system\/solith process/i);
    assert.equal(driver.isOpen(), false);
  });

  for (const executableName of BLOCKED_SYSTEM_EXECUTABLES) {
    test(`rejects direct IPC-style attach to protected Windows process "${executableName}" even when the renderer picker is bypassed`, async () => {
      const driver = new FakeMemoryDriver();
      const session = makeSession(driver);
      const foreignPid = process.pid === 555555 ? 555554 : 555555;

      const result = await session.attach({ pid: foreignPid, executableName }, true);

      assert.equal(result.success, false);
      assert.match(result.error ?? '', /protected system\/solith process/i);
      assert.equal(driver.isOpen(), false, `${executableName} must never reach openProcess`);
      assert.equal(session.isAttached(), false);
    });
  }

  test('rejects attach when target executable path matches Solith\'s own executable, even under a disguised name', async () => {
    const driver = new FakeMemoryDriver();
    const session = makeSession(driver);
    const foreignPid = process.pid === 424242 ? 424241 : 424242;

    const result = await session.attach(
      { pid: foreignPid, executableName: 'totally-not-solith.exe', executablePath: process.execPath },
      true,
    );

    assert.equal(result.success, false);
    assert.match(result.error ?? '', /own executable/i);
    assert.equal(driver.isOpen(), false);
  });

  test('a legitimate, non-blocked target process still attaches successfully (no over-blocking regression)', async () => {
    const driver = new FakeMemoryDriver({ '4096': 100 });
    const session = makeSession(driver);
    driver.setProcessExecutableName(1234, 'demo.exe');

    const result = await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    assert.equal(result.success, true);
    assert.equal(driver.isOpen(), true);
    assert.equal(session.isAttached(), true);
  });

  // Regression (this session): BLOCKED_TARGET_PROCESS_PATTERNS previously
  // included /^solith/i — a name-PREFIX match, not an identity check. That
  // rejected any executable merely starting with "solith", including the
  // pre-existing legitimate E2E fixture SolithConsentGame.exe used by
  // tests/electron-consent-boundary.e2e.test.ts, breaking the entire
  // privileged write-consent workflow before consent could even begin.
  // "Starts with, ends with, or contains solith" must never by itself imply
  // "is Solith". Only PID (process.pid), the exact known executable name
  // (Solith.exe / Solith), and the exact executable-path match against
  // process.execPath are valid Solith self-identity signals.
  const LOOKS_LIKE_SOLITH_BUT_ISNT = [
    'SolithConsentGame.exe',
    'SolithiumGame.exe',
    'SolithTestTarget.exe',
    'MySolithGame.exe',
  ];

  for (const executableName of LOOKS_LIKE_SOLITH_BUT_ISNT) {
    test(`does not reject "${executableName}" merely for containing/starting with "solith" (name-prefix over-blocking regression)`, async () => {
      const driver = new FakeMemoryDriver({ '4096': 100 });
      const session = makeSession(driver);
      const foreignPid = process.pid === 777777 ? 777776 : 777777;
      driver.setProcessExecutableName(foreignPid, executableName);

      const result = await session.attach({ pid: foreignPid, executableName }, true);

      assert.equal(result.success, true, result.error ?? executableName);
      assert.equal(driver.isOpen(), true);
      assert.equal(session.isAttached(), true);
    });
  }

  test('still rejects the exact known Solith executable name without the .exe suffix', async () => {
    const driver = new FakeMemoryDriver();
    const session = makeSession(driver);
    const foreignPid = process.pid === 888888 ? 888887 : 888888;

    const result = await session.attach({ pid: foreignPid, executableName: 'Solith' }, true);

    assert.equal(result.success, false);
    assert.match(result.error ?? '', /protected system\/solith process/i);
    assert.equal(driver.isOpen(), false);
  });

  test('the renderer UI blocklist and the main-process authoritative blocklist are the same object (cannot silently drift)', async () => {
    const { BLOCKED_PROCESS_PATTERNS } = await import('../../src/app/live-memory/process-picker.js');
    assert.equal(BLOCKED_PROCESS_PATTERNS, BLOCKED_TARGET_PROCESS_PATTERNS);
  });
});

describe('assessTargetProcessAuthorization — direct unit coverage', () => {
  test('rejects an invalid (non-positive) PID', () => {
    const result = assessTargetProcessAuthorization({ pid: 0, executableName: 'demo.exe' });
    assert.equal(result.allowed, false);
    assert.match(result.reason, /invalid/i);
  });

  test('rejects an empty executable name', () => {
    const result = assessTargetProcessAuthorization({ pid: 9999, executableName: '' });
    assert.equal(result.allowed, false);
    assert.match(result.reason, /no resolvable executable name/i);
  });

  test('allows a normal game-like target', () => {
    const result = assessTargetProcessAuthorization({ pid: 9999, executableName: 'CrimsonDesert.exe' });
    assert.equal(result.allowed, true);
  });
});
