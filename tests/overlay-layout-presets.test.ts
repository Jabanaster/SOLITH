import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { OVERLAY_LAYOUT_PRESETS, getOverlayLayoutPreset } from '../src/core/cheat-system/overlay-layout-presets.ts';

const RESOLUTIONS = [
  { name: '1080p', width: 1920, height: 1080 },
  { name: 'ultrawide-1440', width: 3440, height: 1440 },
] as const;

function fits(
  workW: number,
  workH: number,
  preset: { width: number; height: number; marginRight: number; marginTop: number },
): boolean {
  const x = workW - preset.marginRight - preset.width;
  const y = preset.marginTop;
  return x >= 0 && y >= 0 && x + preset.width <= workW && y + preset.height <= workH;
}

describe('overlay layout presets — AG bounds', () => {
  test('seven bundled titles are present', () => {
    const ids = Object.keys(OVERLAY_LAYOUT_PRESETS);
    assert.equal(ids.length, 7);
    for (const id of [
      'palworld',
      'stardew-valley',
      'atomfall',
      'avowed',
      'undisputed',
      'dredge',
      'crimson-desert',
    ]) {
      assert.ok(OVERLAY_LAYOUT_PRESETS[id], `missing preset ${id}`);
    }
  });

  test('all presets and default fit 1080p and 3440x1440 work areas', () => {
    const presets = [...Object.values(OVERLAY_LAYOUT_PRESETS), getOverlayLayoutPreset(null)];
    for (const res of RESOLUTIONS) {
      for (const preset of presets) {
        assert.equal(
          fits(res.width, res.height, preset),
          true,
          `preset ${preset.width}x${preset.height} fails ${res.name}`,
        );
      }
    }
  });
});
