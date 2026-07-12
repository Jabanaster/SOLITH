import { test, describe } from 'node:test';
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import type { TrainerItem } from '../src/shared/types/index.js';
import {
  SAVE_EDIT_RISK_COPY,
  saveEditRiskLabelForFormat,
} from '../src/app/save-edit-risk-labels.js';
import {
  LOCAL_TRAINER_SERVICE_UNAVAILABLE_MESSAGE,
  LOCAL_ONLY_SAFETY_MESSAGE,
  OPERATION_FAILED_BEFORE_WRITE_MESSAGE,
  PREVIEW_ONLY_FORMAT_MESSAGE,
  UNSUPPORTED_FORMAT_BLOCKED_MESSAGE,
  stripFilesystemPaths,
} from '../src/app/reliability-messages.js';

// ── Replicated from TrainerPage.tsx for unit testing ──────────────────────────

type TrainerCardState =
  | 'READY' | 'GAME_RUNNING' | 'NEEDS_RESCAN'
  | 'BROKEN' | 'BLOCKED' | 'APPLYING' | 'APPLIED' | 'RESTORED' | 'FAILED';

function deriveCardState(
  item: TrainerItem,
  transient: TrainerCardState | null,
  gameRunning: boolean
): TrainerCardState {
  if (transient && ['APPLYING', 'APPLIED', 'RESTORED', 'FAILED'].includes(transient)) {
    return transient;
  }
  const statusStr = (item.status ?? '').toLowerCase();
  if (item.risk === 'Blocked' || statusStr === 'blocked') return 'BLOCKED';
  if (statusStr === 'needs rescan') return 'NEEDS_RESCAN';
  if (statusStr === 'broken') return 'BROKEN';
  if (gameRunning) return 'GAME_RUNNING';
  return 'READY';
}

// ── Helper ────────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<TrainerItem> = {}): TrainerItem {
  return {
    id: randomUUID(),
    name: 'Test Item',
    description: 'A test trainer item',
    category: 'PLAYER',
    source: '/tmp/save.json',
    risk: 'Safe',
    status: 'Ready',
    confidence: 90,
    currentValue: 100,
    path: 'player.health',
    ...overrides,
  };
}

// ── deriveCardState tests ─────────────────────────────────────────────────────

describe('deriveCardState — Trainer UX state machine', () => {

  test('1. READY when no transient, game closed, item ready', () => {
    const item = makeItem({ risk: 'Safe', status: 'Ready' });
    assert.strictEqual(deriveCardState(item, null, false), 'READY');
  });

  test('2. GAME_RUNNING when game is open and item is otherwise ready', () => {
    const item = makeItem({ risk: 'Safe', status: 'Ready' });
    assert.strictEqual(deriveCardState(item, null, true), 'GAME_RUNNING');
  });

  test('3. BLOCKED when item risk is Blocked', () => {
    const item = makeItem({ risk: 'Blocked', status: 'Ready' });
    assert.strictEqual(deriveCardState(item, null, false), 'BLOCKED');
  });

  test('4. BLOCKED when status is "blocked" (case-insensitive)', () => {
    const item = makeItem({ risk: 'Safe', status: 'Blocked' });
    assert.strictEqual(deriveCardState(item, null, false), 'BLOCKED');
  });

  test('5. BLOCKED when status is "BLOCKED" (upper)', () => {
    const item = makeItem({ risk: 'Safe', status: 'BLOCKED' });
    assert.strictEqual(deriveCardState(item, null, false), 'BLOCKED');
  });

  test('6. NEEDS_RESCAN when status is "needs rescan"', () => {
    const item = makeItem({ risk: 'Safe', status: 'Needs Rescan' });
    assert.strictEqual(deriveCardState(item, null, false), 'NEEDS_RESCAN');
  });

  test('7. NEEDS_RESCAN is not affected by game running (status wins)', () => {
    const item = makeItem({ risk: 'Safe', status: 'Needs Rescan' });
    assert.strictEqual(deriveCardState(item, null, true), 'NEEDS_RESCAN');
  });

  test('8. BROKEN when status is "broken"', () => {
    const item = makeItem({ risk: 'Safe', status: 'broken' });
    assert.strictEqual(deriveCardState(item, null, false), 'BROKEN');
  });

  test('9. APPLYING transient takes precedence over READY', () => {
    const item = makeItem({ risk: 'Safe', status: 'Ready' });
    assert.strictEqual(deriveCardState(item, 'APPLYING', false), 'APPLYING');
  });

  test('10. APPLIED transient takes precedence over BLOCKED item risk', () => {
    const item = makeItem({ risk: 'Blocked', status: 'Ready' });
    assert.strictEqual(deriveCardState(item, 'APPLIED', false), 'APPLIED');
  });

  test('11. RESTORED transient preserved', () => {
    const item = makeItem({ risk: 'Caution', status: 'Ready' });
    assert.strictEqual(deriveCardState(item, 'RESTORED', false), 'RESTORED');
  });

  test('12. FAILED transient preserved even when game running', () => {
    const item = makeItem({ risk: 'Safe', status: 'Ready' });
    assert.strictEqual(deriveCardState(item, 'FAILED', true), 'FAILED');
  });

  test('15. BLOCKED status beats GAME_RUNNING', () => {
    const item = makeItem({ risk: 'Safe', status: 'Blocked' });
    assert.strictEqual(deriveCardState(item, null, true), 'BLOCKED');
  });

  test('16. BROKEN status beats GAME_RUNNING', () => {
    const item = makeItem({ risk: 'Safe', status: 'Broken' });
    assert.strictEqual(deriveCardState(item, null, true), 'BROKEN');
  });

  test('17. Caution risk with Ready status yields READY', () => {
    const item = makeItem({ risk: 'Caution', status: 'Ready' });
    assert.strictEqual(deriveCardState(item, null, false), 'READY');
  });

  test('18. Risky risk with Ready status yields READY', () => {
    const item = makeItem({ risk: 'Risky', status: 'Ready' });
    assert.strictEqual(deriveCardState(item, null, false), 'READY');
  });
});

