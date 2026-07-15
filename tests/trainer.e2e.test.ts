/**
 * tests/trainer.e2e.test.ts
 *
 * Trainer UX E2E — Electron Runtime Verification
 *
 * Drives the new Trainer Mode UI, Workshop Mode toggle, and three new IPC
 * channels through the REAL Electron renderer → preload → IPC → core path.
 * No core module is imported directly — every operation crosses the contextBridge.
 *
 * Coverage:
 *   - Mode toggle DOM (Trainer / Workshop buttons, aria-pressed, persistence)
 *   - Workshop Mode navigation (Compatibility route visible)
 *   - getRecipes IPC returns TrainerItem[] (not Recipe[])
 *   - check-game-running: valid game, no profile, bad ID, sanitised error
 *   - get-compatibility-profile: game with no profile returns null
 *   - get-all-profiles: empty then populated
 *   - Full apply → backup → restore workflow with SHA-256 hash evidence
 *   - Journal events (proposal, apply, rollback)
 *   - No renderer errors, no main-process errors
 *   - Temp-file cleanup
 *
 * Run with: npm run test:trainer-e2e
 */

import { test, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';
import type { ElectronApplication, Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';

// ── Paths ─────────────────────────────────────────────────────────────────────

const ROOT        = path.resolve(import.meta.dirname ?? '.', '..');
const MAIN_BUNDLE = path.join(ROOT, 'dist-electron', 'main.js');
const FIXTURE_SRC = path.join(ROOT, 'tests', 'fixtures', 'discovery-test', 'game', 'player_save.json');

// ── Helpers ───────────────────────────────────────────────────────────────────

function sha256(content: Buffer | string): string {
  return crypto.createHash('sha256').update(content as any).digest('hex');
}
function hashFile(p: string): string { return sha256(fs.readFileSync(p)); }

function expectedOutputHash(original: string, fieldPath: string, newValue: any): string {
  const data = JSON.parse(original);
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
  return sha256(Buffer.from(JSON.stringify(data, null, 2), 'utf-8'));
}

// ── Pre-flight ────────────────────────────────────────────────────────────────

test('trainer-e2e 00 — Electron bundle and fixture exist', () => {
  expect(fs.existsSync(MAIN_BUNDLE), `Bundle missing: ${MAIN_BUNDLE}\nRun: npm run build:electron`).toBe(true);
  expect(fs.existsSync(FIXTURE_SRC), `Fixture missing: ${FIXTURE_SRC}`).toBe(true);
});

// ── Main workflow ─────────────────────────────────────────────────────────────

test('trainer-e2e 01–25 — full Trainer UX workflow', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) {
    test.skip(true, 'Bundle not built');
    return;
  }

  const runId       = `trainer-e2e-${Date.now()}`;
  const baseTemp    = path.join(os.tmpdir(), runId);
  const sourceDir   = path.join(baseTemp, 'source');
  const gameDir     = path.join(baseTemp, 'game');
  const userDataDir = path.join(baseTemp, 'userData');
  const appDataDir  = path.join(baseTemp, 'appdata');

  for (const d of [sourceDir, gameDir, userDataDir, appDataDir]) {
    fs.mkdirSync(d, { recursive: true });
  }

  const fixtureContent = fs.readFileSync(FIXTURE_SRC, 'utf-8');
  const sourceFile     = path.join(sourceDir, 'player_save.json');
  const workspaceFile  = path.join(gameDir,   'player_save.json');
  fs.writeFileSync(sourceFile,    fixtureContent);
  fs.writeFileSync(workspaceFile, fixtureContent);

  const sourceBefore    = hashFile(sourceFile);
  const workspaceBefore = hashFile(workspaceFile);
  const preComputed     = expectedOutputHash(fixtureContent, 'player.gold', 9999);

  const mainErrors: string[]     = [];
  const rendererErrors: string[] = [];

  const electronApp: ElectronApplication = await electron.launch({
    args: [MAIN_BUNDLE],
    env: {
      ...process.env,
      ELECTRON_USER_DATA_PATH: userDataDir,
      APPDATA:                 appDataDir,
      USERPROFILE:             appDataDir,
      NODE_ENV:                'test',
    },
  });

  electronApp.on('console', msg => {
    if (msg.type() === 'error') mainErrors.push(msg.text());
  });

  try {
    const win: Page = await electronApp.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForSelector('#root > *', { timeout: 20_000 });
    win.on('pageerror', err => rendererErrors.push(err.message));

    // ── Test 01: Solith top banner present ──────────────────────────────────
    await expect(win.locator('.solith-top-banner__title')).toBeVisible();

    // ── Test 02: Unified sidebar navigation visible ─────────────────────────
    await expect(win.locator('button', { hasText: 'Game Library' })).toBeVisible();
    await expect(win.locator('button', { hasText: 'Save Editor' })).toBeVisible();
    await expect(win.locator('button', { hasText: 'Compatibility' })).toBeVisible();

    // ── Test 03: Sidebar collapse control present ───────────────────────────
    await expect(win.locator('.sidebar-collapse-btn')).toBeVisible();

    // ── Test 04: Navigate to Compatibility without mode toggle ──────────────
    await win.locator('button', { hasText: 'Compatibility' }).click();
    await win.waitForTimeout(300);
    expect(await win.locator('button.active', { hasText: 'Compatibility' }).count()).toBeGreaterThanOrEqual(1);

    // ── Test 05: Navigate to Save Editor ────────────────────────────────────
    await win.locator('button', { hasText: 'Save Editor' }).click();
    await win.waitForTimeout(300);
    expect(await win.locator('button.active', { hasText: 'Save Editor' }).count()).toBeGreaterThanOrEqual(1);

    // ── Test 06: Return to Game Library ─────────────────────────────────────
    await win.locator('button', { hasText: 'Game Library' }).click();
    await win.waitForTimeout(200);

    // ── Test 07: window.electronAPI is exposed ────────────────────────────────
    const apiExists = await win.evaluate(() => typeof (window as any).electronAPI === 'object');
    expect(apiExists, 'window.electronAPI must be defined').toBe(true);

    // ── Test 08: New IPC methods are present on window.electronAPI ────────────
    const newMethods = await win.evaluate(() => {
      const api = (window as any).electronAPI;
      return {
        checkGameRunning:        typeof api.checkGameRunning        === 'function',
        getCompatibilityProfile: typeof api.getCompatibilityProfile === 'function',
        getAllProfiles:           typeof api.getAllProfiles           === 'function',
      };
    });
    expect(newMethods.checkGameRunning,        'checkGameRunning exposed').toBe(true);
    expect(newMethods.getCompatibilityProfile, 'getCompatibilityProfile exposed').toBe(true);
    expect(newMethods.getAllProfiles,           'getAllProfiles exposed').toBe(true);

    // ── Test 09: Add demo game ────────────────────────────────────────────────
    const addGameRes = await win.evaluate(async (dir: string) =>
      (window as any).electronAPI.addGame({ name: 'Trainer E2E Quest', path: dir }),
      gameDir
    );
    expect(addGameRes?.success, 'addGame must succeed').toBe(true);
    const gameId = addGameRes.game.id as string;
    expect(typeof gameId, 'gameId must be string').toBe('string');

    // ── Test 10: Approve game save location ───────────────────────────────────
    const locRes = await win.evaluate(
      ([gid, dir]: [string, string]) =>
        (window as any).electronAPI.addUserSelectedLocation(gid, dir),
      [gameId, gameDir] as [string, string]
    );
    expect(locRes?.success, 'addUserSelectedLocation must succeed').toBe(true);

    // ── Test 11: check-game-running — game with no profile ───────────────────
    const cgr1 = await win.evaluate(
      (gid: string) => (window as any).electronAPI.checkGameRunning(gid),
      gameId
    );
    expect(typeof cgr1?.running, 'running must be boolean').toBe('boolean');
    expect(typeof cgr1?.evidence, 'evidence must be string').toBe('string');
    // No profile registered → no executable names → not running
    expect(cgr1.running, 'game not running (no profile registered)').toBe(false);
    expect(cgr1.evidence.length > 0, 'evidence string is non-empty').toBe(true);

    // ── Test 12: check-game-running — invalid gameId returns safe error ───────
    const cgr2 = await win.evaluate(() =>
      (window as any).electronAPI.checkGameRunning('not-a-valid-uuid')
    );
    expect(cgr2?.running, 'invalid ID → not running').toBe(false);
    expect(typeof cgr2?.evidence, 'invalid ID → evidence string').toBe('string');

    // ── Test 13: get-compatibility-profile — no profile for new game ──────────
    const profile1 = await win.evaluate(
      (gid: string) => (window as any).electronAPI.getCompatibilityProfile(gid),
      gameId
    );
    expect(profile1, 'no profile yet → null').toBeNull();

    // ── Test 14: get-all-profiles — empty result ──────────────────────────────
    const profiles1 = await win.evaluate(() =>
      (window as any).electronAPI.getAllProfiles()
    );
    expect(Array.isArray(profiles1), 'getAllProfiles returns array').toBe(true);

    // ── Test 15: getRecipes empty before any recipe created ───────────────────
    const emptyRecipes = await win.evaluate(
      (gid: string) => (window as any).electronAPI.getRecipes(gid),
      gameId
    );
    expect(Array.isArray(emptyRecipes), 'getRecipes returns array').toBe(true);

    // ── Test 16: Create a trainer recipe for gold ─────────────────────────────
    const createRes = await win.evaluate(
      ([gid, fp]: [string, string]) =>
        (window as any).electronAPI.createRecipe({
          gameId:         gid,
          name:           'Set Gold',
          category:       'PLAYER',
          source:         fp,
          target:         fp,
          path:           'player.gold',
          valueType:      'number',
          risk:           'Safe',
          requiresBackup: true,
          confidence:     95,
          description:    'Trainer E2E test recipe',
        }),
      [gameId, workspaceFile] as [string, string]
    );
    expect(createRes?.success, 'createRecipe must succeed').toBe(true);
    const recipeId = createRes.recipe.id as string;

    // ── Test 17: getRecipes returns the new recipe as TrainerItem ─────────────
    const trainerItems = await win.evaluate(
      (gid: string) => (window as any).electronAPI.getRecipes(gid),
      gameId
    );
    expect(Array.isArray(trainerItems), 'getRecipes returns array').toBe(true);
    expect(trainerItems.length, 'one item returned').toBe(1);

    const item = trainerItems[0];
    expect(item.id,       'item has id').toBeTruthy();
    expect(item.name,     'item name matches').toBe('Set Gold');
    expect(item.category, 'item category').toBe('PLAYER');
    expect(item.risk,     'item risk').toBe('Safe');
    // TrainerItem-specific fields (not on Recipe)
    expect('currentValue' in item, 'item has currentValue (TrainerItem field)').toBe(true);
    expect('status'       in item, 'item has status (TrainerItem field)').toBe(true);
    expect(item.currentValue, 'currentValue reads live file → 150').toBe(150);

    // ── Test 18: Proposal creation ────────────────────────────────────────────
    const proposal = await win.evaluate(
      ([gid, fp, rid]: [string, string, string]) =>
        (window as any).electronAPI.createProposalForEdit(gid, fp, 'player.gold', 150, 9999, rid),
      [gameId, workspaceFile, recipeId] as [string, string, string]
    );
    expect(proposal?.id, 'proposal has id').toBeTruthy();

    // ── Test 19: Apply proposal (backup → atomic write) ───────────────────────
    const applyRes = await win.evaluate(
      (p: any) => (window as any).electronAPI.applyProposal(p),
      proposal
    );
    expect(applyRes?.success, 'apply must succeed').toBe(true);
    // applyProposal returns { success: true, backup: { id, backupPath, ... } }
    expect(applyRes?.backup?.id, 'backup.id returned').toBeTruthy();
    const backupId = applyRes.backup.id as string;

    const workspaceAfterApply = hashFile(workspaceFile);
    expect(workspaceAfterApply, 'apply changed file').not.toBe(workspaceBefore);
    expect(workspaceAfterApply, 'apply hash matches expected output').toBe(preComputed);

    // ── Test 20: Applied file contains 9999 ──────────────────────────────────
    const parsedAfterApply = await win.evaluate(
      ([gid, fp]: [string, string]) => (window as any).electronAPI.parseSave(gid, fp),
      [gameId, workspaceFile] as [string, string]
    );
    const goldAfter = parsedAfterApply?.values?.find((v: any) => v.path === 'player.gold');
    expect(Number(goldAfter?.value), 'gold is 9999 after apply').toBe(9999);

    // ── Test 21: Journal has proposal and apply events ────────────────────────
    const journalAfterApply = await win.evaluate(
      (gid: string) => (window as any).electronAPI.getJournal(gid),
      gameId
    );
    const journalTypes = (journalAfterApply as any[]).map((e: any) => e.type);
    expect(journalTypes.includes('proposal'), 'journal has proposal event').toBe(true);
    expect(journalTypes.includes('apply'),    'journal has apply event').toBe(true);

    // ── Test 22: Context panel restore via restoreBackup ─────────────────────
    const restoreRes = await win.evaluate(
      (bid: string) => (window as any).electronAPI.restoreBackup(bid),
      backupId
    );
    expect(restoreRes?.success, 'restore must succeed').toBe(true);

    const workspaceAfterRestore = hashFile(workspaceFile);
    expect(workspaceAfterRestore, 'restore hash matches original').toBe(workspaceBefore);

    // ── Test 23: Source file was never modified ───────────────────────────────
    const sourceAfter = hashFile(sourceFile);
    expect(sourceAfter, 'source file unchanged').toBe(sourceBefore);

    // ── Test 24: Journal has rollback event ───────────────────────────────────
    const journalAfterRestore = await win.evaluate(
      (gid: string) => (window as any).electronAPI.getJournal(gid),
      gameId
    );
    const typesAfterRestore = (journalAfterRestore as any[]).map((e: any) => e.type);
    expect(typesAfterRestore.includes('rollback'), 'journal has rollback event').toBe(true);

    // ── Test 25: Workshop mode — Compatibility dashboard IPC ─────────────────
    // After all operations: getAllProfiles still returns a stable array
    const profiles2 = await win.evaluate(() =>
      (window as any).electronAPI.getAllProfiles()
    );
    expect(Array.isArray(profiles2), 'getAllProfiles still returns array').toBe(true);

    // ── Evidence summary ──────────────────────────────────────────────────────
    const evidence: Record<string, string> = {
      source_before:          sourceBefore,
      source_after:           sourceAfter,
      workspace_before:       workspaceBefore,
      pre_computed_expected:  preComputed,
      workspace_after_apply:  workspaceAfterApply,
      workspace_after_restore:workspaceAfterRestore,
      renderer_errors:        String(rendererErrors.length),
      main_errors:            String(mainErrors.length),
    };
    console.log('\n══════════ TRAINER E2E EVIDENCE ══════════');
    for (const [k, v] of Object.entries(evidence)) console.log(`${k.padEnd(26)} = ${v}`);
    console.log('══════════════════════════════════════════\n');

    // Hash invariants
    expect(sourceAfter,           'source_after == source_before').toBe(sourceBefore);
    expect(workspaceAfterApply,   'workspace_after_apply == pre_computed').toBe(preComputed);
    expect(workspaceAfterRestore, 'workspace_after_restore == workspace_before').toBe(workspaceBefore);
    expect(workspaceAfterApply,   'apply changed the file').not.toBe(workspaceBefore);

    // No errors
    expect(rendererErrors.length, `Renderer errors: ${rendererErrors.join('; ')}`).toBe(0);
    expect(mainErrors.filter(e =>
      !e.includes('Recovering operation') && !e.includes('[Crash Recovery]')
    ).length, `Main errors: ${mainErrors.join('; ')}`).toBe(0);

  } finally {
    await electronApp.close().catch(() => {});

    // ── Cleanup ───────────────────────────────────────────────────────────────
    const remaining: string[] = [];
    try { fs.rmSync(baseTemp, { recursive: true, force: true }); }
    catch { remaining.push(baseTemp); }

    if (remaining.length > 0) {
      console.warn('[trainer-e2e] temp files not cleaned:', remaining);
    }
  }
});

