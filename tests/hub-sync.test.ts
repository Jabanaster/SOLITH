import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import db, { resetForTesting } from '../src/core/database/index.ts';
import { getSettings, setSetting } from '../src/core/settings/index.ts';
import {
  getDefinitionPayload,
  getDefinitionSyncMetadata,
  getCatalogEntry,
  upsertDefinitionPayload,
} from '../src/core/trainer-catalog/store.ts';
import { loadGameConfigFromCatalog } from '../src/core/trainer-catalog/mod-pack-loader.ts';
import {
  publishCommunityDefinition,
  syncCommunityDefinitions,
} from '../src/core/trainer-catalog/sync/hub-client.ts';

const HUB_UPDATED_AT = '2026-07-17T08:00:00.000Z';

function communityRecord() {
  return {
    id: 'hub-record-1',
    game_id: 'synthetic-game',
    executable_hash: 'a'.repeat(64),
    cert_level: 'L0_Community' as const,
    definition_payload: {
      schemaVersion: 1,
      id: 'synthetic-game',
      title: 'Synthetic Game',
      gameVersion: '1.0',
      executableHashPrefixes: ['aaaa'],
      author: 'Community Author',
      safety: {
        requiresApproval: true,
        requiresOfflineConfirm: true,
        verificationStatus: 'community',
      },
      target: {
        executables: ['SyntheticGame.exe'],
        arch: 'x64',
      },
      memoryFeatures: [{
        id: 'health',
        name: 'Health',
        category: 'Player',
        type: 'freeze' as const,
        dataType: 'int32' as const,
        defaultValue: 100,
        resolution: {
          moduleName: 'SyntheticGame.exe',
          baseOffset: '0x1234',
          pointerChain: [16],
        },
      }],
    },
    created_at: HUB_UPDATED_AT,
    updated_at: HUB_UPDATED_AT,
  };
}

