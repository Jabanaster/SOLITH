import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { enqueueToast, dismissToast, TOAST_MAX_VISIBLE, formatRelativeTime } from '../src/app/lib/notifications.ts';
import type { NotificationRecord } from '../src/shared/types/index.ts';

function record(id: string): NotificationRecord {
  return {
    id,
    category: 'general',
    title: id,
    message: 'msg',
    severity: 'info',
    createdAt: new Date().toISOString(),
    read: false,
  };
}

describe('enqueueToast', () => {
  test('adds a new toast', () => {
    const queue = enqueueToast([], record('a'));
    assert.equal(queue.length, 1);
    assert.equal(queue[0].id, 'a');
  });

  test('does not duplicate a toast with the same id', () => {
    const queue = enqueueToast([{ id: 'a', record: record('a') }], record('a'));
    assert.equal(queue.length, 1);
  });

  test('caps the queue at TOAST_MAX_VISIBLE, dropping the oldest', () => {
    let queue: ReturnType<typeof enqueueToast> = [];
    for (let i = 0; i < TOAST_MAX_VISIBLE + 2; i += 1) {
      queue = enqueueToast(queue, record(`t${i}`));
    }
    assert.equal(queue.length, TOAST_MAX_VISIBLE);
    assert.equal(queue[0].id, 't2');
    assert.equal(queue[queue.length - 1].id, `t${TOAST_MAX_VISIBLE + 1}`);
  });
});

describe('dismissToast', () => {
  test('removes the matching toast', () => {
    const queue = dismissToast([{ id: 'a', record: record('a') }, { id: 'b', record: record('b') }], 'a');
    assert.deepEqual(queue.map((t) => t.id), ['b']);
  });

  test('no-op for an id not present', () => {
    const original = [{ id: 'a', record: record('a') }];
    assert.deepEqual(dismissToast(original, 'missing'), original);
  });
});

describe('formatRelativeTime', () => {
  test('just now for sub-minute deltas', () => {
    const now = Date.parse('2026-01-01T00:00:30.000Z');
    assert.equal(formatRelativeTime('2026-01-01T00:00:00.000Z', now), 'just now');
  });

  test('minutes ago', () => {
    const now = Date.parse('2026-01-01T00:05:00.000Z');
    assert.equal(formatRelativeTime('2026-01-01T00:00:00.000Z', now), '5m ago');
  });

  test('hours ago', () => {
    const now = Date.parse('2026-01-01T03:00:00.000Z');
    assert.equal(formatRelativeTime('2026-01-01T00:00:00.000Z', now), '3h ago');
  });

  test('days ago', () => {
    const now = Date.parse('2026-01-03T00:00:00.000Z');
    assert.equal(formatRelativeTime('2026-01-01T00:00:00.000Z', now), '2d ago');
  });

  test('invalid timestamp returns empty string', () => {
    assert.equal(formatRelativeTime('not-a-date'), '');
  });
});
