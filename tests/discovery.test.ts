import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Each invocation of this test file gets a unique temp root so that
// consecutive runs (npm test && npm test) never share state.
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const TEMP_ROOT = path.join(os.tmpdir(), `solith-discovery-${RUN_ID}`);
const TEMP_DB   = path.join(TEMP_ROOT, 'test.db');

import { resetForTesting } from '../src/core/database/index.ts';
import {
  getSaveLocations,
  approveSaveLocation,
  revokeSaveLocation,
  addUserSelectedLocation,
  isPathApproved
} from '../src/core/saves/locations.ts';
import { compareSaves, compareSavesWithReport, calculateScore, createDiscoveryReport, rankDiscoveries } from '../src/core/discovery/index.ts';
import { createRecipe } from '../src/core/recipes/index.ts';
import { createProposalForEdit, dryRunProposal, applyProposal } from '../src/core/saves/editor.ts';
import { getBackupsForGame, restoreBackupById } from '../src/core/backups/index.ts';
import { getCanonicalPath } from '../src/core/safety/path-safety.ts';
import db from '../src/core/database/index.ts';

const MOCK_GAME_ID = `discovery-test-game-${RUN_ID}`;

function setupTestGame() {
  fs.mkdirSync(path.join(TEMP_ROOT, 'game'), { recursive: true });
  fs.mkdirSync(path.join(TEMP_ROOT, 'external-save'), { recursive: true });

  db.prepare(`
    INSERT OR REPLACE INTO games (id, name, path)
    VALUES (?, ?, ?)
  `).run(MOCK_GAME_ID, 'Test RPG Game', path.join(TEMP_ROOT, 'game'));
}

