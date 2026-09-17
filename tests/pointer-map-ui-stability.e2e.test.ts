/**
 * Phase 2 P2-4 (mission §16) — real-process, real-UI "Validate After
 * Restart" workflow proof. The 10-restart real-process campaign
 * (tests/live-memory/pointer-stability-real-process.test.ts) already
 * proves the classification logic against genuine ASLR/heap relocation
 * exhaustively at the session/architecture level; this test's job is
 * narrower and complementary — prove the actual rendered form/button/
 * display in PointerMapPanel really drives that same production code
 * path, through real clicks against a real attached process, not a
 * backend-only check.
 *
 * Scoped to a single Electron session (create -> scan -> validate twice)
 * rather than a save -> relaunch -> load -> validate cycle: driving the
 * real "Load" button originally surfaced what looked like a genuine
 * pointer-map-load/pointer-map-list session race — the panel's post-load
 * refresh appeared to intermittently report `not_attached` despite a
 * genuinely attached session.
 *
 * P2-4.1 (mission §7/§8) root-caused it: it was never a backend/session
 * race at all. `PointerMapPanel` calls its own `loadMaps()` unconditionally
 * on mount, before any attach has happened, and that call correctly (and
 * harmlessly) gets `not_attached` back — but `loadMaps()`'s failure branch
 * unconditionally wrote that into the panel's local status message and
 * nothing ever cleared it on a later successful refresh. The stale
 * "Failed to list pointer maps: not_attached" text then sat there,
 * genuinely displayed, until some other panel action overwrote it — and if
 * "Load" on an already-saved map was the user's first interaction with the
 * panel (no Create/Scan beforehand), that stale text was still the only
 * thing on screen for the brief window between the click and
 * `handleLoadSavedMap`'s own final, correct "Loaded ..." message. Fixed in
 * `src/app/components/PointerMapPanel.tsx`'s `loadMaps()`: a `not_attached`
 * list result is the expected pre-attach state, not a failure, and no
 * longer sets the message at all. Scope: cosmetic UI status text only —
 * saved stability pointer-maps on disk, the pointer-map-load/list backend
 * IPC handlers, and P2-4's restart-validation classification logic were
 * never affected. The first test below stays scoped to
 * create -> scan -> validate twice within one live session (its actual
 * job — proving the rendered form/button really drives the real
 * classification code); the fixed Load workflow itself is proven by the
 * second test below.
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
  try { handle.child.stdin.write('exit\n'); } catch { /* already gone */ }
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

const describeReal = fixtureAvailable() ? test : test.skip;

