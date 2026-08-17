import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase } from '../src/core/database/index.ts';
import { createInstallIdentity, INSTALL_IDENTITY_VERSION } from '../src/core/install-discovery/identity.ts';
import { upsertInstalledGames } from '../src/core/install-discovery/store.ts';
import { upsertCatalogEntry } from '../src/core/trainer-catalog/store.ts';
import type { InstalledGameRecord } from '../src/core/install-discovery/types.ts';
import type { TrainerCatalogEntry } from '../src/core/trainer-catalog/types.ts';
import { computeIdentityKey, generateCanonicalGameId } from '../src/core/canonical-games/identity.ts';
import { resolveCanonicalGrouping } from '../src/core/canonical-games/dedupe.ts';
import {
  buildEvidenceFromInstalledGame,
  planCanonicalMigration,
  applyCanonicalMigrationPlan,
} from '../src/core/canonical-games/migration.ts';
import {
  getCanonicalGame,
  listCanonicalGames,
  listInstallationsForGame,
  listPendingCanonicalIdentityReviewItems,
} from '../src/core/canonical-games/store.ts';
import { listInstalledGames } from '../src/core/install-discovery/store.ts';
import type { CanonicalIdentityEvidence } from '../src/core/canonical-games/types.ts';

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

function makeCatalogEntry(catalogGameId: string, displayName: string, overrides: Partial<TrainerCatalogEntry> = {}): TrainerCatalogEntry {
  return {
    catalogGameId,
    displayName,
    executables: ['Test.exe'],
    categories: ['Action'],
    verificationStatus: 'community',
    sources: [{ provider: 'mrantifun', url: `https://mrantifun.net/${catalogGameId}` }],
    hasModPack: false,
    cheatCount: 0,
    searchableText: displayName.toLowerCase(),
    ...overrides,
  };
}

function evidenceFor(id: string, overrides: Partial<CanonicalIdentityEvidence> = {}): CanonicalIdentityEvidence {
  return {
    sourceId: id,
    platform: 'steam',
    installIdentity: `install-identity:${id}`,
    detectedAt: new Date(0).toISOString(),
    lastSeenAt: new Date(0).toISOString(),
    ...overrides,
  };
}

describe('canonical identity — grouping', () => {
  test('same steamAppId across Steam and GOG installs → one canonical game', () => {
    const a = evidenceFor(nextId('a'), { platform: 'steam', steamAppId: 1091500, displayName: 'Cyberpunk 2077' });
    const b = evidenceFor(nextId('b'), { platform: 'gog', steamAppId: 1091500, displayName: 'Cyberpunk 2077' });
    const { groups, ambiguous } = resolveCanonicalGrouping([a, b]);
    assert.equal(groups.size, 1);
    assert.equal(ambiguous.length, 0);
    const [[, evidence]] = [...groups];
    assert.equal(evidence.length, 2);
  });

  test('repeated computation of the same evidence yields the same canonical id', () => {
    const evidence = evidenceFor(nextId('stable'), { steamAppId: 42 });
    const idOne = generateCanonicalGameId(computeIdentityKey(evidence));
    const idTwo = generateCanonicalGameId(computeIdentityKey(evidence));
    assert.equal(idOne, idTwo);
  });

  test('two installations attach to one canonical game', () => {
    const a = evidenceFor(nextId('m1'), { steamAppId: 777 });
    const b = evidenceFor(nextId('m2'), { platform: 'epic', steamAppId: 777 });
    const { groups } = resolveCanonicalGrouping([a, b]);
    assert.equal(groups.size, 1);
    const evidence = [...groups.values()][0];
    assert.equal(evidence.length, 2);
  });
});

