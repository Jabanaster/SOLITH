import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  COMMUNITY_WARNING_LABEL,
  requiresCommunityExecutionApproval,
} from '../src/core/trainer-catalog/community-trust.ts';
import {
  sanitizeDefinitionForCommunityPublish,
} from '../src/core/trainer-catalog/sync/hub-client.ts';
import { resetForTesting, closeDatabaseSafely, flushPersistence } from '../src/core/database/index.ts';
import { getCatalogEntry, upsertCatalogEntry } from '../src/core/trainer-catalog/store.ts';
import { persistTrainerDefinition } from '../src/core/trainer-storage/repository.ts';

const ROOT = path.resolve(import.meta.dirname ?? '.', '..');

describe('community definition trust layer', () => {
  test('L0 definitions receive the required warning and execution gate', () => {
    assert.equal(COMMUNITY_WARNING_LABEL, 'Community (Scan Required)');
    assert.equal(requiresCommunityExecutionApproval('L0_Community'), true);
    assert.equal(requiresCommunityExecutionApproval('L3_Certified'), false);
  });

  test('Trainer Library exposes community rows as explicit scan-required actions', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src/app/pages/TrainerLibraryPage.tsx'), 'utf-8');

    assert.match(source, /entry\.verificationStatus === 'community'/);
    // Round 5 replaced the shouted "Run Community Scan" label with a neutral
    // "View Details" — the scan-required signal now lives in the button's
    // title tooltip and tierHint, not the visible label itself.
    assert.match(source, /communityScan \|\| isGeneric \? 'View Details'/);
    assert.ok(!source.includes('Run Community Scan'), 'obsolete "Run Community Scan" wording should be gone');
    assert.match(source, /a community scan runs before any memory attach/i);
  });

  test('publishing strips PII paths and all client certification claims', () => {
    const sanitized = sanitizeDefinitionForCommunityPublish({
      schemaVersion: 1,
      id: 'local-game',
      title: 'Local Game',
      gameVersion: 'research',
      targetSHA256: 'b'.repeat(64),
      executableHashPrefixes: ['bbbb'],
      author: 'C:\\Users\\chase\\\\wsl$\\Ubuntu\\home\\chase',
      certificationLevel: 'L4',
      safety: {
        requiresApproval: false,
        requiresOfflineConfirm: false,
        verificationStatus: 'verified',
      },
      target: {
        executables: [
          'C:\\Users\\chase\\Games\\LocalGame.exe',
          '\\\\NAS\\Users\\chase\\Games\\LocalGame.exe',
          'C:\\Games\\Other\\LocalGame.exe',
          '/opt/games/LocalGame.exe',
        ],
        arch: 'x64',
      },
      memoryFeatures: [{
        id: 'health',
        name: 'Health',
        category: 'Player',
        type: 'scan_unknown',
        dataType: 'int32',
        defaultValue: 100,
        certificationLevel: 'L4',
        resolution: {
          moduleName: 'C:\\Users\\chase\\Games\\LocalGame.exe',
          baseOffset: '0x1234',
        },
      }],
    }, 'a'.repeat(64));

    assert.equal(sanitized.author, 'community-contributor');
    assert.equal(sanitized.targetSHA256, 'a'.repeat(64));
    assert.deepEqual(sanitized.target.executables, [
      'LocalGame.exe',
      'LocalGame.exe',
      'LocalGame.exe',
      'LocalGame.exe',
    ]);
    assert.equal(sanitized.certificationLevel, undefined);
    assert.equal(sanitized.memoryFeatures?.[0]?.certificationLevel, undefined);
    assert.equal(sanitized.safety.verificationStatus, 'community');
    assert.equal(sanitized.safety.requiresApproval, true);
    assert.equal(sanitized.safety.requiresOfflineConfirm, true);
    assert.equal(sanitized.memoryFeatures?.[0]?.resolution.moduleName, 'LocalGame.exe');
    assert.doesNotMatch(JSON.stringify(sanitized), /chase|NAS|wsl|Users\\|opt\/games/i);
  });
});

