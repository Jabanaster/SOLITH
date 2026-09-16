/**
 * Ambiguous same-executable-filename matching (ROADMAP.md Phase 3 identity
 * model). Explicit hierarchy, no arbitrary/first/alphabetical/installation-
 * order pick: (1) exact displayName match, (2) authoritative content
 * identity (installed executable's real hash vs each candidate's known
 * trainer/mod-pack executableHashPrefixes), (3) otherwise fail closed
 * (undefined — no catalogGameId), never a guess.
 */
import { after as afterAll, before as beforeAll, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { matchInstalledToCatalog, countMatchedCatalog } from '../src/core/install-discovery/match.ts';
import { resetForTesting } from '../src/core/database/index.ts';
import { upsertModPack } from '../src/core/trainer-catalog/store.ts';
import type { TrainerCatalogEntry, ModPack } from '../src/core/trainer-catalog/types.ts';
import type { RawInstalledGame } from '../src/core/install-discovery/types.ts';

function entry(id: string, displayName: string, executable: string): TrainerCatalogEntry {
  return {
    catalogGameId: id,
    displayName,
    categories: [],
    executables: [executable],
    verificationStatus: 'community',
    sources: [{ provider: 'bundled', url: 'bundled://test' }],
    hasModPack: true,
    cheatCount: 0,
    searchableText: displayName.toLowerCase(),
  };
}

function install(overrides: Partial<RawInstalledGame> = {}): RawInstalledGame {
  return {
    platform: 'manual',
    installPath: 'C:/Games/Shared.exe-holder',
    executablePath: 'C:/Games/Shared.exe-holder/Shared.exe',
    ...overrides,
  };
}

const SHARED_EXE = 'Shared.exe';
const CATALOG_AMBIGUOUS: TrainerCatalogEntry[] = [
  entry('game-a', 'Game A', SHARED_EXE),
  entry('game-b', 'Game B', SHARED_EXE),
];

describe('ambiguous executable matching — tier 1 (displayName)', () => {
  test('resolves via exact displayName match when the installer reported a title', () => {
    const [record] = matchInstalledToCatalog(
      [install({ displayName: 'Game B' })],
      CATALOG_AMBIGUOUS,
      new Date().toISOString(),
    );
    assert.equal(record.catalogGameId, 'game-b');
  });

  test('does not use displayName when it matches zero candidates (falls through to tier 2/3)', () => {
    const [record] = matchInstalledToCatalog(
      [install({ displayName: 'Some Unrelated Title' })],
      CATALOG_AMBIGUOUS,
      new Date().toISOString(),
      { hashExecutable: () => null, resolveExecutableHashPrefixes: () => [] },
    );
    assert.equal(record.catalogGameId, undefined);
  });
});

describe('ambiguous executable matching — tier 2 (authoritative content identity)', () => {
  test('resolves via SHA-256 executableHashPrefixes when exactly one candidate matches', () => {
    const [record] = matchInstalledToCatalog(
      [install({ displayName: undefined })],
      CATALOG_AMBIGUOUS,
      new Date().toISOString(),
      {
        hashExecutable: () => 'deadbeef1234',
        resolveExecutableHashPrefixes: (id) => (id === 'game-a' ? ['deadbeef'] : ['00000000']),
      },
    );
    assert.equal(record.catalogGameId, 'game-a');
  });

  test('same filename, different real content hash, resolves to the correct distinct game', () => {
    const records = matchInstalledToCatalog(
      [
        install({ installPath: 'C:/Games/A', executablePath: 'C:/Games/A/Shared.exe' }),
        install({ installPath: 'C:/Games/B', executablePath: 'C:/Games/B/Shared.exe' }),
      ],
      CATALOG_AMBIGUOUS,
      new Date().toISOString(),
      {
        hashExecutable: (exePath) => (exePath.includes('/A/') ? 'aaaa1111' : 'bbbb2222'),
        resolveExecutableHashPrefixes: (id) => (id === 'game-a' ? ['aaaa'] : ['bbbb']),
      },
    );
    assert.equal(records[0].catalogGameId, 'game-a');
    assert.equal(records[1].catalogGameId, 'game-b');
  });

  test('same provider and filename but different builds still disambiguate correctly', () => {
    const [record] = matchInstalledToCatalog(
      [install({ platform: 'steam', displayName: undefined })],
      CATALOG_AMBIGUOUS,
      new Date().toISOString(),
      {
        hashExecutable: () => 'cafef00d',
        resolveExecutableHashPrefixes: (id) => (id === 'game-b' ? ['cafef00d'] : ['aaaaaaaa']),
      },
    );
    assert.equal(record.catalogGameId, 'game-b');
  });
});

describe('ambiguous executable matching — tier 3 (fail closed)', () => {
  test('two candidates share the fingerprint prefix: fails closed, does not guess', () => {
    const [record] = matchInstalledToCatalog(
      [install({ displayName: undefined })],
      CATALOG_AMBIGUOUS,
      new Date().toISOString(),
      {
        hashExecutable: () => 'deadbeef',
        resolveExecutableHashPrefixes: () => ['dead'], // both candidates match — still ambiguous
      },
    );
    assert.equal(record.catalogGameId, undefined);
    assert.equal(countMatchedCatalog([record]), 0);
  });

  test('no hash available and no displayName: fails closed rather than picking the first candidate', () => {
    const [record] = matchInstalledToCatalog(
      [install({ displayName: undefined })],
      CATALOG_AMBIGUOUS,
      new Date().toISOString(),
      { hashExecutable: () => null, resolveExecutableHashPrefixes: () => [] },
    );
    assert.equal(record.catalogGameId, undefined);
  });

  test('ambiguous displayName match (matches more than one candidate) falls through rather than picking either', () => {
    const dupDisplayName: TrainerCatalogEntry[] = [
      entry('dup-a', 'Same Title', SHARED_EXE),
      entry('dup-b', 'Same Title', SHARED_EXE),
    ];
    const [record] = matchInstalledToCatalog(
      [install({ displayName: 'Same Title' })],
      dupDisplayName,
      new Date().toISOString(),
      { hashExecutable: () => null, resolveExecutableHashPrefixes: () => [] },
    );
    assert.equal(record.catalogGameId, undefined);
  });
});

function modPack(catalogGameId: string, executableHashPrefixes: string[]): ModPack {
  return {
    packId: `${catalogGameId}-pack`,
    catalogGameId,
    gameName: catalogGameId,
    source: { provider: 'bundled', url: 'bundled://test' },
    verificationStatus: 'verified',
    versions: [{ versionLabel: '*', executables: [SHARED_EXE], executableHashPrefixes }],
    cheats: [],
    connectionBaseline: 0,
    platform: 'standalone',
    syncedAt: new Date().toISOString(),
  };
}

describe('ambiguous executable matching — real default wiring (real DB + real file hash)', () => {
  let tmpDir: string;

  beforeAll(async () => {
    await resetForTesting();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-ambiguous-match-'));
  });

  afterAll(async () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    await resetForTesting();
  });

  test('default hashExecutable/resolveExecutableHashPrefixes (no injected options) correctly disambiguate a real installed file', () => {
    const exePath = path.join(tmpDir, SHARED_EXE);
    const content = Buffer.from('real-game-a-build-payload');
    fs.writeFileSync(exePath, content);
    const realSha256 = createHash('sha256').update(content).digest('hex');

    upsertModPack(modPack('game-a', [realSha256.slice(0, 16)]));
    upsertModPack(modPack('game-b', ['0000000000000000']));

    const [record] = matchInstalledToCatalog(
      [install({ installPath: tmpDir, executablePath: exePath, displayName: undefined })],
      CATALOG_AMBIGUOUS,
      new Date().toISOString(),
    );
    assert.equal(record.catalogGameId, 'game-a');
  });
});

describe('ambiguous executable matching — unambiguous fast path unaffected', () => {
  test('a single-candidate executable match still resolves immediately, no hashing needed', () => {
    let hashCalls = 0;
    const [record] = matchInstalledToCatalog(
      [install({ executablePath: 'C:/Games/Only/Unique.exe', displayName: undefined })],
      [entry('only-game', 'Only Game', 'Unique.exe')],
      new Date().toISOString(),
      { hashExecutable: () => { hashCalls += 1; return null; }, resolveExecutableHashPrefixes: () => [] },
    );
    assert.equal(record.catalogGameId, 'only-game');
    assert.equal(hashCalls, 0, 'tier 2/3 must not run when the executable name alone is unambiguous');
  });
});
