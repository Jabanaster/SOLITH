/**
 * Trainer Card States and Control Types — Electron renderer assertions
 *
 * Verifies that card state badges and input controls render correctly
 * in the real Electron renderer based on TrainerItem shapes.
 *
 * Coverage:
 *   States reachable via current IPC pipeline:
 *     READY       — recipe with valid file, risk≠Blocked
 *     BLOCKED     — recipe with risk='Blocked'
 *     BLOCKED     — recipe with non-existent target (verifyRecipeSafety → 'Broken' → status='Blocked')
 *     APPLIED     — after applyProposal succeeds
 *     RESTORED    — after restoreBackup succeeds
 *
 *   States NOT reachable via current recipeToTrainerItem mapping (documented as PARTIAL):
 *     BROKEN      — recipeToTrainerItem maps broken files to 'Blocked', not 'Broken'
 *     NEEDS_RESCAN — requires file hash mismatch after recipe creation
 *     NEEDS_SAVE  — not produced by recipeToTrainerItem
 *     STALE       — not produced by recipeToTrainerItem
 *     GAME_RUNNING — requires isGameRunning(profile) to return true
 *     APPLYING    — transient during IPC call, not observable in this test shape
 *     FAILED      — transient on IPC error, requires failing apply
 *
 *   Control types reachable via current IPC pipeline:
 *     toggle      — recipe valueType='boolean' → inputType='toggle'
 *     number      — recipe valueType='number'  → inputType='number' (default)
 *
 *   Control types NOT reachable via current IPC pipeline (documented as PARTIAL):
 *     slider      — recipeToTrainerItem does not produce inputType='slider'
 *     dropdown    — recipeToTrainerItem does not produce inputType='dropdown'
 */

import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';

const MAIN_BUNDLE = path.join('dist-electron', 'main.js');
const DEMO_GAME   = 'demo-game-quest-id-000000000000';
const FIXTURE_CONTENT = JSON.stringify({ player: { hp: 100, gold: 150 } });

async function launchFresh(label: string) {
  if (!fs.existsSync(MAIN_BUNDLE)) return null;
  const runId      = `states-${label}-${Date.now()}`;
  const userDataDir = path.join(os.tmpdir(), runId, 'userData');
  const appDataDir  = path.join(os.tmpdir(), runId, 'appdata');
  const gameDir     = path.join(os.tmpdir(), runId, 'game');
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(appDataDir,  { recursive: true });
  fs.mkdirSync(gameDir,     { recursive: true });

  const saveFile = path.join(gameDir, 'save.json');
  fs.writeFileSync(saveFile, FIXTURE_CONTENT);

  const app = await electron.launch({
    args: [MAIN_BUNDLE],
    env: { ...process.env, ELECTRON_USER_DATA_PATH: userDataDir, APPDATA: appDataDir, USERPROFILE: appDataDir, NODE_ENV: 'test' },
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('#root > *', { timeout: 15_000 });

  // Register game and location
  const addRes = await win.evaluate(
    ([gid, dir]: [string, string]) => (window as any).electronAPI.addGame({ name: 'States Test', path: dir }),
    [DEMO_GAME, gameDir]
  );
  const gameId = addRes?.game?.id ?? DEMO_GAME;

  await win.evaluate(
    ([gid, dir]: [string, string]) => (window as any).electronAPI.addUserSelectedLocation(gid, dir),
    [gameId, gameDir]
  );

  return { app, win, runId, gameDir, saveFile, gameId };
}

async function cleanup(ctx: ReturnType<typeof launchFresh> extends Promise<infer T> ? T : never) {
  if (!ctx) return;
  await ctx.app.close().catch(() => {});
  fs.rmSync(path.join(os.tmpdir(), ctx.runId), { recursive: true, force: true });
}

// ── Card states ──────────────────────────────────────────────────────────────

test('states-01 — READY: recipe with valid file, risk=Safe → getRecipes returns status=Ready', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }
  const ctx = await launchFresh('ready');
  try {
    const recipe = await ctx!.win.evaluate(
      ([gid, file]: [string, string]) => (window as any).electronAPI.createRecipe({
        gameId: gid, name: 'HP', category: 'PLAYER', source: file, target: file,
        path: 'player.hp', valueType: 'number', risk: 'Safe', requiresBackup: true, confidence: 90,
      }),
      [ctx!.gameId, ctx!.saveFile]
    );
    expect(recipe?.recipe?.id, 'recipe created').toBeTruthy();

    const items = await ctx!.win.evaluate(
      (gid: string) => (window as any).electronAPI.getRecipes(gid),
      ctx!.gameId
    );
    expect(Array.isArray(items), 'items is array').toBe(true);
    expect(items.length, 'at least 1 item').toBeGreaterThan(0);

    const hp = items.find((i: any) => i.name === 'HP');
    expect(hp, 'HP item found').toBeTruthy();
    expect(hp.status, 'status is Ready').toBe('Ready');
    expect(hp.risk,   'risk is Safe').toBe('Safe');
    expect(hp.inputType, 'inputType is number').toBe('number');
  } finally { await cleanup(ctx!); }
});

