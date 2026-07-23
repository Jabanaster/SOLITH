import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOcrCorrelationEvent,
  extractBestNumericValue,
  normalizeNumericOcrText,
  scaleDisplayRoiToCapture,
} from '../src/core/ocr/local-ocr.js';

test('normalizeNumericOcrText keeps only local numeric OCR characters', () => {
  assert.equal(normalizeNumericOcrText('Gold: O,725 skeyts'), '0725');
  assert.equal(normalizeNumericOcrText('125 / 155 HP'), '125 155');
});

test('extractBestNumericValue reads single numbers and current/max fractions', () => {
  assert.equal(extractBestNumericValue('Gold: 725'), 725);
  assert.equal(extractBestNumericValue('125 / 155'), 125);
  assert.equal(extractBestNumericValue('weight 50.5 / 144'), 50.5);
});

test('buildOcrCorrelationEvent returns a read-only observed-value event', () => {
  const event = buildOcrCorrelationEvent({
    text: '725',
    normalizedText: '725',
    value: 725,
    readOnly: true,
    localOnly: true,
  });

  assert.equal(event?.kind, 'ocr_value');
  assert.equal(event?.observedValue, 725);
  assert.equal(event?.expectedDirection, 'changed');
});

test('scaleDisplayRoiToCapture maps preview drag bounds to capture pixels', () => {
  assert.deepEqual(
    scaleDisplayRoiToCapture(
      { x: 42, y: 24, width: 84, height: 48 },
      { width: 420, height: 240 },
      { width: 1920, height: 1080 },
    ),
    { x: 192, y: 108, width: 384, height: 216 },
  );
});

test('scaleDisplayRoiToCapture clamps ROI to capture bounds', () => {
  assert.deepEqual(
    scaleDisplayRoiToCapture(
      { x: 410, y: 230, width: 80, height: 80 },
      { width: 420, height: 240 },
      { width: 1920, height: 1080 },
    ),
    { x: 1874, y: 1035, width: 46, height: 45 },
  );
});
