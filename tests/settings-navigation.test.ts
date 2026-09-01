import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  getSettings,
  getNavSectionBehaviorMode,
  setNavSectionBehaviorMode,
  getNavCompactMode,
  setNavCompactMode,
  getNavShowSectionLabels,
  setNavShowSectionLabels,
  getNavRememberedSectionState,
  setNavRememberedSectionState,
  setSetting,
} from '../src/core/settings/index.ts';
import { initDatabase } from '../src/core/database/index.ts';

describe('navigation settings persistence', () => {
  before(async () => {
    await initDatabase();
  });

  test('missing navigation fields default safely', () => {
    assert.equal(getNavSectionBehaviorMode(), 'remember');
    assert.equal(getNavCompactMode(), false);
    assert.equal(getNavShowSectionLabels(), true);
    assert.equal(getNavRememberedSectionState(), '{}');
  });

  test('getSettings() includes navigation defaults for a fresh database', () => {
    const settings = getSettings();
    assert.equal(settings.navSectionBehaviorMode, 'remember');
    assert.equal(settings.navCompactMode, false);
    assert.equal(settings.navShowSectionLabels, true);
    assert.equal(settings.navRememberedSectionState, '{}');
  });

  test('setNavSectionBehaviorMode persists and round-trips', () => {
    setNavSectionBehaviorMode('always-expand');
    assert.equal(getNavSectionBehaviorMode(), 'always-expand');
    setNavSectionBehaviorMode('remember');
  });

  test('malformed/unknown behavior-mode value fails safe to remember', () => {
    setSetting('navSectionBehaviorMode', 'not-a-real-mode');
    assert.equal(getNavSectionBehaviorMode(), 'remember');
    assert.equal(getSettings().navSectionBehaviorMode, 'remember');
    setSetting('navSectionBehaviorMode', 'remember');
  });

  test('setNavCompactMode persists boolean', () => {
    setNavCompactMode(true);
    assert.equal(getNavCompactMode(), true);
    setNavCompactMode(false);
    assert.equal(getNavCompactMode(), false);
  });

  test('setNavShowSectionLabels persists boolean', () => {
    setNavShowSectionLabels(false);
    assert.equal(getNavShowSectionLabels(), false);
    setNavShowSectionLabels(true);
    assert.equal(getNavShowSectionLabels(), true);
  });

  test('setNavRememberedSectionState persists arbitrary JSON string', () => {
    setNavRememberedSectionState('{"Library":true}');
    assert.equal(getNavRememberedSectionState(), '{"Library":true}');
    setNavRememberedSectionState('{}');
  });

  test('legacy settings unaffected by navigation field additions', () => {
    const settings = getSettings();
    assert.equal(settings.theme, 'dark');
    assert.equal(settings.aiProvider, 'None');
    assert.equal(typeof settings.onboardingCompleted, 'boolean');
  });
});