// ── STATE_CONFIG completeness check ──────────────────────────────────────────

describe('STATE_CONFIG — all active states defined', () => {
  const ALL_STATES: TrainerCardState[] = [
    'READY', 'GAME_RUNNING', 'NEEDS_RESCAN',
    'BROKEN', 'BLOCKED', 'APPLYING', 'APPLIED', 'RESTORED', 'FAILED',
  ];

  const STATE_CONFIG: Record<TrainerCardState, { label: string; color: string; explanation: string }> = {
    READY:        { label: 'Ready',        color: 'safe',    explanation: '' },
    GAME_RUNNING: { label: 'Game Running', color: 'caution', explanation: 'Close the game before modifying this save.' },
    NEEDS_RESCAN: { label: 'Needs Rescan', color: 'caution', explanation: 'The save structure changed after a game update.' },
    BROKEN:       { label: 'Broken',       color: 'risky',   explanation: 'Target file not found or inaccessible.' },
    BLOCKED:      { label: 'Blocked',      color: 'blocked', explanation: UNSUPPORTED_FORMAT_BLOCKED_MESSAGE },
    APPLYING:     { label: 'Applying…',    color: 'info',    explanation: 'Writing change atomically. Do not close.' },
    APPLIED:      { label: 'Applied ✓',    color: 'safe',    explanation: 'Change applied. Backup created.' },
    RESTORED:     { label: 'Restored ✓',   color: 'safe',    explanation: 'Original value restored from backup.' },
    FAILED:       { label: 'Failed',       color: 'risky',   explanation: OPERATION_FAILED_BEFORE_WRITE_MESSAGE },
  };

  test('19. All active TrainerCardState values are in STATE_CONFIG', () => {
    for (const s of ALL_STATES) {
      assert.ok(s in STATE_CONFIG, `Missing state: ${s}`);
    }
  });

  test('20. Every STATE_CONFIG entry has a non-empty label', () => {
    for (const [state, config] of Object.entries(STATE_CONFIG)) {
      assert.ok(config.label.length > 0, `Empty label for state ${state}`);
    }
  });

  test('21. Every STATE_CONFIG entry has a color', () => {
    const validColors = ['safe', 'caution', 'risky', 'blocked', 'info', 'muted'];
    for (const [state, config] of Object.entries(STATE_CONFIG)) {
      assert.ok(validColors.includes(config.color), `Bad color "${config.color}" for state ${state}`);
    }
  });

  test('22. READY has empty explanation (no warning needed)', () => {
    assert.strictEqual(STATE_CONFIG.READY.explanation, '');
  });

  test('23. All warning states have non-empty explanation', () => {
    const warningStates: TrainerCardState[] = [
      'GAME_RUNNING', 'NEEDS_RESCAN', 'BROKEN', 'BLOCKED', 'APPLYING', 'FAILED',
    ];
    for (const s of warningStates) {
      assert.ok(STATE_CONFIG[s].explanation.length > 0, `Missing explanation for ${s}`);
    }
  });
});

