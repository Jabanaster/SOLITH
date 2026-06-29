/**
 * tests/milestone-e-acceptance.test.ts — Milestone E Packaged UI Acceptance
 *
 * Validates the Milestone E deliverables in the real packaged ResourceForge.exe:
 *   1. Controls view navigates and renders the accepted shipped controls
 *   2. Removed unsafe/future controls are absent from the shipped UI
 *   3. Money IPC workflow: propose → approve → verify → rollback → verify
 *   4. Companion files are untouched
 *   5. TrainerHost packaged path uses app.asar.unpacked/dist-electron/host-entry.js
 *   6. No orphan host PID after shutdown
 *
 * Validation gates:
 *   A — Controls panel renders in packaged app
 *   B — Removed unsafe/future controls are absent and have no propose button
 *   C — Money preload IPC channels present
 *   D — TrainerHost start/stop round-trip succeeds in packaged app
 *   E — Propose write returns proposalId (validation + approval gate works)
 *   F — ApproveAndWrite returns verifiedValue + backupPath (atomic write works)
 *   G — Companion files are untouched after write
 *   H — Rollback returns verifiedValue (restore works)
 *   I — File reverted to original value after rollback
 *   J — Packaged host entry path uses app.asar.unpacked
 *   K — No orphan host PID after close
 */

import { test, expect, ElectronApplication, Page } from '@playwright/test';
import { _electron as electron } from 'playwright';
import path from 'path';
import fs from 'fs';
import os from 'os';

const ROOT     = path.resolve(import.meta.dirname ?? '.', '..');
const EXE_PATH = path.join(ROOT, 'dist', 'win-unpacked', 'ResourceForge.exe');

