import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  planZeroInputDetection,
  prepareZeroInputSession,
} from '../../src/core/live-memory/zero-input-prepare.js';
import { LiveMemorySession } from '../../src/core/live-memory/live-memory-session.js';
import { MemoryAuditLog } from '../../src/core/live-memory/audit-log.js';
import { FakeMemoryDriver } from '../fixtures/fake-memory-driver.js';
import type { SolithDefinitionV1 } from '../../src/core/definitions/schema.v1.js';
import type { RemoteConnectionEvidence } from '../../src/core/live-memory/types.js';

const CLEAN: RemoteConnectionEvidence = {
  availability: 'available',
  remoteConnectionCount: 0,
  observedAt: '2026-07-18T00:00:00.000Z',
};

const ONLINE: RemoteConnectionEvidence = {
  availability: 'available',
  remoteConnectionCount: 3,
  observedAt: '2026-07-18T00:00:01.000Z',
};

function makeDefinition(overrides: Partial<SolithDefinitionV1> = {}): SolithDefinitionV1 {
  return {
    schemaVersion: 1,
    id: 'demo',
    title: 'Demo',
    gameVersion: '1.0',
    executableHashPrefixes: ['abcd'],
    author: 'test',
    safety: {
      requiresApproval: true,
      requiresOfflineConfirm: true,
      verificationStatus: 'verified',
    },
    target: { executables: ['Demo.exe'], arch: 'x64' },
    connectionBaseline: 0,
    memoryFeatures: [
      {
        id: 'health',
        name: 'Health',
        category: 'Player',
        type: 'write_once',
        dataType: 'int32',
        defaultValue: 100,
        resolution: {
          moduleName: 'Demo.exe',
          baseOffset: '0x100',
          pointerChain: [],
        },
      },
      {
        id: 'scan-me',
        name: 'Scan',
        category: 'Player',
        type: 'scan_unknown',
        dataType: 'int32',
        defaultValue: 0,
        resolution: { moduleName: 'Demo.exe' },
      },
    ],
    ...overrides,
  };
}

