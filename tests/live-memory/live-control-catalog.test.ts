import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listControlsForGame, getControl, listAllControls } from '../../src/core/live-memory/live-control-catalog.js';

test('listControlsForGame returns the Atomfall ammo control for the exact executable name', () => {
  const controls = listControlsForGame('Atomfall_dx12.exe');
  assert.equal(controls.length, 1);
  assert.equal(controls[0].id, 'atomfall-current-weapon-ammo');
});

test('listControlsForGame matches case-insensitively', () => {
  assert.equal(listControlsForGame('atomfall_dx12.exe').length, 1);
  assert.equal(listControlsForGame('ATOMFALL_DX12.EXE').length, 1);
});

test('listControlsForGame returns an empty array for a game with no saved controls', () => {
  assert.deepEqual(listControlsForGame('SomeOtherGame.exe'), []);
});

test('getControl returns the control by id', () => {
  const control = getControl('atomfall-current-weapon-ammo');
  assert.ok(control);
  assert.equal(control?.executableName, 'Atomfall_dx12.exe');
  assert.equal(control?.pointerPath.moduleName, 'atomfall_dx12.exe');
});

test('getControl returns undefined for an unknown id', () => {
  assert.equal(getControl('does-not-exist'), undefined);
});

test('every catalog entry has non-empty evidence and a valid pointer path', () => {
  for (const control of listAllControls()) {
    assert.ok(control.evidence.length > 0);
    assert.ok(control.discoveredAt.length > 0);
    assert.ok(control.pointerPath.moduleName.length > 0);
    assert.ok(Array.isArray(control.pointerPath.offsets));
    assert.ok(control.pointerPath.offsets.length > 0);
  }
});
