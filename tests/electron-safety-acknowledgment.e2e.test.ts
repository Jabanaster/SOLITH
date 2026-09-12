/**
 * tests/electron-safety-acknowledgment.e2e.test.ts
 *
 * Core Product Completion, BLOCKER-01 — Offline Safety Acknowledgment
 * real-Electron fixture coverage. Uses fully isolated, synthetic userData
 * directories — never the owner's real profile. Sets
 * SOLITH_TEST_FORCE_SAFETY_ACK=1 so the real evaluator runs instead of the
 * test-environment bypass every other Electron fixture test relies on.
 *
 * Run with: npx playwright test tests/electron-safety-acknowledgment.e2e.test.ts --config playwright.e2e.config.ts
 */
import { test, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';
import type { ElectronApplication, Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import os from 'os';

const ROOT = path.resolve(import.meta.dirname ?? '.', '..');
const MAIN_BUNDLE = path.join(ROOT, 'dist-electron', 'main.js');

function freshUserDataDir(label: string): string {
  const dir = path.join(os.tmpdir(), `solith-safety-ack-e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function launch(userDataDir: string): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch({
    args: [MAIN_BUNDLE],
    env: {
      ...process.env,
      ELECTRON_USER_DATA_PATH: userDataDir,
      NODE_ENV: 'test',
      SOLITH_TEST_FORCE_SAFETY_ACK: '1',
    },
  });
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  return { app, window };
}

async function seedAcknowledgment(userDataDir: string, overrides: {
  safetyAckPolicyVersion?: number;
  safetyAckAt?: number;
  safetyReminderDismissedAt?: number;
} = {}): Promise<void> {
  process.env.SOLITH_TEST_USER_DATA_PATH = userDataDir;
  process.env.ELECTRON_USER_DATA_PATH = userDataDir;
  const { initDatabase, flushPersistence, closeDatabaseSafely } = await import('../src/core/database/index.js');
  const { setSetting } = await import('../src/core/settings/index.js');
  await initDatabase();
  if (overrides.safetyAckPolicyVersion !== undefined) setSetting('safetyAckPolicyVersion', overrides.safetyAckPolicyVersion);
  if (overrides.safetyAckAt !== undefined) setSetting('safetyAckAt', overrides.safetyAckAt);
  if (overrides.safetyReminderDismissedAt !== undefined) setSetting('safetyReminderDismissedAt', overrides.safetyReminderDismissedAt);
  await flushPersistence();
  await closeDatabaseSafely();
}

const DAY_MS = 24 * 60 * 60 * 1000;

test.describe.configure({ mode: 'serial' });

// ── A/B/C — fresh profile, acknowledge, restart does not re-show ──────────

test('A: fresh profile shows the blocking acknowledgment dialog', async () => {
  const userDataDir = freshUserDataDir('fresh');
  const { app, window } = await launch(userDataDir);
  try {
    const dialog = window.getByRole('dialog', { name: 'Offline / Single-Player Use Only' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    const button = dialog.getByRole('button', { name: 'I Understand — Continue' });
    await expect(button).toBeVisible();
    // Mission 10 — accessibility: the acknowledgment button receives focus
    // on mount (keyboard users land directly on the only actionable control).
    await expect(button).toBeFocused();
    // Escape must be a genuine no-op — no dismiss path except the button.
    await window.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    // Nothing else is reachable — the app shell (sidebar) must not be present.
    await expect(window.locator('aside[aria-label="Main navigation"]')).toHaveCount(0);
  } finally {
    await app.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('B: acknowledging makes the normal app usable', async () => {
  const userDataDir = freshUserDataDir('ack');
  const { app, window } = await launch(userDataDir);
  try {
    await window.getByRole('button', { name: 'I Understand — Continue' }).click();
    await expect(window.locator('aside[aria-label="Main navigation"]')).toBeVisible({ timeout: 15_000 });
    await expect(window.getByRole('dialog', { name: 'Offline / Single-Player Use Only' })).toHaveCount(0);

    // C: restart with the SAME userData dir — acknowledgment must not return.
    await app.close();
    const relaunch = await launch(userDataDir);
    try {
      await expect(relaunch.window.locator('aside[aria-label="Main navigation"]')).toBeVisible({ timeout: 15_000 });
      await expect(relaunch.window.getByRole('dialog', { name: 'Offline / Single-Player Use Only' })).toHaveCount(0);
    } finally {
      await relaunch.app.close();
    }
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

// ── D — stale policy version re-triggers the blocking dialog ───────────────

test('D: a stale (lower) stored policy version brings the blocking dialog back', async () => {
  const userDataDir = freshUserDataDir('stale-version');
  await seedAcknowledgment(userDataDir, { safetyAckPolicyVersion: 0, safetyAckAt: Date.now() });
  const { app, window } = await launch(userDataDir);
  try {
    await expect(window.getByRole('dialog', { name: 'Offline / Single-Player Use Only' })).toBeVisible({ timeout: 15_000 });
  } finally {
    await app.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

// ── E/F — 30-day reminder ───────────────────────────────────────────────────

test('E: current policy, acknowledged <30 days ago -> no reminder banner', async () => {
  const userDataDir = freshUserDataDir('no-reminder');
  await seedAcknowledgment(userDataDir, { safetyAckPolicyVersion: 1, safetyAckAt: Date.now() - 10 * DAY_MS });
  const { app, window } = await launch(userDataDir);
  try {
    await expect(window.locator('aside[aria-label="Main navigation"]')).toBeVisible({ timeout: 15_000 });
    await expect(window.locator('.safety-reminder-banner')).toHaveCount(0);
  } finally {
    await app.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('F: current policy, acknowledged >=30 days ago -> non-blocking reminder appears without blocking the app', async () => {
  const userDataDir = freshUserDataDir('reminder-due');
  await seedAcknowledgment(userDataDir, { safetyAckPolicyVersion: 1, safetyAckAt: Date.now() - 31 * DAY_MS });
  const { app, window } = await launch(userDataDir);
  try {
    await expect(window.locator('aside[aria-label="Main navigation"]')).toBeVisible({ timeout: 15_000 });
    // Mission 10 — accessibility: role="status" (banner semantics, live-region
    // friendly) with a real accessible name, plus a named Dismiss control.
    const banner = window.getByRole('status', { name: 'Safety reminder' });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Offline / Single-Player Only');
    await expect(banner.getByRole('button', { name: 'Dismiss' })).toBeVisible();
    // Reminder is genuinely non-blocking — the rest of the app is usable underneath it.
    await window.getByRole('button', { name: 'Trainer Library' }).click();
    await expect(window.getByRole('heading', { name: 'Trainer Library' })).toBeVisible({ timeout: 15_000 });
  } finally {
    await app.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

// ── G/H — dismiss persistence ────────────────────────────────────────────

test('G: dismissing the reminder removes it and the normal UI remains usable', async () => {
  const userDataDir = freshUserDataDir('dismiss');
  await seedAcknowledgment(userDataDir, { safetyAckPolicyVersion: 1, safetyAckAt: Date.now() - 31 * DAY_MS });
  const { app, window } = await launch(userDataDir);
  try {
    const banner = window.locator('.safety-reminder-banner');
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await banner.getByRole('button', { name: 'Dismiss' }).click();
    await expect(banner).toHaveCount(0);
    await expect(window.locator('aside[aria-label="Main navigation"]')).toBeVisible();

    // H: restart — the reminder must NOT immediately reappear (interval not yet elapsed since dismissal).
    await app.close();
    const relaunch = await launch(userDataDir);
    try {
      await expect(relaunch.window.locator('aside[aria-label="Main navigation"]')).toBeVisible({ timeout: 15_000 });
      await expect(relaunch.window.locator('.safety-reminder-banner')).toHaveCount(0);
    } finally {
      await relaunch.app.close();
    }
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