// ── TrainerItem shape validation ─────────────────────────────────────────────

describe('TrainerItem — shape and field constraints', () => {

  test('24. makeItem produces valid TrainerItem', () => {
    const item = makeItem();
    assert.ok(item.id, 'id present');
    assert.ok(item.name, 'name present');
    assert.ok(item.category, 'category present');
    assert.ok(item.risk, 'risk present');
    assert.ok(item.status !== undefined, 'status present');
  });

  test('25. inputType toggle maps to boolean control', () => {
    const item = makeItem({ inputType: 'toggle', currentValue: true });
    assert.strictEqual(item.inputType, 'toggle');
    assert.strictEqual(typeof item.currentValue, 'boolean');
  });

  test('26. inputType slider requires min and max', () => {
    const item = makeItem({ inputType: 'slider', min: 0, max: 100, currentValue: 50 });
    assert.strictEqual(item.inputType, 'slider');
    assert.ok(item.min !== undefined, 'min defined');
    assert.ok(item.max !== undefined, 'max defined');
    assert.ok((item.currentValue as number) >= item.min!, 'value in range (low)');
    assert.ok((item.currentValue as number) <= item.max!, 'value in range (high)');
  });

  test('27. inputType dropdown requires options array', () => {
    const item = makeItem({
      inputType: 'dropdown',
      options: [
        { label: 'Easy', value: 'easy' },
        { label: 'Normal', value: 'normal' },
        { label: 'Hard', value: 'hard' }
      ],
      currentValue: 'normal'
    });
    assert.ok(Array.isArray(item.options), 'options is array');
    assert.ok((item.options as Array<{ label: string; value: string }>).some(o => o.value === item.currentValue), 'currentValue in options');
  });

  test('28. Items with no path can still be valid', () => {
    const item = makeItem({ path: undefined });
    const state = deriveCardState(item, null, false);
    assert.strictEqual(state, 'READY');
  });

  test('29. Item with missing confidence still derives correct state', () => {
    const item = makeItem({ confidence: undefined, status: 'Ready', risk: 'Safe' });
    assert.strictEqual(deriveCardState(item, null, false), 'READY');
  });
});

// ── Compatibility-level label validation ─────────────────────────────────────

describe('Compatibility profile level taxonomy', () => {
  const VALID_LEVELS = ['VERIFIED', 'SUPPORTED', 'READ_ONLY', 'EXPERIMENTAL', 'UNSUPPORTED', 'BLOCKED'];

  test('30. Six valid compatibility levels defined', () => {
    assert.strictEqual(VALID_LEVELS.length, 6);
  });

  test('31. VERIFIED is the highest tier', () => {
    assert.strictEqual(VALID_LEVELS[0], 'VERIFIED');
  });

  test('32. BLOCKED is the lowest tier', () => {
    assert.strictEqual(VALID_LEVELS[VALID_LEVELS.length - 1], 'BLOCKED');
  });

  test('33. BLOCKED_PENDING_USER_DATA is not a valid profile level (is a dashboard note)', () => {
    assert.ok(!VALID_LEVELS.includes('BLOCKED_PENDING_USER_DATA' as any));
  });
});

