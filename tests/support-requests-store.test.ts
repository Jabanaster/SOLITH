import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import os from 'os';

import { resetForTesting } from '../src/core/database/index.ts';
import {
  requestSupport,
  getSupportRequestForGame,
  listSupportRequests,
  acknowledgeSupportRequest,
  markSupportRequestInProgress,
  resolveSupportRequestIfExists,
} from '../src/core/support-requests/store.ts';

const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const TEMP_ROOT = path.join(os.tmpdir(), `solith-support-requests-${RUN_ID}`);
const TEMP_DB = path.join(TEMP_ROOT, 'test.db');

describe('Support Request store', () => {
  before(async () => {
    fs.mkdirSync(TEMP_ROOT, { recursive: true });
    await resetForTesting(TEMP_DB);
  });

  after(() => {
    try {
      if (fs.existsSync(TEMP_ROOT)) fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  test('requesting support for an owned unsupported game creates a REQUESTED entry', () => {
    const request = requestSupport({
      canonicalGameId: 'owned-unsupported-game',
      gameTitle: 'Owned Unsupported Game',
      platforms: ['steam'],
      launcherGameIds: { steam: '123456' },
    });
    assert.equal(request.status, 'REQUESTED');
    assert.equal(request.canonicalGameId, 'owned-unsupported-game');
    assert.ok(request.requestId.length > 0);
  });

  test('requesting support for an installed unsupported game works the same way', () => {
    const request = requestSupport({
      canonicalGameId: 'installed-unsupported-game',
      gameTitle: 'Installed Unsupported Game',
      platforms: ['gog'],
    });
    assert.equal(request.status, 'REQUESTED');
  });

  test('requesting support for another catalog game (not owned/installed) also works — model does not gate on ownership', () => {
    const request = requestSupport({
      canonicalGameId: 'other-catalog-game',
      gameTitle: 'Other Catalog Game',
      platforms: [],
    });
    assert.equal(request.status, 'REQUESTED');
  });

  test('duplicate request for the same canonical game is a no-op, not a second request (Mission 16 — no repeated-click duplicates)', () => {
    const first = requestSupport({ canonicalGameId: 'dup-request-game', gameTitle: 'Dup Game', platforms: ['steam'] });
    const second = requestSupport({ canonicalGameId: 'dup-request-game', gameTitle: 'Dup Game (different title ignored)', platforms: ['epic'] });
    assert.equal(first.requestId, second.requestId);
    assert.equal(second.platforms.join(','), 'steam', 'second call must not overwrite the first request');

    const all = listSupportRequests().filter((r) => r.canonicalGameId === 'dup-request-game');
    assert.equal(all.length, 1);
  });

  test('support becoming available resolves the request automatically', () => {
    requestSupport({ canonicalGameId: 'soon-supported-game', gameTitle: 'Soon Supported', platforms: ['steam'] });
    const resolved = resolveSupportRequestIfExists('soon-supported-game');
    assert.equal(resolved?.status, 'SUPPORTED');
    assert.equal(getSupportRequestForGame('soon-supported-game')?.status, 'SUPPORTED');
  });

  test('resolving a game with no existing request is a safe no-op', () => {
    const result = resolveSupportRequestIfExists('never-requested-game');
    assert.equal(result, null);
  });

  test('status can progress through ACKNOWLEDGED and IN_PROGRESS before SUPPORTED', () => {
    requestSupport({ canonicalGameId: 'progressing-game', gameTitle: 'Progressing Game', platforms: ['steam'] });
    acknowledgeSupportRequest('progressing-game');
    assert.equal(getSupportRequestForGame('progressing-game')?.status, 'ACKNOWLEDGED');
    markSupportRequestInProgress('progressing-game');
    assert.equal(getSupportRequestForGame('progressing-game')?.status, 'IN_PROGRESS');
    resolveSupportRequestIfExists('progressing-game');
    assert.equal(getSupportRequestForGame('progressing-game')?.status, 'SUPPORTED');
  });

  test('privacy: a support request record contains no user-identifying field, only game + platform evidence', () => {
    const request = requestSupport({ canonicalGameId: 'privacy-check-game', gameTitle: 'Privacy Check', platforms: ['steam'] });
    const fields = Object.keys(request);
    // No userId, username, email, accountId, ownerId, deviceId, or similar
    // ever appears in the record — only what's needed to identify the GAME.
    for (const forbidden of ['userId', 'username', 'email', 'accountId', 'ownerId', 'deviceId', 'ipAddress']) {
      assert.ok(!fields.includes(forbidden), `support request must never carry a "${forbidden}" field`);
    }
    assert.deepEqual(
      fields.sort(),
      ['canonicalGameId', 'gameTitle', 'launcherGameIds', 'platforms', 'requestId', 'requestedAt', 'status', 'updatedAt', 'versionHint'].sort(),
    );
  });
});
