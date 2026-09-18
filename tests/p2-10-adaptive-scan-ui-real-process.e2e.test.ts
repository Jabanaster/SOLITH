/**
 * P2-10 real-process UI proof — Adaptive Scan Planner.
 *
 * One real Electron app launch, one real attach to a real spawned fixture
 * process, then drives the actual rendered `AdaptiveScanPanel` (not just the
 * engine): Adaptive Scan finds a real planted value with a real plan/reasons
 * summary, a follow-up scan shows a genuinely different plan from the first
 * scan's own real telemetry, and Reference Scan finds the same address.
 * Same attach-flow template as p2-6-7-8-ui-real-process.e2e.test.ts.
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

/** See pointer-map-ui-real-process.e2e.test.ts for why this exists — real win.click() hangs for lower-positioned elements in this environment; a DOM-level synthetic click still fires the real React handler. */
async function clickByText(win: Page, text: string, selector = 'button, a, [role="button"]'): Promise<boolean> {
  return win.evaluate(
    ({ selector, text }) => {
      const candidates = Array.from(document.querySelectorAll(selector));
      const target = candidates.find((el) => el.textContent?.includes(text));
      if (!target) return false;
      (target as HTMLElement).click();
      return true;
    },
    { selector, text },
  );
}

const describeReal = fixtureAvailable() ? test : test.skip;

describeReal('P2-10 real-process UI proof — adaptive plan, follow-up adaptation, reference equivalence', async () => {
  test.setTimeout(120_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const userDataDir = path.join(os.tmpdir(), `solith-p210-userdata-${runId}`);
  const appDataDir = path.join(os.tmpdir(), `solith-p210-appdata-${runId}`);
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(appDataDir, { recursive: true });

  const fixture = await spawnFixture();
  // Plant a distinctive u32 into REFINE_REGION (64 KiB, fully reachable
  // through the legacy driver's real 1 MiB-per-read ceiling — see
  // adaptive-scan-planner-real-process.test.ts for why BIG_REGION/TYPES_REGION
  // cannot be used the same way).
  await fixture.writeBytes(0, Buffer.from([0xce, 0xfa, 0x5a, 0x5a]).toString('hex')); // 0x5A5AFACE, LE

  const electronApp: ElectronApplication = await electron.launch({
    args: [MAIN_BUNDLE],
    env: { ...process.env, ELECTRON_USER_DATA_PATH: userDataDir, APPDATA: appDataDir, USERPROFILE: appDataDir, NODE_ENV: 'test' },
  });

  try {
    const win: Page = await electronApp.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForSelector('#root > *', { timeout: 20_000 });

    // Navigate + attach (identical real flow every live-memory UI proof uses).
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
    expect(attached, 'real Attach must succeed against the real fixture process').toBe(true);

    const panel = win.locator('section[aria-label="Adaptive scan planner"]');
    await expect(panel.locator('h3:has-text("Adaptive Scan Planner")')).toBeVisible();

    // ── First adaptive scan: real planted value, real plan with NO_PRIOR_TELEMETRY ──
    // Default type (int32) encodes 0x5A5AFACE identically to uint32 — this
    // value is well within the positive int32 range, so both types produce
    // the exact same little-endian bytes and either finds the planted value.
    await win.fill('#p210-value', String(0x5a5aface));
    expect(await clickByText(win, 'Adaptive Scan'), 'Adaptive Scan button must be clickable').toBe(true);
    await win.waitForSelector('[aria-label="Adaptive scan plan"]', { timeout: 15_000 });
    const firstPlanText = await panel.locator('[aria-label="Adaptive scan plan"]').innerText();
    expect(firstPlanText, 'first scan in a fresh attach must show NO_PRIOR_TELEMETRY').toMatch(/NO_PRIOR_TELEMETRY/);
    const resultsText = await panel.locator('[aria-label="Adaptive scan results"]').innerText();
    expect(resultsText, 'the real planted value must actually be found').toMatch(/1515911886|5a5aface/i);

    // ── Second adaptive scan: real prior telemetry (result count 1) must change the plan ──
    await win.fill('#p210-value', '42');
    expect(await clickByText(win, 'Adaptive Scan'), 'second Adaptive Scan click must succeed').toBe(true);
    await win.waitForFunction(
      () => document.querySelector('[aria-label="Adaptive scan plan"]')?.textContent?.includes('PRIOR_CANDIDATE_SET_SMALL'),
      undefined,
      { timeout: 15_000 },
    );
    const secondPlanText = await panel.locator('[aria-label="Adaptive scan plan"]').innerText();
    expect(secondPlanText, 'follow-up plan must genuinely differ, driven by the first scan\'s real result count').toMatch(
      /NARROWED_BY_PRIOR_CANDIDATES/,
    );
    expect(secondPlanText).not.toMatch(/NO_PRIOR_TELEMETRY/);

    // Scan history must now show both real scans.
    expect(await clickByText(win, 'Scan history', 'summary'), 'scan history <details> must be present').toBe(true);
    const historyText = await panel.locator('[aria-label="Adaptive scan telemetry history"]').innerText();
    expect(historyText).toMatch(/2 scan/);

    // ── Reference scan of the original value must find the same address ──
    await win.fill('#p210-value', String(0x5a5aface));
    expect(await clickByText(win, 'Reference Scan'), 'Reference Scan button must be clickable').toBe(true);
    await win.waitForFunction(
      () => document.querySelector('[aria-label="Adaptive scan plan"]')?.textContent?.includes('REFERENCE_FULL'),
      undefined,
      { timeout: 15_000 },
    );
    const referenceResultsText = await panel.locator('[aria-label="Adaptive scan results"]').innerText();
    expect(referenceResultsText, 'reference mode must find the same real value the adaptive scan found').toMatch(
      /1515911886|5a5aface/i,
    );
  } finally {
    await electronApp.close().catch(() => {});
    killFixture(fixture);
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(appDataDir, { recursive: true, force: true });
  }
});
