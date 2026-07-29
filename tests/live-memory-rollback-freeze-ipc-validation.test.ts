import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LiveMemoryRollbackSchema,
  LiveMemoryFreezeProposeSchema,
  LiveMemoryFreezeIssueConsentSchema,
  LiveMemoryFreezeConfirmSchema,
  RegistryRunVerificationSchema,
  RegistrySelectProcessSchema,
} from '../electron/ipc-validation.ts';

describe('LiveMemoryRollbackSchema (Batch B1 — rollback must not accept a caller-supplied manifest)', () => {
  test('accepts a bare proposalId', () => {
    const parsed = LiveMemoryRollbackSchema.parse({ proposalId: 'abc-123' });
    assert.equal(parsed.proposalId, 'abc-123');
  });

  test('rejects an empty proposalId', () => {
    assert.throws(() => LiveMemoryRollbackSchema.parse({ proposalId: '' }));
  });

  test('rejects a missing proposalId', () => {
    assert.throws(() => LiveMemoryRollbackSchema.parse({}));
  });

  test('rejects an oversized proposalId', () => {
    assert.throws(() => LiveMemoryRollbackSchema.parse({ proposalId: 'x'.repeat(129) }));
  });

  test('rejects a full manifest payload — the old, vulnerable shape must no longer validate', () => {
    assert.throws(() =>
      LiveMemoryRollbackSchema.parse({
        manifest: {
          proposalId: 'abc-123',
          target: { address: '0x1000', dataType: 'int32' },
          valueBefore: 100,
          valueAfter: 9999,
          appliedAt: new Date().toISOString(),
        },
      }),
    );
  });

  test('rejects unknown extra fields (.strict())', () => {
    assert.throws(() =>
      LiveMemoryRollbackSchema.parse({ proposalId: 'abc-123', address: '0x1000', valueBefore: 100 }),
    );
  });
});

describe('LiveMemoryFreezeProposeSchema bounds (Batch B1.1 — freeze can no longer be started via a single privileged call; this is now the propose step)', () => {
  test('accepts a valid payload within interval bounds', () => {
    const parsed = LiveMemoryFreezeProposeSchema.parse({
      address: '0x1000',
      dataType: 'int32',
      value: 9999,
      intervalMs: 100,
    });
    assert.equal(parsed.intervalMs, 100);
  });

  test('defaults intervalMs to undefined (session applies DEFAULT_FREEZE_INTERVAL_MS) when omitted', () => {
    const parsed = LiveMemoryFreezeProposeSchema.parse({ address: '0x1000', dataType: 'int32', value: 9999 });
    assert.equal(parsed.intervalMs, undefined);
  });

  test('rejects an interval below the minimum (50ms)', () => {
    assert.throws(() =>
      LiveMemoryFreezeProposeSchema.parse({ address: '0x1000', dataType: 'int32', value: 9999, intervalMs: 1 }),
    );
  });

  test('rejects an interval above the maximum (5000ms)', () => {
    assert.throws(() =>
      LiveMemoryFreezeProposeSchema.parse({ address: '0x1000', dataType: 'int32', value: 9999, intervalMs: 999999 }),
    );
  });

  test('rejects a non-finite freeze value', () => {
    assert.throws(() =>
      LiveMemoryFreezeProposeSchema.parse({ address: '0x1000', dataType: 'int32', value: Infinity }),
    );
  });

  test('rejects a malformed address string', () => {
    assert.throws(() =>
      LiveMemoryFreezeProposeSchema.parse({ address: 'not-hex', dataType: 'int32', value: 9999 }),
    );
  });

  test('rejects unknown extra fields (.strict()) — a caller cannot smuggle extra parameters into a proposal', () => {
    assert.throws(() =>
      LiveMemoryFreezeProposeSchema.parse({ address: '0x1000', dataType: 'int32', value: 9999, maxDurationMs: 999 }),
    );
  });
});

