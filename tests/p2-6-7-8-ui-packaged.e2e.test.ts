/**
 * Phase 2 P2-6/P2-7/P2-8 packaged UI proof.
 *
 * Minimum bar, matching structure-discovery-ui-packaged.e2e.test.ts's
 * precedent: page loads, preload APIs present, native addon round-trips
 * through a real attach, each panel renders real data — all from packaged
 * resources (app.asar). The real-process test
 * (p2-6-7-8-ui-real-process.e2e.test.ts) already proves the full dev-build
 * flow; this is a lighter single-pass re-proof against the packaged
 * build's distinct risk class (dev-only import paths, unbundled assets,
 * native addon resolution from app.asar.unpacked).
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

describePackaged('packaged P2-6/P2-7/P2-8 UI: typed view, inference, memory map, watchlist all render real data from packaged resources', async () => {
  test.setTimeout(90_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const userDataDir = path.join(os.tmpdir(), `solith-p26789-pkg-userdata-${runId}`);
  const appDataDir = path.join(os.tmpdir(), `solith-p26789-pkg-appdata-${runId}`);
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(appDataDir, { recursive: true });

  const fixture = await spawnFixture();
  const structBaseHex = `0x${BigInt(fixture.fields.STRUCT_REGION_BASE).toString(16)}`;

  const electronApp: ElectronApplication = await electron.launch({
    executablePath: EXE_PATH,
    env: { ...process.env, ELECTRON_USER_DATA_PATH: userDataDir, APPDATA: appDataDir, USERPROFILE: appDataDir, NODE_ENV: 'test' },
  });

  try {
    const win: Page = await electronApp.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForSelector('#root > *', { timeout: 20_000 });

    // Preload APIs present for all three checkpoints.
    const apisPresent = await win.evaluate(() => {
      const api = (window as any).electronAPI;
      return (
        typeof api?.typedViewRead === 'function' &&
        typeof api?.inferStructureBehavior === 'function' &&
        typeof api?.memoryMapListRegions === 'function' &&
        typeof api?.watchlistAdd === 'function'
      );
    });
    expect(apisPresent, 'typedViewRead/inferStructureBehavior/memoryMapListRegions/watchlistAdd must all be exposed in the packaged renderer').toBe(true);

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

    // P2-6 typed view
    await win.fill('#typed-addr', structBaseHex);
    expect(await clickByText(win, 'Read Typed Value'), 'Read Typed Value must be clickable').toBe(true);
    await win.waitForSelector('[aria-label="Typed interpretations"]', { timeout: 10_000 });
    expect(await win.locator('[aria-label="Typed interpretations"] tbody tr').count()).toBeGreaterThan(0);

    // P2-8 memory map
    expect(await clickByText(win, 'Load Memory Map'), 'Load Memory Map must be clickable').toBe(true);
    await win.waitForSelector('table[aria-label="Memory regions"]', { timeout: 10_000 });
    expect(await win.locator('table[aria-label="Memory regions"] tbody tr').count()).toBeGreaterThan(0);

    // P2-8 watchlist
    await win.fill('#watch-addr', structBaseHex);
    expect(await clickByText(win, 'Add Watch'), 'Add Watch must be clickable').toBe(true);
    await win.waitForSelector('table[aria-label="Watch items"]', { timeout: 10_000 });

    // P2-7 inference (discover + 2 snapshots + infer, reusing the P2-5 panel)
    await win.fill('#struct-addr', structBaseHex);
    await win.fill('#struct-length', '128');
    expect(await clickByText(win, 'Discover Structure'), 'Discover Structure must be clickable').toBe(true);
    await win.waitForSelector('table[aria-label="Structure fields"]', { timeout: 10_000 });
    expect(await clickByText(win, 'Snapshot A'), 'Snapshot A must be clickable').toBe(true);
    await win.waitForSelector('text=/Snapshot A captured/', { timeout: 5_000 });
    expect(await clickByText(win, 'Snapshot B'), 'Snapshot B · Compare must be clickable').toBe(true);
    await win.waitForSelector('text=/Compared/', { timeout: 5_000 });
    expect(await clickByText(win, 'Infer Behavior'), 'Infer Behavior (P2-7) must be clickable').toBe(true);
    await win.waitForSelector('[aria-label="Value/type inference"]', { timeout: 10_000 });
  } finally {
    await electronApp.close().catch(() => {});
    killFixture(fixture);
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(appDataDir, { recursive: true, force: true });
  }
});