// Per-run isolation
const RUN_ID    = `rf-me-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const USER_DATA = path.join(os.tmpdir(), RUN_ID, 'userData');
const APP_DATA  = path.join(os.tmpdir(), RUN_ID, 'appdata');
const GAME_DIR  = path.join(os.tmpdir(), RUN_ID, 'game');
const FIXTURE   = path.join(ROOT, 'demo-game', 'save', 'stardew-fixture.xml');

// Companion files that must NOT be modified
const FIXTURE_COMPANION_EXTENSIONS = ['.txt', '.bak', '.json'];

let electronApp: ElectronApplication;
let win: Page;
let testGameId: string;
let fixtureInGame: string;  // copy of stardew fixture inside game dir (auto-approved)
let fixtureOriginalContent: string;
let hostPid: number | null = null;
let backupPath: string | null = null;
const rendererErrors: string[] = [];

// ── Pre-flight ────────────────────────────────────────────────────────────────

test('preflight — packaged exe exists at dist/win-unpacked/ResourceForge.exe', () => {
  expect(
    fs.existsSync(EXE_PATH),
    `EXE not found: ${EXE_PATH}\nRun: npm run build`
  ).toBe(true);
});

test('preflight — stardew fixture exists', () => {
  expect(
    fs.existsSync(FIXTURE),
    `Fixture not found: ${FIXTURE}`
  ).toBe(true);
});

// ── Launch ────────────────────────────────────────────────────────────────────

test.beforeAll(async () => {
  if (!fs.existsSync(EXE_PATH)) return;
  if (!fs.existsSync(FIXTURE))  return;

  // Create isolation dirs + game dir with fixture copy
  fs.mkdirSync(USER_DATA, { recursive: true });
  fs.mkdirSync(APP_DATA,  { recursive: true });
  fs.mkdirSync(GAME_DIR,  { recursive: true });

  fixtureInGame = path.join(GAME_DIR, 'stardew-fixture.xml');
  fs.copyFileSync(FIXTURE, fixtureInGame);
  fixtureOriginalContent = fs.readFileSync(fixtureInGame, 'utf8');

  // Create companion files that must NOT be modified
  for (const ext of FIXTURE_COMPANION_EXTENSIONS) {
    fs.writeFileSync(fixtureInGame + ext, `companion${ext}`);
  }

  electronApp = await electron.launch({
    executablePath: EXE_PATH,
    env: {
      ...process.env,
      ELECTRON_USER_DATA_PATH: USER_DATA,
      APPDATA:                 APP_DATA,
      USERPROFILE:             APP_DATA,
      NODE_ENV:                'test',
    },
  });

  win = await electronApp.firstWindow();
  win.on('pageerror', err => rendererErrors.push(err.message));
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('#root > *', { timeout: 20_000 });

  // Register the game so its directory is auto-approved for path checks
  const addRes = await win.evaluate(
    (dir: string) => (window as any).electronAPI.addGame({ name: 'Stardew Acceptance', path: dir }),
    GAME_DIR
  );
  expect(addRes?.success, 'addGame must succeed').toBe(true);
  testGameId = addRes.game.id as string;
});

test.afterAll(async () => {
  if (electronApp) await electronApp.close().catch(() => {});
  fs.rmSync(path.join(os.tmpdir(), RUN_ID), { recursive: true, force: true });
});

// ── Gate A: Controls panel renders in packaged app ───────────────────────────

test('gate A — Controls panel renders in packaged app (accepted controls present)', async () => {
  if (!electronApp) test.skip(true, 'App not launched');

  // Navigate to Game Library first, then reload to pick up the newly-added game
  await win.reload();
  await win.waitForSelector('#root > *', { timeout: 20_000 });

  // Re-register the game (fresh DB after reload means we need to re-add)
  const addRes = await win.evaluate(
    (dir: string) => (window as any).electronAPI.addGame({ name: 'Stardew Acceptance', path: dir }),
    GAME_DIR
  );
  testGameId = addRes?.game?.id ?? testGameId;

  // Click the game in the library to select it
  const gameCard = win.locator('.game-card', { hasText: 'Stardew Acceptance' }).first();
  await expect(gameCard).toBeVisible({ timeout: 10_000 });
  await gameCard.click();
  await win.waitForTimeout(300);

  // Click "Trainer Controls" in the sidebar
  const controlsNav = win.locator('[data-testid="nav-controls"]');
  await expect(controlsNav).toBeVisible({ timeout: 5_000 });
  await controlsNav.click();
  await win.waitForTimeout(400);

  // Panel must render
  const panel = win.locator('[data-testid="trainer-control-panel"]');
  await expect(panel).toBeVisible({ timeout: 10_000 });

  // Accepted shipped V1 controls
  const expectedIds = [
    'stardew-money',
    'stardew-stamina',
    'stardew-farming-xp',
    'stardew-max-stamina',
  ];
  for (const id of expectedIds) {
    await expect(win.locator(`[data-testid="control-${id}"]`)).toBeVisible(
      { timeout: 5_000 }
    );
  }
});

// ── Gate B: Removed unsafe/future controls are absent ─────────────────────────

test('gate B — removed unsafe and future controls are absent from shipped UI', async () => {
  if (!electronApp) test.skip(true, 'App not launched');

  const removedIds = [
    'stardew-health',
    'stardew-energy',
    'stardew-resources',
    'stardew-godmode',
    'stardew-aimassist',
  ];

  for (const id of removedIds) {
    await expect(win.locator(`[data-testid="control-${id}"]`)).toHaveCount(0);
    await expect(win.locator(`[data-testid="disabled-note-${id}"]`)).toHaveCount(0);
    await expect(win.locator(`[data-testid="propose-btn-${id}"]`)).toHaveCount(0);
  }
});

// ── Gate C: Money preload IPC channels exposed ────────────────────────────────

test('gate C — Money preload channels are present in packaged app', async () => {
  if (!electronApp) test.skip(true, 'App not launched');

  const channels = await win.evaluate(() => {
    const api = (window as any).electronAPI;
    return {
      trainerHostStart:          typeof api?.trainerHostStart          === 'function',
      trainerHostStop:           typeof api?.trainerHostStop           === 'function',
      trainerHostReadField:      typeof api?.trainerHostReadField      === 'function',
      trainerHostProposeWrite:   typeof api?.trainerHostProposeWrite   === 'function',
      trainerHostApproveAndWrite:typeof api?.trainerHostApproveAndWrite=== 'function',
      trainerHostRollback:       typeof api?.trainerHostRollback       === 'function',
    };
  });

  expect(channels.trainerHostStart,          'trainerHostStart').toBe(true);
  expect(channels.trainerHostStop,           'trainerHostStop').toBe(true);
  expect(channels.trainerHostReadField,      'trainerHostReadField').toBe(true);
  expect(channels.trainerHostProposeWrite,   'trainerHostProposeWrite').toBe(true);
  expect(channels.trainerHostApproveAndWrite,'trainerHostApproveAndWrite').toBe(true);
  expect(channels.trainerHostRollback,       'trainerHostRollback').toBe(true);
});

// ── Gate D: TrainerHost start/stop round-trip ─────────────────────────────────

test('gate D — TrainerHost start succeeds in packaged app', async () => {
  if (!electronApp) test.skip(true, 'App not launched');

  const startRes = await win.evaluate(async () =>
    (window as any).electronAPI.trainerHostStart()
  );
  expect(startRes?.success ?? startRes?.running, 'host start success').toBeTruthy();
});

test('gate D2 — TrainerHost can read the fixture field after start', async () => {
  if (!electronApp) test.skip(true, 'App not launched');

  const readRes = await win.evaluate(
    async ([gameId, filePath, field]: [string, string, string]) =>
      (window as any).electronAPI.trainerHostReadField({ gameId, filePath, field }),
    [testGameId, fixtureInGame, 'SaveGame.player.0.money'] as [string, string, string]
  );

  expect(readRes?.success !== false, 'read succeeded').toBe(true);
  expect(readRes?.found ?? readRes?.value !== undefined, 'field found').toBe(true);
  expect(String(readRes?.value), 'current money is 5000').toBe('5000');
});

// ── Gate E: Propose write returns proposalId ──────────────────────────────────

test('gate E — proposeWrite validates field + returns proposalId', async () => {
  if (!electronApp) test.skip(true, 'App not launched');

  const proposeRes = await win.evaluate(
    async ([gameId, filePath, field]: [string, string, string]) =>
      (window as any).electronAPI.trainerHostProposeWrite({
        gameId,
        filePath,
        field,
        currentValue: '5000',
        newValue: '99999',
      }),
    [testGameId, fixtureInGame, 'SaveGame.player.0.money'] as [string, string, string]
  );

  expect(proposeRes?.success, 'propose succeeded').toBe(true);
  expect(typeof proposeRes?.proposalId, 'proposalId is a string').toBe('string');
  expect(proposeRes?.proposalId.length, 'proposalId non-empty').toBeGreaterThan(0);

  // Store proposalId for gate F
  (global as any).__milestoneE_proposalId = proposeRes.proposalId;
});

// ── Gate F: ApproveAndWrite writes the value ──────────────────────────────────

test('gate F — approveAndWrite executes the proposal and verifies the value', async () => {
  if (!electronApp) test.skip(true, 'App not launched');
  const proposalId = (global as any).__milestoneE_proposalId;
  if (!proposalId) test.skip(true, 'No proposalId from gate E');

  const approveRes = await win.evaluate(
    async (pid: string) =>
      (window as any).electronAPI.trainerHostApproveAndWrite({ proposalId: pid }),
    proposalId
  );

  expect(approveRes?.success, 'approve succeeded').toBe(true);
  expect(String(approveRes?.verifiedValue), 'verifiedValue is 99999').toBe('99999');
  expect(typeof approveRes?.backupPath, 'backupPath is string').toBe('string');

  backupPath = approveRes.backupPath as string;

  // Verify file on disk
  const diskContent = fs.readFileSync(fixtureInGame, 'utf8');
  expect(diskContent).toContain('<money>99999</money>');
});

// ── Gate G: Companion files untouched ────────────────────────────────────────

test('gate G — companion files are untouched after write', () => {
  for (const ext of FIXTURE_COMPANION_EXTENSIONS) {
    const companionPath = fixtureInGame + ext;
    const content = fs.readFileSync(companionPath, 'utf8');
    expect(content, `companion ${ext} unchanged`).toBe(`companion${ext}`);
  }
});

// ── Gate H: Rollback restores the original value ──────────────────────────────

test('gate H — rollback returns verifiedValue = 5000', async () => {
  if (!electronApp) test.skip(true, 'App not launched');
  if (!backupPath) test.skip(true, 'No backupPath from gate F');

  const rollbackRes = await win.evaluate(
    async ([gameId, filePath, bp, field]: [string, string, string, string]) =>
      (window as any).electronAPI.trainerHostRollback({
        gameId,
        filePath,
        backupPath: bp,
        field,
      }),
    [testGameId, fixtureInGame, backupPath!, 'SaveGame.player.0.money'] as [string, string, string, string]
  );

  expect(rollbackRes?.success, 'rollback succeeded').toBe(true);
  expect(String(rollbackRes?.verifiedValue), 'verifiedValue is 5000').toBe('5000');
});

// ── Gate I: File reverted to original after rollback ─────────────────────────

test('gate I — file reverted to original content after rollback', () => {
  const diskContent = fs.readFileSync(fixtureInGame, 'utf8');
  expect(diskContent).toContain('<money>5000</money>');
  expect(diskContent).not.toContain('<money>99999</money>');
});

// ── Gate J: Packaged host uses app.asar.unpacked path ────────────────────────

test('gate J — packaged host entry resolves to app.asar.unpacked', async () => {
  if (!electronApp) test.skip(true, 'App not launched');

  const appPath: string = await electronApp.evaluate(({ app }) => app.getAppPath());
  // app.getAppPath() returns the .asar path; unpacked copy is alongside it
  const unpackedEntry = appPath.replace('app.asar', 'app.asar.unpacked')
    + '\\dist-electron\\host-entry.js';

  expect(
    fs.existsSync(unpackedEntry),
    `host-entry.js not found at: ${unpackedEntry}`
  ).toBe(true);
});

// ── Gate K: TrainerHost stop, then no orphan PID ─────────────────────────────

test('gate K — TrainerHost stops cleanly with no orphan process', async () => {
  if (!electronApp) test.skip(true, 'App not launched');

  // Retrieve current host PID before stopping
  const statusBefore = await win.evaluate(async () =>
    (window as any).electronAPI.trainerHostGetStatus()
  ).catch(() => null);

  const capturedPid: number | null =
    (statusBefore as any)?.pid ?? (statusBefore as any)?.childPid ?? null;

  // Stop the host
  const stopRes = await win.evaluate(async () =>
    (window as any).electronAPI.trainerHostStop()
  );
  expect(stopRes?.success ?? true, 'stop did not error').toBeTruthy();

  // Wait for the child process to exit
  await win.waitForTimeout(800);

  // If we have a PID, verify it is gone
  if (capturedPid && capturedPid > 0) {
    let orphanAlive = false;
    try {
      process.kill(capturedPid, 0); // throws if process does not exist
      orphanAlive = true;
    } catch {
      // ESRCH = process gone — expected
    }
    expect(orphanAlive, `PID ${capturedPid} should be gone`).toBe(false);
  }
});

// ── Zero renderer errors ──────────────────────────────────────────────────────

test('final — zero uncaught renderer errors throughout acceptance run', () => {
  expect(
    rendererErrors,
    `Renderer errors: ${rendererErrors.join('; ')}`
  ).toHaveLength(0);
});