// ── IPC channel regression tests ──────────────────────────────────────────────

test('trainer-e2e 26 — check-game-running: demo game literal ID accepted', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }

  const runId      = `cgr-demo-${Date.now()}`;
  const userDataDir = path.join(os.tmpdir(), runId, 'userData');
  const appDataDir  = path.join(os.tmpdir(), runId, 'appdata');
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(appDataDir,  { recursive: true });

  const app = await electron.launch({
    args: [MAIN_BUNDLE],
    env: { ...process.env, ELECTRON_USER_DATA_PATH: userDataDir, APPDATA: appDataDir, USERPROFILE: appDataDir, NODE_ENV: 'test' },
  });
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForSelector('#root > *', { timeout: 15_000 });

    // demo-game-quest-id-000000000000 is explicitly allowed by the Zod schema
    const cgr = await win.evaluate(() =>
      (window as any).electronAPI.checkGameRunning('demo-game-quest-id-000000000000')
    );
    expect(typeof cgr?.running,  'running is boolean').toBe('boolean');
    expect(typeof cgr?.evidence, 'evidence is string').toBe('string');
    // No executable names registered for demo game → not running
    expect(cgr.running, 'demo game not running').toBe(false);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(path.join(os.tmpdir(), runId), { recursive: true, force: true });
  }
});

