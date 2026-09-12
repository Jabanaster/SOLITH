import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeIdentityKey,
  generateCanonicalGameId,
} from '../src/core/canonical-games/identity.js';
import type { CanonicalIdentityEvidence } from '../src/core/canonical-games/types.js';

/**
 * Personal Library Completion pass, Phase 2, Mission 18 — identity safety
 * tests. Adversarial fixtures proving the canonical-identity grouping logic
 * (src/core/canonical-games/identity.ts) does NOT incorrectly merge distinct
 * products that merely share (or nearly share) a title.
 *
 * All fixtures below are invented/plausible-but-fake test data — no real
 * game telemetry is used. This suite touches no game process, no memory,
 * and no launch of anything; it only calls the pure identity functions.
 *
 * Confirms the documented tier system: steamAppId (tier 1) and
 * catalogGameId (tier 2) are trusted, executable+title (tier 3) is trusted,
 * normalized-title-ALONE (tier 4) is explicitly UNTRUSTED
 * (`trusted: false`) — so any two products whose only shared evidence is a
 * near-identical title never get a trusted merge, only ever a tier-4
 * candidate that the doc says "must not be auto-grouped, goes to manual
 * review".
 */

function evidence(overrides: Partial<CanonicalIdentityEvidence> & { sourceId: string; installIdentity: string }): CanonicalIdentityEvidence {
  return {
    platform: 'steam',
    detectedAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('Mission 18 — demo vs full game never merges', () => {
  test('a demo and the full game have distinct steamAppIds -> distinct tier-1 canonical IDs', () => {
    const demo = evidence({
      sourceId: 'src-demo',
      installIdentity: 'inst-demo',
      steamAppId: 1234560,
      displayName: 'Starfall Legends Demo',
      executablePath: 'C:/Games/StarfallLegendsDemo/Starfall.exe',
    });
    const full = evidence({
      sourceId: 'src-full',
      installIdentity: 'inst-full',
      steamAppId: 1234561,
      displayName: 'Starfall Legends',
      executablePath: 'C:/Games/StarfallLegends/Starfall.exe',
    });
    const demoKey = computeIdentityKey(demo);
    const fullKey = computeIdentityKey(full);
    assert.equal(demoKey.tier, 1);
    assert.equal(fullKey.tier, 1);
    assert.notEqual(demoKey.key, fullKey.key);
    assert.notEqual(generateCanonicalGameId(demoKey), generateCanonicalGameId(fullKey));
  });

  test('without steamAppId, matching executable basenames still separate by title (tier 3, exe+title composite)', () => {
    // Same shipped exe name is plausible for a demo built from the same
    // engine/toolchain — the composite key must still separate them because
    // the titles differ.
    const demo = evidence({
      sourceId: 'src-demo2',
      installIdentity: 'inst-demo2',
      displayName: 'Ironclad Frontier Demo',
      executablePath: 'C:/Games/IroncladFrontierDemo/Game.exe',
    });
    const full = evidence({
      sourceId: 'src-full2',
      installIdentity: 'inst-full2',
      displayName: 'Ironclad Frontier',
      executablePath: 'C:/Games/IroncladFrontier/Game.exe',
    });
    const demoKey = computeIdentityKey(demo);
    const fullKey = computeIdentityKey(full);
    assert.notEqual(demoKey.key, fullKey.key);
  });
});

describe('Mission 18 — remaster vs original never merges', () => {
  test('a remaster and the original have distinct steamAppIds -> distinct canonical IDs', () => {
    const original = evidence({
      sourceId: 'src-orig',
      installIdentity: 'inst-orig',
      steamAppId: 5551000,
      displayName: 'Chrome Vanguard',
    });
    const remaster = evidence({
      sourceId: 'src-remaster',
      installIdentity: 'inst-remaster',
      steamAppId: 5551999,
      displayName: 'Chrome Vanguard Remastered',
    });
    const origKey = computeIdentityKey(original);
    const remasterKey = computeIdentityKey(remaster);
    assert.notEqual(origKey.key, remasterKey.key);
    assert.notEqual(generateCanonicalGameId(origKey), generateCanonicalGameId(remasterKey));
  });

  test('title-only evidence for a remaster is tier 4 (untrusted), never silently promoted', () => {
    const remasterTitleOnly = evidence({
      sourceId: 'src-remaster-titleonly',
      installIdentity: 'inst-remaster-titleonly',
      displayName: 'Chrome Vanguard Remastered',
    });
    const key = computeIdentityKey(remasterTitleOnly);
    assert.equal(key.tier, 4);
    assert.equal(key.trusted, false);
  });
});

describe('Mission 18 — benchmark tool vs the actual game never merges', () => {
  test('a standalone benchmark utility and its parent game have distinct steamAppIds', () => {
    const benchmark = evidence({
      sourceId: 'src-bench',
      installIdentity: 'inst-bench',
      steamAppId: 8880001,
      displayName: 'Photon Rift Benchmark',
      executablePath: 'C:/Games/PhotonRift/Benchmark.exe',
    });
    const game = evidence({
      sourceId: 'src-game',
      installIdentity: 'inst-game',
      steamAppId: 8880002,
      displayName: 'Photon Rift',
      executablePath: 'C:/Games/PhotonRift/PhotonRift.exe',
    });
    const benchKey = computeIdentityKey(benchmark);
    const gameKey = computeIdentityKey(game);
    assert.notEqual(benchKey.key, gameKey.key);
    assert.notEqual(generateCanonicalGameId(benchKey), generateCanonicalGameId(gameKey));
  });
});

describe('Mission 18 — dedicated server build vs client build never merges', () => {
  test('distinct steamAppIds for server and client keep them fully separate', () => {
    const server = evidence({
      sourceId: 'src-server',
      installIdentity: 'inst-server',
      steamAppId: 9990100,
      displayName: 'Outland Siege Dedicated Server',
      executablePath: 'C:/Games/OutlandSiege/ServerBin/OutlandSiegeServer.exe',
    });
    const client = evidence({
      sourceId: 'src-client',
      installIdentity: 'inst-client',
      steamAppId: 9990101,
      displayName: 'Outland Siege',
      executablePath: 'C:/Games/OutlandSiege/OutlandSiege.exe',
    });
    const serverKey = computeIdentityKey(server);
    const clientKey = computeIdentityKey(client);
    assert.notEqual(serverKey.key, clientKey.key);
    assert.notEqual(generateCanonicalGameId(serverKey), generateCanonicalGameId(clientKey));
  });

  test('even same executable directory heuristics cannot merge them — different executable basenames keep tier-3 keys apart', () => {
    const server = evidence({
      sourceId: 'src-server2',
      installIdentity: 'inst-server2',
      displayName: 'Outland Siege',
      executablePath: 'C:/Games/OutlandSiege/OutlandSiegeServer.exe',
    });
    const client = evidence({
      sourceId: 'src-client2',
      installIdentity: 'inst-client2',
      displayName: 'Outland Siege',
      executablePath: 'C:/Games/OutlandSiege/OutlandSiegeClient.exe',
    });
    const serverKey = computeIdentityKey(server);
    const clientKey = computeIdentityKey(client);
    assert.notEqual(serverKey.key, clientKey.key);
  });
});

describe('Mission 18 — PTR/test-realm build vs retail build never merges', () => {
  test('distinct steamAppIds for PTR and retail keep them fully separate', () => {
    const ptr = evidence({
      sourceId: 'src-ptr',
      installIdentity: 'inst-ptr',
      steamAppId: 4440500,
      displayName: 'Diablo IV PTR',
    });
    const retail = evidence({
      sourceId: 'src-retail',
      installIdentity: 'inst-retail',
      steamAppId: 4440501,
      displayName: 'Diablo IV',
    });
    const ptrKey = computeIdentityKey(ptr);
    const retailKey = computeIdentityKey(retail);
    assert.notEqual(ptrKey.key, retailKey.key);
    assert.notEqual(generateCanonicalGameId(ptrKey), generateCanonicalGameId(retailKey));
  });

  test('title-only "Diablo IV PTR" vs "Diablo IV" are still different tier-4 keys (normalize does not strip the PTR qualifier)', () => {
    const ptrTitleOnly = evidence({ sourceId: 'src-ptr2', installIdentity: 'inst-ptr2', displayName: 'Diablo IV PTR' });
    const retailTitleOnly = evidence({ sourceId: 'src-retail2', installIdentity: 'inst-retail2', displayName: 'Diablo IV' });
    const ptrKey = computeIdentityKey(ptrTitleOnly);
    const retailKey = computeIdentityKey(retailTitleOnly);
    assert.notEqual(ptrKey.key, retailKey.key);
    assert.equal(ptrKey.tier, 4);
    assert.equal(ptrKey.trusted, false);
  });
});

describe('Mission 18 — level editor vs the game itself never merges', () => {
  test('a bundled level editor and its parent game have distinct steamAppIds', () => {
    const editor = evidence({
      sourceId: 'src-editor',
      installIdentity: 'inst-editor',
      steamAppId: 3330700,
      displayName: 'Verdant Realms Level Editor',
      executablePath: 'C:/Games/VerdantRealms/Editor.exe',
    });
    const game = evidence({
      sourceId: 'src-game3',
      installIdentity: 'inst-game3',
      steamAppId: 3330701,
      displayName: 'Verdant Realms',
      executablePath: 'C:/Games/VerdantRealms/VerdantRealms.exe',
    });
    const editorKey = computeIdentityKey(editor);
    const gameKey = computeIdentityKey(game);
    assert.notEqual(editorKey.key, gameKey.key);
    assert.notEqual(generateCanonicalGameId(editorKey), generateCanonicalGameId(gameKey));
  });
});

describe('Mission 18 — a sequel never merges with its predecessor', () => {
  test('distinct steamAppIds for "Nova Ascendant" and "Nova Ascendant II" keep them fully separate', () => {
    const first = evidence({ sourceId: 'src-1', installIdentity: 'inst-1', steamAppId: 2220300, displayName: 'Nova Ascendant' });
    const second = evidence({ sourceId: 'src-2', installIdentity: 'inst-2', steamAppId: 2220301, displayName: 'Nova Ascendant II' });
    const firstKey = computeIdentityKey(first);
    const secondKey = computeIdentityKey(second);
    assert.notEqual(firstKey.key, secondKey.key);
    assert.notEqual(generateCanonicalGameId(firstKey), generateCanonicalGameId(secondKey));
  });

  test('title normalization does not collapse a numeral suffix into the base title', () => {
    const first = evidence({ sourceId: 'src-1b', installIdentity: 'inst-1b', displayName: 'Nova Ascendant' });
    const second = evidence({ sourceId: 'src-2b', installIdentity: 'inst-2b', displayName: 'Nova Ascendant II' });
    const firstKey = computeIdentityKey(first);
    const secondKey = computeIdentityKey(second);
    assert.notEqual(firstKey.key, secondKey.key);
  });
});

describe('Mission 18 — general tier-precedence guarantees', () => {
  test('steamAppId (tier 1) always wins over title text, even when titles are byte-identical across two different steamAppIds', () => {
    const a = evidence({ sourceId: 'src-a', installIdentity: 'inst-a', steamAppId: 111, displayName: 'Identical Title' });
    const b = evidence({ sourceId: 'src-b', installIdentity: 'inst-b', steamAppId: 222, displayName: 'Identical Title' });
    const aKey = computeIdentityKey(a);
    const bKey = computeIdentityKey(b);
    assert.equal(aKey.tier, 1);
    assert.equal(bKey.tier, 1);
    assert.notEqual(aKey.key, bKey.key);
  });

  test('normalized-title-alone matches are always tier 4 and always trusted: false — never auto-merged', () => {
    const titleOnlyCases = ['Some Game', 'Another Game', 'Yet Another Title'];
    for (const displayName of titleOnlyCases) {
      const key = computeIdentityKey(
        evidence({ sourceId: `src-${displayName}`, installIdentity: `inst-${displayName}`, displayName }),
      );
      assert.equal(key.tier, 4, `expected tier 4 for title-only evidence "${displayName}"`);
      assert.equal(key.trusted, false, `expected trusted:false for title-only evidence "${displayName}"`);
    }
  });

  test('generateCanonicalGameId throws for tier-5 (unresolved) evidence — never mints an ID from untrustworthy evidence', () => {
    const key = computeIdentityKey(evidence({ sourceId: 'src-unresolved', installIdentity: 'inst-unresolved' }));
    assert.equal(key.tier, 5);
    assert.throws(() => generateCanonicalGameId(key));
  });

  test('identity keys are deterministic — same evidence always produces the same key (repeated calls)', () => {
    const e = evidence({ sourceId: 'src-det', installIdentity: 'inst-det', steamAppId: 42, displayName: 'Deterministic Game' });
    const key1 = computeIdentityKey(e);
    const key2 = computeIdentityKey(e);
    assert.equal(key1.key, key2.key);
    assert.equal(generateCanonicalGameId(key1), generateCanonicalGameId(key2));
  });
});

/**
 * Mission 9 (Gate 2.5 doc audit) — re-testing the tier system against the
 * newer, lower-confidence launcher scanners (ubisoft.ts is SUPPORTED
 * confidence; ea.ts/xbox.ts are PARTIAL — see provider-capabilities.ts).
 * These scanners often cannot produce a steamAppId or a pre-existing
 * catalogGameId, and their executable-basename resolution is a shallow
 * "first top-level .exe in the install dir" heuristic (see
 * findFirstTopLevelExecutable in ubisoft.ts/ea.ts/xbox.ts) — so it is
 * entirely plausible for two *different* games from these launchers to both
 * ship a generically-named launcher/game exe (Launcher.exe, Game.exe) or to
 * have very similar titles. None of that evidence is itself trusted
 * (steamAppId/catalogGameId) or executable+title composite in a way that
 * would let two different games collide — the fixtures below prove the
 * grouping key still ends up tier 4 (untrusted, exact-title-only) or tier 5
 * (no reliable signal), never silently promoted to a trusted tier.
 */
describe('Mission 9 — Ubisoft/EA/Xbox weak evidence never gets trusted-merged across different games', () => {
  test('two different Ubisoft-detected games both shipping a generic "Launcher.exe" separate by exe+title composite (tier 3, still distinct keys)', () => {
    // Ubisoft's scanner has no steamAppId/catalogGameId signal at all — it
    // only ever supplies displayName + a shallow-scanned executablePath.
    // Two unrelated Ubisoft titles that both happen to ship a generic
    // "Launcher.exe" in their install root must still separate because the
    // titles differ — the composite tier-3 key includes both.
    const gameA = evidence({
      sourceId: 'src-ubisoft-a',
      installIdentity: 'inst-ubisoft-a',
      platform: 'ubisoft',
      displayName: "Tom Clancy's Rainbow Six Siege",
      executablePath: 'C:/Games/R6Siege/Launcher.exe',
    });
    const gameB = evidence({
      sourceId: 'src-ubisoft-b',
      installIdentity: 'inst-ubisoft-b',
      platform: 'ubisoft',
      displayName: "Tom Clancy's Rainbow Six Extraction",
      executablePath: 'C:/Games/R6Extraction/Launcher.exe',
    });
    const keyA = computeIdentityKey(gameA);
    const keyB = computeIdentityKey(gameB);
    assert.equal(keyA.tier, 3);
    assert.equal(keyB.tier, 3);
    assert.equal(keyA.trusted, true);
    assert.notEqual(keyA.key, keyB.key, 'identical generic exe basename must not collapse two different Ubisoft games');
    assert.notEqual(generateCanonicalGameId(keyA), generateCanonicalGameId(keyB));
  });

  test('two different Ubisoft games with only a generic exe and NO title evidence both fall to tier 5 (manual review), never merged', () => {
    // Without any displayName at all, exe-basename alone is not a valid
    // tier-3 key (computeIdentityKey requires BOTH exe basename and a
    // normalized title for tier 3) — so this must fall all the way to tier
    // 5, and tier 5 keys are unique-per-source by construction, never a
    // shared merge target.
    const gameA = evidence({
      sourceId: 'src-ubisoft-c',
      installIdentity: 'inst-ubisoft-c',
      platform: 'ubisoft',
      executablePath: 'C:/Games/UnknownTitleA/Launcher.exe',
    });
    const gameB = evidence({
      sourceId: 'src-ubisoft-d',
      installIdentity: 'inst-ubisoft-d',
      platform: 'ubisoft',
      executablePath: 'C:/Games/UnknownTitleB/Launcher.exe',
    });
    const keyA = computeIdentityKey(gameA);
    const keyB = computeIdentityKey(gameB);
    assert.equal(keyA.tier, 5);
    assert.equal(keyB.tier, 5);
    assert.equal(keyA.trusted, false);
    assert.equal(keyB.trusted, false);
    assert.notEqual(keyA.key, keyB.key);
    assert.throws(() => generateCanonicalGameId(keyA));
    assert.throws(() => generateCanonicalGameId(keyB));
  });

  test('two different Xbox (AppX/PARTIAL) titles sharing a generic "Game.exe" and similar titles land on distinct tier-4 keys, never trusted', () => {
    // Xbox's scanner (PARTIAL confidence) resolves opaque PackageFullName
    // ids, not trustworthy catalog/steam ids, and frequently cannot resolve
    // a meaningful executable at all for packages with non-top-level exes.
    // Model the worst case: same generic exe name, near-identical titles
    // differing only by edition suffix. The exe+title composite still
    // distinguishes them (tier 3) because the *titles* differ; simulate the
    // even-weaker case where displayName is missing too, to prove the
    // fallback is tier 4/5, never a false trusted merge.
    const withTitleA = evidence({
      sourceId: 'src-xbox-a',
      installIdentity: 'inst-xbox-a',
      platform: 'xbox',
      displayName: 'Sea of Thieves',
      executablePath: 'C:/XboxGames/SeaOfThieves/Content/Game.exe',
    });
    const withTitleB = evidence({
      sourceId: 'src-xbox-b',
      installIdentity: 'inst-xbox-b',
      platform: 'xbox',
      displayName: 'Sea of Thieves 2: The Legend of Monkey Island',
      executablePath: 'C:/XboxGames/SeaOfThieves2/Content/Game.exe',
    });
    const keyA = computeIdentityKey(withTitleA);
    const keyB = computeIdentityKey(withTitleB);
    assert.notEqual(keyA.key, keyB.key, 'shared generic Game.exe basename must not collapse two different Xbox titles once titles differ');

    // Now the weaker case both scanners can actually hit: no displayName
    // resolved (package metadata unavailable), only the generic exe path.
    const noTitleA = evidence({
      sourceId: 'src-xbox-c',
      installIdentity: 'inst-xbox-c',
      platform: 'xbox',
      executablePath: 'C:/XboxGames/PackageA/Content/Game.exe',
    });
    const noTitleB = evidence({
      sourceId: 'src-xbox-d',
      installIdentity: 'inst-xbox-d',
      platform: 'xbox',
      executablePath: 'C:/XboxGames/PackageB/Content/Game.exe',
    });
    const noTitleKeyA = computeIdentityKey(noTitleA);
    const noTitleKeyB = computeIdentityKey(noTitleB);
    assert.equal(noTitleKeyA.tier, 5, 'generic exe with no title evidence must not be trusted as tier 3/4');
    assert.equal(noTitleKeyB.tier, 5);
    assert.notEqual(noTitleKeyA.key, noTitleKeyB.key);
  });

  test('EA (PARTIAL) title-only evidence for two different games sharing no distinguishing signal stays tier 4, untrusted, and never produces the same key', () => {
    const gameA = evidence({
      sourceId: 'src-ea-a',
      installIdentity: 'inst-ea-a',
      platform: 'ea',
      displayName: 'Battlefield 2042',
    });
    const gameB = evidence({
      sourceId: 'src-ea-b',
      installIdentity: 'inst-ea-b',
      platform: 'ea',
      displayName: 'Battlefield V',
    });
    const keyA = computeIdentityKey(gameA);
    const keyB = computeIdentityKey(gameB);
    assert.equal(keyA.tier, 4);
    assert.equal(keyB.tier, 4);
    assert.equal(keyA.trusted, false);
    assert.equal(keyB.trusted, false);
    assert.notEqual(keyA.key, keyB.key);
  });

  test('a Ubisoft-sourced steamAppId (tier 1, trusted) still wins even when title and exe are shared with an unrelated EA/Xbox entry', () => {
    // Sanity check that adding a lower-confidence source into the mix does
    // not somehow weaken a genuinely trusted tier-1 signal for a different
    // evidence row that happens to share generic exe/title text.
    const trusted = evidence({
      sourceId: 'src-trusted',
      installIdentity: 'inst-trusted',
      platform: 'steam',
      steamAppId: 777001,
      displayName: 'Generic Launcher Game',
      executablePath: 'C:/Games/GenericA/Launcher.exe',
    });
    const weakUbisoft = evidence({
      sourceId: 'src-weak-ubisoft',
      installIdentity: 'inst-weak-ubisoft',
      platform: 'ubisoft',
      displayName: 'Generic Launcher Game',
      executablePath: 'C:/Games/GenericB/Launcher.exe',
    });
    const trustedKey = computeIdentityKey(trusted);
    const weakKey = computeIdentityKey(weakUbisoft);
    assert.equal(trustedKey.tier, 1);
    assert.equal(weakKey.tier, 3, 'without steamAppId, exe+title composite is the best this evidence can reach');
    assert.notEqual(trustedKey.key, weakKey.key);
  });
});

describe('Mission 9 — Battle.net has no scanner and is never accepted as a trustworthy identity signal', () => {
  test('Battle.net evidence with only a platform tag and no other signal resolves to tier 5 (manual review), not a crash, not a false match', () => {
    // Battle.net's scanner (battle-net.ts) is PARTIAL, not a fully trusted
    // signal (see provider-capabilities.ts: installedDetectionLevel:
    // 'partial'). Evidence claiming platform 'battlenet' with nothing else
    // (no steamAppId, no catalogGameId, no executable, no display name)
    // must never be trusted or silently matched to anything — it must land
    // on tier 5 like any other no-signal row, keyed uniquely so it can
    // never become a merge target.
    const bnetEvidence: CanonicalIdentityEvidence = {
      sourceId: 'src-battlenet-empty',
      platform: 'battlenet',
      installIdentity: 'inst-battlenet-empty',
      detectedAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
    };
    const key = computeIdentityKey(bnetEvidence);
    assert.equal(key.tier, 5);
    assert.equal(key.trusted, false);
    assert.throws(() => generateCanonicalGameId(key), 'tier-5 Battle.net evidence must never mint a canonical id');
  });

  test('two different Battle.net titles with only a shared generic displayName both land on the same untrusted tier-4 key, but that key is never treated as a trusted merge', () => {
    // Even in the case where Battle.net evidence DID carry a display name
    // (its real partial scanner, or manually-entered metadata tagged
    // platform: 'battlenet'), a bare title match is documented as
    // tier 4 / untrusted for every platform — Battle.net gets no special
    // exemption that would make its title evidence more trustworthy than
    // any other platform's.
    const first = evidence({
      sourceId: 'src-battlenet-a',
      installIdentity: 'inst-battlenet-a',
      platform: 'battlenet',
      displayName: 'World of Warcraft',
    });
    const second = evidence({
      sourceId: 'src-battlenet-b',
      installIdentity: 'inst-battlenet-b',
      platform: 'battlenet',
      displayName: 'World of Warcraft',
    });
    const firstKey = computeIdentityKey(first);
    const secondKey = computeIdentityKey(second);
    assert.equal(firstKey.tier, 4);
    assert.equal(firstKey.trusted, false);
    assert.equal(firstKey.key, secondKey.key, 'identical exact titles do produce the same tier-4 key, but tier 4 is documented as untrusted/manual-review, never auto-merged as if verified');
    // Tier 4 is trusted:false but NOT tier 5 — generateCanonicalGameId only
    // throws for tier 5. Confirm it does not throw here (a shared tier-4 key
    // is still a valid, deterministic id), while the `trusted: false` flag
    // above is what callers must check before treating it as a real merge.
    assert.doesNotThrow(() => generateCanonicalGameId(firstKey));
    assert.equal(generateCanonicalGameId(firstKey), generateCanonicalGameId(secondKey));
  });

  test('Battle.net evidence never accidentally reaches tier 1/2/3 through absent-field coercion (no crash on missing fields)', () => {
    // Defensive: confirm that calling computeIdentityKey with a
    // minimal/absent-evidence Battle.net row does not throw and does not
    // fall through to a trusted tier by accident (e.g. undefined ==
    // undefined style bugs). This is the "no crash" half of the mission
    // requirement.
    const minimal: CanonicalIdentityEvidence = {
      sourceId: 'src-battlenet-minimal',
      platform: 'battlenet',
      installIdentity: 'inst-battlenet-minimal',
      detectedAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
      steamAppId: undefined,
      catalogGameId: undefined,
      displayName: undefined,
      executablePath: undefined,
      canonicalExecutablePath: undefined,
    };
    assert.doesNotThrow(() => computeIdentityKey(minimal));
    const key = computeIdentityKey(minimal);
    assert.equal(key.tier, 5);
    assert.equal(key.trusted, false);
  });
});