describe('Solith Save Discovery, Locations, and Discovery Engine Tests', () => {
  before(async () => {
    // Fully isolated database — never touches production data
    await resetForTesting(TEMP_DB);
    setupTestGame();
  });

  after(() => {
    if (fs.existsSync(TEMP_ROOT)) {
      try {
        fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
      } catch (e) {
        console.error('Failed to clean up TEMP_ROOT:', e);
      }
    }
  });

  test('1. Save Location Suggestions and Approvals', () => {
    const externalPath = path.join(TEMP_ROOT, 'external-save');

    // Add user selected location
    const addRes = addUserSelectedLocation(MOCK_GAME_ID, externalPath);
    assert.ok(addRes.success);
    assert.ok(addRes.location);
    assert.strictEqual(addRes.location.approvalState, 'Approved');

    // Verify it is in the list
    const list = getSaveLocations(MOCK_GAME_ID);
    assert.ok(list.length > 0);
    const loc = list.find(l => getCanonicalPath(l.canonicalPath) === getCanonicalPath(externalPath));
    assert.ok(loc, 'Location should be found in the list');

    // Revoke
    const revokeRes = revokeSaveLocation(loc!.id);
    assert.ok(revokeRes);
    const listAfterRevoke = getSaveLocations(MOCK_GAME_ID);
    const locAfterRevoke = listAfterRevoke.find(l => l.id === loc!.id);
    assert.strictEqual(locAfterRevoke?.approvalState, 'Revoked');

    // Re-approve
    const approveRes = approveSaveLocation(loc!.id);
    assert.ok(approveRes);
  });

  test('2. Path Approval Containment Checks', () => {
    const gameRootFile    = path.join(TEMP_ROOT, 'game', 'config.json');
    const externalFile    = path.join(TEMP_ROOT, 'external-save', 'save1.json');
    const unapprovedFile  = path.join(TEMP_ROOT, 'unapproved-save', 'save1.json');

    // Game root file is approved by default
    assert.strictEqual(isPathApproved(gameRootFile, MOCK_GAME_ID), true);

    // External approved save file is approved
    assert.strictEqual(isPathApproved(externalFile, MOCK_GAME_ID), true);

    // Unapproved file path is blocked
    assert.strictEqual(isPathApproved(unapprovedFile, MOCK_GAME_ID), false);
  });

  test('3. Discovery Engine Diffing & Confidence Scoring', () => {
    const docA = {
      format: 'json',
      path: path.join(TEMP_ROOT, 'game', 'saveA.json'),
      data: { player: { hp: 100, gold: 50 }, session: { timestamp: '2026-06-21T10:00:00Z', checksum: 'A1B2' } }
    };
    const docB = {
      format: 'json',
      path: path.join(TEMP_ROOT, 'game', 'saveB.json'),
      data: { player: { hp: 100, gold: 200 }, session: { timestamp: '2026-06-21T11:00:00Z', checksum: 'C3D4' } }
    };

    const diffs = compareSaves(docA, docB, MOCK_GAME_ID);
    assert.ok(diffs.length > 0);

    // Gold change discovered
    const goldDiff = diffs.find(d => d.path === 'player.gold');
    assert.ok(goldDiff, 'Gold diff should be found');
    assert.strictEqual(goldDiff!.oldValue, 50);
    assert.strictEqual(goldDiff!.newValue, 200);
    assert.strictEqual(goldDiff!.noiseClassification, 'gameplay');

    // Timestamp change classified as noise
    const timeDiff = diffs.find(d => d.path === 'session.timestamp');
    if (timeDiff) {
      assert.strictEqual(timeDiff.noiseClassification, 'noise');
      assert.ok(calculateScore(timeDiff) < 50, 'Timestamp should be down-ranked');
    }

    // Checksum completely blocked/suppressed
    const checksumDiff = diffs.find(d => d.path === 'session.checksum');
    if (checksumDiff) {
      assert.strictEqual(calculateScore(checksumDiff), 0);
    }
  });

  test('4. Known-Value Guided Matches & Repeated Session Boost', () => {
    const docA = {
      format: 'json',
      path: path.join(TEMP_ROOT, 'game', 'saveA.json'),
      data: { player: { hp: 100, gold: 50 } }
    };
    const docB = {
      format: 'json',
      path: path.join(TEMP_ROOT, 'game', 'saveB.json'),
      data: { player: { hp: 100, gold: 200 } }
    };

    const diffsWrong   = compareSaves(docA, docB, MOCK_GAME_ID, 999, 888);
    const goldDiffWrong = diffsWrong.find(d => d.path === 'player.gold');
    const confidenceWrong = goldDiffWrong ? goldDiffWrong.confidence : 100;

    const diffsCorrect   = compareSaves(docA, docB, MOCK_GAME_ID, 50, 200);
    const goldDiffCorrect = diffsCorrect.find(d => d.path === 'player.gold');
    const confidenceCorrect = goldDiffCorrect ? goldDiffCorrect.confidence : 0;

    assert.ok(confidenceCorrect > confidenceWrong, 'Correct known-values should boost confidence');
    assert.strictEqual(confidenceCorrect, 98);
  });

  test('4b. Discovery comparison ignores unchanged files and orders ties deterministically', () => {
    const docA = {
      format: 'json',
      path: path.join(TEMP_ROOT, 'game', 'sameA.json'),
      data: { player: { gold: 50, level: 2 } }
    };
    const docB = {
      format: 'json',
      path: path.join(TEMP_ROOT, 'game', 'sameB.json'),
      data: { player: { gold: 50, level: 2 } }
    };

    assert.deepStrictEqual(compareSaves(docA, docB), []);

    const ranked = rankDiscoveries([
      { path: 'player.zed', oldValue: 1, newValue: 2, confidence: 50, description: 'z' },
      { path: 'player.alpha', oldValue: 1, newValue: 2, confidence: 50, description: 'a' },
    ]);
    assert.deepStrictEqual(ranked.map(r => r.path), ['player.alpha', 'player.zed']);
  });

  test('4c. Discovery handles binary differences as advisory results only', () => {
    const docA = {
      format: 'binary',
      path: path.join(TEMP_ROOT, 'game', 'before.bin'),
      data: { rawBase64: Buffer.from([1, 2, 3, 4]).toString('base64'), strings: [] }
    };
    const docB = {
      format: 'binary',
      path: path.join(TEMP_ROOT, 'game', 'after.bin'),
      data: { rawBase64: Buffer.from([1, 2, 9, 4]).toString('base64'), strings: [] }
    };

    const diffs = compareSaves(docA, docB);
    assert.ok(diffs.length > 0);
    assert.ok(diffs.every(d => !('execute' in d)), 'Discovery output must not expose execution');
    assert.ok(diffs.every(d => d.risk === 'caution'), 'Binary diffs remain advisory caution items');
  });

  test('4d. Discovery rejects oversized existing files without parsing', () => {
    const largePath = path.join(TEMP_ROOT, 'game', 'large-save.json');
    fs.writeFileSync(largePath, Buffer.alloc((8 * 1024 * 1024) + 1));

    const docA = {
      format: 'json',
      path: largePath,
      data: { player: { gold: 1 } }
    };
    const docB = {
      format: 'json',
      path: path.join(TEMP_ROOT, 'game', 'normal-save.json'),
      data: { player: { gold: 2 } }
    };

    assert.deepStrictEqual(compareSaves(docA, docB), []);
  });

  test('4e. Discovery report captures hash evidence without leaking full paths', () => {
    const beforePath = path.join(TEMP_ROOT, 'game', 'report-before.json');
    const afterPath = path.join(TEMP_ROOT, 'game', 'report-after.json');
    fs.writeFileSync(beforePath, JSON.stringify({ player: { gold: 50 }, session: { checksum: 'abc' } }));
    fs.writeFileSync(afterPath, JSON.stringify({ player: { gold: 200 }, session: { checksum: 'def' } }));

    const docA = {
      format: 'json',
      path: beforePath,
      data: { player: { gold: 50 }, session: { checksum: 'abc' } }
    };
    const docB = {
      format: 'json',
      path: afterPath,
      data: { player: { gold: 200 }, session: { checksum: 'def' } }
    };

    const results = [
      ...compareSaves(docA, docB),
      {
        path: 'session.checksum',
        oldValue: 'abc',
        newValue: 'def',
        confidence: 0,
        description: 'Integrity metadata changed',
        risk: 'blocked'
      }
    ];
    const report = createDiscoveryReport(docA, docB, results, '2026-07-02T12:00:00.000Z');

    assert.strictEqual(report.comparedAt, '2026-07-02T12:00:00.000Z');
    assert.deepStrictEqual(report.files.map(file => file.fileName), ['report-before.json', 'report-after.json']);
    assert.ok(report.files.every(file => /^[a-f0-9]{64}$/.test(file.sha256 || '')), 'Report should include SHA-256 hashes');
    assert.ok(report.files.every(file => typeof file.sizeBytes === 'number'), 'Report should include file sizes');
    assert.ok(!JSON.stringify(report).includes(TEMP_ROOT), 'Report must not leak full local paths');
    assert.deepStrictEqual(report.changedPaths.map(change => change.path), ['player.gold']);
    assert.deepStrictEqual(report.unsupportedSections, ['session.checksum']);
  });

  test('4f. Discovery report serialization is deterministic for stable inputs', () => {
    const docA = {
      format: 'json',
      path: path.join(TEMP_ROOT, 'game', 'deterministic-before.json'),
      data: { player: { level: 2, gold: 50 } }
    };
    const docB = {
      format: 'json',
      path: path.join(TEMP_ROOT, 'game', 'deterministic-after.json'),
      data: { player: { level: 3, gold: 200 } }
    };

    const results = [
      { path: 'player.level', oldValue: 2, newValue: 3, confidence: 50, description: 'level changed' },
      { path: 'player.gold', oldValue: 50, newValue: 200, confidence: 50, description: 'gold changed' }
    ];

    const reportA = createDiscoveryReport(docA, docB, results, '2026-07-02T12:00:00.000Z');
    const reportB = createDiscoveryReport(docA, docB, [...results].reverse(), '2026-07-02T12:00:00.000Z');

    assert.strictEqual(JSON.stringify(reportA), JSON.stringify(reportB));
    assert.deepStrictEqual(reportA.changedPaths.map(change => change.path), ['player.gold', 'player.level']);
  });

  test('4g. Advisory comparison returns report metadata for save diff tooling', () => {
    const docA = {
      format: 'json',
      path: path.join(TEMP_ROOT, 'game', 'advisory-before.json'),
      data: { player: { gold: 50 }, session: { checksum: 'abc' } }
    };
    const docB = {
      format: 'json',
      path: path.join(TEMP_ROOT, 'game', 'advisory-after.json'),
      data: { player: { gold: 200 }, session: { checksum: 'def' } }
    };

    const advisory = compareSavesWithReport(docA, docB, MOCK_GAME_ID, 50, 200);

    assert.ok(advisory.results.length > 0);
    assert.strictEqual(advisory.report.files.length, 2);
    assert.ok(advisory.report.changedPaths.some(change => change.path === 'player.gold'));
    assert.ok(advisory.report.unsupportedSections.includes('session.checksum'));
  });

  test('5. End-to-End Save Edit & Restore Workflow', async () => {
    const saveFilePath = path.join(TEMP_ROOT, 'game', 'player_save.json');
    fs.writeFileSync(saveFilePath, JSON.stringify({ player: { hp: 100, gold: 150 } }));

    // Create Recipe
    const recipe = createRecipe({
      gameId: MOCK_GAME_ID,
      name: 'Max Gold',
      category: 'PLAYER',
      source: 'SAVE',
      target: saveFilePath,
      path: 'player.gold',
      valueType: 'number',
      risk: 'Safe',
      requiresBackup: true,
      confidence: 100,
      description: 'Increases player gold'
    });
    assert.ok(recipe, 'Recipe should be created');

    // Create proposal
    const proposal = createProposalForEdit(
      MOCK_GAME_ID,
      saveFilePath,
      'player.gold',
      150,
      9999,
      recipe.id
    );
    assert.ok(proposal, 'Proposal should be created');

    // Dry Run
    const dryRunRes = await dryRunProposal(proposal);
    assert.ok(dryRunRes.success, 'Dry run should succeed');

    // Apply proposal (Creates backup and writes value atomically)
    const applyRes = await applyProposal(proposal);
    assert.ok(applyRes.success, 'Apply should succeed');

    // Verify value was modified
    const contentAfter = JSON.parse(fs.readFileSync(saveFilePath, 'utf-8'));
    assert.strictEqual(contentAfter.player.gold, 9999);

    // Verify backup exists
    const backups = getBackupsForGame(MOCK_GAME_ID);
    assert.ok(backups.length > 0, 'At least one backup should exist');
    const latestBackup = backups[0];

    // Restore backup
    const restoreRes = restoreBackupById(latestBackup.id);
    assert.ok(restoreRes, 'Restore should succeed');

    // Verify original value is restored
    const contentRestored = JSON.parse(fs.readFileSync(saveFilePath, 'utf-8'));
    assert.strictEqual(contentRestored.player.gold, 150);
  });
});

