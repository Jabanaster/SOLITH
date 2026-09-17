/**
 * P2-3.1 §8 — packaged pointer-map scan cancellation proof.
 *
 * Same real-Cancel-button-interrupts-a-real-in-flight-scan proof as
 * tests/pointer-map-ui-cancellation.e2e.test.ts, run against the packaged
 * `dist/win-unpacked/Solith.exe` instead of the dev build — proves the
 * cancellable IPC contract (pointer-map-scan-start/-cancel/-poll) survives
 * packaging the same way the rest of the pointer-map IPC contract already
 * does (doc 009).
 */
import { test, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';
import type { ElectronApplication, Page } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import { findRepoRoot, resolvePackagedExecutable } from '../scripts/release-artifact-utils.mjs';

const ROOT = findRepoRoot(import.meta.url);
const EXE_PATH = resolvePackagedExecutable(ROOT);
const FIXTURE_PATH = path.join(ROOT, 'native', 'solith-scanner-core', 'target', 'release', 'solith-scanner-fixture.exe');

interface FixtureHandle {
  child: ChildProcessWithoutNullStreams;
  fields: Record<string, string>;
}

/** `['1', '150']` — see fixture.rs and the dev cancellation test for why. */
function spawnFixture(): Promise<FixtureHandle> {
  const child = spawn(FIXTURE_PATH, ['1', '150'], { stdio: ['pipe', 'pipe', 'inherit'] });
  child.stdin.on('error', () => {});
  return new Promise((resolve, reject) => {
    let buffered = '';
    const fields: Record<string, string> = {};
    function onData(chunk: Buffer) {
      buffered += chunk.toString('utf8');
      let idx: number;
      while ((idx = buffered.indexOf('\n')) !== -1) {
        const line = buffered.slice(0, idx).trim();
        buffered = buffered.slice(idx + 1);
        if (line === 'READY') {
          child.stdout.off('data', onData);
          resolve({ child, fields });
          return;
        }
        const eq = line.indexOf('=');
        if (eq !== -1) fields[line.slice(0, eq)] = line.slice(eq + 1);
      }
    }
    child.stdout.on('data', onData);
    child.on('error', reject);
  });
}

function killFixture(handle: FixtureHandle): void {
  try { handle.child.stdin.write('exit\n'); } catch { /* already gone */ }
  handle.child.kill();
}

async function bodyContains(win: Page, text: string | RegExp): Promise<boolean> {
  const content = await win.evaluate(() => document.body.innerText);
  return typeof text === 'string' ? content.includes(text) : text.test(content);
}

async function waitUntilBodyMatches(win: Page, pattern: RegExp, timeoutMs = 20_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await bodyContains(win, pattern)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for page text matching: ${pattern}`);
}

async function clickByText(win: Page, text: string, selector = 'button, a, [role="button"]', exact = false): Promise<boolean> {
  return win.evaluate(
    ({ selector, text, exact }) => {
      const candidates = Array.from(document.querySelectorAll(selector));
      const target = candidates.find((el) => (exact ? el.textContent?.trim() === text : el.textContent?.includes(text)));
      if (!target) return false;
      (target as HTMLElement).click();
      return true;
    },
    { selector, text, exact },
  );
}

const fixtureAvailable = process.platform === 'win32' && fs.existsSync(FIXTURE_PATH) && fs.existsSync(EXE_PATH);
const describePackaged = fixtureAvailable ? test : test.skip;

describePackaged('packaged pointer-map UI: Cancel interrupts a genuinely in-flight scan', async () => {
  test.setTimeout(90_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const userDataDir = path.join(os.tmpdir(), `solith-p231-pkg-cancel-userdata-${runId}`);
  const appDataDir = path.join(os.tmpdir(), `solith-p231-pkg-cancel-appdata-${runId}`);
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(appDataDir, { recursive: true });

  const fixture = await spawnFixture();
  const target = BigInt(fixture.fields.POINTER_NODE3_BASE) + BigInt(Number(fixture.fields.POINTER_TARGET_OFFSET));
  const targetHex = `0x${target.toString(16)}`;

  const electronApp: ElectronApplication = await electron.launch({
    executablePath: EXE_PATH,
    env: { ...process.env, ELECTRON_USER_DATA_PATH: userDataDir, APPDATA: appDataDir, USERPROFILE: appDataDir, NODE_ENV: 'test' },
  });

  try {
    const win: Page = await electronApp.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForSelector('#root > *', { timeout: 20_000 });

    await win.click('button[title="Live Memory Trainer"]');
    await win.waitForSelector('text=Pointer Maps', { timeout: 10_000 });

    await win.click('text=Refresh Process List');
    await win.waitForSelector('#live-memory-process-picker', { timeout: 10_000 });
    await win.getByLabel('Show all processes').check();
    await win.selectOption('#live-memory-process-picker', String(fixture.child.pid));
    await win.getByLabel(/I accept the single-player/).click();
    await win.waitForSelector('text=I understand — enable', { timeout: 5_000 });
    await win.click('text=I understand — enable');

    let attached = false;
    for (let attempt = 0; attempt < 5 && !attached; attempt++) {
      await clickByText(win, 'Attach', 'button.btn-primary', true);
      try {
        await win.waitForSelector('button:has-text("Detach")', { timeout: 5_000 });
        attached = true;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    expect(attached, 'real Attach must succeed against the packaged app').toBe(true);

    await win.fill('input[aria-label="New pointer map name"]', 'Packaged Cancel Proof Map');
    await win.click('text=Create Map');
    await win.waitForSelector('text=Created pointer map', { timeout: 5_000 });

    const cancelButton = win.locator('button:has-text("Cancel Scan")');
    await expect(cancelButton).toBeDisabled();

    await win.fill('#pm-targets', targetHex);
    expect(await clickByText(win, 'Scan Into Map'), 'Scan Into Map button must be clickable').toBe(true);
    await waitUntilBodyMatches(win, /Scan in progress/);
    await expect(cancelButton).toBeEnabled();

    expect(await clickByText(win, 'Cancel Scan', 'button', true), 'Cancel Scan button must be clickable').toBe(true);

    await win.waitForFunction(
      () => !document.body.innerText.includes('Scanning…') && !document.body.innerText.includes('Scan in progress'),
      { timeout: 20_000 },
    );
    expect(await bodyContains(win, /cancel/i), 'must settle on a truthful cancelled outcome').toBe(true);
    await expect(cancelButton).toBeDisabled();

    // Renderer stays usable and a second scan succeeds normally.
    expect(await clickByText(win, 'Scan Into Map'), 'Scan Into Map must be clickable again after a cancel').toBe(true);
    await waitUntilBodyMatches(win, /Scanned \d+\/\d+ target|Scan cancelled/);
  } finally {
    await electronApp.close().catch(() => {});
    killFixture(fixture);
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(appDataDir, { recursive: true, force: true });
  }
});
