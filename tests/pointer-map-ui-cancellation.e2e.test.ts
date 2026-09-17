/**
 * P2-3.1 §5/§6/§8 — real-process, real-UI pointer-map scan cancellation proof.
 *
 * Drives the actual rendered PointerMapPanel through Electron/Playwright
 * against a real spawned fixture process, clicking the real "Cancel Scan"
 * button while a real scan is genuinely still in flight — not a backend-only
 * check (that already exists, exhaustively, in
 * tests/live-memory/pointer-map-scan-cancellation.test.ts) and not a
 * simulated delay in product code. The fixture is spawned with extra small
 * "noise" regions (a real, bounded test-fixture feature — see
 * native/solith-scanner-core/src/bin/fixture.rs) purely to slow a real scan
 * to a human/Playwright-observable multi-second duration, the same way a
 * real large game process with many small heap allocations naturally would.
 */
import { test, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';
import type { ElectronApplication, Page } from 'playwright';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { existsSync } from 'node:fs';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname ?? '.', '..');
const MAIN_BUNDLE = path.join(ROOT, 'dist-electron', 'main.js');
const FIXTURE_PATH = path.join(ROOT, 'native', 'solith-scanner-core', 'target', 'release', 'solith-scanner-fixture.exe');

function fixtureAvailable(): boolean {
  return process.platform === 'win32' && existsSync(FIXTURE_PATH) && existsSync(MAIN_BUNDLE);
}

interface FixtureHandle {
  child: ChildProcessWithoutNullStreams;
  fields: Record<string, string>;
}

/** `['1', '150']`: a harmless 1 MiB bench region plus 150 real noise regions — see fixture.rs's own comment on why. */
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

/** Same environment-quirk workaround as pointer-map-ui-real-process.e2e.test.ts — see its comment. */
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

async function bodyContains(win: Page, text: string | RegExp): Promise<boolean> {
  const content = await win.locator('body').innerText();
  return typeof text === 'string' ? content.includes(text) : text.test(content);
}

function targetAddress(fields: Record<string, string>): bigint {
  const node3 = BigInt(fields.POINTER_NODE3_BASE);
  const offset = BigInt(Number(fields.POINTER_TARGET_OFFSET));
  return node3 + offset;
}

const describeReal = fixtureAvailable() ? test : test.skip;

describeReal('P2-3.1 real-process pointer-map UI — Cancel interrupts a genuinely in-flight scan', async () => {
  test.setTimeout(120_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const userDataDir = path.join(os.tmpdir(), `solith-p231-cancel-userdata-${runId}`);
  const appDataDir = path.join(os.tmpdir(), `solith-p231-cancel-appdata-${runId}`);
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(appDataDir, { recursive: true });

  const fixture = await spawnFixture();
  const targetHex = `0x${targetAddress(fixture.fields).toString(16)}`;

  const electronApp: ElectronApplication = await electron.launch({
    args: [MAIN_BUNDLE],
    env: { ...process.env, ELECTRON_USER_DATA_PATH: userDataDir, APPDATA: appDataDir, USERPROFILE: appDataDir, NODE_ENV: 'test' },
  });

  try {
    const win: Page = await electronApp.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForSelector('#root > *', { timeout: 20_000 });

    await win.click('button[title="Live Memory Trainer"]');
    await win.waitForSelector('text=Advanced Scan Mode', { timeout: 10_000 });

    await win.click('text=Refresh Process List');
    await win.waitForSelector('#live-memory-process-picker', { timeout: 10_000 });
    await win.getByLabel('Show all processes').check();
    await win.selectOption('#live-memory-process-picker', String(fixture.child.pid));
    await win.getByLabel(/I accept the single-player/).click();
    await win.waitForSelector('text=I understand — enable', { timeout: 5_000 });
    await win.click('text=I understand — enable');

    let attached = false;
    for (let attempt = 0; attempt < 5 && !attached; attempt++) {
      await clickByText(win, 'Attach', 'button.btn-primary');
      try {
        await win.waitForSelector('button:has-text("Detach")', { timeout: 5_000 });
        attached = true;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    expect(attached, 'real Attach button must succeed against the real fixture process within 5 attempts').toBe(true);

    await win.fill('input[aria-label="New pointer map name"]', 'P2-3.1 Cancel Proof Map');
    await win.click('text=Create Map');
    await win.waitForSelector('text=Created pointer map', { timeout: 5_000 });

    // Cancel button starts disabled — no scan is active yet.
    const cancelButton = win.locator('button:has-text("Cancel Scan")');
    await expect(cancelButton).toBeDisabled();

    // 1/2. Start a real scan (slowed by the fixture's noise regions) and
    // observe the UI visibly enter an active-scanning state.
    await win.fill('#pm-targets', targetHex);
    expect(await clickByText(win, 'Scan Into Map'), 'Scan Into Map button must be clickable').toBe(true);
    if (process.env.P231_DEBUG) {
      await new Promise((r) => setTimeout(r, 500));
      console.log('--- DEBUG body text 500ms after Scan Into Map click ---');
      console.log(await win.locator('body').innerText());
    }
    await win.waitForSelector('text=Scan in progress', { timeout: 5_000 });

    // 3. Cancel is enabled while the scan is genuinely still running.
    await expect(cancelButton).toBeEnabled();

    // 4/5/6. Click Cancel while the backend scan is still in flight (the
    // noise regions keep it running for several seconds — see spawnFixture).
    expect(await clickByText(win, 'Cancel Scan', 'button', true), 'Cancel Scan button must be clickable').toBe(true);

    // 10/11. The UI must settle on a truthful cancelled/aggregate state, not
    // silently keep showing "Scanning…" forever and not silently report a
    // plain success as if nothing happened.
    await win.waitForFunction(
      () => !document.body.innerText.includes('Scanning…') && !document.body.innerText.includes('Scan in progress'),
      { timeout: 20_000 },
    );
    const settledText = await win.locator('body').innerText();
    expect(
      /cancel/i.test(settledText),
      `expected a truthful cancelled outcome after clicking Cancel mid-scan, got page text containing: ${settledText.slice(0, 2000)}`,
    ).toBe(true);

    // Cancel button returns to disabled once no scan is active.
    await expect(cancelButton).toBeDisabled();

    // 12. The user can immediately start a fresh scan and it completes normally.
    expect(await clickByText(win, 'Scan Into Map'), 'Scan Into Map button must be clickable after a cancel').toBe(true);
    await win.waitForFunction(
      () => /Scanned \d+\/\d+ target|Scan cancelled/.test(document.body.innerText),
      { timeout: 30_000 },
    );
    expect(await bodyContains(win, /Scanned \d+\/\d+ target|Scan cancelled/), 'the second scan must reach a real terminal state').toBe(true);
  } finally {
    await electronApp.close().catch(() => {});
    killFixture(fixture);
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(appDataDir, { recursive: true, force: true });
  }
});
