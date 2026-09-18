/**
 * Phase 2 P2-6/P2-7/P2-8 real-process UI proof.
 *
 * Closes the certification gap disclosed in ROADMAP.md's "Honest
 * correction" note: engine/session/IPC/real-fixture/real-game proof was
 * complete for P2-6 (typed memory view), P2-7 (value/type inference), and
 * P2-8 (memory map + watchlists), but no Playwright test had ever driven
 * their actual rendered panels. One real Electron app launch, one real
 * attach to a real spawned fixture, then each panel's real UI flow in turn
 * — same attach-flow template as structure-discovery-ui-real-process.e2e.test.ts.
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

describeReal('P2-6/P2-7/P2-8 real-process UI proof — typed view, inference, memory map, watchlist', async () => {
  test.setTimeout(180_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const userDataDir = path.join(os.tmpdir(), `solith-p26789-userdata-${runId}`);
  const appDataDir = path.join(os.tmpdir(), `solith-p26789-appdata-${runId}`);
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(appDataDir, { recursive: true });

  const fixture = await spawnFixture();
  const structBaseHex = `0x${BigInt(fixture.fields.STRUCT_REGION_BASE).toString(16)}`;

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

    // ── P2-6: Typed Memory View ────────────────────────────────────────
    const typedPanel = win.locator('section[aria-label="Phase 2 P2-6 typed memory view"]');
    await expect(typedPanel.locator('h3:has-text("Typed Memory View")')).toBeVisible();
    await win.fill('#typed-addr', structBaseHex);
    await win.selectOption('#typed-length', '8');
    expect(await clickByText(win, 'Read Typed Value'), 'Read Typed Value button must be clickable').toBe(true);
    await win.waitForSelector('[aria-label="Typed interpretations"]', { timeout: 10_000 });
    const typedRows = await win.locator('[aria-label="Typed interpretations"] tbody tr').count();
    expect(typedRows, 'the typed interpretations table must render at least one real reading').toBeGreaterThan(0);
    const typedText = await typedPanel.innerText();
    expect(typedText, 'the same real bytes must be shown as multiple simultaneous types').toMatch(/i32/);
    expect(typedText).toMatch(/f32/);

    // ── P2-7: Value/Type Inference (inside the P2-5 Structure Discovery panel) ──
    const structPanel = win.locator('section[aria-label="Phase 2 P2-5 structure discovery"]');
    await win.fill('#struct-addr', structBaseHex);
    await win.fill('#struct-length', '128');
    expect(await clickByText(win, 'Discover Structure'), 'Discover Structure button must be clickable').toBe(true);
    await win.waitForSelector('table[aria-label="Structure fields"]', { timeout: 10_000 });
    expect(await clickByText(win, 'Snapshot A'), 'Snapshot A button must be clickable').toBe(true);
    await win.waitForSelector('text=/Snapshot A captured/', { timeout: 5_000 });
    expect(await clickByText(win, 'Snapshot B'), 'Snapshot B · Compare button must be clickable').toBe(true);
    await win.waitForSelector('text=/Compared/', { timeout: 5_000 });
    expect(await clickByText(win, 'Infer Behavior'), 'Infer Behavior (P2-7) button must be clickable').toBe(true);
    await win.waitForSelector('[aria-label="Value/type inference"]', { timeout: 10_000 });
    const inferenceText = await win.locator('[aria-label="Value/type inference"]').innerText();
    expect(inferenceText, 'the inference table must render real per-offset rows').toMatch(/0x/);

    // ── P2-8: Memory Map ─────────────────────────────────────────────
    const memMapPanel = win.locator('section[aria-label="Phase 2 P2-8 memory map"]');
    await expect(memMapPanel.locator('h3:has-text("Memory Map")')).toBeVisible();
    expect(await clickByText(win, 'Load Memory Map'), 'Load Memory Map button must be clickable').toBe(true);
    await win.waitForSelector('table[aria-label="Memory regions"]', { timeout: 10_000 });
    const regionRows = await win.locator('table[aria-label="Memory regions"] tbody tr').count();
    expect(regionRows, 'the memory map must render at least one real region from the real fixture process').toBeGreaterThan(0);
    const moduleRows = await win.locator('table[aria-label="Loaded modules"] tbody tr').count();
    expect(moduleRows, 'the memory map must render at least one real loaded module').toBeGreaterThan(0);

    // ── P2-8: Watchlist ──────────────────────────────────────────────
    const watchPanel = win.locator('section[aria-label="Phase 2 P2-8 watchlist"]');
    await expect(watchPanel.locator('h3:has-text("Watchlist")')).toBeVisible();
    await win.fill('#watch-addr', structBaseHex);
    await win.selectOption('#watch-width', '4');
    await win.fill('#watch-label', 'e2e watch');
    expect(await clickByText(win, 'Add Watch'), 'Add Watch button must be clickable').toBe(true);
    await win.waitForSelector('table[aria-label="Watch items"]', { timeout: 10_000 });
    const watchText = await watchPanel.innerText();
    expect(watchText, 'the watch item must render the real user-supplied label').toContain('e2e watch');
    expect(watchText, 'the watch item must render a real resolve state').toMatch(/live/);
    expect(await clickByText(win, 'Refresh All'), 'Refresh All button must be clickable').toBe(true);
  } finally {
    await electronApp.close().catch(() => {});
    killFixture(fixture);
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(appDataDir, { recursive: true, force: true });
  }
});