describe('Solith Hub community definition sync', () => {
  beforeEach(async () => {
    await resetForTesting();
  });

  test('catalog schema includes certification and integer delta columns', () => {
    const columns = db.prepare('PRAGMA table_info(trainer_mod_packs)').all() as Array<{
      name: string;
      type: string;
      dflt_value: string | number | null;
    }>;
    const certLevel = columns.find((column) => column.name === 'cert_level');
    const updatedAt = columns.find((column) => column.name === 'updated_at');

    assert.equal(certLevel?.type, 'TEXT');
    assert.equal(certLevel?.dflt_value, "'L3_Certified'");
    assert.equal(updatedAt?.type, 'INTEGER');
    assert.equal(Number(updatedAt?.dflt_value), 0);
  });

  test('community sync defaults off and makes zero network requests', async () => {
    assert.equal(getSettings().communitySyncEnabled, false);
    let fetchCalls = 0;

    const result = await syncCommunityDefinitions({
      fetchImpl: async () => {
        fetchCalls += 1;
        throw new Error('fetch must not run while community sync is disabled');
      },
    });

    assert.equal(result.status, 'disabled');
    assert.equal(fetchCalls, 0);
  });

  test('opted-in delta sync stores an L0 community definition', async () => {
    setSetting('communitySyncEnabled', true);
    const requestedUrls: string[] = [];

    const result = await syncCommunityDefinitions({
      fetchImpl: async (input) => {
        requestedUrls.push(String(input));
        return new Response(JSON.stringify({
          definitions: [communityRecord()],
          count: 1,
          next_since: '2026-07-17T08:01:00.000Z',
          has_more: false,
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    assert.equal(result.status, 'synced');
    assert.equal(result.imported, 1);
    assert.equal(requestedUrls.length, 1);
    assert.equal(new URL(requestedUrls[0]!).searchParams.get('since'), '1970-01-01T00:00:00.000Z');

    const stored = getDefinitionPayload('synthetic-game');
    assert.equal(stored?.author, 'Community Author');
    assert.equal(stored?.safety.verificationStatus, 'community');
    assert.equal(stored?.safety.requiresApproval, true);

    const metadata = getDefinitionSyncMetadata('hub-record-1');
    assert.equal(metadata?.certLevel, 'L0_Community');
    assert.equal(metadata?.updatedAt, Date.parse(HUB_UPDATED_AT));
    assert.equal(getCatalogEntry('synthetic-game')?.certLevel, 'L0_Community');
    const gameConfig = loadGameConfigFromCatalog('synthetic-game');
    assert.equal(gameConfig?.cheats.length, 1);
    assert.ok(gameConfig?.cheats.every((cheat) => cheat.certLevel === 'L0_Community'));
    assert.ok(gameConfig?.cheats.every((cheat) => cheat.requiresDiscovery));
  });

  test('remote records never overwrite a user-authored definition by default', async () => {
    setSetting('communitySyncEnabled', true);
    const local = communityRecord().definition_payload;
    local.author = 'Local User';
    upsertDefinitionPayload(
      'synthetic-game-pack',
      'synthetic-game',
      JSON.stringify(local),
      'community',
      'user',
      '2026-07-17T07:00:00.000Z',
    );

    const remote = communityRecord();
    remote.cert_level = 'L3_Certified';
    const result = await syncCommunityDefinitions({
      fetchImpl: async () => new Response(JSON.stringify({
        definitions: [remote],
        count: 1,
        next_since: '2026-07-17T08:01:00.000Z',
        has_more: false,
      })),
    });

    assert.equal(result.skippedUserDefinitions, 1);
    assert.equal(getDefinitionPayload('synthetic-game')?.author, 'Local User');
  });

  test('publishing is opt-in and sends only a sanitized L0 submission', async () => {
    let fetchCalls = 0;
    await assert.rejects(
      publishCommunityDefinition({
        definition: communityRecord().definition_payload,
        executableHash: 'a'.repeat(64),
      }, {
        fetchImpl: async () => {
          fetchCalls += 1;
          throw new Error('must not fetch');
        },
      }),
      /community_sync_disabled/,
    );
    assert.equal(fetchCalls, 0);

    setSetting('communitySyncEnabled', true);
    let submitted: Record<string, unknown> | undefined;
    const result = await publishCommunityDefinition({
      definition: {
        ...communityRecord().definition_payload,
        author: 'C:\\Users\\private-user',
        certificationLevel: 'L4',
      },
      executableHash: 'b'.repeat(64),
    }, {
      fetchImpl: async (input, init) => {
        assert.equal(new URL(String(input)).pathname, '/submit');
        assert.equal(init?.method, 'POST');
        submitted = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({
          id: 'published-record',
          game_id: 'synthetic-game',
          cert_level: 'L0_Community',
          created_at: HUB_UPDATED_AT,
          updated_at: HUB_UPDATED_AT,
        }), { status: 201 });
      },
    });

    assert.equal(result.certLevel, 'L0_Community');
    assert.equal(submitted?.game_id, 'synthetic-game');
    assert.doesNotMatch(JSON.stringify(submitted), /private-user|L4/);
  });

  test('hub L3 payloads cannot disable approval or offline confirm', async () => {
    setSetting('communitySyncEnabled', true);
    const remote = communityRecord();
    remote.id = 'hub-record-l3';
    remote.game_id = 'synthetic-l3';
    remote.cert_level = 'L3_Certified';
    remote.definition_payload = {
      ...remote.definition_payload,
      id: 'synthetic-l3',
      safety: {
        requiresApproval: false,
        requiresOfflineConfirm: false,
        verificationStatus: 'verified',
      },
    };

    const result = await syncCommunityDefinitions({
      fetchImpl: async () => new Response(JSON.stringify({
        definitions: [remote],
        count: 1,
        next_since: '2026-07-17T08:01:00.000Z',
        has_more: false,
      })),
    });

    assert.equal(result.imported, 1);
    const stored = getDefinitionPayload('synthetic-l3');
    assert.equal(stored?.safety.verificationStatus, 'verified');
    assert.equal(stored?.safety.requiresApproval, true);
    assert.equal(stored?.safety.requiresOfflineConfirm, true);
  });

  test('paginated delta sync advances the since cursor', async () => {
    setSetting('communitySyncEnabled', true);
    const requested: string[] = [];
    const page1 = communityRecord();
    const page2 = {
      ...communityRecord(),
      id: 'hub-record-2',
      game_id: 'synthetic-game-2',
      updated_at: '2026-07-17T09:00:00.000Z',
      definition_payload: {
        ...communityRecord().definition_payload,
        id: 'synthetic-game-2',
        title: 'Synthetic Game 2',
      },
    };

    const result = await syncCommunityDefinitions({
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        requested.push(url.searchParams.get('since') ?? '');
        if (requested.length === 1) {
          return new Response(JSON.stringify({
            definitions: [page1],
            count: 1,
            next_since: '2026-07-17T08:30:00.000Z',
            has_more: true,
          }));
        }
        return new Response(JSON.stringify({
          definitions: [page2],
          count: 1,
          next_since: '2026-07-17T09:01:00.000Z',
          has_more: false,
        }));
      },
    });

    assert.equal(result.status, 'synced');
    assert.equal(result.imported, 2);
    assert.equal(result.pages, 2);
    assert.deepEqual(requested, [
      '1970-01-01T00:00:00.000Z',
      '2026-07-17T08:30:00.000Z',
    ]);
  });

  test('explicit overwrite replaces a user-authored definition', async () => {
    setSetting('communitySyncEnabled', true);
    const local = communityRecord().definition_payload;
    local.author = 'Local User';
    upsertDefinitionPayload(
      'synthetic-game-pack',
      'synthetic-game',
      JSON.stringify(local),
      'community',
      'user',
      '2026-07-17T07:00:00.000Z',
    );

    const remote = communityRecord();
    remote.definition_payload = {
      ...remote.definition_payload,
      author: 'Hub Author',
    };

    const result = await syncCommunityDefinitions({
      overwriteUserDefinitions: true,
      fetchImpl: async () => new Response(JSON.stringify({
        definitions: [remote],
        count: 1,
        next_since: '2026-07-17T08:01:00.000Z',
        has_more: false,
      })),
    });

    assert.equal(result.imported, 1);
    assert.equal(result.skippedUserDefinitions, 0);
    assert.equal(getDefinitionPayload('synthetic-game')?.author, 'Hub Author');
  });
});