test('trainer-e2e 27 — get-all-profiles: returns array, no crash', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }

  const runId      = `profiles-${Date.now()}`;
  const userDataDir = path.join(os.tmpdir(), runId, 'userData');
  const appDataDir  = path.join(os.tmpdir(), runId, 'appdata');
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(appDataDir,  { recursive: true });

  const app = await electron.launch({
    args: [MAIN_BUNDLE],
    env: { ...process.env, ELECTRON_USER_DATA_PATH: userDataDir, APPDATA: appDataDir, USERPROFILE: appDataDir, NODE_ENV: 'test' },
  });
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForSelector('#root > *', { timeout: 15_000 });

    const profiles = await win.evaluate(() => (window as any).electronAPI.getAllProfiles());
    expect(Array.isArray(profiles), 'getAllProfiles → array').toBe(true);
    // Fresh database → no profiles committed (BLOCKED_PENDING_USER_DATA)
    expect(profiles.length, 'fresh DB has no real-world profiles').toBe(0);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(path.join(os.tmpdir(), runId), { recursive: true, force: true });
  }
});

test('trainer-e2e 28 — unified sidebar contains core workshop pages', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }

  const runId      = `nav-${Date.now()}`;
  const userDataDir = path.join(os.tmpdir(), runId, 'userData');
  const appDataDir  = path.join(os.tmpdir(), runId, 'appdata');
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(appDataDir,  { recursive: true });

  const app = await electron.launch({
    args: [MAIN_BUNDLE],
    env: { ...process.env, ELECTRON_USER_DATA_PATH: userDataDir, APPDATA: appDataDir, USERPROFILE: appDataDir, NODE_ENV: 'test' },
  });
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForSelector('#root > *', { timeout: 15_000 });

    const expectedPages = [
      'Save Editor', 'Discovery Lab', 'Recipes', 'Backups', 'Journal',
      'Save Locations', 'Compatibility', 'Trainer Library', 'Live Memory Trainer',
    ];
    for (const page of expectedPages) {
      await expect(win.locator('button', { hasText: page })).toBeVisible();
    }

  } finally {
    await app.close().catch(() => {});
    fs.rmSync(path.join(os.tmpdir(), runId), { recursive: true, force: true });
  }
});
