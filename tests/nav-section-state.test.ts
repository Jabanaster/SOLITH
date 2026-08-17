import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canManuallyToggleSections,
  isSectionCollapsed,
  parseRememberedSectionState,
  serializeRememberedSectionState,
  toggleRememberedSection,
} from '../src/app/lib/navSectionState.ts';

describe('parseRememberedSectionState', () => {
  test('empty/undefined/null input yields empty map', () => {
    assert.deepEqual(parseRememberedSectionState(undefined), {});
    assert.deepEqual(parseRememberedSectionState(null), {});
    assert.deepEqual(parseRememberedSectionState(''), {});
  });

  test('malformed JSON fails safe to empty map', () => {
    assert.deepEqual(parseRememberedSectionState('{not json'), {});
  });

  test('non-object JSON (array/number/string) fails safe to empty map', () => {
    assert.deepEqual(parseRememberedSectionState('[1,2,3]'), {});
    assert.deepEqual(parseRememberedSectionState('42'), {});
    assert.deepEqual(parseRememberedSectionState('"hello"'), {});
  });

  test('drops non-boolean values from an otherwise valid map', () => {
    const result = parseRememberedSectionState('{"Library":true,"Recovery":"nope","Advanced":1}');
    assert.deepEqual(result, { Library: true });
  });

  test('valid map round-trips through serialize', () => {
    const map = { Library: true, Recovery: false };
    assert.deepEqual(parseRememberedSectionState(serializeRememberedSectionState(map)), map);
  });
});

describe('toggleRememberedSection', () => {
  test('flips an unset section from expanded to collapsed', () => {
    assert.deepEqual(toggleRememberedSection({}, 'Library'), { Library: true });
  });

  test('flips a collapsed section back to expanded', () => {
    assert.deepEqual(toggleRememberedSection({ Library: true }, 'Library'), { Library: false });
  });

  test('leaves other sections untouched', () => {
    const result = toggleRememberedSection({ Recovery: true }, 'Library');
    assert.deepEqual(result, { Recovery: true, Library: true });
  });
});

describe('isSectionCollapsed precedence', () => {
  test('always-expand overrides remembered collapsed state', () => {
    const collapsed = isSectionCollapsed({
      title: 'Library',
      behaviorMode: 'always-expand',
      activeSectionTitle: 'Advanced',
      remembered: { Library: true },
    });
    assert.equal(collapsed, false);
  });

  test('always-collapse-inactive expands only the active section', () => {
    assert.equal(
      isSectionCollapsed({
        title: 'Library',
        behaviorMode: 'always-collapse-inactive',
        activeSectionTitle: 'Library',
        remembered: {},
      }),
      false,
    );
    assert.equal(
      isSectionCollapsed({
        title: 'Recovery',
        behaviorMode: 'always-collapse-inactive',
        activeSectionTitle: 'Library',
        remembered: { Recovery: false },
      }),
      true,
    );
  });

  test('always-collapse-inactive with no active section collapses nothing', () => {
    assert.equal(
      isSectionCollapsed({
        title: 'Library',
        behaviorMode: 'always-collapse-inactive',
        activeSectionTitle: null,
        remembered: {},
      }),
      false,
    );
  });

  test('remember mode restores manual per-section state', () => {
    assert.equal(
      isSectionCollapsed({
        title: 'Library',
        behaviorMode: 'remember',
        activeSectionTitle: null,
        remembered: { Library: true },
      }),
      true,
    );
  });

  test('remember mode with no remembered entry defaults to expanded', () => {
    assert.equal(
      isSectionCollapsed({
        title: 'Library',
        behaviorMode: 'remember',
        activeSectionTitle: null,
        remembered: {},
      }),
      false,
    );
  });
});

describe('canManuallyToggleSections', () => {
  test('only remember mode allows manual toggling', () => {
    assert.equal(canManuallyToggleSections('remember'), true);
    assert.equal(canManuallyToggleSections('always-expand'), false);
    assert.equal(canManuallyToggleSections('always-collapse-inactive'), false);
  });
});
