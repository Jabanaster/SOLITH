import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  BLOCKED_WISP_ACTIONS,
  createWispMessage,
  DEFAULT_WISP_STATE,
  getWispFormForMessage,
  isWispActionAllowed,
  isWispActionBlocked,
  sanitizeWispActions,
  wispReducer,
} from '../src/core/companion/wisp.ts';

describe('Solith Wisp companion safety model', () => {
  test('allows only companion-safe quick actions', () => {
    assert.equal(isWispActionAllowed('scan_now'), true);
    assert.equal(isWispActionAllowed('open_ocr_capture'), true);
    assert.equal(isWispActionAllowed('write_memory'), false);
    assert.equal(isWispActionAllowed('execute_ct_script'), false);
  });

  test('explicitly records unsafe action classes as blocked', () => {
    assert.equal(isWispActionBlocked('write_memory'), true);
    assert.equal(isWispActionBlocked('promote_l4'), true);
    assert.equal(BLOCKED_WISP_ACTIONS.has('run_shell_command'), true);
  });

  test('sanitizes injected actions before rendering or dispatch', () => {
    const actions = sanitizeWispActions([
      { kind: 'scan_now', label: 'Scan now' },
      { kind: 'write_memory' as never, label: 'Write memory' },
      { kind: 'execute_ct_script' as never, label: 'Run script' },
      { kind: 'dismiss', label: 'Dismiss' },
    ]);

    assert.deepEqual(actions.map((action) => action.kind), ['scan_now', 'dismiss']);
  });

  test('maps safety and operational messages to creature forms', () => {
    assert.equal(getWispFormForMessage(createWispMessage({
      title: 'OCR requested',
      body: 'Open inventory.',
      source: 'ocr-fallback',
    })), 'scan');

    assert.equal(getWispFormForMessage(createWispMessage({
      title: 'Guard blocked',
      body: 'No writes are available.',
      source: 'write-policy',
      severity: 'guard',
    })), 'warning');

    assert.equal(getWispFormForMessage(createWispMessage({
      title: 'Recovery finished',
      body: 'Backup verified.',
      source: 'backup-recovery',
      severity: 'success',
    })), 'phoenix');
  });

  test('reducer keeps Wisp visible for messages and asleep when hidden', () => {
    const message = createWispMessage({
      title: 'Scan pass complete',
      body: '12 stable, 16 no-match.',
      source: 'analysis-runtime',
      severity: 'info',
      actions: [{ kind: 'open_details', label: 'Open details' }],
    });

    const withMessage = wispReducer(DEFAULT_WISP_STATE, { type: 'message', message });
    assert.equal(withMessage.visible, true);
    assert.equal(withMessage.interactionOpen, false);
    assert.equal(withMessage.form, 'dragon');
    assert.equal(withMessage.bubbles.length, 1);
    assert.equal(withMessage.messageHistory.length, 1);

    const hidden = wispReducer(withMessage, { type: 'hide' });
    assert.equal(hidden.visible, false);
    assert.equal(hidden.interactionOpen, false);
    assert.equal(hidden.form, 'crystal');
  });

  test('default state is a free-floating pet without forced bubbles or command input', () => {
    assert.equal(DEFAULT_WISP_STATE.visible, true);
    assert.equal(DEFAULT_WISP_STATE.interactionOpen, false);
    assert.equal(DEFAULT_WISP_STATE.message, null);
    assert.deepEqual(DEFAULT_WISP_STATE.bubbles, []);
  });

  test('closing a detached bubble does not hide the Wisp', () => {
    const message = createWispMessage({
      title: 'Scan complete',
      body: 'Stable signatures recorded.',
      source: 'analysis-runtime',
      severity: 'success',
    });

    const withBubble = wispReducer(DEFAULT_WISP_STATE, { type: 'message', message });
    const withoutBubble = wispReducer(withBubble, { type: 'closeBubble', id: message.id });

    assert.equal(withoutBubble.visible, true);
    assert.equal(withoutBubble.message, null);
    assert.equal(withoutBubble.bubbles.length, 0);
    assert.equal(withoutBubble.form, 'base');
  });

  test('interaction mode is intentional and separate from notification bubbles', () => {
    const opened = wispReducer(DEFAULT_WISP_STATE, { type: 'openInteraction' });
    assert.equal(opened.visible, true);
    assert.equal(opened.interactionOpen, true);
    assert.equal(opened.message, null);
    assert.equal(opened.bubbles.length, 0);

    const closed = wispReducer(opened, { type: 'closeInteraction' });
    assert.equal(closed.interactionOpen, false);
    assert.equal(closed.visible, true);
  });

  test('temporary status forms return to the selected persistent form', () => {
    const selected = wispReducer(DEFAULT_WISP_STATE, { type: 'selectForm', form: 'phoenix' });
    const message = createWispMessage({
      title: 'Scan started',
      body: 'Read-only scan is active.',
      source: 'ocr-fallback',
    });
    const scanning = wispReducer(selected, { type: 'message', message });
    assert.equal(scanning.form, 'scan');
    assert.equal(scanning.preferredForm, 'phoenix');

    const closed = wispReducer(scanning, { type: 'closeBubble', id: message.id });
    assert.equal(closed.form, 'phoenix');
  });

  test('quiet mode survives hide and show without an active message', () => {
    const quiet = wispReducer(DEFAULT_WISP_STATE, { type: 'setQuietMode', quietMode: true });
    const hidden = wispReducer(quiet, { type: 'hide' });
    const shown = wispReducer(hidden, { type: 'show' });

    assert.equal(shown.visible, true);
    assert.equal(shown.quietMode, true);
    assert.equal(shown.mood, 'sleepy');
  });

  test('quiet mode survives closing an interaction', () => {
    const message = createWispMessage({
      title: 'Guard blocked',
      body: 'The requested action is unavailable.',
      source: 'write-policy',
      severity: 'guard',
    });
    const withMessage = wispReducer(DEFAULT_WISP_STATE, { type: 'message', message });
    const quiet = wispReducer(withMessage, { type: 'setQuietMode', quietMode: true });
    const opened = wispReducer(quiet, { type: 'openInteraction' });
    const closed = wispReducer(opened, { type: 'closeInteraction' });

    assert.equal(closed.interactionOpen, false);
    assert.equal(closed.quietMode, true);
    assert.equal(closed.mood, 'sleepy');
  });

  test('non-quiet show and interaction-close retain the normal curious mood', () => {
    const shown = wispReducer(wispReducer(DEFAULT_WISP_STATE, { type: 'hide' }), { type: 'show' });
    const closed = wispReducer(wispReducer(shown, { type: 'openInteraction' }), { type: 'closeInteraction' });

    assert.equal(shown.mood, 'curious');
    assert.equal(closed.mood, 'curious');
  });
});
