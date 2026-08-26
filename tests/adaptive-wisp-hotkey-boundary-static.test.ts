import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Increment 5, Section 58 — static boundary assertion for the hotkey
 * integration layer specifically (electron/trainer-hotkeys.ts and
 * electron/adaptive-wisp-hotkey-composition.ts). No direct trainer/memory
 * mutation import, no direct consent/freeze implementation import — every
 * execution must route through executeWispAction / the Increment 4
 * composition entrypoint.
 */
const FORBIDDEN_IMPORT_FRAGMENTS = ['memory-manager', 'live-memory-session', 'write-consent', 'freeze-concurrency-registry', 'child_process', 'shell'];

const ELECTRON_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'electron');
const HOTKEY_FILES = ['trainer-hotkeys.ts', 'adaptive-wisp-hotkey-composition.ts'];

describe('Adaptive Wisp hotkey layer stays behind the Increment 4 executor (no direct trainer/memory mutation import)', () => {
  for (const file of HOTKEY_FILES) {
    test(`${file} imports nothing from a forbidden direct-mutation module`, () => {
      const contents = readFileSync(path.join(ELECTRON_DIR, file), 'utf8');
      const importLines = contents.split('\n').filter((line) => /^\s*import\b/.test(line));
      for (const line of importLines) {
        for (const fragment of FORBIDDEN_IMPORT_FRAGMENTS) {
          assert.ok(!line.toLowerCase().includes(fragment), `${file} imports from forbidden module fragment "${fragment}": ${line.trim()}`);
        }
      }
    });
  }

  test('adaptive-wisp-hotkey-composition.ts only reaches production trainer mutation through getAdaptiveWispExecutionAdapter', () => {
    const contents = readFileSync(path.join(ELECTRON_DIR, 'adaptive-wisp-hotkey-composition.ts'), 'utf8');
    assert.ok(contents.includes('getAdaptiveWispExecutionAdapter'), 'expected the hotkey composition to obtain its trainer adapter through the single Increment 4 composition entrypoint');
    assert.ok(!contents.includes('new MemoryManager'), 'hotkey composition must not construct its own MemoryManager');
    assert.ok(!contents.includes('proposeWrite') && !contents.includes('confirmWrite') && !contents.includes('proposeFreeze') && !contents.includes('startFreezeConfirmed'), 'hotkey composition must not call trainer mutation methods directly — only executeWispAction may');
  });

  test('trainer-hotkeys.ts routes wisp_slot activation only through the quick-slot controller, never a direct executor call', () => {
    const contents = readFileSync(path.join(ELECTRON_DIR, 'trainer-hotkeys.ts'), 'utf8');
    assert.ok(contents.includes('getAdaptiveWispQuickSlotController'), 'expected trainer-hotkeys.ts to dispatch wisp_slot_N through the quick-slot controller');
    assert.ok(!/import\s*\{[^}]*executeWispAction/.test(contents), 'trainer-hotkeys.ts must not import executeWispAction directly — the quick-slot controller owns that call');
  });

  test('no ipcMain handler or globalShortcut import exists in the adaptive-wisp domain hotkey files', () => {
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'core', 'adaptive-wisp');
    for (const file of ['hotkey-errors.ts', 'hotkey-types.ts', 'quick-slot-resolution.ts', 'active-profile-provider.ts', 'quick-slot-controller.ts']) {
      const contents = readFileSync(path.join(dir, file), 'utf8');
      assert.ok(!contents.includes('ipcMain'), `${file} must not register an IPC handler`);
      assert.ok(!contents.includes('globalShortcut'), `${file} must not import Electron's globalShortcut directly — that stays in electron/`);
      assert.ok(!/from ['"]electron['"]/.test(contents), `${file} must not import from 'electron' directly — domain modules stay Electron-free`);
    }
  });
});
