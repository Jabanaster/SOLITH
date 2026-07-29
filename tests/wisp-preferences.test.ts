import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  DEFAULT_WISP_PREFERENCES,
  clampWispPosition,
  parseWispPreferences,
  positionForPreset,
} from '../src/app/wisp/preferences.ts';

describe('Wisp in-app preferences and positioning', () => {
  test('recovers malformed preferences to visible safe defaults', () => {
    assert.deepEqual(parseWispPreferences('{broken'), DEFAULT_WISP_PREFERENCES);
    assert.deepEqual(parseWispPreferences(JSON.stringify({
      form: 'missing',
      scale: 99,
      opacity: 0,
      animationIntensity: 'chaos',
    })), {
      ...DEFAULT_WISP_PREFERENCES,
      scale: 1.5,
      opacity: 0.5,
    });
  });

  test('accepts every bounded user setting', () => {
    const preferences = parseWispPreferences(JSON.stringify({
      form: 'phoenix',
      scale: 0.75,
      opacity: 0.8,
      reducedMotion: true,
      animationIntensity: 'reduced',
      rememberPosition: false,
      rememberForm: false,
    }));
    assert.equal(preferences.form, 'phoenix');
    assert.equal(preferences.scale, 0.75);
    assert.equal(preferences.opacity, 0.8);
    assert.equal(preferences.reducedMotion, true);
    assert.equal(preferences.animationIntensity, 'reduced');
  });

  test('clamps invalid and off-screen positions into the usable viewport', () => {
    assert.deepEqual(
      clampWispPosition({ x: -500, y: Number.NaN }, { width: 800, height: 600 }, { width: 150, height: 150 }, 12),
      { x: 12, y: 12 },
    );
    assert.deepEqual(
      clampWispPosition({ x: 900, y: 900 }, { width: 800, height: 600 }, { width: 150, height: 150 }, 12),
      { x: 638, y: 438 },
    );
  });

  test('provides keyboard-accessible edge, corner, and center presets', () => {
    const viewport = { width: 800, height: 600 };
    const sprite = { width: 150, height: 150 };
    assert.deepEqual(positionForPreset('top-left', viewport, sprite, 12), { x: 12, y: 12 });
    assert.deepEqual(positionForPreset('bottom-right', viewport, sprite, 12), { x: 638, y: 438 });
    assert.deepEqual(positionForPreset('center', viewport, sprite, 12), { x: 325, y: 225 });
  });
});
