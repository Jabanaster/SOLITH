import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase } from '../src/core/database/index.ts';
import { createInstallIdentity, INSTALL_IDENTITY_VERSION } from '../src/core/install-discovery/identity.ts';
import { upsertInstalledGames } from '../src/core/install-discovery/store.ts';
import { upsertCatalogEntry } from '../src/core/trainer-catalog/store.ts';
import type { InstalledGameRecord } from '../src/core/install-discovery/types.ts';
import type { TrainerCatalogEntry } from '../src/core/trainer-catalog/types.ts';
import { planCanonicalMigration } from '../src/core/canonical-games/migration.ts';
import {
  classifyTrainerCatalogEligibility,
  filterEligibleForTrainerLibrary,
  isEntryEligibleForTrainerLibrary,
  type TrainerCatalogEligibilityEvidence,
} from '../src/core/trainer-catalog/eligibility-classification.ts';

let uid = 0;
function nextId(prefix: string): string {
  uid += 1;
  return `${prefix}-${Date.now()}-${uid}`;
}

function makeInstalledGame(overrides: Partial<InstalledGameRecord> & { id: string; platform: InstalledGameRecord['platform']; installPath: string }): InstalledGameRecord {
  const identity = createInstallIdentity({
    platform: overrides.platform,
    installPath: overrides.installPath,
    executablePath: overrides.executablePath,
    displayName: overrides.displayName,
    steamAppId: overrides.steamAppId,
    launcherAppId: overrides.launcherAppId,
  });
  return {
    id: overrides.id,
    platform: overrides.platform,
    installPath: overrides.installPath,
    executablePath: overrides.executablePath,
    displayName: overrides.displayName,
    steamAppId: overrides.steamAppId,
    launcherAppId: overrides.launcherAppId,
    installIdentity: identity.installIdentity,
    canonicalInstallPath: identity.canonicalInstallPath,
    canonicalExecutablePath: identity.canonicalExecutablePath,
    identityVersion: INSTALL_IDENTITY_VERSION,
    identityStatus: identity.identityStatus,
    needsReverification: identity.needsReverification,
    catalogGameId: overrides.catalogGameId,
    catalogDisplayName: overrides.catalogDisplayName,
    detectedAt: overrides.detectedAt ?? new Date(0).toISOString(),
    lastSeenAt: overrides.lastSeenAt ?? new Date(0).toISOString(),
  };
}

function makeCatalogEntry(overrides: Partial<TrainerCatalogEntry> & { catalogGameId: string; displayName: string }): TrainerCatalogEntry {
  return {
    catalogGameId: overrides.catalogGameId,
    displayName: overrides.displayName,
    executables: overrides.executables ?? [],
    categories: overrides.categories ?? [],
    verificationStatus: overrides.verificationStatus ?? 'unverified',
    sources: overrides.sources ?? [],
    hasModPack: overrides.hasModPack ?? false,
    cheatCount: overrides.cheatCount ?? 0,
    searchableText: overrides.displayName.toLowerCase(),
    steamAppId: overrides.steamAppId,
    antiCheat: overrides.antiCheat,
    offlinePlayAvailable: overrides.offlinePlayAvailable,
    catalogExclusionFlags: overrides.catalogExclusionFlags,
    explicitlyUnsupported: overrides.explicitlyUnsupported,
  };
}

before(async () => {
  await initDatabase();
});

describe('classifyTrainerCatalogEligibility — basic states (Phase 3A)', () => {
  test('explicit unsupported evidence classifies as unsupported, not excluded', () => {
    const result = classifyTrainerCatalogEligibility({ explicitlyUnsupported: true });
    assert.equal(result.state, 'unsupported');
    assert.equal(result.excluded, false);
    assert.deepEqual(result.reasonCodes, ['explicitly-unsupported']);
  });

  test('verified verificationStatus with no exclusion evidence classifies as verified', () => {
    const result = classifyTrainerCatalogEligibility({ verificationStatus: 'verified' });
    assert.equal(result.state, 'verified');
    assert.equal(result.excluded, false);
  });

  test('missing evidence entirely classifies as eligible, never silently supported/verified', () => {
    const result = classifyTrainerCatalogEligibility({});
    assert.equal(result.state, 'eligible');
    assert.equal(result.excluded, false);
    assert.deepEqual(result.reasonCodes, []);
  });

  test('metadata-only/unverified verificationStatus classifies as listed', () => {
    assert.equal(classifyTrainerCatalogEligibility({ verificationStatus: 'metadata-only' }).state, 'listed');
    assert.equal(classifyTrainerCatalogEligibility({ verificationStatus: 'unverified' }).state, 'listed');
  });
});

