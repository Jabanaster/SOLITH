/**
 * SOL0-P0-1 remediation proof.
 *
 * Not wired into any npm script — run directly via Playwright, same
 * convention as the other Gate 2.x packaged e2e files. Proves, in the real
 * running main process (not by source inspection), that
 * isPrivilegedConsentEnvOverrideAllowed() (electron/privileged-consent-dialog.ts)
 * — the exact predicate resolveDialogImpl() and requestPrivilegedWriteConsent()
 * both consult before honoring SOLITH_PRIVILEGED_CONSENT / SOLITH_CONSENT_TTL_MS —
 * returns the correct value across the four required cases:
 *
 *   A. unpackaged (dev bundle):            override allowed regardless of SOLITH_TEST_BUILD
 *   B. packaged, no SOLITH_TEST_BUILD:     override NOT allowed (the vulnerable case, now fixed)
 *   C. packaged, SOLITH_TEST_BUILD=1:      override allowed (existing Gate 2.x e2e suites rely on this)
 *   D. packaged, no override at all:       app launches normally on the default/real-dialog path
 *
 * No real privileged mutation or process attach is performed; the predicate
 * is queried directly via ElectronApplication.evaluate() against the real
 * built module, so no native consent dialog is ever opened and nothing can
 * hang waiting for a click.
 */
import { test, expect } from '@playwright/test';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { findRepoRoot, resolvePackagedExecutable } from '../scripts/release-artifact-utils.mjs';

const ROOT = findRepoRoot(import.meta.url);
const EXE_PATH = resolvePackagedExecutable(ROOT);
const MAIN_BUNDLE = path.join(ROOT, 'dist-electron', 'main.js');

type Ctx = { app: ElectronApplication; win: Page; userData: string; appData: string };

async function launchPackaged(tag: string, extraEnv: Record<string, string> = {}): Promise<Ctx> {
  const runId = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const userData = path.join(os.tmpdir(), `solith-sol0p01-${runId}`);
  const appData = path.join(os.tmpdir(), `solith-sol0p01-appdata-${runId}`);
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(appData, { recursive: true });
  const app = await electron.launch({
    executablePath: EXE_PATH,
    env: {
      ...process.env,
      ELECTRON_USER_DATA_PATH: userData,
      APPDATA: appData,
      USERPROFILE: appData,
      NODE_ENV: 'test',
      ...extraEnv,
    },
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('#root > *', { timeout: 20_000 });
  return { app, win, userData, appData };
}

async function launchUnpackaged(tag: string, extraEnv: Record<string, string> = {}): Promise<Ctx> {
  const runId = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const userData = path.join(os.tmpdir(), `solith-sol0p01-dev-${runId}`);
  const appData = path.join(os.tmpdir(), `solith-sol0p01-dev-appdata-${runId}`);
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(appData, { recursive: true });
  const app = await electron.launch({
    args: [MAIN_BUNDLE],
    env: {
      ...process.env,
      ELECTRON_USER_DATA_PATH: userData,
      APPDATA: appData,
      USERPROFILE: appData,
      NODE_ENV: 'test',
      ...extraEnv,
    },
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('#root > *', { timeout: 20_000 });
  return { app, win, userData, appData };
}

async function cleanup(ctx: Ctx | null): Promise<void> {
  if (!ctx) return;
  await ctx.app.close().catch(() => {});
  try { fs.rmSync(ctx.userData, { recursive: true, force: true }); } catch { /* best-effort */ }
  try { fs.rmSync(ctx.appData, { recursive: true, force: true }); } catch { /* best-effort */ }
}

async function readOverrideAllowed(app: ElectronApplication): Promise<{ isPackaged: boolean; overrideAllowed: boolean }> {
  return app.evaluate(({ app: electronApp }) => {
    const fn = (globalThis as Record<string, unknown>).__solithIsPrivilegedConsentEnvOverrideAllowed as
      | (() => boolean)
      | undefined;
    if (typeof fn !== 'function') {
      throw new Error('__solithIsPrivilegedConsentEnvOverrideAllowed hook missing — rebuild dist-electron/main.js from current source.');
    }
    return {
      isPackaged: electronApp.isPackaged,
      overrideAllowed: fn(),
    };
  });
}

test.beforeAll(() => {
  expect(fs.existsSync(EXE_PATH), `packaged exe not found at ${EXE_PATH} — run npm run build:vite && npm run build:electron && npm run dist:dir first`).toBe(true);
  expect(fs.existsSync(MAIN_BUNDLE), `dev bundle not found at ${MAIN_BUNDLE} — run npm run build:electron first`).toBe(true);
});

test('Case A — unpackaged dev/test build: env override allowed with no SOLITH_TEST_BUILD', async () => {
  let ctx: Ctx | null = null;
  try {
    ctx = await launchUnpackaged('case-a', { SOLITH_PRIVILEGED_CONSENT: 'auto-approve' });
    const result = await readOverrideAllowed(ctx.app);
    expect(result.isPackaged, 'sanity: dev bundle launch must report isPackaged=false').toBe(false);
    expect(result.overrideAllowed, 'Case A: unpackaged must allow the consent env override').toBe(true);
  } finally {
    await cleanup(ctx);
  }
});

test('Case B (SOL0-P0-1 core proof) — packaged build, no SOLITH_TEST_BUILD: env override NOT allowed', async () => {
  let ctx: Ctx | null = null;
  try {
    ctx = await launchPackaged('case-b', { SOLITH_PRIVILEGED_CONSENT: 'auto-approve', SOLITH_CONSENT_TTL_MS: '999999999' });
    const result = await readOverrideAllowed(ctx.app);
    expect(result.isPackaged, 'sanity: packaged exe launch must report isPackaged=true').toBe(true);
    expect(result.overrideAllowed, 'Case B: packaged build must NOT allow the consent env override without SOLITH_TEST_BUILD=1 — this is the SOL0-P0-1 fix').toBe(false);
  } finally {
    await cleanup(ctx);
  }
});

test('Case C — packaged build with SOLITH_TEST_BUILD=1: env override still allowed (existing Gate 2.x e2e suites depend on this)', async () => {
  let ctx: Ctx | null = null;
  try {
    ctx = await launchPackaged('case-c', { SOLITH_PRIVILEGED_CONSENT: 'auto-approve', SOLITH_TEST_BUILD: '1' });
    const result = await readOverrideAllowed(ctx.app);
    expect(result.isPackaged).toBe(true);
    expect(result.overrideAllowed, 'Case C: packaged + SOLITH_TEST_BUILD=1 must still allow the override').toBe(true);
  } finally {
    await cleanup(ctx);
  }
});

test('Case D — packaged build, no override env at all, launches normally on the default consent path', async () => {
  let ctx: Ctx | null = null;
  try {
    ctx = await launchPackaged('case-d');
    const result = await readOverrideAllowed(ctx.app);
    expect(result.isPackaged).toBe(true);
    expect(result.overrideAllowed, 'Case D: no SOLITH_TEST_BUILD set, so the override stays disallowed by default too').toBe(false);
  } finally {
    await cleanup(ctx);
  }
});
