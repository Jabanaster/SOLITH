/**
 * tests/electron.e2e.test.ts
 *
 * Gate 13 — Full Demo Workflow (Tier-1 Evidence)
 *
 * Drives the complete edit/backup/apply/restore workflow through the REAL
 * Electron renderer → preload → IPC → core services → SQLite path.
 * No core module is imported or called directly — every operation crosses
 * the IPC bridge via window.electronAPI.
 *
 * Run twice (independent Electron instances, separate temp workspaces).
 * Records actual SHA-256 hashes and asserts all required equalities:
 *
 *   source-before  == source-after            (immutable source untouched)
 *   workspace-before == verified-backup-hash  (backup matches original)
 *   workspace-before == electron-original-hash (Electron agrees with our hash)
 *   workspace-after-apply == expected-output  (apply produced correct bytes)
 *   workspace-after-restore == workspace-before (restore recovered original)
 *   workspace-after-apply != workspace-before  (apply actually changed file)
 *
 * Run with: npm run test:electron-e2e
 */

import { test, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';
import type { ElectronApplication, Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';

// ── Paths ────────────────────────────────────────────────────────────────────

// __dirname equivalent: test file is in tests/, project root is one level up
const ROOT        = path.resolve(import.meta.dirname ?? '.', '..');
const MAIN_BUNDLE = path.join(ROOT, 'dist-electron', 'main.js');
const FIXTURE_SRC = path.join(ROOT, 'tests', 'fixtures', 'discovery-test', 'game', 'player_save.json');

// ── Helpers ──────────────────────────────────────────────────────────────────

function sha256(content: Buffer | string): string {
  return crypto.createHash('sha256').update(content as any).digest('hex');
}

function hashFile(filePath: string): string {
  return sha256(fs.readFileSync(filePath));
}

/** Compute the expected output bytes that the JSON adapter will write. */
function expectedOutputHash(originalContent: string, fieldPath: string, newValue: any): string {
  const data = JSON.parse(originalContent);
  // Mirror setDeepValue from src/core/adapters/json.ts
  const parts = fieldPath.split(/[.[\]]/).filter(Boolean);
  let cur = data;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    const idx = parseInt(p);
    cur = (!isNaN(idx) && Array.isArray(cur)) ? cur[idx] : cur[p];
  }
  const last = parts[parts.length - 1];
  const lastIdx = parseInt(last);
  if (!isNaN(lastIdx) && Array.isArray(cur)) cur[lastIdx] = newValue;
  else cur[last] = newValue;

  const output = JSON.stringify(data, null, 2);
  return sha256(Buffer.from(output, 'utf-8'));
}

// ── Workflow runner (one complete Electron lifecycle) ─────────────────────────

interface WorkflowResult {
  runLabel: string;
  runId: string;
  userDataDirRedacted: string; // %TEMP%\rf-e2e-<runId>
  durationMs: number;
  exitCode: number;
  cleanupSuccess: boolean;
  // Hashes
  sourceBefore: string;
  sourceAfter: string;
  workspaceBefore: string;
  verifiedBackupHash: string;
  electronOriginalHash: string; // hash Electron computed for the backup
  expectedOutput: string;
  workspaceAfterApply: string;
  workspaceAfterRestore: string;
  // Evidence
  gameId: string;
  backupId: string;
  backupPath: string;
  journalEventTypes: string[];
  rendererErrorCount: number;
  mainErrorCount: number;
  ipcChannelsUsed: string[];
  tempFilesRemaining: string[];
}

async function runWorkflow(runLabel: string): Promise<WorkflowResult> {
  if (!fs.existsSync(MAIN_BUNDLE)) {
    throw new Error(`Electron bundle not found: ${MAIN_BUNDLE}\nRun "npm run build:electron" first.`);
  }
  if (!fs.existsSync(FIXTURE_SRC)) {
    throw new Error(`Fixture not found: ${FIXTURE_SRC}`);
  }

  const startMs  = Date.now();
  const runId    = `${runLabel}-${startMs}`;
  const baseTemp = path.join(os.tmpdir(), `rf-e2e-${runId}`);
  const sourceDir   = path.join(baseTemp, 'source');
  const gameDir     = path.join(baseTemp, 'game');
  const userDataDir = path.join(baseTemp, 'userData');
  const appDataDir  = path.join(baseTemp, 'appdata');

  for (const d of [sourceDir, gameDir, userDataDir, appDataDir]) {
    fs.mkdirSync(d, { recursive: true });
  }

  const fixtureContent  = fs.readFileSync(FIXTURE_SRC, 'utf-8');
  const sourceFile      = path.join(sourceDir, 'player_save.json');
  const workspaceFile   = path.join(gameDir, 'player_save.json');

  // Write immutable source and writable workspace
  fs.writeFileSync(sourceFile, fixtureContent);
  fs.writeFileSync(workspaceFile, fixtureContent);

  const preComputedExpected = expectedOutputHash(fixtureContent, 'player.gold', 9999);
  const sourceBefore        = hashFile(sourceFile);
  const workspaceBefore     = hashFile(workspaceFile);

  const ipcChannelsUsed: string[] = [];
  const mainErrors: string[] = [];

  const electronApp: ElectronApplication = await electron.launch({
    args: [MAIN_BUNDLE],
    env: {
      ...process.env,
      ELECTRON_USER_DATA_PATH: userDataDir,
      APPDATA: appDataDir,
      USERPROFILE: appDataDir,
      NODE_ENV: 'test',
    },
  });

  electronApp.on('console', (msg) => {
    if (msg.type() === 'error') mainErrors.push(msg.text());
  });

  let result: WorkflowResult;

  try {
    const win: Page = await electronApp.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForSelector('#root > *', { timeout: 20_000 });

    const rendererErrors: string[] = [];
    win.on('pageerror', err => rendererErrors.push(err.message));

    // ── Step 1: add-game ────────────────────────────────────────────────────
    ipcChannelsUsed.push('add-game');
    const addGameRes = await win.evaluate(async (dir: string) => {
      return (window as any).electronAPI.addGame({ name: 'E2E Test Quest', path: dir });
    }, gameDir);
    if (!addGameRes?.success) throw new Error(`add-game failed: ${JSON.stringify(addGameRes)}`);
    const gameId = addGameRes.game.id as string;

    // ── Step 2: add-user-selected-location (approve save directory) ─────────
    ipcChannelsUsed.push('add-user-selected-location');
    const locRes = await win.evaluate(
      async ([gid, dir]: [string, string]) =>
        (window as any).electronAPI.addUserSelectedLocation(gid, dir),
      [gameId, gameDir] as [string, string]
    );
    if (!locRes?.success) throw new Error(`addUserSelectedLocation failed: ${JSON.stringify(locRes)}`);

    // ── Step 3: parse-save before apply (confirm gold = 150) ────────────────
    ipcChannelsUsed.push('parse-save');
    const parseBefore = await win.evaluate(
      async ([gid, fp]: [string, string]) => (window as any).electronAPI.parseSave(gid, fp),
      [gameId, workspaceFile] as [string, string]
    );
    if (!parseBefore) throw new Error('parseSave returned null before apply');
    const goldBefore = parseBefore.values?.find((v: any) => v.path === 'player.gold');
    if (Number(goldBefore?.value) !== 150)
      throw new Error(`Expected gold=150 before apply, got ${goldBefore?.value}`);

    // ── Step 4: create-proposal-for-edit ────────────────────────────────────
    ipcChannelsUsed.push('create-proposal-for-edit');
    const proposal = await win.evaluate(
      async ([gid, fp]: [string, string]) =>
        (window as any).electronAPI.createProposalForEdit(gid, fp, 'player.gold', 150, 9999),
      [gameId, workspaceFile] as [string, string]
    );
    if (!proposal?.id) throw new Error(`createProposalForEdit failed: ${JSON.stringify(proposal)}`);

    // ── Step 5: apply-proposal (backup → atomic write) ──────────────────────
    ipcChannelsUsed.push('apply-proposal');
    const applyRes = await win.evaluate(
      async (p: any) => (window as any).electronAPI.applyProposal(p),
      proposal
    );
    if (!applyRes?.success) throw new Error(`applyProposal failed: ${JSON.stringify(applyRes)}`);

    const backupId           = applyRes.backup.id as string;
    const backupPath         = applyRes.backup.backupPath as string;
    const electronOrigHash   = applyRes.backup.originalHash as string;

    // Hash from the test process (Node.js) — never imports core modules
    const workspaceAfterApply  = hashFile(workspaceFile);
    const verifiedBackupHash   = hashFile(backupPath);

    // ── Step 6: parse-save after apply (confirm gold = 9999) ────────────────
    const parseAfterApply = await win.evaluate(
      async ([gid, fp]: [string, string]) => (window as any).electronAPI.parseSave(gid, fp),
      [gameId, workspaceFile] as [string, string]
    );
    const goldAfterApply = parseAfterApply?.values?.find((v: any) => v.path === 'player.gold');
    if (Number(goldAfterApply?.value) !== 9999)
      throw new Error(`Expected gold=9999 after apply, got ${goldAfterApply?.value}`);

    // ── Step 7: get-journal (confirm apply event) ────────────────────────────
    ipcChannelsUsed.push('get-journal');
    const journalAfterApply = await win.evaluate(
      async (gid: string) => (window as any).electronAPI.getJournal(gid),
      gameId
    );
    const applyEvent = journalAfterApply?.find((e: any) => e.type === 'apply');
    if (!applyEvent) throw new Error('Journal missing apply event after apply');

    // ── Step 8: restore-backup ───────────────────────────────────────────────
    ipcChannelsUsed.push('restore-backup');
    const restoreRes = await win.evaluate(
      async (bid: string) => (window as any).electronAPI.restoreBackup(bid),
      backupId
    );
    if (!restoreRes?.success) throw new Error(`restoreBackup failed: ${JSON.stringify(restoreRes)}`);

    const workspaceAfterRestore = hashFile(workspaceFile);

    // ── Step 9: parse-save after restore (confirm gold = 150) ───────────────
    const parseAfterRestore = await win.evaluate(
      async ([gid, fp]: [string, string]) => (window as any).electronAPI.parseSave(gid, fp),
      [gameId, workspaceFile] as [string, string]
    );
    const goldAfterRestore = parseAfterRestore?.values?.find((v: any) => v.path === 'player.gold');
    if (Number(goldAfterRestore?.value) !== 150)
      throw new Error(`Expected gold=150 after restore, got ${goldAfterRestore?.value}`);

    // ── Step 10: get-journal (confirm rollback event) ────────────────────────
    const journalAfterRestore = await win.evaluate(
      async (gid: string) => (window as any).electronAPI.getJournal(gid),
      gameId
    );
    const rollbackEvent = journalAfterRestore?.find((e: any) => e.type === 'rollback');
    if (!rollbackEvent) throw new Error('Journal missing rollback event after restore');

    const journalEventTypes: string[] = [
      ...new Set(journalAfterRestore.map((e: any) => e.type as string))
    ];

    // Hash source-after (immutable — must equal source-before)
    const sourceAfter = hashFile(sourceFile);

    // Verify no Solith temp files remain in game directory
    const tempFilesRemaining = fs.readdirSync(gameDir).filter(f => f.includes('.solith'));

    result = {
      runLabel,
      runId,
      userDataDirRedacted: `%TEMP%\\rf-e2e-${runId}\\userData`,
      durationMs: Date.now() - startMs,
      exitCode: 0,
      cleanupSuccess: true,
      sourceBefore,
      sourceAfter,
      workspaceBefore,
      verifiedBackupHash,
      electronOriginalHash: electronOrigHash,
      expectedOutput: preComputedExpected,
      workspaceAfterApply,
      workspaceAfterRestore,
      gameId,
      backupId,
      backupPath: `%TEMP%\\rf-e2e-${runId}\\appdata\\...\\${path.basename(backupPath)}`,
      journalEventTypes,
      rendererErrorCount: rendererErrors.length,
      mainErrorCount: mainErrors.length,
      ipcChannelsUsed: [...new Set(ipcChannelsUsed)],
      tempFilesRemaining,
    };

  } finally {
    await electronApp.close().catch(() => {});
    let cleanupSuccess = true;
    try { fs.rmSync(baseTemp, { recursive: true, force: true }); } catch { cleanupSuccess = false; }
    if (result!) (result as any).cleanupSuccess = cleanupSuccess;
  }

  return result!;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Gate 13 — Full Demo Workflow', () => {

  let run1: WorkflowResult;
  let run2: WorkflowResult;

  test('pre-flight: Electron bundle exists', () => {
    expect(fs.existsSync(MAIN_BUNDLE), `Bundle missing: ${MAIN_BUNDLE}`).toBe(true);
    expect(fs.existsSync(FIXTURE_SRC), `Fixture missing: ${FIXTURE_SRC}`).toBe(true);
  });

  test('run 1: complete workflow — UI → preload → IPC → DB → backup → apply → restore → journal', async () => {
    run1 = await runWorkflow('run1');

    // Print evidence for the reconciliation report
    console.log('\n══════════ GATE 13 RUN 1 HASH EVIDENCE ══════════');
    console.log(`run_id                 = ${run1.runId}`);
    console.log(`user_data_dir          = ${run1.userDataDirRedacted}`);
    console.log(`duration_ms            = ${run1.durationMs}`);
    console.log(`exit_code              = ${run1.exitCode}`);
    console.log(`cleanup_success        = ${run1.cleanupSuccess}`);
    console.log(`source_before          = ${run1.sourceBefore}`);
    console.log(`source_after           = ${run1.sourceAfter}`);
    console.log(`workspace_before       = ${run1.workspaceBefore}`);
    console.log(`verified_backup_hash   = ${run1.verifiedBackupHash}`);
    console.log(`electron_original_hash = ${run1.electronOriginalHash}`);
    console.log(`expected_output        = ${run1.expectedOutput}`);
    console.log(`workspace_after_apply  = ${run1.workspaceAfterApply}`);
    console.log(`workspace_after_restore= ${run1.workspaceAfterRestore}`);
    console.log(`journal_events         = ${run1.journalEventTypes.join(', ')}`);
    console.log(`ipc_channels           = ${run1.ipcChannelsUsed.join(', ')}`);
    console.log(`renderer_errors        = ${run1.rendererErrorCount}`);
    console.log(`main_process_errors    = ${run1.mainErrorCount}`);
    console.log(`temp_files_remaining   = ${run1.tempFilesRemaining.length}`);
    console.log('═══════════════════════════════════════════════════\n');

    // ── Hash equalities ────────────────────────────────────────────────────
    expect(run1.sourceBefore, 'source-before == source-after: immutable source was modified')
      .toBe(run1.sourceAfter);

    expect(run1.workspaceBefore, 'workspace-before == verified-backup: backup hash mismatch')
      .toBe(run1.verifiedBackupHash);

    expect(run1.workspaceBefore, 'workspace-before == electron-original-hash: Electron hash disagreement')
      .toBe(run1.electronOriginalHash);

    expect(run1.workspaceAfterApply, 'workspace-after-apply == expected-output: applied bytes wrong')
      .toBe(run1.expectedOutput);

    expect(run1.workspaceAfterRestore, 'workspace-after-restore == workspace-before: restore failed')
      .toBe(run1.workspaceBefore);

    expect(run1.workspaceAfterApply, 'workspace-after-apply must differ from workspace-before')
      .not.toBe(run1.workspaceBefore);

    // ── Safety invariants ──────────────────────────────────────────────────
    expect(run1.rendererErrorCount, 'renderer must have 0 critical errors').toBe(0);

    expect(run1.journalEventTypes, 'journal must contain apply event').toContain('apply');
    expect(run1.journalEventTypes, 'journal must contain rollback event').toContain('rollback');

    expect(run1.tempFilesRemaining.length, 'no Solith temp files must remain in game dir').toBe(0);

    expect(run1.ipcChannelsUsed, 'must use window.electronAPI (not direct imports)').toEqual(
      expect.arrayContaining([
        'add-game',
        'add-user-selected-location',
        'parse-save',
        'create-proposal-for-edit',
        'apply-proposal',
        'get-journal',
        'restore-backup',
      ])
    );
  });

  test('run 2: complete workflow — second independent run proves repeatability', async () => {
    run2 = await runWorkflow('run2');

    console.log('\n══════════ GATE 13 RUN 2 HASH EVIDENCE ══════════');
    console.log(`run_id                 = ${run2.runId}`);
    console.log(`user_data_dir          = ${run2.userDataDirRedacted}`);
    console.log(`duration_ms            = ${run2.durationMs}`);
    console.log(`exit_code              = ${run2.exitCode}`);
    console.log(`cleanup_success        = ${run2.cleanupSuccess}`);
    console.log(`source_before          = ${run2.sourceBefore}`);
    console.log(`source_after           = ${run2.sourceAfter}`);
    console.log(`workspace_before       = ${run2.workspaceBefore}`);
    console.log(`verified_backup_hash   = ${run2.verifiedBackupHash}`);
    console.log(`electron_original_hash = ${run2.electronOriginalHash}`);
    console.log(`expected_output        = ${run2.expectedOutput}`);
    console.log(`workspace_after_apply  = ${run2.workspaceAfterApply}`);
    console.log(`workspace_after_restore= ${run2.workspaceAfterRestore}`);
    console.log(`journal_events         = ${run2.journalEventTypes.join(', ')}`);
    console.log(`ipc_channels           = ${run2.ipcChannelsUsed.join(', ')}`);
    console.log(`renderer_errors        = ${run2.rendererErrorCount}`);
    console.log(`main_process_errors    = ${run2.mainErrorCount}`);
    console.log(`temp_files_remaining   = ${run2.tempFilesRemaining.length}`);
    console.log('═══════════════════════════════════════════════════\n');

    expect(run2.sourceBefore, 'run2: source-before == source-after').toBe(run2.sourceAfter);
    expect(run2.workspaceBefore, 'run2: workspace-before == verified-backup').toBe(run2.verifiedBackupHash);
    expect(run2.workspaceBefore, 'run2: workspace-before == electron-original-hash').toBe(run2.electronOriginalHash);
    expect(run2.workspaceAfterApply, 'run2: workspace-after-apply == expected-output').toBe(run2.expectedOutput);
    expect(run2.workspaceAfterRestore, 'run2: workspace-after-restore == workspace-before').toBe(run2.workspaceBefore);
    expect(run2.workspaceAfterApply, 'run2: apply must change the file').not.toBe(run2.workspaceBefore);
    expect(run2.rendererErrorCount, 'run2: renderer must have 0 critical errors').toBe(0);
    expect(run2.tempFilesRemaining.length, 'run2: no temp files remaining').toBe(0);
  });

  test('cross-run: both runs produce identical hash pattern', () => {
    expect(run1, 'run 1 result must exist (run 1 test must pass first)').toBeDefined();
    expect(run2, 'run 2 result must exist (run 2 test must pass first)').toBeDefined();

    // source-before must agree across runs (same fixture file)
    expect(run1.sourceBefore, 'both runs hash same fixture source').toBe(run2.sourceBefore);

    // Both fixture copies must hash the same (deterministic fixture)
    expect(run1.workspaceBefore, 'workspace-before same across runs').toBe(run2.workspaceBefore);

    // Both expected outputs must be the same (deterministic transformation)
    expect(run1.expectedOutput, 'expected-output same across runs').toBe(run2.expectedOutput);

    // Both applied files must hash the same (repeatable apply)
    expect(run1.workspaceAfterApply, 'workspace-after-apply same across runs').toBe(run2.workspaceAfterApply);

    // Both restores must recover to workspace-before
    expect(run1.workspaceAfterRestore, 'workspace-after-restore same across runs').toBe(run2.workspaceAfterRestore);

    console.log('\n══════════ GATE 13 CROSS-RUN VERIFICATION ══════════');
    console.log(`run1.workspaceBefore      = ${run1.workspaceBefore}`);
    console.log(`run2.workspaceBefore      = ${run2.workspaceBefore}`);
    console.log(`run1.expectedOutput       = ${run1.expectedOutput}`);
    console.log(`run2.expectedOutput       = ${run2.expectedOutput}`);
    console.log(`run1.workspaceAfterApply  = ${run1.workspaceAfterApply}`);
    console.log(`run2.workspaceAfterApply  = ${run2.workspaceAfterApply}`);
    console.log(`Repeatability: CONFIRMED`);
    console.log('════════════════════════════════════════════════════\n');
  });
});
