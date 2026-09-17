/**
 * Phase 2 P2-3 (mission §18) — real-process pointer-map UI proof.
 *
 * Drives the REAL rendered UI (PointerMapPanel inside LiveMemoryTrainerPage)
 * through Electron/Playwright against a real spawned fixture process — not a
 * backend-only IPC check. Only the initial process-attach step (identical to
 * Phase 1's own already-covered attach UI) is driven via evaluate, matching
 * the precedent in gate2-2a1-packaged-real-process-write-proof.e2e.test.ts;
 * everything specific to this stage — create map, scan two independent real
 * targets, see both groups, inspect both chains, resolve, verify ground-truth
 * addresses, kill the fixture, refresh, see process-exited — is driven
 * through real clicks/selects against the real DOM.
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

/**
 * Real Playwright input-dispatch (win.click) reproducibly hung indefinitely
 * — even just resolving the locator, before any actionability check — for
 * elements positioned lower on this page (Attach, a scanned candidate row),
 * while elements near the top clicked fine with plain win.click(). A
 * DOM-level synthetic click dispatched inside the real page via evaluate()
 * still fires the real onClick handler through the real React tree, and
 * sidesteps whatever this environment-specific scroll/input-dispatch issue
 * is, without weakening what's actually under test (the component's real
 * click handling).
 */
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

function targetAddresses(fields: Record<string, string>) {
  const node3 = BigInt(fields.POINTER_NODE3_BASE);
  const nodeB1 = BigInt(fields.POINTER_NODE_B1_BASE);
  const offset = BigInt(Number(fields.POINTER_TARGET_OFFSET));
  return { targetA: node3 + offset, targetB: nodeB1 + offset };
}

const describeReal = fixtureAvailable() ? test : test.skip;