describe('classifyTrainerCatalogEligibility — strict whole-game anti-cheat rule (Phase 3A §3.2)', () => {
  test('offline-only game with no anti-cheat evidence is not excluded by this rule', () => {
    const result = classifyTrainerCatalogEligibility({ antiCheat: 'none', offlinePlayAvailable: true, verificationStatus: 'verified' });
    assert.equal(result.excluded, false);
    assert.equal(result.state, 'verified');
  });

  test('offline campaign + anti-cheat-protected multiplayer excludes the ENTIRE game', () => {
    const result = classifyTrainerCatalogEligibility({
      antiCheat: 'protected-multiplayer',
      offlinePlayAvailable: true,
      verificationStatus: 'verified',
    });
    assert.equal(result.state, 'excluded');
    assert.equal(result.excluded, true);
    assert.ok(result.reasonCodes.includes('anti-cheat-protected-multiplayer'));
  });

  test('anti-cheat-protected online-only game is excluded', () => {
    const result = classifyTrainerCatalogEligibility({ antiCheat: 'protected-online-only' });
    assert.equal(result.state, 'excluded');
    assert.ok(result.reasonCodes.includes('protected-online-only'));
  });

  test('unknown anti-cheat status is not silently classified as supported/verified-safe', () => {
    const result = classifyTrainerCatalogEligibility({ antiCheat: 'unknown', verificationStatus: 'verified' });
    // Not excluded (no positive danger evidence) — but this is a distinct axis
    // from the pre-existing CanonicalGameSupportState 'supported' field, which
    // Phase 3A does not touch and which stays 'unknown' absent a modpack.
    assert.equal(result.excluded, false);
    assert.equal(result.reasonCodes.length, 0);
  });

  test('anti-cheat field entirely absent behaves identically to explicit unknown', () => {
    const withField = classifyTrainerCatalogEligibility({ antiCheat: 'unknown', verificationStatus: 'community' });
    const withoutField = classifyTrainerCatalogEligibility({ verificationStatus: 'community' });
    assert.equal(withField.state, withoutField.state);
    assert.equal(withField.excluded, withoutField.excluded);
    assert.deepEqual(withField.reasonCodes, withoutField.reasonCodes);
  });
});

describe('classifyTrainerCatalogEligibility — §3.2 catalog exclusion flags', () => {
  const flags: Array<[TrainerCatalogEligibilityEvidence['catalogExclusionFlags'], string]> = [
    [['mmo'], 'mmo'],
    [['competitive-online-only'], 'competitive-online-only'],
    [['cloud-only'], 'cloud-only'],
    [['dedicated-server'], 'dedicated-server'],
    [['demo'], 'demo'],
    [['soundtrack'], 'soundtrack'],
    [['editor-tool'], 'editor-tool'],
    [['dlc-only'], 'dlc-only'],
    [['unsupported-delisted'], 'unsupported-delisted'],
    [['no-meaningful-offline-play'], 'no-meaningful-offline-play'],
  ];
  for (const [catalogExclusionFlags, expectedReason] of flags) {
    test(`${expectedReason} flag excludes the title`, () => {
      const result = classifyTrainerCatalogEligibility({ catalogExclusionFlags, verificationStatus: 'verified' });
      assert.equal(result.state, 'excluded');
      assert.ok(result.reasonCodes.includes(expectedReason as never));
    });
  }
});

describe('classifyTrainerCatalogEligibility — provenance separation (Phase 3A Step 4)', () => {
  test('verified provenance does not imply automatic safety clearance', () => {
    const result = classifyTrainerCatalogEligibility({ verificationStatus: 'verified', antiCheat: 'protected-online-only' });
    assert.equal(result.state, 'excluded');
  });

  test('community provenance does not imply automatic unsupported/excluded', () => {
    const result = classifyTrainerCatalogEligibility({ verificationStatus: 'community' });
    assert.equal(result.state, 'community');
    assert.equal(result.excluded, false);
  });
});