describe('Save edit risk messaging', () => {
  test('34. labels exist for read-only, preview-only, executable, and blocked states', () => {
    assert.strictEqual(SAVE_EDIT_RISK_COPY.read_only.label, 'Read-only');
    assert.strictEqual(SAVE_EDIT_RISK_COPY.preview_only.label, 'Preview-only');
    assert.strictEqual(SAVE_EDIT_RISK_COPY.executable.label, 'Executable');
    assert.strictEqual(SAVE_EDIT_RISK_COPY.blocked.label, 'Blocked');
  });

  test('35. JSON and INI are executable save-field formats', () => {
    assert.strictEqual(saveEditRiskLabelForFormat('json'), 'Executable');
    assert.strictEqual(saveEditRiskLabelForFormat('ini'), 'Executable');
    assert.strictEqual(saveEditRiskLabelForFormat('cfg'), 'Preview-only');
  });

  test('36. executable copy keeps approval, backup, and rollback language', () => {
    const copy = SAVE_EDIT_RISK_COPY.executable.detail.toLowerCase();
    assert.match(copy, /xml/);
    assert.match(copy, /json/);
    assert.match(copy, /ini/);
    assert.match(copy, /approval/);
    assert.match(copy, /backup/);
    assert.match(copy, /rollback/);
    assert.match(copy, /before writing/);
    assert.match(copy, /after a supported write/);
  });

  test('37. blocked copy covers unsupported formats and unsafe paths', () => {
    const copy = SAVE_EDIT_RISK_COPY.blocked.detail.toLowerCase();
    assert.match(copy, /blocked - this format is not executable yet/);
    assert.match(copy, /unsupported formats/);
    assert.match(copy, /unsafe paths/);
    assert.match(copy, /rejected operations/);
  });

  test('38. risk messaging does not reintroduce misleading safe edit wording or unsafe domains', () => {
    const allCopy = Object.values(SAVE_EDIT_RISK_COPY)
      .map(copy => `${copy.label} ${copy.summary} ${copy.detail}`)
      .join(' ')
      .toLowerCase();
    assert.ok(!allCopy.includes('safe edit'));
    assert.ok(!allCopy.includes('multiplayer'));
    assert.ok(!allCopy.includes('anti-cheat'));
    assert.ok(!allCopy.includes('process injection'));
    assert.ok(!allCopy.includes('memory editing'));
    assert.ok(!allCopy.includes('debugger attachment'));
  });

  test('39. preview-only cfg/config copy does not claim backup or rollback execution', () => {
    const copy = SAVE_EDIT_RISK_COPY.preview_only.detail.toLowerCase();
    assert.ok(copy.includes(PREVIEW_ONLY_FORMAT_MESSAGE.toLowerCase()));
    assert.match(copy, /write execution/);
    assert.match(copy, /backup creation/);
    assert.match(copy, /rollback execution/);
    assert.match(copy, /blocked/);
    assert.ok(!copy.includes('rollback available'));
  });

  test('40. blocked copy does not claim rollback availability', () => {
    const copy = SAVE_EDIT_RISK_COPY.blocked.detail.toLowerCase();
    assert.match(copy, /backup/);
    assert.match(copy, /rollback/);
    assert.match(copy, /unavailable/);
    assert.ok(!copy.includes('rollback available'));
  });

  test('41. reliability messages are user-safe and do not claim file changes after blocked writes', () => {
    assert.strictEqual(
      LOCAL_TRAINER_SERVICE_UNAVAILABLE_MESSAGE,
      'Local trainer service unavailable. No game files were changed.'
    );
    assert.strictEqual(
      OPERATION_FAILED_BEFORE_WRITE_MESSAGE,
      'Operation failed before write completion. Check backup/rollback status before retrying.'
    );

    const copy = [
      LOCAL_TRAINER_SERVICE_UNAVAILABLE_MESSAGE,
      OPERATION_FAILED_BEFORE_WRITE_MESSAGE,
      UNSUPPORTED_FORMAT_BLOCKED_MESSAGE,
      PREVIEW_ONLY_FORMAT_MESSAGE,
    ].join(' ').toLowerCase();

    assert.match(copy, /no game files were changed/);
    assert.match(copy, /before write completion/);
    assert.ok(!copy.includes('safe edit'));
    assert.ok(!copy.includes('online'));
    assert.ok(!copy.includes('multiplayer'));
    assert.ok(!copy.includes('memory editing'));
    assert.ok(!copy.includes('process injection'));
    assert.ok(!copy.includes('debugger attachment'));
    assert.ok(!copy.includes('anti-cheat'));
  });

  test('42. displayed error detail strips full filesystem paths', () => {
    const source = 'ENOENT C:\\Users\\private\\AppData\\Roaming\\ResourceForge\\backups\\manifest.json /tmp/private/save.json';
    const safe = stripFilesystemPaths(source);
    assert.equal(safe.includes('C:\\Users\\private'), false);
    assert.equal(safe.includes('/tmp/private'), false);
    assert.match(safe, /\[path\]/);
  });

  test('43. local-only safety copy is short, scoped, and does not imply prohibited support', () => {
    const copy = LOCAL_ONLY_SAFETY_MESSAGE.toLowerCase();
    assert.match(copy, /local single-player files only/);
    assert.match(copy, /approved supported action/);
    assert.equal(copy.includes('online'), false);
    assert.equal(copy.includes('multiplayer'), false);
    assert.equal(copy.includes('anti-cheat'), false);
    assert.equal(copy.includes('memory'), false);
    assert.equal(copy.includes('process'), false);
    assert.equal(copy.includes('debugger'), false);
    assert.equal(copy.includes('cloud'), false);
  });
});
