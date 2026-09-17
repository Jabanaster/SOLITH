import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeInstallPlatform,
  normalizeModPackPlatform,
  normalizeProviderLabel,
  sameCanonicalProvider,
} from '../src/core/install-discovery/provider-identity.ts';
import type { InstallPlatform } from '../src/core/install-discovery/types.ts';
import type { ModPack } from '../src/core/trainer-catalog/types.ts';

describe('provider normalization — typed union bridges', () => {
  test('every InstallPlatform value maps to a canonical provider', () => {
    const platforms: InstallPlatform[] = ['steam', 'epic', 'gog', 'xbox', 'ubisoft', 'ea', 'battlenet', 'manual'];
    for (const platform of platforms) {
      const normalized = normalizeInstallPlatform(platform);
      assert.notEqual(normalized.canonical, undefined);
      assert.equal(normalized.raw, platform, 'raw value must be preserved for diagnostics');
    }
  });

  test('every ModPack.platform value maps to a canonical provider', () => {
    const platforms: ModPack['platform'][] = ['steam', 'epic', 'xbox-game-pass', 'standalone', 'unknown'];
    for (const platform of platforms) {
      const normalized = normalizeModPackPlatform(platform);
      assert.notEqual(normalized.canonical, undefined);
      assert.equal(normalized.raw, platform);
    }
  });

  test('the install-discovery "xbox" install platform and the mod-pack "xbox-game-pass" platform bridge to the same canonical provider', () => {
    const installSide = normalizeInstallPlatform('xbox');
    const modPackSide = normalizeModPackPlatform('xbox-game-pass');
    assert.equal(installSide.canonical, modPackSide.canonical);
    assert.ok(sameCanonicalProvider(installSide, modPackSide));
  });

  test('install-discovery "manual" and mod-pack "standalone" bridge to the same canonical provider', () => {
    assert.ok(sameCanonicalProvider(normalizeInstallPlatform('manual'), normalizeModPackPlatform('standalone')));
  });

  test('different real providers are never considered the same', () => {
    assert.equal(sameCanonicalProvider(normalizeInstallPlatform('steam'), normalizeModPackPlatform('epic')), false);
  });

  test('mod-pack "unknown" never matches anything, including another unknown', () => {
    const a = normalizeModPackPlatform('unknown');
    const b = normalizeModPackPlatform('unknown');
    assert.equal(sameCanonicalProvider(a, b), false, '"unknown" must never be treated as a confirmed provider match');
  });
});

describe('provider normalization — free-form label aliases', () => {
  const cases: Array<[string, string]> = [
    ['Steam', 'steam'],
    ['STEAM', 'steam'],
    ['Valve', 'steam'],
    ['Epic Games', 'epic'],
    ['EpicGames', 'epic'],
    ['epic', 'epic'],
    ['GOG', 'gog'],
    ['gog.com', 'gog'],
    ['Xbox', 'xbox'],
    ['Xbox Game Pass', 'xbox'],
    ['Microsoft Store', 'xbox'],
    ['MS Store', 'xbox'],
    ['Ubisoft Connect', 'ubisoft'],
    ['uplay', 'ubisoft'],
    ['EA', 'ea'],
    ['EA App', 'ea'],
    ['Origin', 'ea'],
    ['Battle.net', 'battlenet'],
    ['standalone', 'standalone'],
    ['manual', 'standalone'],
  ];

  for (const [raw, expected] of cases) {
    test(`"${raw}" normalizes to canonical "${expected}"`, () => {
      assert.equal(normalizeProviderLabel(raw).canonical, expected);
    });
  }

  test('an unrecognized label normalizes to "unknown" rather than throwing or guessing', () => {
    const result = normalizeProviderLabel('SomeRandomLauncherNobodyHeardOf');
    assert.equal(result.canonical, 'unknown');
    assert.equal(result.raw, 'SomeRandomLauncherNobodyHeardOf', 'original text is retained, never discarded');
  });

  test('leading/trailing whitespace does not affect normalization', () => {
    assert.equal(normalizeProviderLabel('  Steam  ').canonical, 'steam');
  });
});