describe('classifyTrainerCatalogEligibility — conflict/ambiguity (Step 11)', () => {
  test('identity-ambiguous evidence routes to excluded, not a permissive guess', () => {
    const result = classifyTrainerCatalogEligibility({ identityAmbiguous: true, verificationStatus: 'verified' });
    assert.equal(result.state, 'excluded');
    assert.ok(result.reasonCodes.includes('identity-ambiguous'));
  });
});

describe('filterEligibleForTrainerLibrary — exclusion participation (Step 9/18)', () => {
  test('excluded game is omitted from the eligible Trainer Library dataset', () => {
    const entries = [
      makeCatalogEntry({ catalogGameId: 'g1', displayName: 'Safe Offline Game', verificationStatus: 'verified' }),
      makeCatalogEntry({ catalogGameId: 'g2', displayName: 'Protected Online Game', antiCheat: 'protected-online-only' }),
    ];
    const eligible = filterEligibleForTrainerLibrary(entries);
    assert.equal(eligible.length, 1);
    assert.equal(eligible[0].catalogGameId, 'g1');
  });

  test('an excluded game cannot re-enter via an alias/search-helper wrapping the same filter', () => {
    const excluded = makeCatalogEntry({ catalogGameId: 'g3', displayName: 'MMO Title', catalogExclusionFlags: ['mmo'] });
    const aliasSearchResults = filterEligibleForTrainerLibrary(filterEligibleForTrainerLibrary([excluded]));
    assert.equal(aliasSearchResults.length, 0);
    assert.equal(isEntryEligibleForTrainerLibrary({ catalogExclusionFlags: ['mmo'] }), false);
  });
});

describe('canonical multi-launcher classification (Step 12/18)', () => {
  test('Steam + GOG installations of the same canonical game receive the same eligibility classification', () => {
    const catalogGameId = nextId('catalog');
    upsertCatalogEntry(makeCatalogEntry({ catalogGameId, displayName: 'Cross-Launcher Game', verificationStatus: 'verified' }));

    const steamId = nextId('steam');
    const gogId = nextId('gog');
    upsertInstalledGames([
      makeInstalledGame({ id: steamId, platform: 'steam', installPath: 'C:/Games/CrossLauncher', displayName: 'Cross-Launcher Game', catalogGameId }),
      makeInstalledGame({ id: gogId, platform: 'gog', installPath: 'C:/GOG/CrossLauncher', displayName: 'Cross-Launcher Game', catalogGameId }),
    ]);

    const plan = planCanonicalMigration(new Date(0).toISOString());
    const group = plan.canonicalGames.find((g) => g.catalogGameId === catalogGameId);
    assert.ok(group, 'expected one canonical game for the cross-launcher pair');
    assert.equal(group!.eligibility, 'verified');

    const installations = plan.installations.filter((i) => i.canonicalGameId === group!.id);
    assert.equal(installations.length, 2, 'no duplicate eligibility records — one canonical game, two installations');
  });

  test('an excluded canonical game stays excluded regardless of which launcher installation is inspected', () => {
    const catalogGameId = nextId('catalog');
    upsertCatalogEntry(
      makeCatalogEntry({ catalogGameId, displayName: 'Protected MP Game', verificationStatus: 'verified', antiCheat: 'protected-online-only' }),
    );

    const epicId = nextId('epic');
    upsertInstalledGames([
      makeInstalledGame({ id: epicId, platform: 'epic', installPath: 'C:/Epic/ProtectedMP', displayName: 'Protected MP Game', catalogGameId }),
    ]);

    const plan = planCanonicalMigration(new Date(0).toISOString());
    const group = plan.canonicalGames.find((g) => g.catalogGameId === catalogGameId);
    assert.ok(group);
    assert.equal(group!.eligibility, 'excluded');
  });

  test('a canonical game with no trainer-catalog link classifies as eligible, not silently unsupported', () => {
    const manualId = nextId('manual-install');
    upsertInstalledGames([
      makeInstalledGame({ id: manualId, platform: 'manual', installPath: 'C:/Standalone/NoCatalog', displayName: 'No Catalog Link Game' }),
    ]);

    const plan = planCanonicalMigration(new Date(0).toISOString());
    const group = plan.canonicalGames.find((g) => g.displayName === 'No Catalog Link Game');
    assert.ok(group);
    assert.equal(group!.eligibility, 'eligible');
  });
});
