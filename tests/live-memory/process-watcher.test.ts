import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  matchCatalogProcess,
  buildZeroInputAttachPlan,
} from '../../src/core/live-memory/process-watcher.js';
import type { SolithDefinitionV1 } from '../../src/core/definitions/schema.v1.js';

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
    memoryFeatures: [],
    ...overrides,
  };
}

describe('process-watcher', () => {
  test('matchCatalogProcess returns first catalog hit', () => {
    const detection = matchCatalogProcess(
      [
        { pid: 10, name: 'chrome.exe' },
        { pid: 42, name: 'Demo.exe' },
      ],
      [
        {
          catalogGameId: 'demo-game',
          displayName: 'Demo Game',
          executables: ['Demo.exe'],
        },
      ],
    );
    assert.deepEqual(detection, {
      catalogGameId: 'demo-game',
      displayName: 'Demo Game',
      pid: 42,
      executable: 'Demo.exe',
    });
  });

  test('buildZeroInputAttachPlan blocks without definition', () => {
    const plan = buildZeroInputAttachPlan({
      detection: {
        catalogGameId: 'demo-game',
        displayName: 'Demo',
        pid: 1,
        executable: 'Demo.exe',
      },
      definition: null,
      userConfirmedOffline: true,
      remoteConnections: {
        availability: 'available',
        remoteConnectionCount: 0,
        observedAt: new Date().toISOString(),
      },
    });
    assert.equal(plan.allowed, false);
    assert.match(plan.blockReason ?? '', /No definition/);
  });

  test('buildZeroInputAttachPlan blocks fingerprint mismatch without drift ack', () => {
    const plan = buildZeroInputAttachPlan({
      detection: {
        catalogGameId: 'demo-game',
        displayName: 'Demo',
        pid: 1,
        executable: 'Demo.exe',
      },
      definition: makeDefinition(),
      executableHashSHA256: 'ffff' + '0'.repeat(60),
      userConfirmedOffline: true,
      remoteConnections: {
        availability: 'available',
        remoteConnectionCount: 0,
        observedAt: new Date().toISOString(),
      },
    });
    assert.equal(plan.allowed, false);
    assert.equal(plan.fingerprint.status, 'mismatch');
  });

  test('buildZeroInputAttachPlan allows offline confirmed + matching hash', () => {
    const plan = buildZeroInputAttachPlan({
      detection: {
        catalogGameId: 'demo-game',
        displayName: 'Demo',
        pid: 1,
        executable: 'Demo.exe',
      },
      definition: makeDefinition(),
      executableHashSHA256: 'abcd' + '1'.repeat(60),
      userConfirmedOffline: true,
      remoteConnections: {
        availability: 'available',
        remoteConnectionCount: 0,
        observedAt: new Date().toISOString(),
      },
    });
    assert.equal(plan.allowed, true);
    assert.equal(plan.guard.allowed, true);
  });

  test('buildZeroInputAttachPlan allows with waiver when remote connections present (Trust Shift)', () => {
    const plan = buildZeroInputAttachPlan({
      detection: {
        catalogGameId: 'demo-game',
        displayName: 'Demo',
        pid: 1,
        executable: 'Demo.exe',
      },
      definition: makeDefinition(),
      executableHashSHA256: 'abcd' + '1'.repeat(60),
      userConfirmedOffline: true,
      remoteConnections: {
        availability: 'available',
        remoteConnectionCount: 2,
        observedAt: new Date().toISOString(),
      },
    });
    assert.equal(plan.allowed, true);
    assert.match(plan.guard.reason, /advisory/i);
  });
});
