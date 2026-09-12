import assert from 'node:assert/strict';
import test from 'node:test';
import { toSafeDisplayText } from '../src/shared/safe-display-text.js';

/**
 * Core Product Completion audit, Mission 1 — adversarial bidi/zero-width
 * display-spoofing tests. Every dangerous code point is referenced only by
 * its \u escape (never a raw literal) so this file itself never embeds the
 * exact bytes it exists to test stripping.
 */
const LRE = '‪';
const RLE = '‫';
const PDF = '‬';
const LRO = '‭';
const RLO = '‮';
const LRI = '⁦';
const RLI = '⁧';
const FSI = '⁨';
const PDI = '⁩';
const ZWSP = '​';
const ZWNJ = '‌';
const ZWJ = '‍';
const WORD_JOINER = '⁠';
const BOM = '﻿';
const LRM = '‎';
const RLM = '‏';
const BELL = '\x07';
const NUL = '\x00';
const DEL = '\x7F';

test('RLO is stripped — classic filename-extension spoof vector', () => {
  const spoofed = `cool-game${RLO}exe.txt`;
  assert.equal(toSafeDisplayText(spoofed), 'cool-gameexe.txt');
});

test('LRO is stripped', () => {
  assert.equal(toSafeDisplayText(`a${LRO}b`), 'ab');
});

test('LRE/RLE + PDF (embedding/pop pairs) are stripped', () => {
  assert.equal(toSafeDisplayText(`a${LRE}b${PDF}c${RLE}d${PDF}e`), 'abcde');
});

test('LRI/RLI/FSI/PDI (isolates) are stripped', () => {
  assert.equal(toSafeDisplayText(`a${LRI}b${PDI}c${RLI}d${PDI}e${FSI}f${PDI}g`), 'abcdefg');
});

test('zero-width characters (ZWSP/ZWNJ/ZWJ/word-joiner/BOM) are stripped', () => {
  assert.equal(toSafeDisplayText(`fa${ZWSP}vor${ZWNJ}ite${ZWJ}${WORD_JOINER}${BOM}`), 'favorite');
});

test('non-whitespace control characters are stripped', () => {
  assert.equal(toSafeDisplayText(`a${BELL}b${NUL}c${DEL}d`), 'abcd');
});

test('LRM and RLM (bidi MARKS, not formatting characters) are preserved — harmless and common in real mixed-direction text', () => {
  const input = `a${LRM}b${RLM}c`;
  assert.equal(toSafeDisplayText(input), input);
});

test('legitimate RTL/LTR mixed real-world title is unchanged', () => {
  const input = 'مرحبا Game 2';
  assert.equal(toSafeDisplayText(input), input);
});

test('normal international titles (CJK, Cyrillic, accents) are unchanged — never ASCII-folded', () => {
  for (const title of ['日本語ゲーム', 'Игра', 'Café Über Quête', 'Pokémon']) {
    assert.equal(toSafeDisplayText(title), title);
  }
});

test('emoji and other supplementary-plane characters are unchanged', () => {
  const input = 'Game 🎮 Title 🔥';
  assert.equal(toSafeDisplayText(input), input);
});

test('whitespace (tab, newline, CR, regular space) is preserved', () => {
  const input = 'a\tb\nc\rd e';
  assert.equal(toSafeDisplayText(input), input);
});

test('null/undefined/empty input returns empty string, never throws', () => {
  assert.equal(toSafeDisplayText(null), '');
  assert.equal(toSafeDisplayText(undefined), '');
  assert.equal(toSafeDisplayText(''), '');
});

test('a title with only formatting characters collapses to empty string, not a crash', () => {
  assert.equal(toSafeDisplayText(`${RLO}${LRO}${PDF}`), '');
});

test('combined real-world adversarial payload: hidden extension spoof mixed with real title', () => {
  const payload = `Half${ZWSP}-Life${RLO} 2${LRM}`;
  const result = toSafeDisplayText(payload);
  assert.doesNotMatch(result, /[‪-‮⁦-⁩​‌‍⁠﻿]/u);
  assert.equal(result, `Half-Life 2${LRM}`);
});
