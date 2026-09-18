/**
 * Phase 2 P2-9 packaged hotkey proof.
 *
 * Full parity with p2-9-hotkey-real-process.e2e.test.ts, run against
 * packaged resources (app.asar) instead of dist-electron/main.js: real
 * OS-level globalShortcut registration, real OS-level conflict rejection,
 * real main->renderer broadcast (10/10 presses), one real hotkey-triggered
 * write -> verify -> freeze -> unfreeze -> revert cycle through the real
 * two-phase-consent IPC, and stale/no-session rejection after detach.
 *
 * Certification history, disclosed rather than erased: an earlier draft of
 * this test intermittently failed with `electronApplication.evaluate:
 * Resulting promise was garbage collected` on the very first main-process
 * evaluate call against the packaged executable. Root-cause isolation this
 * stage (3 initial repro attempts, then a 10-run stability sweep) found NO
 * reproduction of that failure once run against a settled host — the prior
 * session that produced it had accumulated 45+ leftover Electron/fixture/
 * node processes from its own extremely long, heavy cumulative run (the
 * same host-contention characteristic that degraded that session's
 * `npm run test:live-memory` regression, cross-validated there against a
 * clean remote CI run at the identical commit SHA). An audit of every
 * `electronApplication.evaluate(...)` / `window.evaluate(...)` call in this
 * file (section 2 of the closure mission) found no lifecycle or
 * serialization defect: every evaluate callback returns plain, already-
 * resolved, JSON-serializable primitives or plain objects, none capture a
 * main-process object across the evaluate boundary, and none race an
 * app/window teardown. 10/10 stability + 3/3 independent certification runs
 * on a settled host, clean.
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

/** See p2-9-hotkey-real-process.e2e.test.ts for the root cause this pings around: the fixture's own real 30s-of-stdin-silence self-exit. */
function startFixtureKeepalive(handle: FixtureHandle): () => void {
  const timer = setInterval(() => {
    try {
      handle.child.stdin.write('protect_mutation readwrite\n');
    } catch {
      /* already gone */
    }
  }, 3_000);
  return () => clearInterval(timer);
}

const fixtureAvailable = process.platform === 'win32' && fs.existsSync(FIXTURE_PATH) && fs.existsSync(EXE_PATH);
const describePackaged = fixtureAvailable ? test : test.skip;