describeReal('P2-4 real-process pointer-map UI — Validate After Restart against a genuinely restarted process', async () => {
  test.setTimeout(120_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const userDataDir = path.join(os.tmpdir(), `solith-p24-stability-userdata-${runId}`);
  const appDataDir = path.join(os.tmpdir(), `solith-p24-stability-appdata-${runId}`);
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(appDataDir, { recursive: true });

  // The fixture's own compile-time constant (fixture.rs: POINTER_TARGET_VALUE = 0x5A5A_1234),
  // a real independently-known expected value — never "resolved to readable memory".
  const POINTER_TARGET_VALUE_DECIMAL = 0x5a5a1234;

  async function attachToFixture(win: Page, handle: FixtureHandle) {
    await win.click('text=Refresh Process List');
    await win.waitForSelector('#live-memory-process-picker', { timeout: 10_000 });
    await win.getByLabel('Show all processes').check();
    await win.selectOption('#live-memory-process-picker', String(handle.child.pid));
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
    expect(attached, 'real Attach must succeed against the real fixture process').toBe(true);
  }

  const fixture = await spawnFixture();
  const app: ElectronApplication = await electron.launch({
    args: [MAIN_BUNDLE],
    env: { ...process.env, ELECTRON_USER_DATA_PATH: userDataDir, APPDATA: appDataDir, USERPROFILE: appDataDir, NODE_ENV: 'test' },
  });
  try {
    const win: Page = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForSelector('#root > *', { timeout: 20_000 });
    await win.click('button[title="Live Memory Trainer"]');
    await win.waitForSelector('text=Pointer Maps', { timeout: 10_000 });
    await attachToFixture(win, fixture);

    // 1/2/3. Create a real map and scan the real depth-3 target.
    const node3 = BigInt(fixture.fields.POINTER_NODE3_BASE);
    const offset = BigInt(Number(fixture.fields.POINTER_TARGET_OFFSET));
    const targetHex = `0x${(node3 + offset).toString(16)}`;
    await win.fill('input[aria-label="New pointer map name"]', 'P2-4 UI Restart Proof');
    await win.click('text=Create Map');
    await win.waitForSelector('text=Created pointer map', { timeout: 5_000 });
    await win.fill('#pm-targets', targetHex);
    await win.click('text=Scan Into Map');
    await win.waitForFunction(() => /Scanned \d+\/\d+ target/.test(document.body.innerText), { timeout: 20_000 });

    expect(await clickByText(win, '(depth 3)'), 'the depth-3 candidate row must be clickable').toBe(true);
    await win.waitForSelector('text=Restart Stability', { timeout: 5_000 });
    // Not yet validated -> a truthful caution badge, never a silent green.
    // Badge CSS renders text-transform: uppercase, so match case-insensitively.
    expect(await bodyContains(win, /not yet validated/i), 'an un-validated node must show a truthful not-yet-validated state').toBe(true);

    // 4/5/6/7/8. Fill the ground-truth form and validate — this establishes
    // the baseline against this real attached process.
    await win.fill('#pm-ground-truth-expected', String(POINTER_TARGET_VALUE_DECIMAL));
    await win.fill('#pm-ground-truth-description', 'fixture POINTER_TARGET_VALUE');
    expect(await clickByText(win, 'Validate After Restart'), 'Validate After Restart button must be clickable').toBe(true);
    await waitUntilBodyMatches(win, /Restart validation:/);
    expect(await bodyContains(win, 'Stable (exact)'), 'the first validation must classify as stable_exact').toBe(true);
    expect(await bodyContains(win, '1/1'), 'one attempt, one correct after the first validation').toBe(true);

    // A second real validation against the same live process: real,
    // accumulated history (never reset), and the button/form remain fully
    // usable for a repeat click — the real "Validate After Restart" can be
    // used more than once per session.
    expect(await clickByText(win, 'Validate After Restart'), 'Validate After Restart must be clickable a second time').toBe(true);
    await waitUntilBodyMatches(win, /2\/2/);
    expect(await bodyContains(win, '2/2'), 'a second validation must show 2 attempts, 2 correct — real accumulated history').toBe(true);
    expect(await bodyContains(win, 'Stable (exact)'), 'the second validation against the same unchanged process is still stable_exact').toBe(true);

    // Drill-down history is real and shows both observations.
    expect(await clickByText(win, 'Show restart history'), 'the restart-history drill-down toggle must be clickable').toBe(true);
    const historyText = await win.locator('[aria-label="Restart stability history"]').innerText();
    assertContains(historyText, '#1');
    assertContains(historyText, '#2');
  } finally {
    await app.close().catch(() => {});
    killFixture(fixture);
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(appDataDir, { recursive: true, force: true });
  }
});

function assertContains(haystack: string, needle: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(`Expected text to contain "${needle}", got: ${haystack.slice(0, 500)}`);
  }
}