describe('LiveMemoryFreezeIssueConsentSchema / LiveMemoryFreezeConfirmSchema (Batch B1.1)', () => {
  test('issue-consent accepts only a bare proposalId', () => {
    const parsed = LiveMemoryFreezeIssueConsentSchema.parse({ proposalId: 'abc-123' });
    assert.equal(parsed.proposalId, 'abc-123');
  });

  test('issue-consent rejects a missing proposalId', () => {
    assert.throws(() => LiveMemoryFreezeIssueConsentSchema.parse({}));
  });

  test('issue-consent rejects extra fields (.strict()) — cannot smuggle address/value at issue-consent time', () => {
    assert.throws(() => LiveMemoryFreezeIssueConsentSchema.parse({ proposalId: 'abc-123', address: '0x1000' }));
  });

  test('confirm requires both proposalId and a UUID consentToken', () => {
    const parsed = LiveMemoryFreezeConfirmSchema.parse({
      proposalId: 'abc-123',
      consentToken: '11111111-1111-4111-8111-111111111111',
    });
    assert.equal(parsed.proposalId, 'abc-123');
  });

  test('confirm rejects a non-UUID consentToken', () => {
    assert.throws(() =>
      LiveMemoryFreezeConfirmSchema.parse({ proposalId: 'abc-123', consentToken: 'not-a-uuid' }),
    );
  });

  test('confirm rejects a payload carrying address/value/interval — confirm can ONLY reference a proposalId, never fresh parameters', () => {
    assert.throws(() =>
      LiveMemoryFreezeConfirmSchema.parse({
        proposalId: 'abc-123',
        consentToken: '11111111-1111-4111-8111-111111111111',
        address: '0x1000',
        value: 9999,
      }),
    );
  });
});

describe('RegistrySelectProcessSchema (Batch B1.1 — requests a main-process-verified selection)', () => {
  test('accepts a valid pid + executableName', () => {
    const parsed = RegistrySelectProcessSchema.parse({ pid: 1234, executableName: 'game.exe' });
    assert.equal(parsed.pid, 1234);
  });

  test('rejects a non-positive pid', () => {
    assert.throws(() => RegistrySelectProcessSchema.parse({ pid: -1, executableName: 'game.exe' }));
    assert.throws(() => RegistrySelectProcessSchema.parse({ pid: 0, executableName: 'game.exe' }));
  });

  test('rejects an empty executableName', () => {
    assert.throws(() => RegistrySelectProcessSchema.parse({ pid: 1234, executableName: '' }));
  });

  test('rejects unknown extra fields (.strict()) — cannot smuggle executablePath/userSelectedProcess through selection', () => {
    assert.throws(() =>
      RegistrySelectProcessSchema.parse({ pid: 1234, executableName: 'game.exe', executablePath: 'C:\\x.exe' }),
    );
  });
});

describe('RegistryRunVerificationSchema (Batch B1.1 — replaces renderer-supplied userSelectedProcess with a server-generated selectionId)', () => {
  const validPayload = {
    registry: { some: 'registry' },
    selectionId: '11111111-1111-4111-8111-111111111111',
  };

  test('accepts a valid payload with a UUID selectionId', () => {
    const parsed = RegistryRunVerificationSchema.parse(validPayload);
    assert.equal(parsed.selectionId, validPayload.selectionId);
    assert.equal(parsed.timeoutMs, 30_000, 'default timeout applies when omitted');
  });

  test('rejects a payload missing selectionId', () => {
    assert.throws(() => RegistryRunVerificationSchema.parse({ registry: {} }));
  });

  test('rejects a non-UUID selectionId', () => {
    assert.throws(() => RegistryRunVerificationSchema.parse({ ...validPayload, selectionId: 'not-a-uuid' }));
  });

  test('rejects a payload carrying pid/executableName/userSelectedProcess directly — the old Batch B1 shape must no longer validate', () => {
    assert.throws(() =>
      RegistryRunVerificationSchema.parse({
        registry: {},
        pid: 1234,
        executableName: 'game.exe',
        userSelectedProcess: true,
      }),
    );
  });

  test('rejects a timeout outside the 1s-120s bound', () => {
    assert.throws(() => RegistryRunVerificationSchema.parse({ ...validPayload, timeoutMs: 500 }));
    assert.throws(() => RegistryRunVerificationSchema.parse({ ...validPayload, timeoutMs: 999_999 }));
  });

  test('rejects unknown extra fields (.strict())', () => {
    assert.throws(() => RegistryRunVerificationSchema.parse({ ...validPayload, extra: 'field' }));
  });
});
