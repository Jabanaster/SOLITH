/**
 * Phase 2 P2-5 (SOLITH.MD mission §24) — packaged structure-discovery UI
 * proof.
 *
 * Minimum bar, matching pointer-map-ui-packaged.e2e.test.ts's precedent:
 * page loads, preload API present, native addon round-trips through a real
 * attach, structure discovery renders — all from packaged resources
 * (app.asar). structure-discovery-ui-real-process.e2e.test.ts already
 * proves the full dev-build flow (field inspector, snapshot/compare,
 * refresh, process-exit behavior); this is a lighter single-flow re-proof
 * against the packaged build's distinct risk class (dev-only import paths,
 * unbundled assets, native addon resolution from app.asar.unpacked).
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

function spawnFixture(): Promise<FixtureHandle> {
  const child = spawn(FIXTURE_PATH, [], { stdio: ['pipe', 'pipe', 'inherit'] });
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
  try {
    handle.child.stdin.write('exit\n');
  } catch {
    /* already gone */
  }
  handle.child.kill();
}

async function bodyContains(win: Page, text: string): Promise<boolean> {
  return win.evaluate((needle) => document.body.innerText.includes(needle), text);
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

describePackaged('packaged structure-discovery UI: attach, discover a real structure, field table, native addon, all from packaged resources', async () => {
  test.setTimeout(90_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const userDataDir = path.join(os.tmpdir(), `solith-p25-pkg-userdata-${runId}`);
  const appDataDir = path.join(os.tmpdir(), `solith-p25-pkg-appdata-${runId}`);
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(appDataDir, { recursive: true });

  const fixture = await spawnFixture();
  const structBaseHex = `0x${BigInt(fixture.fields.STRUCT_REGION_BASE).toString(16)}`;

  const electronApp: ElectronApplication = await electron.launch({
    executablePath: EXE_PATH,
    env: {
      ...process.env,
      ELECTRON_USER_DATA_PATH: userDataDir,
      APPDATA: appDataDir,
      USERPROFILE: appDataDir,
      NODE_ENV: 'test',
    },
  });

  try {
    // 1. Page loads from packaged resources.
    const win: Page = await electronApp.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForSelector('#root > *', { timeout: 20_000 });

    // 2. Preload API is present.
    const apiPresent = await win.evaluate(() => typeof (window as any).electronAPI?.structureDiscover === 'function');
    expect(apiPresent, 'window.electronAPI.structureDiscover must be exposed in the packaged renderer').toBe(true);

    // 3. Native addon resolves from app.asar.unpacked, proven via a real attach.
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
      await clickByText(win, 'Attach', 'button.btn-primary', true);
      try {
        await win.waitForSelector('button:has-text("Detach")', { timeout: 5_000 });
        attached = true;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    expect(attached, 'real Attach (native addon round-trip) must succeed against the packaged app').toBe(true);

    // 4. Discover a real structure through the packaged UI.
    await win.fill('#struct-addr', structBaseHex);
    await win.fill('#struct-length', '128');
    expect(await clickByText(win, 'Discover Structure'), 'Discover Structure button must be clickable').toBe(true);
    await win.waitForSelector('table[aria-label="Structure fields"]', { timeout: 10_000 });

    // 5. Real field data renders, not a placeholder.
    expect(await bodyContains(win, structBaseHex), 'the discovered structure\'s base address must render').toBe(true);
    const rowCount = await win.locator('table[aria-label="Structure fields"] tbody tr').count();
    expect(rowCount, 'the field table must render at least one real discovered row from the packaged build').toBeGreaterThan(0);
  } finally {
    await electronApp.close().catch(() => {});
    killFixture(fixture);
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(appDataDir, { recursive: true, force: true });
  }
});
