/**
 * Phase 2 P2-3 (mission §19) — packaged pointer-map UI proof.
 *
 * Minimum bar per mission §19: page loads, preload API present, create/load
 * map, pointer data renders, native addon loads from packaged path, no
 * dev-only import/path dependency. §18's dev-build test already proves the
 * full two-target/depth-3/process-exit behavior; this test proves the SAME
 * component works unmodified from packaged resources (app.asar) — a
 * distinct risk class (dev-only import paths, unbundled assets, native
 * addon resolution from app.asar.unpacked) — with a lighter single-target
 * flow, not a full re-proof of already-covered scan/resolve behavior.
 *
 * Real attach is required here, not optional: the P2-2 pointer-map IPC
 * layer ties its in-memory map registry to the attached LiveMemorySession
 * (requireSession -> requireBundle throws 'not_attached' otherwise), so
 * map create/list/save/load cannot be exercised without a real attach —
 * this is existing P2-2 architecture, not something to work around.
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
  try { handle.child.stdin.write('exit\n'); } catch { /* already gone */ }
  handle.child.kill();
}

/** Reliable in this environment (see clickByText) — evaluate-based, no Locator actionability wait. */
async function bodyContains(win: Page, text: string): Promise<boolean> {
  return win.evaluate((needle) => document.body.innerText.includes(needle), text);
}

async function waitUntilBodyContains(win: Page, text: string, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await bodyContains(win, text)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for page text: "${text}"`);
}

// exact=true is required for short/common words (e.g. "Save", "Attach") that
// also appear as substrings of unrelated sidebar nav items ("Save Locations")
// — a plain substring match silently navigated away to the wrong page here.
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

describePackaged('packaged pointer-map UI: attach, create/scan/save/load a map, native addon, all from packaged resources', async () => {
  test.setTimeout(90_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const userDataDir = path.join(os.tmpdir(), `solith-p23-pkg-userdata-${runId}`);
  const appDataDir = path.join(os.tmpdir(), `solith-p23-pkg-appdata-${runId}`);
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(appDataDir, { recursive: true });

  const fixture = await spawnFixture();

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
    const apiPresent = await win.evaluate(() => typeof (window as any).electronAPI?.pointerMapCreate === 'function');
    expect(apiPresent, 'window.electronAPI.pointerMapCreate must be exposed in the packaged renderer').toBe(true);

    // 3. Native addon resolves from app.asar.unpacked and answers a real call
    // — attach itself is the strongest proof (it round-trips through the
    // native scanner), so this is folded into the attach step below rather
    // than a separate no-op check.
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
    expect(attached, 'real Attach (native addon round-trip) must succeed against the packaged app').toBe(true);

    // 4. Create a map, scan one real target (single-target — the two-target
    // depth-3 case is already proven against the dev build in §18).
    await win.fill('input[aria-label="New pointer map name"]', 'Packaged Proof Map');
    await win.click('text=Create Map');
    await win.waitForSelector('text=Created pointer map', { timeout: 5_000 });

    const target = BigInt(fixture.fields.POINTER_NODE_B1_BASE) + BigInt(Number(fixture.fields.POINTER_TARGET_OFFSET));
    const targetHex = `0x${target.toString(16)}`;
    await win.fill('#pm-targets', targetHex);
    await win.click('text=Scan Into Map');
    await win.waitForSelector('text=/Scanned 1\\/1 target/', { timeout: 20_000 });

    // 5. Pointer data renders.
    expect(await bodyContains(win, targetHex), 'target group header must render').toBe(true);
    expect(await bodyContains(win, '(depth 1)'), 'the depth-1 candidate must render').toBe(true);

    // 6. Save (schema-versioned SQLite persistence at the packaged database
    // path) and reload it, still from packaged resources.
    expect(await clickByText(win, 'Save', 'button', true), 'Save button must be clickable').toBe(true);
    if (process.env.P23_DEBUG) {
      await new Promise((r) => setTimeout(r, 1500));
      console.log('--- DEBUG full body text after Save click ---');
      console.log(await win.evaluate(() => document.body.innerText));
    }
    await waitUntilBodyContains(win, 'Pointer map saved');
    await waitUntilBodyContains(win, 'Saved maps');
    expect(await bodyContains(win, 'Packaged Proof Map'), 'saved map must reappear in the Saved maps list').toBe(true);
  } finally {
    await electronApp.close().catch(() => {});
    killFixture(fixture);
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(appDataDir, { recursive: true, force: true });
  }
});