describe('canonical identity — false-merge protection', () => {
  test('DOOM vs DOOM Eternal remain separate', () => {
    const doom = evidenceFor(nextId('doom'), { displayName: 'DOOM' });
    const doomEternal = evidenceFor(nextId('doom-eternal'), { displayName: 'DOOM Eternal' });
    const { groups, ambiguous } = resolveCanonicalGrouping([doom, doomEternal]);
    assert.equal(groups.size, 2);
    assert.equal(ambiguous.length, 0);
  });

  test('remake vs original remain separate', () => {
    const original = evidenceFor(nextId('re4'), { displayName: 'Resident Evil 4' });
    const remake = evidenceFor(nextId('re4-remake'), { displayName: 'Resident Evil 4 Remake' });
    const { groups } = resolveCanonicalGrouping([original, remake]);
    assert.equal(groups.size, 2);
  });

  test('conflicting trusted platform IDs do not merge', () => {
    const a = evidenceFor(nextId('conflict-a'), { steamAppId: 100, displayName: 'Same Title' });
    const b = evidenceFor(nextId('conflict-b'), { steamAppId: 200, displayName: 'Same Title' });
    const { groups, ambiguous } = resolveCanonicalGrouping([a, b]);
    assert.equal(groups.size, 2);
    assert.equal(ambiguous.length, 0);
  });

  test('ambiguous same-title records with conflicting trusted identities enter review path', () => {
    const trustedA = evidenceFor(nextId('amb-a'), { steamAppId: 301, displayName: 'Ambiguous Title' });
    const trustedB = evidenceFor(nextId('amb-b'), { steamAppId: 302, displayName: 'Ambiguous Title' });
    const bare = evidenceFor(nextId('amb-c'), { displayName: 'Ambiguous Title' });
    const { groups, ambiguous } = resolveCanonicalGrouping([trustedA, trustedB, bare]);
    assert.equal(groups.size, 2);
    assert.equal(ambiguous.length, 1);
    assert.equal(ambiguous[0].reason, 'title-matches-multiple-trusted-identities');
  });

  test('no usable evidence at all always routes to manual review', () => {
    const empty = evidenceFor(nextId('empty'));
    const { groups, ambiguous } = resolveCanonicalGrouping([empty]);
    assert.equal(groups.size, 0);
    assert.equal(ambiguous.length, 1);
    assert.equal(ambiguous[0].reason, 'no-identity-evidence');
  });
});

