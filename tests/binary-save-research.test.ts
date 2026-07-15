import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { detectResearchBinaryProfile } from '../src/core/saves/binary-formats/research-profiles.ts';
import { readBinarySaveField } from '../src/core/saves/binary-save-field.ts';
import path from 'node:path';

const TERRARIA_FIXTURE = path.join('demo-game', 'saves', 'terraria', 'player-fixture-v279.plr');

describe('binary save research profiles', () => {
  test('detects Terraria .plr by extension', () => {
    const profile = detectResearchBinaryProfile('C:/Games/Terraria/Players/SteamUser.plr');
    assert.equal(profile?.id, 'terraria-plr-v1');
    assert.equal(profile?.canWrite, false);
  });

  test('reads version from sandbox Terraria fixture', () => {
    const result = readBinarySaveField(TERRARIA_FIXTURE, 'version');
    assert.equal(result.success, true);
    assert.equal(result.value, 279);
  });

  test('detects Hollow Knight user.dat by filename', () => {
    const profile = detectResearchBinaryProfile(
      'C:/Users/me/AppData/LocalLow/Team Cherry/Hollow Knight/user1.dat',
    );
    assert.equal(profile?.id, 'hollow-knight-userdat-v1');
  });
});
