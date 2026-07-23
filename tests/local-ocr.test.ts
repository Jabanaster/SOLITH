import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOcrCorrelationEvent,
  extractBestNumericValue,
  normalizeNumericOcrText,
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