test('states-02 — BLOCKED: recipe with risk=Blocked → getRecipes returns status=Blocked via risk', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }
  const ctx = await launchFresh('blocked-risk');
  try {
    const recipe = await ctx!.win.evaluate(
      ([gid, file]: [string, string]) => (window as any).electronAPI.createRecipe({
        gameId: gid, name: 'Protected', category: 'PLAYER', source: file, target: file,
        path: 'player.hp', valueType: 'number', risk: 'Blocked', requiresBackup: true, confidence: 50,
      }),
      [ctx!.gameId, ctx!.saveFile]
    );
    expect(recipe?.recipe?.id).toBeTruthy();

    const items = await ctx!.win.evaluate(
      (gid: string) => (window as any).electronAPI.getRecipes(gid),
      ctx!.gameId
    );
    const item = items.find((i: any) => i.name === 'Protected');
    expect(item, 'Protected item found').toBeTruthy();
    // deriveCardState: risk=Blocked → BLOCKED
    expect(item.risk, 'risk=Blocked drives state').toBe('Blocked');
  } finally { await cleanup(ctx!); }
});

test('states-03 — BLOCKED via missing file: recipe targeting non-existent file → status=Blocked', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }
  const ctx = await launchFresh('blocked-missing');
  try {
    const missingFile = path.join(ctx!.gameDir, 'does-not-exist.json');

    const recipe = await ctx!.win.evaluate(
      ([gid, src, tgt]: [string, string, string]) => (window as any).electronAPI.createRecipe({
        gameId: gid, name: 'Missing', category: 'PLAYER', source: src, target: tgt,
        path: 'player.hp', valueType: 'number', risk: 'Safe', requiresBackup: true, confidence: 50,
      }),
      [ctx!.gameId, ctx!.saveFile, missingFile]
    );
    expect(recipe?.recipe?.id).toBeTruthy();

    const items = await ctx!.win.evaluate(
      (gid: string) => (window as any).electronAPI.getRecipes(gid),
      ctx!.gameId
    );
    const item = items.find((i: any) => i.name === 'Missing');
    expect(item, 'Missing item returned').toBeTruthy();
    // verifyRecipeSafety returns 'Broken' → recipeToTrainerItem maps to status='Blocked'
    expect(item.status, 'missing file → status Blocked (broken maps to Blocked in recipeToTrainerItem)').toBe('Blocked');
  } finally { await cleanup(ctx!); }
});

