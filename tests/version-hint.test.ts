import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { extractVersionHint } from '../src/core/registry/version-hint.js';

describe('extractVersionHint (Mission 17 — optional, non-authoritative)', () => {
  test('explicit version number wins', () => {
    const result = extractVersionHint('DS3_TGA_v3.4.0.CT');
    assert.equal(result.kind, 'explicit_version');
    assert.equal(result.hint, '3.4.0');
  });

  test('ISO date is recognized when no version number present', () => {
    const result = extractVersionHint('ff7_2012_update_23-10-14.ct'); // no v-number here
    // "23-10-14" is not a full ISO year, so this should NOT match as a date —
    // verifies we don't false-positive on ambiguous short numeric strings.
    assert.equal(result.kind, 'none');
  });

  test('real ISO-dated filename is recognized', () => {
    const result = extractVersionHint('ff7_-_2016-09-26_-_jgheld.ct');
    assert.equal(result.kind, 'date');
    assert.equal(result.hint, '2016-09-26');
  });

  test('platform tag alone is the weakest signal', () => {
    const result = extractVersionHint('bl2-steam-updated_no_aob.ct'.replace('bl2-', 'bl2 '));
    assert.equal(result.kind, 'platform_only');
    assert.equal(result.hint, 'steam');
  });

  test('nothing recognizable -> none, not an error', () => {
    const result = extractVersionHint('pointerscan result');
    assert.equal(result.kind, 'none');
    assert.equal(result.hint, null);
  });

  test('checks both tableName and archivePath', () => {
    const result = extractVersionHint('Tactics Ogre Reborn', 'Games/Tactics Ogre Reborn v1.2.3/0_Tactics Ogre Reborn.CT');
    assert.equal(result.kind, 'explicit_version');
    assert.equal(result.hint, '1.2.3');
  });

  test('empty/undefined inputs are safe', () => {
    assert.deepEqual(extractVersionHint(), { kind: 'none', hint: null });
    assert.deepEqual(extractVersionHint(undefined, ''), { kind: 'none', hint: null });
  });

  test('Mission 13 regression — a bare trailing community-table ID is NOT misread as a version', () => {
    // Real Hexorg/CheatEngineTables filename shape: "<name>_<sequential-id>.ct".
    // The trailing "_524" here is an arbitrary community-database row ID, not
    // a game version — must not produce a false explicit_version hint.
    const result = extractVersionHint('borderlands2_v_1.2.2_524');
    assert.equal(result.kind, 'explicit_version');
    assert.equal(result.hint, '1.2.2', 'must extract the real "1.2.2" version, not the trailing "524" id');
  });

  test('Mission 13 regression — pure numeric filename with no dotted version yields none, not a false version', () => {
    const result = extractVersionHint('isaac-ng_108');
    assert.equal(result.kind, 'none');
  });
});
