import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { detectResearchBinaryProfile } from '../src/core/saves/binary-formats/research-profiles.ts';

describe('binary save research profiles', () => {
  test('detects Terraria .plr by extension', () => {
    const profile = detectResearchBinaryProfile('C:/Games/Terraria/Players/SteamUser.plr');
    assert.equal(profile?.id, 'terraria-plr-v1');
    assert.equal(profile?.canWrite, false);
  });

  test('detects Hollow Knight user.dat by filename', () => {
    const profile = detectResearchBinaryProfile(
      'C:/Users/me/AppData/LocalLow/Team Cherry/Hollow Knight/user1.dat',
    );
    assert.equal(profile?.id, 'hollow-knight-userdat-v1');
  });
});