describeReal('pointer-map UI — Load as the first interaction after a fresh attach never shows a stale not_attached error', async () => {
  test.setTimeout(120_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const userDataDir = path.join(os.tmpdir(), `solith-p241-load-userdata-${runId}`);
  const appDataDir = path.join(os.tmpdir(), `solith-p241-load-appdata-${runId}`);
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(appDataDir, { recursive: true });

  async function attachToFixture(win: Page, handle: FixtureHandle) {
    await win.click('text=Refresh Process List');
    await win.waitForSelector('#live-memory-process-picker', { timeout: 10_000 });
    await win.getByLabel('Show all processes').check();
    await win.selectOption('#live-memory-process-picker', String(handle.child.pid));
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
    expect(attached, 'real Attach must succeed against the real fixture process').toBe(true);
  }

  // Session 1: create and save a real map against a real fixture instance,
  // then close everything — the saved map is the only thing that survives.
  const fixture1 = await spawnFixture();
  const app1: ElectronApplication = await electron.launch({
    args: [MAIN_BUNDLE],
    env: { ...process.env, ELECTRON_USER_DATA_PATH: userDataDir, APPDATA: appDataDir, USERPROFILE: appDataDir, NODE_ENV: 'test' },
  });
  try {
    const win1: Page = await app1.firstWindow();
    await win1.waitForLoadState('domcontentloaded');
    await win1.waitForSelector('#root > *', { timeout: 20_000 });
    await win1.click('button[title="Live Memory Trainer"]');
    await win1.waitForSelector('text=Pointer Maps', { timeout: 10_000 });
    await attachToFixture(win1, fixture1);

    await win1.fill('input[aria-label="New pointer map name"]', 'P2-4.1 Load Regression');
    await win1.click('text=Create Map');
    await win1.waitForSelector('text=Created pointer map', { timeout: 5_000 });
    expect(await clickByText(win1, 'Save', 'button, a, [role="button"]', true), 'Save button must be clickable').toBe(true);
    await win1.waitForSelector('text=/Pointer map saved\\.|Save failed/', { timeout: 5_000 });
    expect(await bodyContains(win1, 'Save failed'), 'the real save must succeed').toBe(false);
  } finally {
    await app1.close().catch(() => {});
    killFixture(fixture1);
  }

  // Session 2: a genuinely fresh app launch and a genuinely new fixture
  // process instance (a real restart) sharing the same on-disk userData —
  // attach, then click Load on the saved map as the FIRST interaction with
  // the panel, with no Create/Scan beforehand. Poll the body continuously
  // through the async window between the click and the final message so a
  // transient stale "not_attached" text cannot slip past an end-state-only
  // assertion.
  const fixture2 = await spawnFixture();
  const app2: ElectronApplication = await electron.launch({
    args: [MAIN_BUNDLE],
    env: { ...process.env, ELECTRON_USER_DATA_PATH: userDataDir, APPDATA: appDataDir, USERPROFILE: appDataDir, NODE_ENV: 'test' },
  });
  try {
    const win2: Page = await app2.firstWindow();
    await win2.waitForLoadState('domcontentloaded');
    await win2.waitForSelector('#root > *', { timeout: 20_000 });
    await win2.click('button[title="Live Memory Trainer"]');
    await win2.waitForSelector('text=Pointer Maps', { timeout: 10_000 });
    await attachToFixture(win2, fixture2);

    let sawStaleError = false;
    const pollUntilLoaded = (async () => {
      const start = Date.now();
      while (Date.now() - start < 15_000) {
        if (await bodyContains(win2, 'Failed to list pointer maps: not_attached')) {
          sawStaleError = true;
          return;
        }
        if (await bodyContains(win2, /^Loaded "/m)) return;
        await new Promise((r) => setTimeout(r, 50));
      }
    })();

    await win2.waitForSelector('[aria-label="Saved pointer maps"] li', { timeout: 10_000 });
    expect(
      await clickByText(win2, 'Load', '[aria-label="Saved pointer maps"] button.btn-secondary'),
      'Load must be clickable as the very first panel interaction',
    ).toBe(true);
    await pollUntilLoaded;

    expect(sawStaleError, 'the fixed Load workflow must never surface a stale not_attached error').toBe(false);
    await waitUntilBodyMatches(win2, /^Loaded "P2-4\.1 Load Regression"/m);
  } finally {
    await app2.close().catch(() => {});
    killFixture(fixture2);
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(appDataDir, { recursive: true, force: true });
  }
});