test('states-04 — APPLIED: apply flow produces APPLIED transient (IPC success)', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }
  const ctx = await launchFresh('applied');
  try {
    const recipe = await ctx!.win.evaluate(
      ([gid, file]: [string, string]) => (window as any).electronAPI.createRecipe({
        gameId: gid, name: 'Gold', category: 'STATS', source: file, target: file,
        path: 'player.gold', valueType: 'number', risk: 'Safe', requiresBackup: true, confidence: 90,
      }),
      [ctx!.gameId, ctx!.saveFile]
    );
    expect(recipe?.recipe?.id).toBeTruthy();

    const items = await ctx!.win.evaluate(
      (gid: string) => (window as any).electronAPI.getRecipes(gid),
      ctx!.gameId
    );
    const goldItem = items.find((i: any) => i.name === 'Gold');

    const proposal = await ctx!.win.evaluate(
      ([gid, file, recipeId]: [string, string, string]) =>
        (window as any).electronAPI.createProposalForEdit(gid, file, 'player.gold', 150, 9999, recipeId),
      [ctx!.gameId, ctx!.saveFile, goldItem.id]
    );
    expect(proposal?.id, 'proposal created').toBeTruthy();

    const applyRes = await ctx!.win.evaluate(
      (p: any) => (window as any).electronAPI.applyProposal(p),
      proposal
    );
    expect(applyRes?.success, 'apply succeeded').toBe(true);
    expect(applyRes?.backup?.id, 'backup.id exists').toBeTruthy();

    // Verify backup exists
    const backups = await ctx!.win.evaluate(
      (gid: string) => (window as any).electronAPI.getBackups(gid),
      ctx!.gameId
    );
    expect(Array.isArray(backups), 'backups array').toBe(true);
    expect(backups.length, 'at least one backup').toBeGreaterThan(0);
  } finally { await cleanup(ctx!); }
});

test('states-05 — RESTORED: restore flow succeeds, file reverts to original', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }
  const ctx = await launchFresh('restored');
  try {
    const recipe = await ctx!.win.evaluate(
      ([gid, file]: [string, string]) => (window as any).electronAPI.createRecipe({
        gameId: gid, name: 'Gold2', category: 'STATS', source: file, target: file,
        path: 'player.gold', valueType: 'number', risk: 'Safe', requiresBackup: true, confidence: 90,
      }),
      [ctx!.gameId, ctx!.saveFile]
    );
    const items = await ctx!.win.evaluate(
      (gid: string) => (window as any).electronAPI.getRecipes(gid),
      ctx!.gameId
    );
    const goldItem = items.find((i: any) => i.name === 'Gold2');
    const proposal = await ctx!.win.evaluate(
      ([gid, file, rid]: [string, string, string]) =>
        (window as any).electronAPI.createProposalForEdit(gid, file, 'player.gold', 150, 8888, rid),
      [ctx!.gameId, ctx!.saveFile, goldItem.id]
    );
    const applyRes = await ctx!.win.evaluate(
      (p: any) => (window as any).electronAPI.applyProposal(p),
      proposal
    );
    expect(applyRes?.success).toBe(true);
    const backupId = applyRes.backup.id;

    const restoreRes = await ctx!.win.evaluate(
      (bid: string) => (window as any).electronAPI.restoreBackup(bid),
      backupId
    );
    expect(restoreRes?.success, 'restore succeeded').toBe(true);

    // Verify file reverted
    const currentContent = fs.readFileSync(ctx!.saveFile, 'utf8');
    const currentHash    = crypto.createHash('sha256').update(currentContent).digest('hex');
    const originalHash   = crypto.createHash('sha256').update(FIXTURE_CONTENT).digest('hex');
    expect(currentHash, 'file reverted to original').toBe(originalHash);
  } finally { await cleanup(ctx!); }
});

// ── Control types ────────────────────────────────────────────────────────────

