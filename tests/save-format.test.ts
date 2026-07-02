import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import {
  UnsupportedSaveFormatError,
  assertPathSaveFormatSupportsOperation,
  detectSaveFormatFromPath,
  getDeclaredSaveFormatCapability,
  getDetectedSaveFormatCapability,
  normalizeDeclaredSaveFormat,
} from '../src/core/saves/save-format.ts';

describe('save format capabilities', () => {
  test('recognizes supported declared formats', () => {
    assert.equal(normalizeDeclaredSaveFormat('xml'), 'xml');
    assert.equal(normalizeDeclaredSaveFormat('JSON'), 'json');
    assert.equal(normalizeDeclaredSaveFormat(' ini '), 'ini');
  });

  test('detects known safe formats from extensions', () => {
    assert.equal(detectSaveFormatFromPath(path.join('saves', 'player.xml')), 'xml');
    assert.equal(detectSaveFormatFromPath(path.join('saves', 'player.json')), 'json');
    assert.equal(detectSaveFormatFromPath(path.join('saves', 'settings.ini')), 'ini');
    assert.equal(detectSaveFormatFromPath(path.join('saves', 'settings.cfg')), 'ini');
    assert.equal(detectSaveFormatFromPath(path.join('saves', 'settings.conf')), 'ini');
  });

  test('classifies malformed and unknown extensions without guessing', () => {
    assert.equal(detectSaveFormatFromPath(path.join('saves', 'player.json.tmp')), 'unsupported');
    assert.equal(detectSaveFormatFromPath(path.join('saves', 'player')), 'unknown');
    assert.equal(normalizeDeclaredSaveFormat('binary'), 'unsupported');
  });

  test('reports explicit capabilities for recognized formats', () => {
    const xml = getDeclaredSaveFormatCapability('xml');
    const json = getDeclaredSaveFormatCapability('json');
    const ini = getDetectedSaveFormatCapability('settings.ini');

    assert.equal(xml.canReadSaveField, true);
    assert.equal(xml.canWriteSaveField, true);
    assert.equal(json.recognized, true);
    assert.equal(json.canReadSaveField, true);
    assert.equal(json.canProposeSaveField, true);
    assert.equal(json.canWriteSaveField, false);
    assert.equal(ini.recognized, true);
    assert.equal(ini.canReadSaveField, true);
    assert.equal(ini.canProposeSaveField, true);
    assert.equal(ini.canWriteSaveField, false);
  });

  test('throws typed unsupported-format errors for save-field operations', () => {
    assert.throws(
      () => assertPathSaveFormatSupportsOperation(path.join('C:\\Users\\private', 'player.json'), 'save_field_write'),
      (error: unknown) => {
        assert.ok(error instanceof UnsupportedSaveFormatError);
        assert.equal(error.code, 'unsupported_save_format');
        assert.equal(error.format, 'json');
        assert.equal(error.operation, 'save_field_write');
        assert.equal(error.targetName, 'player.json');
        assert.match(error.message, /player\.json/);
        assert.equal(error.message.includes('C:\\Users\\private'), false);
        return true;
      },
    );
  });

  test('allows XML save-field operations', () => {
    assert.doesNotThrow(() => assertPathSaveFormatSupportsOperation('farm.xml', 'save_field_read'));
    assert.doesNotThrow(() => assertPathSaveFormatSupportsOperation('farm.xml', 'save_field_propose'));
    assert.doesNotThrow(() => assertPathSaveFormatSupportsOperation('farm.xml', 'save_field_write'));
    assert.doesNotThrow(() => assertPathSaveFormatSupportsOperation('farm.xml', 'save_field_rollback'));
  });

  test('allows JSON read/propose but rejects write execution', () => {
    assert.doesNotThrow(() => assertPathSaveFormatSupportsOperation('player.json', 'save_field_read'));
    assert.doesNotThrow(() => assertPathSaveFormatSupportsOperation('player.json', 'save_field_propose'));
    assert.throws(
      () => assertPathSaveFormatSupportsOperation('player.json', 'save_field_write'),
      /unsupported_save_format/,
    );
  });

  test('allows INI read/propose but rejects write execution', () => {
    assert.doesNotThrow(() => assertPathSaveFormatSupportsOperation('settings.ini', 'save_field_read'));
    assert.doesNotThrow(() => assertPathSaveFormatSupportsOperation('settings.ini', 'save_field_propose'));
    assert.throws(
      () => assertPathSaveFormatSupportsOperation('settings.ini', 'save_field_write'),
      /unsupported_save_format/,
    );
  });
});