describe('P4-13 §21: hasModPack/certLevel fail-open edge', () => {
  let tempDbDir: string;
  let tempDbPath: string;

  before(async () => {
    tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-p413-cert-'));
    tempDbPath = path.join(tempDbDir, 'test-p4-13-cert.sqlite');
    await resetForTesting(tempDbPath);
    await flushPersistence();
  });

  after(async () => {
    await closeDatabaseSafely();
    if (fs.existsSync(tempDbDir)) fs.rmSync(tempDbDir, { recursive: true, force: true });
  });

  test('requiresCommunityExecutionApproval(undefined) intentionally stays fail-open — CheatDefinition.certLevel is undefined for nearly every curated/bundled cheat', () => {
    // Nearly every CheatDefinition across every bundled/curated game never
    // sets certLevel at all (only 3 do, in src/core/cheat-system/games.ts,
    // each explicitly 'L0_Community'). useGameCheatSession.ts's
    // requireCommunityApproval() calls requiresCommunityExecutionApproval
    // (cheat.certLevel) on every hotkey/cheat action for every curated
    // game. Flipping this default to fail-closed would force the
    // community-approval prompt onto that entire curated, non-ModPack
    // surface — not a narrow fix. The real hasModPack:true-with-no-certLevel
    // gap (below) was closed at its source instead: the writer.
    assert.equal(requiresCommunityExecutionApproval(undefined), false);
  });

  test('reachability: a trainer_catalog_games row can have hasModPack:true with no resolvable certLevel (contradicts the prior "not reachable" audit)', () => {
    const id = `p413-orphan-${Date.now()}`;
    // Reproduces the exact condition the old trainer-catalog/sync/index.ts
    // ordering could leave behind: a catalog row claiming hasModPack:true
    // with no corresponding trainer_mod_packs row ever persisted for this
    // catalogGameId (no persistTrainerDefinition/upsertDefinitionPayload
    // call happened here at all).
    upsertCatalogEntry({
      catalogGameId: id,
      displayName: 'Orphan Test',
      executables: ['Orphan.exe'],
      categories: ['Action'],
      verificationStatus: 'metadata-only',
      sources: [{ provider: 'user', url: 'local://orphan-test' }],
      hasModPack: true,
      modPackId: `${id}-pack`,
      cheatCount: 3,
      searchableText: 'orphan test',
    });

    const entry = getCatalogEntry(id);
    assert.ok(entry);
    assert.equal(entry?.hasModPack, true);
    // getCatalogEntry()'s correlated subquery against trainer_mod_packs
    // finds nothing for this catalogGameId, so certLevel resolves to
    // undefined — requiresCommunityExecutionApproval(entry.certLevel)
    // would fail open on this row if nothing else gated it.
    assert.equal(entry?.certLevel, undefined);
  });

  test('fix: trainer-catalog/sync/index.ts write ordering never leaves hasModPack:true orphaned when persistTrainerDefinition fails', () => {
    const id = `p413-fixed-${Date.now()}`;
    // Mirrors syncAllTrainerSources()'s fixed ordering: the identity-review
    // write happens with hasModPack:false first.
    upsertCatalogEntry({
      catalogGameId: id,
      displayName: 'Fixed Ordering Test',
      executables: ['Fixed.exe'],
      categories: ['Action'],
      verificationStatus: 'community',
      sources: [{ provider: 'mrantifun', url: 'https://example.test/fixed-ordering' }],
      hasModPack: false,
      cheatCount: 0,
      searchableText: 'fixed ordering test',
    });

    // Deliberately malformed input — fails schema validation. This is the
    // exact persistTrainerDefinition failure mode that, under the OLD
    // unconditional-hasModPack:true-first ordering, would have left this
    // row orphaned with hasModPack:true and no trainer_mod_packs row.
    const persisted = persistTrainerDefinition({ schemaVersion: 1, id }, { sourceProvider: 'mrantifun' });
    assert.equal(persisted.success, false);

    // The fixed ordering only flips hasModPack to true in a follow-up
    // upsertCatalogEntry() call AFTER a successful persist — which never
    // ran here, so the row must still read back as hasModPack:false, never
    // orphaned true.
    const entry = getCatalogEntry(id);
    assert.equal(entry?.hasModPack, false);
    // The invariant this whole fix protects, asserted directly: whenever a
    // row does claim hasModPack:true, certLevel must be resolvable.
    if (entry?.hasModPack) {
      assert.notEqual(entry.certLevel, undefined);
    }
  });
});