describe('canonical migration — persistence', () => {
  before(async () => {
    await initDatabase();
  });

  test('legacy single-launcher row migrates to one canonical game with one installation', () => {
    const catalogId = nextId('catalog-single');
    upsertCatalogEntry(makeCatalogEntry(catalogId, 'Solo Launcher Game'));
    const row = makeInstalledGame({
      id: nextId('install-single'),
      platform: 'steam',
      installPath: 'C:/Games/Solo',
      executablePath: 'C:/Games/Solo/solo.exe',
      displayName: 'Solo Launcher Game',
      steamAppId: 555001,
      catalogGameId: catalogId,
      catalogDisplayName: 'Solo Launcher Game',
    });
    upsertInstalledGames([row]);

    const plan = planCanonicalMigration(new Date(0).toISOString());
    const target = plan.canonicalGames.find((g) => g.catalogGameId === catalogId);
    assert.ok(target, 'expected a canonical game linked to the catalog entry');
    const installsForTarget = plan.installations.filter((i) => i.canonicalGameId === target!.id);
    assert.equal(installsForTarget.length, 1);

    applyCanonicalMigrationPlan(plan);
    const persisted = getCanonicalGame(target!.id);
    assert.ok(persisted);
    assert.equal(persisted!.catalogGameId, catalogId);
    assert.equal(listInstallationsForGame(target!.id).length, 1);
  });

  test('duplicate launcher rows collapse onto one canonical game when identity is trusted', () => {
    const steamAppId = 909001;
    const steamRow = makeInstalledGame({
      id: nextId('dup-steam'),
      platform: 'steam',
      installPath: 'C:/Games/DupSteam',
      executablePath: 'C:/Games/DupSteam/dup.exe',
      displayName: 'Duplicate Title',
      steamAppId,
    });
    const gogRow = makeInstalledGame({
      id: nextId('dup-gog'),
      platform: 'gog',
      installPath: 'D:/GOG/DupGog',
      executablePath: 'D:/GOG/DupGog/dup.exe',
      displayName: 'Duplicate Title',
      steamAppId,
    });
    upsertInstalledGames([steamRow, gogRow]);

    const plan = planCanonicalMigration(new Date(0).toISOString());
    const grouped = plan.installations.filter(
      (i) => i.sourceInstalledGameId === steamRow.id || i.sourceInstalledGameId === gogRow.id,
    );
    assert.equal(grouped.length, 2);
    assert.equal(grouped[0].canonicalGameId, grouped[1].canonicalGameId);
  });

  test('ambiguous legacy rows (no usable identity) remain separate and enter review, not silently merged', () => {
    const rowA = makeInstalledGame({ id: nextId('ambig-a'), platform: 'manual', installPath: 'C:/Games/Unknown1' });
    const rowB = makeInstalledGame({ id: nextId('ambig-b'), platform: 'manual', installPath: 'C:/Games/Unknown2' });
    upsertInstalledGames([rowA, rowB]);

    const plan = planCanonicalMigration(new Date(0).toISOString());
    const coveredIds = new Set(plan.installations.map((i) => i.sourceInstalledGameId));
    assert.equal(coveredIds.has(rowA.id), false);
    assert.equal(coveredIds.has(rowB.id), false);

    applyCanonicalMigrationPlan(plan);
    const pending = listPendingCanonicalIdentityReviewItems();
    const reviewedIds = new Set(pending.flatMap((item) => item.evidence.map((e) => e.sourceId)));
    assert.ok(reviewedIds.has(rowA.id));
    assert.ok(reviewedIds.has(rowB.id));
  });

  test('migration rerun is idempotent — same canonical ids, no duplicate rows', () => {
    const steamAppId = 909555;
    const row = makeInstalledGame({
      id: nextId('idem'),
      platform: 'steam',
      installPath: 'C:/Games/Idem',
      steamAppId,
      displayName: 'Idempotent Game',
    });
    upsertInstalledGames([row]);

    const planOne = planCanonicalMigration(new Date(0).toISOString());
    applyCanonicalMigrationPlan(planOne);
    const countAfterFirst = listCanonicalGames().length;

    const planTwo = planCanonicalMigration(new Date(1).toISOString());
    applyCanonicalMigrationPlan(planTwo);
    const countAfterSecond = listCanonicalGames().length;

    assert.equal(countAfterFirst, countAfterSecond);
    const idOne = planOne.canonicalGames.find((g) => g.displayName === 'Idempotent Game')?.id;
    const idTwo = planTwo.canonicalGames.find((g) => g.displayName === 'Idempotent Game')?.id;
    assert.equal(idOne, idTwo);
  });

  test('migration never mutates installed_games rows (trainer lookup stays intact)', () => {
    const catalogId = nextId('catalog-preserve');
    upsertCatalogEntry(makeCatalogEntry(catalogId, 'Preserve Me'));
    const row = makeInstalledGame({
      id: nextId('preserve'),
      platform: 'steam',
      installPath: 'C:/Games/Preserve',
      steamAppId: 12321,
      catalogGameId: catalogId,
    });
    upsertInstalledGames([row]);
    const before_ = listInstalledGames().find((r) => r.id === row.id);

    const plan = planCanonicalMigration(new Date(0).toISOString());
    applyCanonicalMigrationPlan(plan);

    const after = listInstalledGames().find((r) => r.id === row.id);
    assert.deepEqual(after, before_);
  });
});

describe('canonical games — lookup API', () => {
  before(async () => {
    await initDatabase();
  });

  test('canonical game with no installations remains a valid, listable entity', () => {
    const evidence = evidenceFor(nextId('no-install'), { steamAppId: 6060, displayName: 'Standalone Entry' });
    const id = generateCanonicalGameId(computeIdentityKey(evidence));
    applyCanonicalMigrationPlan({
      canonicalGames: [
        {
          id,
          displayName: 'Standalone Entry',
          normalizedTitle: 'standalone entry',
          aliases: [],
          genres: [],
          playModes: [],
          eligibility: 'listed',
          supportState: 'unknown',
          identityStatus: 'verified',
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        },
      ],
      installations: [],
      ambiguous: [],
      report: {
        legacyInstalledGameRows: 0,
        canonicalGamesProduced: 1,
        installationsProduced: 0,
        safeMerges: 0,
        ambiguousCases: 0,
        manualReviewCases: 0,
      },
    });

    const persisted = getCanonicalGame(id);
    assert.ok(persisted);
    assert.equal(listInstallationsForGame(id).length, 0);
    assert.ok(listCanonicalGames().some((g) => g.id === id));
  });
});
