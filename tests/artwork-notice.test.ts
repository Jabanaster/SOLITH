import assert from 'node:assert/strict';
import test, { describe, before } from 'node:test';
import {
  ARTWORK_NOTICE_POLICY_VERSION,
  ARTWORK_NOTICE_TEXT,
  hasAcknowledgedArtworkNotice,
  recordArtworkNoticeAcknowledgement,
} from '../src/core/artwork-cache/artwork-notice.ts';
import { getSettings } from '../src/core/settings/index.ts';
import { initDatabase } from '../src/core/database/index.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 0, 30, 12, 0, 0);

describe('artwork-notice — pure state evaluation', () => {
  test('ARTWORK_NOTICE_TEXT is a non-empty string', () => {
    assert.equal(typeof ARTWORK_NOTICE_TEXT, 'string');
    assert.ok(ARTWORK_NOTICE_TEXT.length > 0);
  });

  test('not-yet-acknowledged (empty persisted state) -> false', () => {
    assert.equal(hasAcknowledgedArtworkNotice({}), false);
  });

  test('acknowledged at the current policy version -> true', () => {
    assert.equal(
      hasAcknowledgedArtworkNotice({
        artworkNoticeAckPolicyVersion: ARTWORK_NOTICE_POLICY_VERSION,
        artworkNoticeAckAt: NOW,
      }),
      true,
    );
  });

  test('a stale acknowledgment (lower policy version) -> false', () => {
    assert.equal(
      hasAcknowledgedArtworkNotice({
        artworkNoticeAckPolicyVersion: ARTWORK_NOTICE_POLICY_VERSION - 1,
        artworkNoticeAckAt: NOW,
      }),
      false,
    );
  });

  test('a version higher than current (e.g. downgraded app) -> false, never trusted', () => {
    assert.equal(
      hasAcknowledgedArtworkNotice({
        artworkNoticeAckPolicyVersion: ARTWORK_NOTICE_POLICY_VERSION + 1,
        artworkNoticeAckAt: NOW,
      }),
      false,
    );
  });

  test('malformed version values all fail safe to false', () => {
    const malformed: unknown[] = [null, undefined, '1', NaN, -1, 1.5, {}, [], true];
    for (const bad of malformed) {
      assert.equal(
        hasAcknowledgedArtworkNotice({ artworkNoticeAckPolicyVersion: bad, artworkNoticeAckAt: NOW }),
        false,
        `expected false for malformed version ${JSON.stringify(bad)}`,
      );
    }
  });

  test('malformed/missing timestamp with a valid version -> false', () => {
    const malformed: unknown[] = [undefined, null, 'not-a-date', NaN, -1, {}, [], true, ''];
    for (const bad of malformed) {
      assert.equal(
        hasAcknowledgedArtworkNotice({ artworkNoticeAckPolicyVersion: ARTWORK_NOTICE_POLICY_VERSION, artworkNoticeAckAt: bad }),
        false,
        `expected false for malformed timestamp ${JSON.stringify(bad)}`,
      );
    }
  });

  test('an ISO-string timestamp (settings round-trip format) is accepted', () => {
    assert.equal(
      hasAcknowledgedArtworkNotice({
        artworkNoticeAckPolicyVersion: ARTWORK_NOTICE_POLICY_VERSION,
        artworkNoticeAckAt: new Date(NOW).toISOString(),
      }),
      true,
    );
  });

  test('never throws on a corrupted persisted-state shape', () => {
    assert.doesNotThrow(() =>
      hasAcknowledgedArtworkNotice({ artworkNoticeAckPolicyVersion: 'corrupt' as unknown, artworkNoticeAckAt: { foo: 'bar' } as unknown }),
    );
  });
});

describe('artwork-notice — persistence through the real settings store', () => {
  before(async () => {
    await initDatabase();
  });

  test('not-yet-acknowledged in a fresh settings row -> hasAcknowledgedArtworkNotice(getSettings()) is false, then true after recording', () => {
    const before_ = getSettings();
    assert.equal(hasAcknowledgedArtworkNotice(before_), false);

    recordArtworkNoticeAcknowledgement(NOW);

    const after_ = getSettings();
    assert.equal(after_.artworkNoticeAckPolicyVersion, ARTWORK_NOTICE_POLICY_VERSION);
    assert.equal(after_.artworkNoticeAckAt, NOW);
    assert.equal(hasAcknowledgedArtworkNotice(after_), true);
  });

  test('recordArtworkNoticeAcknowledgement defaults to the current wall clock when no timestamp is passed', () => {
    const before_ = Date.now();
    recordArtworkNoticeAcknowledgement();
    const after_ = Date.now();

    const settings = getSettings();
    assert.equal(settings.artworkNoticeAckPolicyVersion, ARTWORK_NOTICE_POLICY_VERSION);
    assert.ok(typeof settings.artworkNoticeAckAt === 'number');
    assert.ok((settings.artworkNoticeAckAt as number) >= before_ - DAY_MS);
    assert.ok((settings.artworkNoticeAckAt as number) <= after_ + DAY_MS);
    assert.equal(hasAcknowledgedArtworkNotice(settings), true);
  });
});
