import { describe, test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTIFICATION_HISTORY_LIMIT,
  createNotification,
  listNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  clearNotificationHistory,
} from '../src/core/notifications/index.ts';
import { initDatabase } from '../src/core/database/index.ts';
import db from '../src/core/database/index.ts';

describe('notifications store', () => {
  before(async () => {
    await initDatabase();
  });

  beforeEach(() => {
    clearNotificationHistory();
  });

  test('create notification persists and returns a full record', () => {
    const record = createNotification({
      category: 'general',
      title: 'Hello',
      message: 'World',
    });
    assert.equal(record.category, 'general');
    assert.equal(record.title, 'Hello');
    assert.equal(record.message, 'World');
    assert.equal(record.severity, 'info');
    assert.equal(record.read, false);
    assert.equal(typeof record.id, 'string');
    assert.equal(typeof record.createdAt, 'string');
  });

  test('unread defaults correctly', () => {
    createNotification({ category: 'general', title: 'A', message: 'B' });
    const [first] = listNotifications();
    assert.equal(first.read, false);
    assert.equal(getUnreadNotificationCount(), 1);
  });

  test('ordering is most-recent-first and deterministic for same-timestamp inserts', () => {
    createNotification({ category: 'general', title: 'First', message: 'x' });
    createNotification({ category: 'general', title: 'Second', message: 'x' });
    createNotification({ category: 'general', title: 'Third', message: 'x' });
    const list = listNotifications();
    assert.deepEqual(list.map((n) => n.title), ['Third', 'Second', 'First']);
  });

  test('mark one read persists', () => {
    const record = createNotification({ category: 'general', title: 'A', message: 'B' });
    const changed = markNotificationRead(record.id);
    assert.equal(changed, true);
    const [reloaded] = listNotifications();
    assert.equal(reloaded.read, true);
  });

  test('mark one read on unknown id returns false', () => {
    assert.equal(markNotificationRead('00000000-0000-0000-0000-000000000000'), false);
  });

  test('mark all read persists', () => {
    createNotification({ category: 'general', title: 'A', message: 'B' });
    createNotification({ category: 'general', title: 'C', message: 'D' });
    markAllNotificationsRead();
    assert.equal(getUnreadNotificationCount(), 0);
    assert.equal(listNotifications().every((n) => n.read), true);
  });

  test('clear history persists and empties the list', () => {
    createNotification({ category: 'general', title: 'A', message: 'B' });
    clearNotificationHistory();
    assert.deepEqual(listNotifications(), []);
  });

  test('new notifications after clear work normally', () => {
    createNotification({ category: 'general', title: 'A', message: 'B' });
    clearNotificationHistory();
    const record = createNotification({ category: 'general', title: 'After clear', message: 'x' });
    const list = listNotifications();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, record.id);
  });

  test('history cap enforced', () => {
    for (let i = 0; i < NOTIFICATION_HISTORY_LIMIT + 10; i += 1) {
      createNotification({ category: 'general', title: `n${i}`, message: 'x' });
    }
    assert.equal(listNotifications(NOTIFICATION_HISTORY_LIMIT + 50).length, NOTIFICATION_HISTORY_LIMIT);
  });

  test('invalid category throws rather than persisting malformed data', () => {
    assert.throws(() => createNotification({ category: 'not-a-real-category' as any, title: 'A', message: 'B' }));
  });

  test('title and message are trimmed and length-capped', () => {
    const record = createNotification({
      category: 'general',
      title: `  padded  `,
      message: 'x'.repeat(2000),
    });
    assert.equal(record.title, 'padded');
    assert.equal(record.message.length, 1000);
  });

  test('malformed persisted rows fail safe when read back', () => {
    db.prepare(`
      INSERT INTO notifications (id, category, title, message, severity, read)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('malformed-row-id', 'not-a-category', 'Bad row', 'msg', 'not-a-severity', 0);
    const found = listNotifications().find((n) => n.id === 'malformed-row-id');
    assert.ok(found);
    assert.equal(found!.category, 'general');
    assert.equal(found!.severity, 'info');
  });

  test('open-view action round-trips', () => {
    const record = createNotification({
      category: 'catalog-update',
      title: 'Update',
      message: 'x',
      action: { type: 'open-view', view: 'trainer-library' },
    });
    const [reloaded] = listNotifications();
    assert.deepEqual(reloaded.action, { type: 'open-view', view: 'trainer-library' });
    void record;
  });
});