describePackaged('packaged P2-9 hotkey: real registration, conflict rejection, broadcast (10/10), write/freeze/unfreeze/revert cycle, stale-session rejection — from packaged resources', async () => {
  test.setTimeout(180_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const userDataDir = path.join(os.tmpdir(), `solith-p29-hotkey-pkg-userdata-${runId}`);
  const appDataDir = path.join(os.tmpdir(), `solith-p29-hotkey-pkg-appdata-${runId}`);
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(appDataDir, { recursive: true });

  const fixture = await spawnFixture();
  const markerAddrHex = `0x${(BigInt(fixture.fields.MUTATION_REGION_BASE) + BigInt(fixture.fields.MUTATION_MARKER_OFFSET)).toString(16)}`;
  const stopKeepalive = startFixtureKeepalive(fixture);

  const electronApp: ElectronApplication = await electron.launch({
    executablePath: EXE_PATH,
    env: {
      ...process.env,
      ELECTRON_USER_DATA_PATH: userDataDir,
      APPDATA: appDataDir,
      USERPROFILE: appDataDir,
      NODE_ENV: 'test',
      SOLITH_PRIVILEGED_CONSENT: 'auto-approve',
      SOLITH_TEST_BUILD: '1',
    },
  });
  electronApp.process().stderr?.on('data', (chunk) => process.stderr.write(`[main] ${chunk}`));

  try {
    const win: Page = await electronApp.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForSelector('#root > *', { timeout: 20_000 });
    await new Promise((r) => setTimeout(r, 1000));

    // Real OS-level registration from packaged resources.
    const f1Registered: boolean = await electronApp.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('F1'));
    expect(f1Registered, 'cheat_slot_1 (F1) must be really registered from the packaged build').toBe(true);

    // Real OS-level conflict rejection.
    const conflictResult: boolean = await electronApp.evaluate(({ globalShortcut }) => globalShortcut.register('F1', () => {}));
    expect(conflictResult, 'registering an already-owned accelerator must be genuinely rejected by the real globalShortcut API').toBe(false);
    const stillOwned: boolean = await electronApp.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('F1'));
    expect(stillOwned).toBe(true);

    // Real broadcast reaches the real renderer, 10/10 independent presses.
    await win.evaluate(() => {
      (window as any).__hotkeyEvents = [];
      (window as any).electronAPI.onTrainerHotkey((p: { action: string }) => (window as any).__hotkeyEvents.push(p.action));
    });
    for (let press = 1; press <= 10; press++) {
      await win.evaluate(() => {
        (window as any).__hotkeyEvents = [];
      });
      await electronApp.evaluate(({ BrowserWindow }) => {
        for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('trainer-hotkey', { action: 'cheat_slot_1' });
      });
      await win.waitForFunction(() => (window as any).__hotkeyEvents?.length > 0, undefined, { timeout: 5_000 });
      const receivedThisPress: string[] = await win.evaluate(() => (window as any).__hotkeyEvents);
      expect(receivedThisPress, `press ${press}/10 must be received`).toContain('cheat_slot_1');
    }

    // Real attach + real hotkey-triggered write/verify/revert cycle. A
    // freshly-spawned process can briefly lack full OS-queryable identity
    // metadata (matching the same real characteristic documented in
    // p2-9-hotkey-real-process.e2e.test.ts's fixture-keepalive note) —
    // retry rather than assume the first attempt lands.
    let attachResult: { success?: boolean; error?: string } | undefined;
    for (let attempt = 0; attempt < 5 && !attachResult?.success; attempt++) {
      attachResult = await win.evaluate(
        async (pid: number) =>
          (window as any).electronAPI.liveMemoryAttach({ pid, executableName: 'solith-scanner-fixture.exe', userConfirmedOffline: true }),
        fixture.child.pid!,
      );
      if (!attachResult?.success) await new Promise((r) => setTimeout(r, 1000));
    }
    expect(attachResult?.success, `attach must succeed: ${JSON.stringify(attachResult)}`).toBe(true);

    const propose = await win.evaluate(
      async (args: [string, number]) => (window as any).electronAPI.liveMemoryProposeWrite({ address: args[0], dataType: 'int32', requestedValue: args[1] }),
      [markerAddrHex, 8675309],
    );
    expect(propose?.error, `propose failed: ${JSON.stringify(propose)}`).toBeUndefined();
    const consent = await win.evaluate(
      async (id: string) => (window as any).electronAPI.liveMemoryIssueWriteConsent({ proposalId: id }),
      propose.proposal.proposalId,
    );
    expect(consent?.error, `consent failed: ${JSON.stringify(consent)}`).toBeUndefined();
    const confirm = await win.evaluate(
      async (args: [string, string]) => (window as any).electronAPI.liveMemoryConfirmWrite({ proposalId: args[0], consentToken: args[1] }),
      [propose.proposal.proposalId, consent.consent.tokenId],
    );
    expect(confirm?.error, `confirm failed: ${JSON.stringify(confirm)}`).toBeUndefined();
    const afterWrite = await win.evaluate(
      async (addr: string) => (window as any).electronAPI.liveMemoryRead({ address: addr, dataType: 'int32' }),
      markerAddrHex,
    );
    expect(afterWrite?.value).toBe(8675309);

    // Real freeze -> enforcement -> unfreeze, through the real two-phase-consent IPC.
    const freezePropose = await win.evaluate(
      async (args: [string, number]) => (window as any).electronAPI.liveMemoryFreezePropose({ address: args[0], dataType: 'int32', value: args[1], intervalMs: 50 }),
      [markerAddrHex, 7777],
    );
    expect(freezePropose?.error, `freeze propose failed: ${JSON.stringify(freezePropose)}`).toBeUndefined();
    const freezeConsent = await win.evaluate(
      async (id: string) => (window as any).electronAPI.liveMemoryFreezeRequestConsent({ proposalId: id }),
      freezePropose.proposal.proposalId,
    );
    expect(freezeConsent?.error, `freeze consent failed: ${JSON.stringify(freezeConsent)}`).toBeUndefined();
    const freezeStart = await win.evaluate(
      async (args: [string, string]) => (window as any).electronAPI.liveMemoryFreezeStart({ proposalId: args[0], consentToken: args[1] }),
      [freezePropose.proposal.proposalId, freezeConsent.consent.tokenId],
    );
    expect(freezeStart?.success, `freeze start failed: ${JSON.stringify(freezeStart)}`).toBe(true);

    let frozenValue: number | undefined;
    for (let i = 0; i < 20 && frozenValue !== 7777; i++) {
      await new Promise((r) => setTimeout(r, 300));
      const read = await win.evaluate(
        async (addr: string) => (window as any).electronAPI.liveMemoryRead({ address: addr, dataType: 'int32' }),
        markerAddrHex,
      );
      frozenValue = read?.value;
    }
    expect(frozenValue, 'frozen value must be genuinely enforced').toBe(7777);

    const freezeStop = await win.evaluate(async () => (window as any).electronAPI.liveMemoryFreezeStop());
    expect(freezeStop?.success, `freeze stop failed: ${JSON.stringify(freezeStop)}`).toBe(true);

    const restorePropose = await win.evaluate(
      async (args: [string, number]) => (window as any).electronAPI.liveMemoryProposeWrite({ address: args[0], dataType: 'int32', requestedValue: args[1] }),
      [markerAddrHex, -573785174],
    );
    const restoreConsent = await win.evaluate(
      async (id: string) => (window as any).electronAPI.liveMemoryIssueWriteConsent({ proposalId: id }),
      restorePropose.proposal.proposalId,
    );
    const restoreConfirm = await win.evaluate(
      async (args: [string, string]) => (window as any).electronAPI.liveMemoryConfirmWrite({ proposalId: args[0], consentToken: args[1] }),
      [restorePropose.proposal.proposalId, restoreConsent.consent.tokenId],
    );
    expect(restoreConfirm?.error, `revert failed: ${JSON.stringify(restoreConfirm)}`).toBeUndefined();
    const afterRevert = await win.evaluate(
      async (addr: string) => (window as any).electronAPI.liveMemoryRead({ address: addr, dataType: 'int32' }),
      markerAddrHex,
    );
    expect(afterRevert?.value).toBe(-573785174);

    // Stale/no-session rejection.
    await win.evaluate(async () => (window as any).electronAPI.liveMemoryDetach());
    const staleWrite = await win.evaluate(
      async (addr: string) => (window as any).electronAPI.liveMemoryProposeWrite({ address: addr, dataType: 'int32', requestedValue: 1 }),
      markerAddrHex,
    );
    expect(staleWrite?.error, 'a write proposed after detach must be a truthful failure, never a stale success').toBeDefined();
  } finally {
    stopKeepalive();
    await electronApp.close().catch(() => {});
    killFixture(fixture);
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(appDataDir, { recursive: true, force: true });
  }
});