// ── Regression: two consecutive runs must not conflict ────────────────────────
describe('Discovery Suite — Consecutive-Run Isolation Regression', () => {
  const RUN2_ID   = `${Date.now()}-${Math.random().toString(36).slice(2)}-run2`;
  const TEMP2     = path.join(os.tmpdir(), `solith-discovery-${RUN2_ID}`);
  const TEMP2_DB  = path.join(TEMP2, 'test.db');
  const GAME2_ID  = `discovery-test-game-${RUN2_ID}`;

  before(async () => {
    await resetForTesting(TEMP2_DB);
    fs.mkdirSync(path.join(TEMP2, 'game'), { recursive: true });
    db.prepare(`
      INSERT OR REPLACE INTO games (id, name, path)
      VALUES (?, ?, ?)
    `).run(GAME2_ID, 'Isolation Regression Game', path.join(TEMP2, 'game'));
  });

  after(() => {
    if (fs.existsSync(TEMP2)) {
      try { fs.rmSync(TEMP2, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  test('Consecutive run: no recipe conflict from a prior run', () => {
    // If state leaked from the first describe block, GAME2_ID would be unknown
    // and this INSERT would fail (FK violation). Passing proves isolation.
    const saveFilePath = path.join(TEMP2, 'game', 'save.json');
    fs.writeFileSync(saveFilePath, JSON.stringify({ player: { gold: 100 } }));

    const recipe = createRecipe({
      gameId: GAME2_ID,
      name: 'Max Gold',
      category: 'PLAYER',
      source: 'SAVE',
      target: saveFilePath,
      path: 'player.gold',
      valueType: 'number',
      risk: 'Safe',
      requiresBackup: false,
      confidence: 100,
      description: 'Regression isolation check'
    });

    assert.ok(recipe, 'Recipe should be created without conflict from a previous run');
    assert.ok(recipe.gameId === GAME2_ID, 'Recipe should belong to the isolated game');

    // Also confirm no data from the first describe block bleeds in
    const locations = getSaveLocations(GAME2_ID);
    assert.strictEqual(locations.length, 0, 'Fresh DB should have no pre-existing save locations');
  });
});
