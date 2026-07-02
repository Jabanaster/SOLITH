/**
 * tests/game-profile.test.ts â€” Milestone H
 *
 * Tests for the game profile system: validation, loading, and control conversion.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  validateGameProfile,
  loadGameProfile,
  loadStardewProfile,
  loadTrainerControls,
  type GameProfile,
} from '../src/core/game-profiles/index.js';
import { isControlExecutable, requiresApproval } from '../src/core/trainer-host/trainer-control-schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STARDEW_PROFILE_PATH = path.resolve(__dirname, '../src/core/game-profiles/profiles/stardew-valley.json');
const SHIPPED_PROFILES_DIR = path.resolve(__dirname, '../src/core/game-profiles/profiles');

function loadShippedProfileFiles(): Array<{ filePath: string; raw: string; profile: GameProfile }> {
  return fs.readdirSync(SHIPPED_PROFILES_DIR)
    .filter(file => file.endsWith('.json'))
    .map(file => {
      const filePath = path.join(SHIPPED_PROFILES_DIR, file);
      const raw = fs.readFileSync(filePath, 'utf-8');
      return { filePath, raw, profile: JSON.parse(raw) as GameProfile };
    });
}

function shippedControlText(control: GameProfile['controls'][0]): string {
  return JSON.stringify(control).toLowerCase();
}

// â”€â”€ Profile validation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('validateGameProfile â€” structure validation', () => {
  it('returns no errors for a valid minimal profile', () => {
    const validProfile: GameProfile = {
      profileVersion: '1.0.0',
      gameId: 'test-game',
      displayName: 'Test Game',
      saveFormat: 'json',
      controls: [],
    };
    const errors = validateGameProfile(validProfile);
    assert.deepStrictEqual(errors, []);
  });

  it('rejects missing profileVersion', () => {
    const invalid = {
      gameId: 'test',
      displayName: 'Test',
      saveFormat: 'json',
      controls: [],
    };
    const errors = validateGameProfile(invalid);
    assert.ok(errors.some(e => e.field === 'profileVersion'), 'Expected profileVersion error');
  });

  it('rejects missing gameId', () => {
    const invalid = {
      profileVersion: '1.0.0',
      displayName: 'Test',
      saveFormat: 'json',
      controls: [],
    };
    const errors = validateGameProfile(invalid);
    assert.ok(errors.some(e => e.field === 'gameId'), 'Expected gameId error');
  });

  it('rejects invalid saveFormat', () => {
    const invalid = {
      profileVersion: '1.0.0',
      gameId: 'test',
      displayName: 'Test',
      saveFormat: 'invalid-format',
      controls: [],
    };
    const errors = validateGameProfile(invalid);
    assert.ok(errors.some(e => e.field === 'saveFormat'), 'Expected saveFormat error');
  });

  it('rejects non-array controls', () => {
    const invalid = {
      profileVersion: '1.0.0',
      gameId: 'test',
      displayName: 'Test',
      saveFormat: 'json',
      controls: 'not-an-array',
    };
    const errors = validateGameProfile(invalid);
    assert.ok(errors.some(e => e.field === 'controls'), 'Expected controls error');
  });

  it('rejects duplicate control ids', () => {
    const invalid: GameProfile = {
      profileVersion: '1.0.0',
      gameId: 'test',
      displayName: 'Test',
      saveFormat: 'json',
      controls: [
        {
          id: 'money',
          label: 'Money 1',
          description: 'First',
          category: 'CURRENCY',
          controlType: 'number_input',
          backend: 'save_field',
          safetyStatus: 'future_feature',
        },
        {
          id: 'money', // duplicate
          label: 'Money 2',
          description: 'Second',
          category: 'CURRENCY',
          controlType: 'number_input',
          backend: 'save_field',
          safetyStatus: 'future_feature',
        },
      ],
    };
    const errors = validateGameProfile(invalid);
    assert.ok(errors.some(e => e.message.includes('Duplicate control id')), 'Expected duplicate id error');
  });

  it('requires saveField for executable save_field controls', () => {
    const invalid: GameProfile = {
      profileVersion: '1.0.0',
      gameId: 'test',
      displayName: 'Test',
      saveFormat: 'json',
      controls: [
        {
          id: 'money',
          label: 'Money',
          description: 'Test',
          category: 'CURRENCY',
          controlType: 'number_input',
          backend: 'save_field',
          safetyStatus: 'requires_approval',
          // missing saveField
        },
      ],
    };
    const errors = validateGameProfile(invalid);
    assert.ok(errors.some(e => e.field.includes('saveField')), 'Expected saveField error');
  });

  it('allows save_field controls without saveField if disabled', () => {
    const valid: GameProfile = {
      profileVersion: '1.0.0',
      gameId: 'test',
      displayName: 'Test',
      saveFormat: 'json',
      controls: [
        {
          id: 'disabled-control',
          label: 'Disabled',
          description: 'Test',
          category: 'TEST',
          controlType: 'number_input',
          backend: 'save_field',
          safetyStatus: 'disabled',
          // no saveField needed for disabled
        },
      ],
    };
    const errors = validateGameProfile(valid);
    assert.deepStrictEqual(errors, []);
  });

  it('rejects executable memory backends in V1 profiles', () => {
    const invalid: GameProfile = {
      profileVersion: '1.0.0',
      gameId: 'test',
      displayName: 'Test',
      saveFormat: 'json',
      controls: [
        {
          id: 'memory-money',
          label: 'Memory Money',
          description: 'Unsafe',
          category: 'TEST',
          controlType: 'number_input',
          backend: 'memory_write',
          safetyStatus: 'requires_approval',
        },
      ],
    };
    const errors = validateGameProfile(invalid);
    assert.ok(errors.some(e => e.message.includes('memory backends cannot be executable')));
  });

  it('rejects executable save_field profile paths with traversal or raw absolute paths', () => {
    const invalid: GameProfile = {
      profileVersion: '1.0.0',
      gameId: 'test',
      displayName: 'Test',
      saveFormat: 'json',
      controls: [
        {
          id: 'bad-path',
          label: 'Bad Path',
          description: 'Unsafe',
          category: 'TEST',
          controlType: 'number_input',
          backend: 'save_field',
          safetyStatus: 'requires_approval',
          saveField: {
            filePath: 'C:\\Users\\tester\\save.json',
            fieldPath: 'player.money',
            gameId: 'test',
          },
        },
        {
          id: 'traversal-path',
          label: 'Traversal Path',
          description: 'Unsafe',
          category: 'TEST',
          controlType: 'number_input',
          backend: 'save_field',
          safetyStatus: 'requires_approval',
          saveField: {
            filePath: '{SAVE_ROOT}\\..\\outside.json',
            fieldPath: 'player.money',
            gameId: 'test',
          },
        },
      ],
    };
    const errors = validateGameProfile(invalid);
    assert.ok(errors.some(e => e.message.includes('raw absolute path')));
    assert.ok(errors.some(e => e.message.includes('path traversal')));
  });
});

// â”€â”€ Stardew profile loading â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('loadStardewProfile â€” Stardew Valley profile', () => {
  it('loads without errors', () => {
    assert.doesNotThrow(() => {
      loadStardewProfile();
    });
  });

  it('has correct gameId', () => {
    const profile = loadStardewProfile();
    assert.strictEqual(profile.gameId, 'demo-game-quest-id-000000000000');
  });

  it('has displayName Stardew Valley', () => {
    const profile = loadStardewProfile();
    assert.strictEqual(profile.displayName, 'Stardew Valley');
  });

  it('has saveFormat xml', () => {
    const profile = loadStardewProfile();
    assert.strictEqual(profile.saveFormat, 'xml');
  });

  it('includes only the 4 accepted executable controls', () => {
    const profile = loadStardewProfile();
    const ids = profile.controls.map(c => c.id).sort();
    assert.deepStrictEqual(ids, [
      'stardew-farming-xp',
      'stardew-max-stamina',
      'stardew-money',
      'stardew-stamina',
    ]);
  });

  it('includes Money control with correct field path', () => {
    const profile = loadStardewProfile();
    const money = profile.controls.find(c => c.id === 'stardew-money');
    assert.ok(money, 'Money control must be present');
    assert.strictEqual(money.backend, 'save_field');
    assert.strictEqual(money.safetyStatus, 'requires_approval');
    assert.strictEqual(money.saveField?.fieldPath, 'SaveGame.player.0.money');
  });

  it('includes Stamina control with correct field path', () => {
    const profile = loadStardewProfile();
    const stamina = profile.controls.find(c => c.id === 'stardew-stamina');
    assert.ok(stamina, 'Stamina control must be present');
    assert.strictEqual(stamina.backend, 'save_field');
    assert.strictEqual(stamina.safetyStatus, 'requires_approval');
    assert.strictEqual(stamina.saveField?.fieldPath, 'SaveGame.player.0.stamina.0.float.0');
  });

  it('includes Farming XP control with correct field path', () => {
    const profile = loadStardewProfile();
    const farmingXp = profile.controls.find(c => c.id === 'stardew-farming-xp',
      'stardew-max-stamina');
    assert.ok(farmingXp, 'Farming XP control must be present');
    assert.strictEqual(farmingXp.backend, 'save_field');
    assert.strictEqual(farmingXp.safetyStatus, 'requires_approval');
    assert.strictEqual(farmingXp.saveField?.fieldPath, 'SaveGame.player.0.experiencePoints.0.int.0');
  });

  it('does not include Health as a shipped control', () => {
    const profile = loadStardewProfile();
    const health = profile.controls.find(c => c.id === 'stardew-health');
    assert.equal(health, undefined);
  });

  it('does not include God Mode as a shipped control', () => {
    const profile = loadStardewProfile();
    const godmode = profile.controls.find(c => c.id === 'stardew-godmode');
    assert.equal(godmode, undefined);
  });

  it('does not include Aim Assist as a shipped control', () => {
    const profile = loadStardewProfile();
    const aimassist = profile.controls.find(c => c.id === 'stardew-aimassist');
    assert.equal(aimassist, undefined);
  });
});

describe('shipped game profiles â€” hygiene gates', () => {
  it('reject shipped profile text containing C:\\Users paths', () => {
    for (const shipped of loadShippedProfileFiles()) {
      assert.equal(
        /c:(?:\\|\\\\)users(?:\\|\\\\)/i.test(shipped.raw),
        false,
        `${path.basename(shipped.filePath)} must not contain C:\\Users paths`,
      );
    }
  });

  it('reject shipped profile saveField paths with user-specific absolute paths', () => {
    const windowsUserAbsolutePath = /^[a-z]:\\users\\/i;
    for (const shipped of loadShippedProfileFiles()) {
      for (const control of shipped.profile.controls) {
        const filePath = control.saveField?.filePath ?? '';
        assert.equal(
          windowsUserAbsolutePath.test(filePath),
          false,
          `${control.id} must not ship a user-specific absolute saveField path`,
        );
      }
    }
  });

  it('reject shipped profile memory_write controls', () => {
    for (const shipped of loadShippedProfileFiles()) {
      const memoryControls = shipped.profile.controls.filter(control => control.backend === 'memory_write');
      assert.deepStrictEqual(
        memoryControls.map(control => control.id),
        [],
        `${path.basename(shipped.filePath)} must not contain memory_write controls`,
      );
    }
  });

  it('reject shipped profile online or multiplayer cheat-style controls', () => {
    const blockedTerms = ['god mode', 'godmode', 'aim assist', 'aimassist', 'online', 'multiplayer'];
    for (const shipped of loadShippedProfileFiles()) {
      for (const control of shipped.profile.controls) {
        const text = shippedControlText(control);
        const matched = blockedTerms.filter(term => text.includes(term));
        assert.deepStrictEqual(matched, [], `${control.id} contains unsupported control terms: ${matched.join(', ')}`);
      }
    }
  });

  it('loads and validates the cleaned Stardew profile', () => {
    assert.doesNotThrow(() => loadGameProfile(STARDEW_PROFILE_PATH));
    const profile = loadGameProfile(STARDEW_PROFILE_PATH);
    assert.deepStrictEqual(validateGameProfile(profile), []);
  });
});

// â”€â”€ Control conversion â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('loadTrainerControls â€” profile to TrainerControl conversion', () => {
  it('converts all Stardew controls to TrainerControl format', () => {
    const profile = loadStardewProfile();
    const controls = loadTrainerControls(profile);
    assert.strictEqual(controls.length, profile.controls.length);
  });

  it('preserves control id, label, description', () => {
    const profile = loadStardewProfile();
    const controls = loadTrainerControls(profile);
    const money = controls.find(c => c.id === 'stardew-money');
    assert.ok(money);
    assert.strictEqual(money.label, 'Money');
    assert.ok(money.description.length > 0);
  });

  it('converts constraints to min/max/step', () => {
    const profile = loadStardewProfile();
    const controls = loadTrainerControls(profile);
    const money = controls.find(c => c.id === 'stardew-money');
    assert.ok(money);
    assert.strictEqual(money.min, 0);
    assert.strictEqual(money.max, 2147483647);
  });

  it('converts saveField correctly', () => {
    const profile = loadStardewProfile();
    const controls = loadTrainerControls(profile);
    const money = controls.find(c => c.id === 'stardew-money');
    assert.ok(money);
    assert.ok(money.saveField);
    assert.strictEqual(money.saveField.fieldPath, 'SaveGame.player.0.money');
  });

  it('only 4 controls are executable (Money, Stamina, Farming XP, Max Stamina)', () => {
    const profile = loadStardewProfile();
    const controls = loadTrainerControls(profile);
    const executable = controls.filter(c => isControlExecutable(c));
    assert.strictEqual(executable.length, 4, `Expected 4 executable controls, got ${executable.length}`);
    const ids = executable.map(c => c.id).sort();
    assert.deepStrictEqual(ids, ['stardew-farming-xp',
      'stardew-max-stamina', 'stardew-money', 'stardew-stamina']);
  });

  it('all executable controls require approval', () => {
    const profile = loadStardewProfile();
    const controls = loadTrainerControls(profile);
    const executable = controls.filter(c => isControlExecutable(c));
    for (const c of executable) {
      assert.strictEqual(requiresApproval(c), true, `${c.id} must require approval`);
    }
  });

  it('shipped Stardew profile contains no memory_write controls', () => {
    const profile = loadStardewProfile();
    const controls = loadTrainerControls(profile);
    const memoryControls = controls.filter(c => c.backend === 'memory_write');
    assert.deepStrictEqual(memoryControls, []);
  });

  it('unsupported and non-save_field backends are never executable', () => {
    const profile = loadStardewProfile();
    const controls = loadTrainerControls(profile);
    for (const c of controls) {
      if (c.backend !== 'save_field') {
        assert.strictEqual(
          isControlExecutable(c), false,
          `${c.id} (${c.backend}) must not be executable`,
        );
      }
    }
    // A constructed 'unsupported' backend control must also be non-executable.
    assert.strictEqual(
      isControlExecutable({
        id: 'x', label: 'X', description: '', category: 'TEST',
        controlType: 'button', backend: 'unsupported', safetyStatus: 'supported',
      }),
      false,
    );
  });

  it('disabled save_field controls are not executable', () => {
    const profile = loadStardewProfile();
    const controls = loadTrainerControls(profile);
    const disabled = controls.filter(c => c.safetyStatus === 'disabled');
    for (const c of disabled) {
      assert.strictEqual(isControlExecutable(c), false, `${c.id} (disabled) must not be executable`);
    }
  });
});




