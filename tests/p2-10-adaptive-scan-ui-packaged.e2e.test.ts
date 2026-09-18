/**
 * P2-10 packaged UI proof — Adaptive Scan Planner.
 *
 * Minimum bar, matching p2-6-7-8-ui-packaged.e2e.test.ts's precedent: page
 * loads, preload APIs present, native addon round-trips through a real
 * attach, the panel renders a real plan/reasons/result from packaged
 * resources (app.asar). The real-process test
 * (p2-10-adaptive-scan-ui-real-process.e2e.test.ts) already proves the full
 * dev-build flow including the follow-up adaptation and reference
 * equivalence; this is a lighter single-pass re-proof against the packaged
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
  writeBytes: (offset: number, leHex: string) => Promise<void>;
}

function spawnFixture(): Promise<FixtureHandle> {
  const child = spawn(FIXTURE_PATH, [], { stdio: ['pipe', 'pipe', 'inherit'] });
  child.stdin.on('error', () => {});
  return new Promise((resolve, reject) => {
    let buffered = '';
    const fields: Record<string, string> = {};
    const pendingWrites: Array<{ offset: number; resolve: () => void; reject: (e: Error) => void }> = [];

    function onData(chunk: Buffer) {
      buffered += chunk.toString('utf8');
      let idx: number;
      while ((idx = buffered.indexOf('\n')) !== -1) {
        const line = buffered.slice(0, idx).trim();
        buffered = buffered.slice(idx + 1);
        if (line === 'READY') {
          child.stdout.off('data', onData);
          child.stdout.on('data', onWriteAckData);
          resolve({ child, fields, writeBytes });
          return;
        }
        const eq = line.indexOf('=');
        if (eq !== -1) fields[line.slice(0, eq)] = line.slice(eq + 1);
      }
    }

    let ackBuffered = '';
    function onWriteAckData(chunk: Buffer) {
      ackBuffered += chunk.toString('utf8');
      let idx: number;
      while ((idx = ackBuffered.indexOf('\n')) !== -1) {
        const line = ackBuffered.slice(0, idx).trim();
        ackBuffered = ackBuffered.slice(idx + 1);
        const wroteMatch = /^WROTE (\d+)$/.exec(line);
        const pending = pendingWrites.shift();
        if (!pending) continue;
        if (wroteMatch && Number(wroteMatch[1]) === pending.offset) pending.resolve();
        else pending.reject(new Error(`unexpected fixture response to write: ${line}`));
      }
    }

    function writeBytes(offset: number, leHex: string): Promise<void> {
      return new Promise((res, rej) => {
        pendingWrites.push({ offset, resolve: res, reject: rej });
        child.stdin.write(`write ${offset} ${leHex}\n`);
      });
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

describePackaged('packaged P2-10 adaptive scan UI: real plan/reasons/result render from packaged resources', async () => {
  test.setTimeout(90_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const userDataDir = path.join(os.tmpdir(), `solith-p210-pkg-userdata-${runId}`);
  const appDataDir = path.join(os.tmpdir(), `solith-p210-pkg-appdata-${runId}`);
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(appDataDir, { recursive: true });

  const fixture = await spawnFixture();
  await fixture.writeBytes(0, Buffer.from([0xce, 0xfa, 0x5a, 0x5a]).toString('hex')); // 0x5A5AFACE, LE

  const electronApp: ElectronApplication = await electron.launch({
    executablePath: EXE_PATH,
    env: { ...process.env, ELECTRON_USER_DATA_PATH: userDataDir, APPDATA: appDataDir, USERPROFILE: appDataDir, NODE_ENV: 'test' },
  });

  try {
    const win: Page = await electronApp.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForSelector('#root > *', { timeout: 20_000 });

    const apisPresent = await win.evaluate(() => {
      const api = (window as any).electronAPI;
      return typeof api?.liveMemoryAdaptiveScanStart === 'function' && typeof api?.liveMemoryAdaptiveScanTelemetryGet === 'function';
    });
    expect(apisPresent, 'liveMemoryAdaptiveScanStart/liveMemoryAdaptiveScanTelemetryGet must be exposed in the packaged renderer').toBe(
      true,
    );

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

    const panel = win.locator('section[aria-label="Adaptive scan planner"]');
    await expect(panel.locator('h3:has-text("Adaptive Scan Planner")')).toBeVisible();

    await win.fill('#p210-value', String(0x5a5aface));
    expect(await clickByText(win, 'Adaptive Scan'), 'Adaptive Scan button must be clickable').toBe(true);
    await win.waitForSelector('[aria-label="Adaptive scan plan"]', { timeout: 15_000 });
    const planText = await panel.locator('[aria-label="Adaptive scan plan"]').innerText();
    expect(planText, 'a fresh attach\'s first scan must show a real, measured NO_PRIOR_TELEMETRY plan').toMatch(/NO_PRIOR_TELEMETRY/);
    const resultsText = await panel.locator('[aria-label="Adaptive scan results"]').innerText();
    expect(resultsText, 'the real planted value must be found from packaged resources').toMatch(/1515911886/);
  } finally {
    await electronApp.close().catch(() => {});
    killFixture(fixture);
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(appDataDir, { recursive: true, force: true });
  }
});
