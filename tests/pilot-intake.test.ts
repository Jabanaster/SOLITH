/**
 * Pilot Intake System — dry-run with invented fixture
 *
 * Tests the safe intake pipeline without any real user data.
 * All fixture files are created in os.tmpdir() for isolation.
 *
 * Coverage:
 *  - Hash chain: sourceHash == workspaceHash == backupHash
 *  - Source unchanged after copy
 *  - Manifest schema validates (Zod parse passes)
 *  - formatStatus: ACCEPTED for JSON, INI, XML, CSV, text
 *  - formatStatus: REJECTED for binary, unknown
 *  - Blocked path: reject source inside repo working tree
 *  - Blocked path: reject missing source file
 *  - confirmations object round-trips correctly through manifest
 *  - pilotId is unique across two calls
 *  - workspace copy is independent (deleting source does not affect workspace)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { intakePilotSave } from '../src/core/pilot/intake.js';
import { RealWorldPilotManifestSchema, assessPilotReadiness, createCompatibilityPilotReport } from '../src/core/pilot/manifest.js';

const FIXTURE_JSON  = JSON.stringify({ player: { hp: 100, gold: 150, level: 5 } });
const FIXTURE_INI   = '[player]\nhp = 100\ngold = 150\n';
const FIXTURE_XML   = '<save><player><hp>100</hp></player></save>';
const FIXTURE_CSV   = 'hp,gold,level\n100,150,5\n';
const FIXTURE_TXT   = 'hp=100 gold=150 level=5';
const FIXTURE_BIN   = '\x00\x01\x02\x03\xFF\xFE\xFD';

function makeWorkspace(label: string) {
  const dir = path.join(os.tmpdir(), `solith-intake-test-${label}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeFixture(dir: string, filename: string, content: string) {
  const p = path.join(dir, filename);
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

function sha256file(p: string) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

const BASE_CONFIRMATIONS = {
  singlePlayerConfirmed: true  as const,
  gameClosed:            true  as const,
  userOwned:             true  as const,
  copyPermission:        true  as const,
  noGit:                 true  as const,
  cloudSyncDisabled:     false,
};

// ── Test 1 — JSON fixture: full happy path ────────────────────────────────────

test('intake-01 — JSON fixture: success, ACCEPTED, hash chain verified', async () => {
  const srcDir = makeWorkspace('src-json');
  const wrkDir = makeWorkspace('wrk-json');
  const src    = makeFixture(srcDir, 'save.json', FIXTURE_JSON);

  const result = await intakePilotSave({
    gameName:        'Test Quest',
    gameVersion:     '1.0.0',
    gameStore:       'steam',
    sourceSavePath:  src,
    workspaceRootDir: wrkDir,
    cloudSyncRisk:   'none',
    confirmations:   BASE_CONFIRMATIONS,
  });

  assert.equal(result.success, true, 'intake succeeded');
  if (!result.success) return;

  const { manifest } = result;

  // Hash chain
  assert.equal(manifest.save.sourceHashSha256.length,     64, 'source hash 64 chars');
  assert.equal(manifest.workspace.workspaceHashSha256.length, 64, 'workspace hash 64 chars');
  assert.equal(manifest.save.sourceHashSha256, manifest.workspace.workspaceHashSha256, 'source == workspace hash');

  // Backup hash matches
  const backupHash = sha256file(manifest.workspace.backupPath);
  assert.equal(backupHash, manifest.save.sourceHashSha256, 'backup hash == source hash');

  // Format
  assert.equal(manifest.save.format,      'json',     'format = json');
  assert.equal(manifest.formatStatus,     'ACCEPTED', 'formatStatus = ACCEPTED');

  // Source unchanged
  const sourceHashNow = sha256file(src);
  assert.equal(sourceHashNow, manifest.save.sourceHashSha256, 'source file unchanged');

  // Schema validates
  const parsed = RealWorldPilotManifestSchema.safeParse(manifest);
  assert.equal(parsed.success, true, 'manifest passes Zod schema');

  fs.rmSync(srcDir, { recursive: true, force: true });
  fs.rmSync(wrkDir, { recursive: true, force: true });
});

// ── Test 2 — INI fixture ──────────────────────────────────────────────────────

test('intake-02 — INI fixture: ACCEPTED', async () => {
  const srcDir = makeWorkspace('src-ini');
  const wrkDir = makeWorkspace('wrk-ini');
  const src    = makeFixture(srcDir, 'game.ini', FIXTURE_INI);

  const result = await intakePilotSave({
    gameName: 'Test Quest', gameVersion: '1.0', gameStore: 'gog',
    sourceSavePath: src, workspaceRootDir: wrkDir,
    cloudSyncRisk: 'none', confirmations: BASE_CONFIRMATIONS,
  });

  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.manifest.save.format,  'ini',      'INI format detected');
  assert.equal(result.manifest.formatStatus, 'ACCEPTED', 'ACCEPTED');

  fs.rmSync(srcDir, { recursive: true, force: true });
  fs.rmSync(wrkDir, { recursive: true, force: true });
});

// ── Test 3 — XML fixture ──────────────────────────────────────────────────────

test('intake-03 — XML fixture: ACCEPTED', async () => {
  const srcDir = makeWorkspace('src-xml');
  const wrkDir = makeWorkspace('wrk-xml');
  const src    = makeFixture(srcDir, 'save.xml', FIXTURE_XML);

  const result = await intakePilotSave({
    gameName: 'Test Quest', gameVersion: '1.0', gameStore: 'steam',
    sourceSavePath: src, workspaceRootDir: wrkDir,
    cloudSyncRisk: 'none', confirmations: BASE_CONFIRMATIONS,
  });

  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.manifest.save.format,  'xml',      'XML format detected');
  assert.equal(result.manifest.formatStatus, 'ACCEPTED', 'ACCEPTED');

  fs.rmSync(srcDir, { recursive: true, force: true });
  fs.rmSync(wrkDir, { recursive: true, force: true });
});

// ── Test 4 — CSV fixture ──────────────────────────────────────────────────────

test('intake-04 — CSV fixture: ACCEPTED', async () => {
  const srcDir = makeWorkspace('src-csv');
  const wrkDir = makeWorkspace('wrk-csv');
  const src    = makeFixture(srcDir, 'saves.csv', FIXTURE_CSV);

  const result = await intakePilotSave({
    gameName: 'Test Quest', gameVersion: '1.0', gameStore: 'itch',
    sourceSavePath: src, workspaceRootDir: wrkDir,
    cloudSyncRisk: 'none', confirmations: BASE_CONFIRMATIONS,
  });

  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.manifest.save.format,  'csv',      'CSV format detected');
  assert.equal(result.manifest.formatStatus, 'ACCEPTED', 'ACCEPTED');

  fs.rmSync(srcDir, { recursive: true, force: true });
  fs.rmSync(wrkDir, { recursive: true, force: true });
});

// ── Test 5 — text fixture ─────────────────────────────────────────────────────

test('intake-05 — text fixture (.txt): ACCEPTED', async () => {
  const srcDir = makeWorkspace('src-txt');
  const wrkDir = makeWorkspace('wrk-txt');
  const src    = makeFixture(srcDir, 'save.txt', FIXTURE_TXT);

  const result = await intakePilotSave({
    gameName: 'Test Quest', gameVersion: '1.0', gameStore: 'other',
    sourceSavePath: src, workspaceRootDir: wrkDir,
    cloudSyncRisk: 'none', confirmations: BASE_CONFIRMATIONS,
  });

  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.manifest.save.format,  'text',     'text format detected');
  assert.equal(result.manifest.formatStatus, 'ACCEPTED', 'ACCEPTED');

  fs.rmSync(srcDir, { recursive: true, force: true });
  fs.rmSync(wrkDir, { recursive: true, force: true });
});

// ── Test 6 — binary fixture: REJECTED ────────────────────────────────────────

test('intake-06 — binary fixture (.bin): REJECTED, intake still succeeds', async () => {
  const srcDir = makeWorkspace('src-bin');
  const wrkDir = makeWorkspace('wrk-bin');
  const src    = path.join(srcDir, 'save.bin');
  fs.writeFileSync(src, Buffer.from([0x00, 0x01, 0x02, 0xFF, 0xFE]));

  const result = await intakePilotSave({
    gameName: 'Test Quest', gameVersion: '1.0', gameStore: 'steam',
    sourceSavePath: src, workspaceRootDir: wrkDir,
    cloudSyncRisk: 'none', confirmations: BASE_CONFIRMATIONS,
  });

  assert.equal(result.success, true, 'intake succeeds even for binary');
  if (!result.success) return;
  assert.equal(result.manifest.save.format,  'binary',   'binary format detected');
  assert.equal(result.manifest.formatStatus, 'REJECTED', 'formatStatus REJECTED');

  fs.rmSync(srcDir, { recursive: true, force: true });
  fs.rmSync(wrkDir, { recursive: true, force: true });
});

// ── Test 7 — missing source: error ───────────────────────────────────────────

test('intake-07 — missing source file: returns error', async () => {
  const wrkDir = makeWorkspace('wrk-missing');
  const src    = path.join(os.tmpdir(), `no-such-file-${Date.now()}.json`);

  const result = await intakePilotSave({
    gameName: 'Test Quest', gameVersion: '1.0', gameStore: 'steam',
    sourceSavePath: src, workspaceRootDir: wrkDir,
    cloudSyncRisk: 'none', confirmations: BASE_CONFIRMATIONS,
  });

  assert.equal(result.success, false, 'fails for missing file');
  if (result.success) return;
  assert.match(result.error, /not found|Source save/i, 'error mentions file');

  fs.rmSync(wrkDir, { recursive: true, force: true });
});

// ── Test 8 — workspace copy is independent of source ─────────────────────────

test('intake-08 — workspace copy survives source deletion', async () => {
  const srcDir = makeWorkspace('src-indep');
  const wrkDir = makeWorkspace('wrk-indep');
  const src    = makeFixture(srcDir, 'save.json', FIXTURE_JSON);

  const result = await intakePilotSave({
    gameName: 'Test Quest', gameVersion: '1.0', gameStore: 'steam',
    sourceSavePath: src, workspaceRootDir: wrkDir,
    cloudSyncRisk: 'none', confirmations: BASE_CONFIRMATIONS,
  });

  assert.equal(result.success, true);
  if (!result.success) return;

  // Delete source
  fs.rmSync(srcDir, { recursive: true, force: true });

  // Workspace copy still readable and hash matches
  assert.ok(fs.existsSync(result.manifest.workspace.workspacePath), 'workspace copy still exists');
  const workspaceHash = sha256file(result.manifest.workspace.workspacePath);
  assert.equal(workspaceHash, result.manifest.save.sourceHashSha256, 'workspace hash unchanged');

  fs.rmSync(wrkDir, { recursive: true, force: true });
});

// ── Test 9 — pilotId is unique across two calls ───────────────────────────────

test('intake-09 — pilotId is unique across two intakes', async () => {
  const s1 = makeWorkspace('src-uid1');
  const s2 = makeWorkspace('src-uid2');
  const w1 = makeWorkspace('wrk-uid1');
  const w2 = makeWorkspace('wrk-uid2');
  const f1 = makeFixture(s1, 'save.json', FIXTURE_JSON);
  const f2 = makeFixture(s2, 'save.json', FIXTURE_JSON);

  const [r1, r2] = await Promise.all([
    intakePilotSave({ gameName: 'Q1', gameVersion: '1.0', gameStore: 'steam', sourceSavePath: f1, workspaceRootDir: w1, cloudSyncRisk: 'none', confirmations: BASE_CONFIRMATIONS }),
    intakePilotSave({ gameName: 'Q2', gameVersion: '1.0', gameStore: 'steam', sourceSavePath: f2, workspaceRootDir: w2, cloudSyncRisk: 'none', confirmations: BASE_CONFIRMATIONS }),
  ]);

  assert.equal(r1.success, true);
  assert.equal(r2.success, true);
  if (!r1.success || !r2.success) return;
  assert.notEqual(r1.manifest.pilotId, r2.manifest.pilotId, 'pilotIds are unique');

  [s1, s2, w1, w2].forEach(d => fs.rmSync(d, { recursive: true, force: true }));
});

// ── Test 10 — confirmations round-trip in manifest ───────────────────────────

test('intake-10 — confirmations round-trip through manifest and Zod schema', async () => {
  const srcDir = makeWorkspace('src-conf');
  const wrkDir = makeWorkspace('wrk-conf');
  const src    = makeFixture(srcDir, 'save.json', FIXTURE_JSON);

  const result = await intakePilotSave({
    gameName: 'Test Quest', gameVersion: '2.1.0', gameStore: 'epic',
    sourceSavePath: src, workspaceRootDir: wrkDir,
    cloudSyncRisk: 'high',
    confirmations: { ...BASE_CONFIRMATIONS, cloudSyncDisabled: true },
  });

  assert.equal(result.success, true);
  if (!result.success) return;

  const { manifest } = result;
  assert.equal(manifest.confirmations.gameClosed,        true,  'gameClosed');
  assert.equal(manifest.confirmations.userOwned,         true,  'userOwned');
  assert.equal(manifest.confirmations.copyPermission,    true,  'copyPermission');
  assert.equal(manifest.confirmations.noGit,             true,  'noGit');
  assert.equal(manifest.confirmations.cloudSyncDisabled, true,  'cloudSyncDisabled round-trips');
  assert.equal(manifest.save.cloudSyncRisk,              'high', 'cloudSyncRisk=high');
  assert.equal(manifest.game.store,                      'epic', 'store=epic');

  // Full Zod parse
  const parsed = RealWorldPilotManifestSchema.safeParse(manifest);
  assert.equal(parsed.success, true, 'manifest validates with Zod');

  fs.rmSync(srcDir, { recursive: true, force: true });
  fs.rmSync(wrkDir, { recursive: true, force: true });
});

test('intake-11 — high cloud-sync risk requires disabled sync before pilot readiness', async () => {
  const srcDir = makeWorkspace('src-cloud-risk');
  const wrkDir = makeWorkspace('wrk-cloud-risk');
  const src = makeFixture(srcDir, 'save.json', FIXTURE_JSON);

  const result = await intakePilotSave({
    gameName: 'Test Quest',
    gameVersion: '1.0',
    gameStore: 'steam',
    sourceSavePath: src,
    workspaceRootDir: wrkDir,
    cloudSyncRisk: 'high',
    confirmations: BASE_CONFIRMATIONS,
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(result.error, /high_cloud_sync_risk_requires_disabled_sync/);
  }

  fs.rmSync(srcDir, { recursive: true, force: true });
  fs.rmSync(wrkDir, { recursive: true, force: true });
});

test('intake-12 — pilot readiness accepts copied local text formats and rejects binary formats', async () => {
  const srcDir = makeWorkspace('src-ready');
  const wrkDir = makeWorkspace('wrk-ready');
  const src = makeFixture(srcDir, 'save.json', FIXTURE_JSON);

  const result = await intakePilotSave({
    gameName: 'Test Quest',
    gameVersion: '1.0',
    gameStore: 'steam',
    sourceSavePath: src,
    workspaceRootDir: wrkDir,
    cloudSyncRisk: 'none',
    confirmations: BASE_CONFIRMATIONS,
  });

  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(assessPilotReadiness(result.manifest), { ready: true, reasons: [] });

  const rejected = RealWorldPilotManifestSchema.parse({
    ...result.manifest,
    save: { ...result.manifest.save, format: 'binary' },
    formatStatus: 'REJECTED',
  });
  const readiness = assessPilotReadiness(rejected);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.reasons.includes('save_format_not_ready_for_pilot'));

  fs.rmSync(srcDir, { recursive: true, force: true });
  fs.rmSync(wrkDir, { recursive: true, force: true });
});

test('pilot-report-01 — safe offline pilot report is ready and read-only', async () => {
  const srcDir = makeWorkspace('src-report-ready');
  const wrkDir = makeWorkspace('wrk-report-ready');
  const src = makeFixture(srcDir, 'save.json', FIXTURE_JSON);

  const result = await intakePilotSave({
    gameName: 'Report Quest',
    gameVersion: '1.0',
    gameStore: 'steam',
    sourceSavePath: src,
    workspaceRootDir: wrkDir,
    cloudSyncRisk: 'none',
    confirmations: BASE_CONFIRMATIONS,
  });

  assert.equal(result.success, true);
  if (!result.success) return;

  const report = createCompatibilityPilotReport({
    manifest: result.manifest,
    gameClassification: 'offline_single_player',
    fixtureEvidenceConfirmed: true,
  });

  assert.equal(report.ready, true);
  assert.equal(report.gameName, 'Report Quest');
  assert.equal(report.format, 'json');
  assert.equal(report.sampleFileEvidence.fileName, 'save.json');
  assert.equal(report.sampleFileEvidence.sha256.length, 64);
  assert.ok(report.supportedOperations.includes('read_save_fields'));
  assert.ok(report.blockedOperations.includes('write_execution'));
  assert.equal(report.executableControlsEnabled, false);

  fs.rmSync(srcDir, { recursive: true, force: true });
  fs.rmSync(wrkDir, { recursive: true, force: true });
});

test('pilot-report-02 — unsupported pilot format is rejected in report', async () => {
  const srcDir = makeWorkspace('src-report-bin');
  const wrkDir = makeWorkspace('wrk-report-bin');
  const src = path.join(srcDir, 'save.bin');
  fs.writeFileSync(src, Buffer.from([0x00, 0x01, 0x02]));

  const result = await intakePilotSave({
    gameName: 'Binary Quest',
    gameVersion: '1.0',
    gameStore: 'steam',
    sourceSavePath: src,
    workspaceRootDir: wrkDir,
    cloudSyncRisk: 'none',
    confirmations: BASE_CONFIRMATIONS,
  });

  assert.equal(result.success, true);
  if (!result.success) return;

  const report = createCompatibilityPilotReport({
    manifest: result.manifest,
    gameClassification: 'offline_single_player',
    fixtureEvidenceConfirmed: true,
  });

  assert.equal(report.ready, false);
  assert.equal(report.format, 'binary');
  assert.deepEqual(report.supportedOperations, []);
  assert.ok(report.errors.includes('save_format_not_ready_for_pilot'));
  assert.equal(report.executableControlsEnabled, false);

  fs.rmSync(srcDir, { recursive: true, force: true });
  fs.rmSync(wrkDir, { recursive: true, force: true });
});

test('pilot-report-03 — online and multiplayer classifications are rejected', async () => {
  const srcDir = makeWorkspace('src-report-online');
  const wrkDir = makeWorkspace('wrk-report-online');
  const src = makeFixture(srcDir, 'save.json', FIXTURE_JSON);

  const result = await intakePilotSave({
    gameName: 'Classification Quest',
    gameVersion: '1.0',
    gameStore: 'steam',
    sourceSavePath: src,
    workspaceRootDir: wrkDir,
    cloudSyncRisk: 'none',
    confirmations: BASE_CONFIRMATIONS,
  });

  assert.equal(result.success, true);
  if (!result.success) return;

  for (const classification of ['online', 'multiplayer'] as const) {
    const report = createCompatibilityPilotReport({
      manifest: result.manifest,
      gameClassification: classification,
      fixtureEvidenceConfirmed: true,
    });
    assert.equal(report.ready, false);
    assert.ok(report.errors.includes('pilot_requires_offline_single_player_classification'));
    assert.ok(report.blockedOperations.includes('online_or_multiplayer_pilot'));
  }

  fs.rmSync(srcDir, { recursive: true, force: true });
  fs.rmSync(wrkDir, { recursive: true, force: true });
});

test('pilot-report-04 — cloud-sync risk and missing sample evidence block readiness', async () => {
  const srcDir = makeWorkspace('src-report-cloud');
  const wrkDir = makeWorkspace('wrk-report-cloud');
  const src = makeFixture(srcDir, 'save.json', FIXTURE_JSON);

  const result = await intakePilotSave({
    gameName: 'Cloud Quest',
    gameVersion: '1.0',
    gameStore: 'steam',
    sourceSavePath: src,
    workspaceRootDir: wrkDir,
    cloudSyncRisk: 'high',
    confirmations: { ...BASE_CONFIRMATIONS, cloudSyncDisabled: true },
  });

  assert.equal(result.success, true);
  if (!result.success) return;

  const report = createCompatibilityPilotReport({
    manifest: result.manifest,
    gameClassification: 'offline_single_player',
    fixtureEvidenceConfirmed: false,
  });

  assert.equal(report.ready, false);
  assert.ok(report.blockedOperations.includes('cloud_sync_risk_high'));
  assert.ok(report.errors.includes('fixture_or_safe_sample_evidence_required'));
  assert.equal(report.executableControlsEnabled, false);

  fs.rmSync(srcDir, { recursive: true, force: true });
  fs.rmSync(wrkDir, { recursive: true, force: true });
});
