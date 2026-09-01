/**
 * ROADMAP §6.2 Proposal Inspector — validation for the new get-proposals
 * IPC channel's schema.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { GetProposalsSchema } from '../electron/ipc-validation.ts';

describe('GetProposalsSchema', () => {
  test('accepts a valid UUID gameId', () => {
    const parsed = GetProposalsSchema.parse({ gameId: '123e4567-e89b-12d3-a456-426614174000' });
    assert.equal(parsed.gameId, '123e4567-e89b-12d3-a456-426614174000');
  });

  test('accepts the demo game literal id', () => {
    const parsed = GetProposalsSchema.parse({ gameId: 'demo-game-quest-id-000000000000' });
    assert.equal(parsed.gameId, 'demo-game-quest-id-000000000000');
  });

  test('rejects a missing gameId', () => {
    assert.throws(() => GetProposalsSchema.parse({}));
  });

  test('rejects a non-UUID, non-demo gameId', () => {
    assert.throws(() => GetProposalsSchema.parse({ gameId: 'not-a-uuid' }));
  });
});
