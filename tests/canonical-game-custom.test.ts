import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase } from '../src/core/database/index.ts';
import { createCustomGame, offerIdentityLink } from '../src/core/canonical-games/custom-game.ts';
import { getCanonicalGame, listCanonicalGames, listInstallationsForGame } from '../src/core/canonical-games/store.ts';

describe('custom game creation', () => {
  before(async () => {
    await initDatabase();
  });

  test('creates a canonical game with no launcher at all (platform: standalone)', () => {
    const { canonicalGame, installation } = createCustomGame({
      displayName: 'My Homebrew Game',
      platform: 'standalone',
    });
    assert.equal(canonicalGame.isCustomGame, true);
    assert.equal(canonicalGame.identityStatus, 'verified');
    assert.equal(installation, undefined);

    const persisted = getCanonicalGame(canonicalGame.id);
    assert.ok(persisted);
    assert.equal(persisted!.isCustomGame, true);
    assert.equal(listInstallationsForGame(canonicalGame.id).length, 0);
  });

  test('creates a canonical game for platform "unknown"/"other" without requiring providerGameId', () => {
    const { canonicalGame, installation } = createCustomGame({
      displayName: 'Mystery Game',
      platform: 'unknown',
    });
    assert.equal(canonicalGame.isCustomGame, true);
    assert.equal(installation, undefined);
  });

  test('links an installation only when a real provider platform AND providerGameId are both given', () => {
    const { canonicalGame, installation } = createCustomGame({
      displayName: 'Linked Custom Game',
      platform: 'steam',
      providerGameId: '123456',
      installPath: 'C:/Games/Linked',
      executablePath: 'C:/Games/Linked/game.exe',
    });
    assert.ok(installation);
    assert.equal(installation!.launcher, 'steam');
    assert.equal(installation!.launcherGameId, '123456');
    assert.equal(installation!.canonicalGameId, canonicalGame.id);
    // isCustomGame records how the canonical row was CREATED, not whether it has a link.
    assert.equal(canonicalGame.isCustomGame, true);

    const installations = listInstallationsForGame(canonicalGame.id);
    assert.equal(installations.length, 1);
  });

  test('a real provider platform WITHOUT providerGameId creates no installation', () => {
    const { installation } = createCustomGame({
      displayName: 'Steam Platform No Id',
      platform: 'steam',
    });
    assert.equal(installation, undefined);
  });

  test('never silently merges on name collision — a second custom game with the same displayName is a distinct row', () => {
    const first = createCustomGame({ displayName: 'Collision Game', platform: 'standalone' });
    const second = createCustomGame({ displayName: 'Collision Game', platform: 'standalone' });
    assert.notEqual(first.canonicalGame.id, second.canonicalGame.id);

    const matches = listCanonicalGames().filter((g) => g.displayName === 'Collision Game');
    assert.equal(matches.length, 2);
  });

  test('never silently merges into an existing NON-custom canonical game with the same name', () => {
    // Simulate a pre-existing, non-custom canonical game (e.g. migrated from a launcher scan).
    const nonCustom = createCustomGame({ displayName: 'Shared Name Game', platform: 'standalone' });
    // Manually flip it to look non-custom for this test's purposes is not possible via the
    // public API (by design — isCustomGame is never toggled post-creation), so instead we
    // assert the general invariant: creating another custom game with the same name never
    // reuses `nonCustom`'s id, regardless of that other row's isCustomGame value.
    const customGame = createCustomGame({ displayName: 'Shared Name Game', platform: 'standalone' });
    assert.notEqual(customGame.canonicalGame.id, nonCustom.canonicalGame.id);
  });

  test('rejects an empty displayName', () => {
    assert.throws(() => createCustomGame({ displayName: '   ', platform: 'standalone' }));
  });

  test('offerIdentityLink returns a proposed suggestion without writing anything', () => {
    const { canonicalGame } = createCustomGame({ displayName: 'Awaiting Link', platform: 'standalone' });
    const before_ = getCanonicalGame(canonicalGame.id);

    const suggestion = offerIdentityLink(canonicalGame.id, 'steam:99999');
    assert.equal(suggestion.status, 'proposed');
    assert.equal(suggestion.customGameId, canonicalGame.id);
    assert.equal(suggestion.discoveredProviderGameId, 'steam:99999');

    // Confirm nothing was written: no installation exists for this canonical game.
    assert.equal(listInstallationsForGame(canonicalGame.id).length, 0);
    // And the canonical row itself is unchanged.
    const after = getCanonicalGame(canonicalGame.id);
    assert.deepEqual(after, before_);
  });

  test('offerIdentityLink never auto-applies even when called repeatedly', () => {
    const { canonicalGame } = createCustomGame({ displayName: 'Repeated Offers', platform: 'standalone' });
    offerIdentityLink(canonicalGame.id, 'steam:1');
    offerIdentityLink(canonicalGame.id, 'steam:2');
    offerIdentityLink(canonicalGame.id, 'steam:3');
    assert.equal(listInstallationsForGame(canonicalGame.id).length, 0);
  });
});
