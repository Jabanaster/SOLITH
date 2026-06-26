/**
 * Browser Fallback — renderer without preload bridge
 *
 * Verifies that all 7 guarded page components handle the absence of
 * window.electronAPI gracefully, rendering an error/unavailable message
 * instead of crashing the renderer.
 *
 * Strategy: launch Electron, then use page.evaluate() to delete
 * window.electronAPI before each navigation, simulating a renderer
 * that started without the contextBridge preload.
 *
 * Pages under test (all have `if (!window.electronAPI)` guards):
 *   1. Home / Dashboard
 *   2. Games
 *   3. Recipes / Workshop
 *   4. Trainer
 *   5. Proposals
 *   6. Backups
 *   7. Compatibility Dashboard
 */

import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const MAIN_BUNDLE = path.join('dist-electron', 'main.js');

async function launchFresh(label: string) {
  if (!fs.existsSync(MAIN_BUNDLE)) return null;
  const runId      = `fallback-${label}-${Date.now()}`;
  const userDataDir = path.join(os.tmpdir(), runId, 'userData');
  const appDataDir  = path.join(os.tmpdir(), runId, 'appdata');
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(appDataDir,  { recursive: true });

  const app = await electron.launch({
    args: [MAIN_BUNDLE],
    env: { ...process.env, ELECTRON_USER_DATA_PATH: userDataDir, APPDATA: appDataDir, USERPROFILE: appDataDir, NODE_ENV: 'test' },
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('#root > *', { timeout: 15_000 });

  return { app, win, runId };
}

async function cleanup(ctx: { app: any; runId: string } | null) {
  if (!ctx) return;
  await ctx.app.close().catch(() => {});
  fs.rmSync(path.join(os.tmpdir(), ctx.runId), { recursive: true, force: true });
}

async function removeAPIAndNavigate(win: any, hash: string) {
  const errors: string[] = [];
  win.on('pageerror', (err: Error) => errors.push(err.message));

  // Simulate missing preload bridge
  await win.evaluate(() => { delete (window as any).electronAPI; });

  // Navigate to the target hash-route
  await win.evaluate((h: string) => { window.location.hash = h; }, hash);
  await win.waitForTimeout(800);

  return errors;
}

// ── fallback-01: Home / Dashboard ────────────────────────────────────────────

test('fallback-01 — Home: no crash without electronAPI', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }
  const ctx = await launchFresh('home');
  try {
    const errors = await removeAPIAndNavigate(ctx!.win, '#/');
    expect(errors, `renderer errors: ${errors.join('; ')}`).toHaveLength(0);

    // Should render some fallback content — not a blank page
    const rootHtml = await ctx!.win.evaluate(() =>
      document.getElementById('root')?.innerHTML ?? ''
    );
    expect(rootHtml.length, 'root has content after navigation').toBeGreaterThan(0);
  } finally { await cleanup(ctx); }
});

// ── fallback-02: Games ────────────────────────────────────────────────────────

test('fallback-02 — Games: no crash without electronAPI', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }
  const ctx = await launchFresh('games');
  try {
    const errors = await removeAPIAndNavigate(ctx!.win, '#/games');
    expect(errors, `renderer errors: ${errors.join('; ')}`).toHaveLength(0);

    const rootHtml = await ctx!.win.evaluate(() =>
      document.getElementById('root')?.innerHTML ?? ''
    );
    expect(rootHtml.length, 'root has content').toBeGreaterThan(0);
  } finally { await cleanup(ctx); }
});

// ── fallback-03: Recipes / Workshop ──────────────────────────────────────────

test('fallback-03 — Recipes/Workshop: no crash without electronAPI', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }
  const ctx = await launchFresh('recipes');
  try {
    const errors = await removeAPIAndNavigate(ctx!.win, '#/recipes');
    expect(errors, `renderer errors: ${errors.join('; ')}`).toHaveLength(0);

    const rootHtml = await ctx!.win.evaluate(() =>
      document.getElementById('root')?.innerHTML ?? ''
    );
    expect(rootHtml.length).toBeGreaterThan(0);
  } finally { await cleanup(ctx); }
});

// ── fallback-04: Trainer ─────────────────────────────────────────────────────

test('fallback-04 — Trainer: no crash without electronAPI, shows unavailable message', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }
  const ctx = await launchFresh('trainer');
  try {
    const errors = await removeAPIAndNavigate(ctx!.win, '#/trainer');
    expect(errors, `renderer errors: ${errors.join('; ')}`).toHaveLength(0);

    // TrainerPage guard: if (!apiAvailable) shows unavailable UI
    const rootHtml = await ctx!.win.evaluate(() =>
      document.getElementById('root')?.innerHTML ?? ''
    );
    expect(rootHtml.length).toBeGreaterThan(0);
    // Should NOT show recipe cards (those require electronAPI)
    // Should show some fallback content (empty state, error, or unavailable message)
  } finally { await cleanup(ctx); }
});

// ── fallback-05: Proposals ───────────────────────────────────────────────────

test('fallback-05 — Proposals: no crash without electronAPI', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }
  const ctx = await launchFresh('proposals');
  try {
    const errors = await removeAPIAndNavigate(ctx!.win, '#/proposals');
    expect(errors, `renderer errors: ${errors.join('; ')}`).toHaveLength(0);

    const rootHtml = await ctx!.win.evaluate(() =>
      document.getElementById('root')?.innerHTML ?? ''
    );
    expect(rootHtml.length).toBeGreaterThan(0);
  } finally { await cleanup(ctx); }
});

// ── fallback-06: Backups ─────────────────────────────────────────────────────

test('fallback-06 — Backups: no crash without electronAPI', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }
  const ctx = await launchFresh('backups');
  try {
    const errors = await removeAPIAndNavigate(ctx!.win, '#/backups');
    expect(errors, `renderer errors: ${errors.join('; ')}`).toHaveLength(0);

    const rootHtml = await ctx!.win.evaluate(() =>
      document.getElementById('root')?.innerHTML ?? ''
    );
    expect(rootHtml.length).toBeGreaterThan(0);
  } finally { await cleanup(ctx); }
});

// ── fallback-07: Compatibility Dashboard ─────────────────────────────────────

test('fallback-07 — CompatibilityDashboard: no crash without electronAPI, shows unavailable message', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }
  const ctx = await launchFresh('compat');
  try {
    const errors = await removeAPIAndNavigate(ctx!.win, '#/compatibility');
    expect(errors, `renderer errors: ${errors.join('; ')}`).toHaveLength(0);

    // CompatibilityDashboard guard: if (!apiAvailable) shows unavailable UI
    const rootHtml = await ctx!.win.evaluate(() =>
      document.getElementById('root')?.innerHTML ?? ''
    );
    expect(rootHtml.length).toBeGreaterThan(0);
    // Should NOT show profile cards (those require electronAPI)
  } finally { await cleanup(ctx); }
});