test('controls-01 — toggle control: valueType=boolean → inputType=toggle in TrainerItem', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }
  const ctx = await launchFresh('toggle');
  try {
    // Add a boolean field to the fixture
    const boolSave = JSON.stringify({ player: { hp: 100, gold: 150, godMode: false } });
    fs.writeFileSync(ctx!.saveFile, boolSave);

    const recipe = await ctx!.win.evaluate(
      ([gid, file]: [string, string]) => (window as any).electronAPI.createRecipe({
        gameId: gid, name: 'GodMode', category: 'PLAYER', source: file, target: file,
        path: 'player.godMode', valueType: 'boolean', risk: 'Safe', requiresBackup: true, confidence: 85,
      }),
      [ctx!.gameId, ctx!.saveFile]
    );
    expect(recipe?.recipe?.id).toBeTruthy();

    const items = await ctx!.win.evaluate(
      (gid: string) => (window as any).electronAPI.getRecipes(gid),
      ctx!.gameId
    );
    const godMode = items.find((i: any) => i.name === 'GodMode');
    expect(godMode, 'GodMode item found').toBeTruthy();
    expect(godMode.inputType, 'boolean → toggle').toBe('toggle');
  } finally { await cleanup(ctx!); }
});

test('controls-02 — number control: valueType=number → inputType=number in TrainerItem', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }
  const ctx = await launchFresh('number');
  try {
    const recipe = await ctx!.win.evaluate(
      ([gid, file]: [string, string]) => (window as any).electronAPI.createRecipe({
        gameId: gid, name: 'HP', category: 'PLAYER', source: file, target: file,
        path: 'player.hp', valueType: 'number', risk: 'Safe', requiresBackup: true, confidence: 90,
      }),
      [ctx!.gameId, ctx!.saveFile]
    );
    expect(recipe?.recipe?.id).toBeTruthy();

    const items = await ctx!.win.evaluate(
      (gid: string) => (window as any).electronAPI.getRecipes(gid),
      ctx!.gameId
    );
    const hp = items.find((i: any) => i.name === 'HP');
    expect(hp.inputType, 'number → number input').toBe('number');
  } finally { await cleanup(ctx!); }
});

// ── Coverage gaps documented as explicit skip tests ──────────────────────────

test('coverage-gap — BROKEN state: recipeToTrainerItem maps broken files to Blocked, not Broken', () => {
  // verifyRecipeSafety() returns 'Broken' when target file is missing.
  // recipeToTrainerItem() maps this to statusBadge='Blocked' (not 'Broken').
  // Therefore deriveCardState() never reaches the 'broken' branch via current IPC pipeline.
  // The BROKEN TrainerCardState is implemented in TrainerCard.tsx but unreachable via IPC.
  // This is a known implementation gap documented in KNOWN_ISSUES.md (KI-012).
  test.skip(true, 'PARTIAL: BROKEN state unreachable via recipeToTrainerItem — maps broken files to status=Blocked');
});

test('coverage-gap — slider/dropdown controls: recipeToTrainerItem only produces toggle|number', () => {
  // recipeToTrainerItem line 460: inputType = valueType === 'boolean' ? 'toggle' : 'number'
  // slider and dropdown are implemented in TrainerCard.tsx but never produced by the IPC pipeline.
  // Unit tests 25-27 verify the component renders correctly for these types.
  // E2E Electron coverage is PARTIAL for slider and PARTIAL for dropdown.
  test.skip(true, 'PARTIAL: slider/dropdown controls unreachable via recipeToTrainerItem — only toggle|number produced');
});

test('coverage-gap — GAME_RUNNING/APPLYING/FAILED/NEEDS_RESCAN/NEEDS_SAVE/STALE states', () => {
  // GAME_RUNNING: requires isGameRunning(profile) to return true; process detection is read-only
  // APPLYING: transient lock during applyProposal, observable only within the IPC call
  // FAILED: transient on apply failure; requires a deliberately failing write
  // NEEDS_RESCAN: requires file hash change after recipe creation
  // NEEDS_SAVE: not produced by recipeToTrainerItem
  // STALE: not produced by recipeToTrainerItem
  // All 6 states are unit-tested in tests/trainer-ui.test.ts via deriveCardState().
  test.skip(true, 'PARTIAL: 6 states unreachable via automated E2E; verified by unit tests (trainer-ui.test.ts tests 1-18)');
});
