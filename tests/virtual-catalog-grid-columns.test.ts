import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { computeColumnCount } from '../src/app/components/VirtualCatalogGrid.tsx';

describe('computeColumnCount — container-width-derived column count, no fixed cap', () => {
  test('narrow container yields a single column', () => {
    assert.equal(computeColumnCount(320), 1);
  });

  test('typical laptop width yields a moderate column count', () => {
    assert.equal(computeColumnCount(1488), 4);
  });

  test('wide viewport (2560px) yields more than the old 6-column cap', () => {
    assert.ok(computeColumnCount(2560) > 6, `expected >6 columns, got ${computeColumnCount(2560)}`);
  });

  test('ultra-wide viewport (3440px) scales further, no ceiling', () => {
    const at2560 = computeColumnCount(2560);
    const at3440 = computeColumnCount(3440);
    assert.ok(at3440 > at2560, `expected column count to keep increasing with width`);
  });

  test('wider width never decreases column count', () => {
    const widths = [300, 600, 900, 1200, 1600, 2000, 2400, 2800, 3200, 3600];
    let previous = 0;
    for (const w of widths) {
      const count = computeColumnCount(w);
      assert.ok(count >= previous, `column count decreased at width ${w}`);
      previous = count;
    }
  });

  test('never returns fewer than 1 column even at 0 width', () => {
    assert.equal(computeColumnCount(0), 1);
  });

  test('negative width clamps to 1 column', () => {
    assert.equal(computeColumnCount(-100), 1);
  });

  test('NaN width does not propagate — clamps to 1 column', () => {
    assert.equal(computeColumnCount(NaN), 1);
  });

  test('Infinity width clamps to 1 column, not Infinity columns', () => {
    assert.equal(computeColumnCount(Infinity), 1);
  });

  test('-Infinity width clamps to 1 column', () => {
    assert.equal(computeColumnCount(-Infinity), 1);
  });

  test('very narrow finite width still yields at least 1 column', () => {
    assert.equal(computeColumnCount(1), 1);
    assert.equal(computeColumnCount(0.5), 1);
  });
});