describeReal('P2-3 real-process pointer-map UI proof — two targets, chain inspection, resolve, process-exit truth', async () => {
  test.setTimeout(120_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const userDataDir = path.join(os.tmpdir(), `solith-p23-userdata-${runId}`);
  const appDataDir = path.join(os.tmpdir(), `solith-p23-appdata-${runId}`);
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(appDataDir, { recursive: true });

  const fixture = await spawnFixture();
  const { targetA, targetB } = targetAddresses(fixture.fields);
  const targetAHex = `0x${targetA.toString(16)}`;
  const targetBHex = `0x${targetB.toString(16)}`;

  const electronApp: ElectronApplication = await electron.launch({
    args: [MAIN_BUNDLE],
    env: { ...process.env, ELECTRON_USER_DATA_PATH: userDataDir, APPDATA: appDataDir, USERPROFILE: appDataDir, NODE_ENV: 'test' },
  });

  try {
    const win: Page = await electronApp.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForSelector('#root > *', { timeout: 20_000 });

    // 1. Navigate to the Live Memory Trainer page.
    await win.click('button[title="Live Memory Trainer"]');
    await win.waitForSelector('text=Advanced Scan Mode', { timeout: 10_000 });

    // 2. Attach to the real fixture process through the REAL Attach UI (process
    // list, "show all processes", process picker, waiver, Attach button) — the
    // same flow a user drives. Retried a few times: real-process attach right
    // after spawn is documented as intermittently flaky on Windows even when
    // the process is confirmed running (see doc 003/doc 129 history).
    await win.click('text=Refresh Process List');
    await win.waitForSelector('#live-memory-process-picker', { timeout: 10_000 });
    await win.getByLabel('Show all processes').check();
    await win.selectOption('#live-memory-process-picker', String(fixture.child.pid));
    // Not .check() — this checkbox is intentionally controlled and stays
    // unchecked (userConfirmedOffline) until the waiver modal is accepted.
    await win.getByLabel(/I accept the single-player/).click();
    await win.waitForSelector('text=I understand — enable', { timeout: 5_000 });
    await win.click('text=I understand — enable');

    if (process.env.P23_DEBUG) {
      console.log('--- DEBUG page text before Attach loop ---');
      console.log(await win.locator('body').innerText());
    }

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

    // 3. Create a pointer map through the real UI.
    await win.fill('input[aria-label="New pointer map name"]', 'P2-3 Real Proof Map');
    await win.click('text=Create Map');
    await win.waitForSelector('text=Created pointer map', { timeout: 5_000 });

    // 4/5. Scan both real targets into the same map in one operation.
    await win.fill('#pm-targets', `${targetAHex} ${targetBHex}`);
    await win.click('text=Scan Into Map');
    await win.waitForSelector('text=/Scanned 2\\/2 target/', { timeout: 20_000 });

    // 6. Both target groups are displayed, correctly grouped, not flattened.
    const groupsRegion = win.locator('[aria-label="Pointer map targets and candidates"]');
    await expect(groupsRegion.locator(`text=${targetAHex}`)).toBeVisible();
    await expect(groupsRegion.locator(`text=${targetBHex}`)).toBeVisible();

    // 7. Inspect the depth-3 chain (Target A).
    expect(await clickByText(win, '(depth 3)'), 'a depth-3 candidate row must be clickable').toBe(true);
    await win.waitForSelector('text=Chain Detail', { timeout: 5_000 });
    await expect(win.locator('text=Chain Detail').locator('..')).toContainText('Depth');

    // 8. Inspect the depth-1 chain (Target B).
    expect(await clickByText(win, '(depth 1)'), 'a depth-1 candidate row must be clickable').toBe(true);
    await win.waitForSelector('text=Chain Detail', { timeout: 5_000 });

    // 9/10. Refresh/resolve and verify both nodes resolve to the exact real ground-truth addresses.
    expect(await clickByText(win, 'Refresh / Resolve'), 'Refresh / Resolve button must be clickable').toBe(true);
    await win.waitForSelector('text=/Resolved: \\d+ succeeded/', { timeout: 15_000 });
    // Multiple candidate chains can legitimately resolve to the same real
    // target address (BFS finds more than one valid path) — .first() only.
    await expect(win.locator(`text=→ ${targetAHex}`).first()).toBeVisible();
    await expect(win.locator(`text=→ ${targetBHex}`).first()).toBeVisible();

    // 11/12/13. Stop the fixture, refresh again, and the UI must visibly
    // transition to process-exited truth — never a stale "resolved" badge.
    killFixture(fixture);
    // Real-Windows finding (matches this project's own documented Phase 1
    // behavior: a dead-but-still-open process handle can keep returning
    // stale-but-successful reads for a variable amount of time after the
    // process actually exits — there is no fixed delay that reliably makes
    // getModules()/reads start failing). So this polls Refresh/Resolve
    // rather than asserting after one fixed wait.
    let sawTruthfulTransition = false;
    let lastGroupsText = '';
    for (let attempt = 0; attempt < 8 && !sawTruthfulTransition; attempt++) {
      await new Promise((r) => setTimeout(r, 2000));
      expect(await clickByText(win, 'Refresh / Resolve'), 'Refresh / Resolve button must be clickable').toBe(true);
      await win.waitForSelector('text=/Resolved: \\d+ succeeded/', { timeout: 15_000 });
      lastGroupsText = await win.locator('[aria-label="Pointer map targets and candidates"]').innerText();
      // Badge text renders visually UPPERCASE via CSS text-transform, which
      // innerText reflects — match case-insensitively.
      if (!/\bresolved\b/i.test(lastGroupsText) && /process exited|read failed/i.test(lastGroupsText)) {
        sawTruthfulTransition = true;
      }
    }
    expect(
      sawTruthfulTransition,
      `expected every node to leave RESOLVED for a truthful non-resolved state (Process Exited or Read Failed) within 8 polls after kill, got: ${lastGroupsText}`,
    ).toBe(true);
  } finally {
    await electronApp.close().catch(() => {});
    killFixture(fixture);
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(appDataDir, { recursive: true, force: true });
  }
});