describe('zero-input-prepare', () => {
  test('planZeroInputDetection blocks when offline not confirmed (watch preview)', () => {
    const plan = planZeroInputDetection({
      detection: {
        catalogGameId: 'demo',
        displayName: 'Demo',
        pid: 1,
        executable: 'Demo.exe',
      },
      definition: makeDefinition(),
      userConfirmedOffline: false,
      remoteConnections: CLEAN,
      executableHashSHA256: 'abcd' + '1'.repeat(60),
    });
    assert.equal(plan.allowed, false);
  });

  test('prepareZeroInputSession blocks fingerprint mismatch', async () => {
    const driver = new FakeMemoryDriver({ '4352': 50 });
    driver.setProcessExecutableName(1234, 'Demo.exe');
    driver.addModule('Demo.exe', 0x1000n, 0x1000);
    const session = new LiveMemorySession(driver);
    session._injectRemoteConnectionObserver(async () => CLEAN);
    const audit = new MemoryAuditLog();

    const result = await prepareZeroInputSession(
      session,
      {
        detection: {
          catalogGameId: 'demo',
          displayName: 'Demo',
          pid: 1234,
          executable: 'Demo.exe',
        },
        definition: makeDefinition(),
        userConfirmedOffline: true,
        remoteConnections: CLEAN,
        executableHashSHA256: 'ffff' + '0'.repeat(60),
      },
      audit,
    );

    assert.equal(result.success, false);
    assert.equal(result.plan.fingerprint.status, 'mismatch');
    assert.equal(session.isAttached(), false);
  });

  test('prepareZeroInputSession allows with waiver even when remote connections present (Trust Shift)', async () => {
    const driver = new FakeMemoryDriver({ '4352': 50 });
    driver.setProcessExecutableName(1234, 'Demo.exe');
    driver.addModule('Demo.exe', 0x1000n, 0x1000);
    const session = new LiveMemorySession(driver);
    session._injectRemoteConnectionObserver(async () => ONLINE);
    const audit = new MemoryAuditLog();

    const result = await prepareZeroInputSession(
      session,
      {
        detection: {
          catalogGameId: 'demo',
          displayName: 'Demo',
          pid: 1234,
          executable: 'Demo.exe',
        },
        definition: makeDefinition(),
        userConfirmedOffline: true,
        remoteConnections: ONLINE,
        executableHashSHA256: 'abcd' + '1'.repeat(60),
      },
      audit,
    );

    assert.equal(result.success, true);
    assert.equal(session.isAttached(), true);
    assert.match(result.plan.guard.reason, /advisory/i);
  });

  test('prepareZeroInputSession attaches and resolves pointer + marks scan_required', async () => {
    const driver = new FakeMemoryDriver({ '4352': 50 });
    driver.setProcessExecutableName(1234, 'Demo.exe');
    driver.addModule('Demo.exe', 0x1000n, 0x1000);
    const session = new LiveMemorySession(driver);
    session._injectRemoteConnectionObserver(async () => CLEAN);
    const audit = new MemoryAuditLog();

    const result = await prepareZeroInputSession(
      session,
      {
        detection: {
          catalogGameId: 'demo',
          displayName: 'Demo',
          pid: 1234,
          executable: 'Demo.exe',
        },
        definition: makeDefinition(),
        userConfirmedOffline: true,
        remoteConnections: CLEAN,
        executableHashSHA256: 'abcd' + '1'.repeat(60),
      },
      audit,
    );

    assert.equal(result.success, true);
    assert.equal(session.isAttached(), true);
    assert.ok(result.counts);
    assert.equal(result.counts!.resolved, 1);
    assert.equal(result.counts!.scanRequired, 1);
    const health = result.features?.find((f) => f.featureId === 'health');
    assert.ok(health);
    assert.equal(health!.resolution, 'pointer');
    assert.ok(audit.recent().some((e) => e.op === 'attach'));
    assert.ok(audit.recent().some((e) => e.op === 'resolve' && e.featureId === 'health'));
  });

  test('prepareZeroInputSession accepts featureHints map without failing', async () => {
    const driver = new FakeMemoryDriver({ '4352': 50 });
    driver.setProcessExecutableName(1234, 'Demo.exe');
    driver.addModule('Demo.exe', 0x1000n, 0x1000);
    const region = Buffer.alloc(0x200, 0);
    region.set([0xde, 0xad, 0xbe, 0xef], 0x100);
    driver.addRegion(0x1000n, region);
    const session = new LiveMemorySession(driver);
    session._injectRemoteConnectionObserver(async () => CLEAN);

    const result = await prepareZeroInputSession(session, {
      detection: {
        catalogGameId: 'demo',
        displayName: 'Demo',
        pid: 1234,
        executable: 'Demo.exe',
      },
      definition: makeDefinition({
        memoryFeatures: [
          {
            id: 'sig-health',
            name: 'Sig Health',
            category: 'Player',
            type: 'write_once',
            dataType: 'int32',
            defaultValue: 100,
            resolution: {
              moduleName: 'Demo.exe',
              signature: 'DE AD BE EF',
              baseOffset: '0x0',
            },
          },
        ],
        executableHashPrefixes: [],
      }),
      userConfirmedOffline: true,
      remoteConnections: CLEAN,
      featureHints: { 'sig-health': '0x1100' },
      fuzzyOptions: { maxDistance: 2, maxEdits: 1 },
    });

    assert.equal(result.success, true);
    assert.equal(session.isAttached(), true);
    const feature = result.features?.find((entry) => entry.featureId === 'sig-health');
    assert.equal(feature?.resolution, 'exact_aob');
    assert.equal(feature?.address, '0x1100');
  });
});
