import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  getSettings,
  getNotificationsToastEnabled,
  setNotificationsToastEnabled,
  getNotificationsCategoryEnabled,
  getNotificationsShowUnreadBadge,
  setNotificationsShowUnreadBadge,
  getCommunitySyncEverSucceeded,
  setCommunitySyncEverSucceeded,
  setSetting,
} from '../src/core/settings/index.ts';
import { initDatabase } from '../src/core/database/index.ts';

describe('notification settings persistence', () => {
  before(async () => {
    await initDatabase();
  });

  test('missing notification fields default to enabled/true', () => {
    assert.equal(getNotificationsToastEnabled(), true);
    assert.equal(getNotificationsShowUnreadBadge(), true);
    assert.equal(getNotificationsCategoryEnabled('catalog-update'), true);
    assert.equal(getNotificationsCategoryEnabled('artwork'), true);
    assert.equal(getNotificationsCategoryEnabled('trainer-profile'), true);
    assert.equal(getNotificationsCategoryEnabled('maintenance'), true);
    assert.equal(getCommunitySyncEverSucceeded(), false);
  });

  test('getSettings() includes notification defaults for a fresh database', () => {
    const settings = getSettings();
    assert.equal(settings.notificationsToastEnabled, true);
    assert.equal(settings.notificationsCatalogUpdateEnabled, true);
    assert.equal(settings.notificationsArtworkEnabled, true);
    assert.equal(settings.notificationsTrainerProfileEnabled, true);
    assert.equal(settings.notificationsMaintenanceEnabled, true);
    assert.equal(settings.notificationsShowUnreadBadge, true);
    assert.equal(settings.communitySyncEverSucceeded, false);
  });

  test('setNotificationsToastEnabled persists and round-trips', () => {
    setNotificationsToastEnabled(false);
    assert.equal(getNotificationsToastEnabled(), false);
    setNotificationsToastEnabled(true);
    assert.equal(getNotificationsToastEnabled(), true);
  });

  test('setNotificationsShowUnreadBadge persists and round-trips', () => {
    setNotificationsShowUnreadBadge(false);
    assert.equal(getNotificationsShowUnreadBadge(), false);
    setNotificationsShowUnreadBadge(true);
    assert.equal(getNotificationsShowUnreadBadge(), true);
  });

  test('setCommunitySyncEverSucceeded persists and round-trips', () => {
    setCommunitySyncEverSucceeded(true);
    assert.equal(getCommunitySyncEverSucceeded(), true);
    setCommunitySyncEverSucceeded(false);
    assert.equal(getCommunitySyncEverSucceeded(), false);
  });

  test('per-category toggle persists independently', () => {
    setSetting('notificationsCatalogUpdateEnabled', false);
    assert.equal(getNotificationsCategoryEnabled('catalog-update'), false);
    assert.equal(getNotificationsCategoryEnabled('artwork'), true);
    setSetting('notificationsCatalogUpdateEnabled', true);
  });

  test('legacy/malformed values fail safe to enabled (true)', () => {
    setSetting('notificationsToastEnabled', 'not-a-boolean' as any);
    assert.equal(getNotificationsToastEnabled(), true);
    setSetting('notificationsToastEnabled', true);
  });

  test('legacy settings unaffected by notification field additions', () => {
    const settings = getSettings();
    assert.equal(settings.theme, 'dark');
    assert.equal(settings.aiProvider, 'None');
  });
});
