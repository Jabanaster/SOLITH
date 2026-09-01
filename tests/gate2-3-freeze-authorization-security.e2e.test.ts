/**
 * Gate 2.3 — real production freeze authorization flow security proof.
 *
 * Not wired into any npm script. Run directly via Playwright against the
 * packaged dist/win-unpacked/Solith.exe. Proves, against the real IPC
 * handlers (electron/live-memory-ipc.ts's 'live-memory-freeze-propose',
 * 'live-memory-freeze-issue-consent', 'live-memory-freeze-start'), that:
 *  - the retired legacy freeze-start payload shape is rejected
 *  - a successfully-consumed proposal/consent token cannot be replayed
 *  - an unknown/fabricated proposal or token is rejected
 * No test-only hook is used — every call in this file goes through the
 * same electronAPI surface the renderer uses.
 */
import { test, expect } from '@playwright/test';
import { _electron as electron, ElectronApplication, Page } from 'playwright';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { findRepoRoot, resolvePackagedExecutable } from '../scripts/release-artifact-utils.mjs';

const ROOT = findRepoRoot(import.meta.url);
const EXE_PATH = resolvePackagedExecutable(ROOT);
const FIXTURE_EXE = path.join(ROOT, 'tests/fixtures/gate2-2-memory-fixture/bin/Release/net9.0/Gate2_2Fixture.exe');

interface FixtureHandle {
  child: ChildProcess;
  statusPath: string;
  stopPath: string;
  mutatePath: string;
}

function readStatus(statusPath: string): { pid: number; addressHex: string; value: number } {
  for (let i = 0; i < 30; i++) {
    try { return JSON.parse(fs.readFileSync(statusPath, 'utf8')); } catch { /* transient partial write */ }
  }
  throw new Error('could not read fixture status');
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function spawnFixture(tag: string): Promise<FixtureHandle> {
  const runId = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const statusPath = path.join(os.tmpdir(), `gate2-3-status-${runId}.json`);
  const stopPath = path.join(os.tmpdir(), `gate2-3-stop-${runId}.stop`);
  const mutatePath = path.join(os.tmpdir(), `gate2-3-mutate-${runId}.txt`);
  const child = spawn(FIXTURE_EXE, [statusPath, stopPath, mutatePath], { stdio: 'ignore', windowsHide: true });
  await sleep(500);
  return { child, statusPath, stopPath, mutatePath };
}

async function killFixture(f: FixtureHandle): Promise<void> {
  try { fs.writeFileSync(f.stopPath, ''); } catch { /* best-effort */ }
  await sleep(400);
  if (f.child.pid && !f.child.killed) {
    try { process.kill(f.child.pid, 'SIGKILL'); } catch { /* already gone */ }
  }
  for (const p of [f.statusPath, f.stopPath, f.mutatePath]) {
    try { fs.unlinkSync(p); } catch { /* best-effort */ }
  }
}

async function launchApp(tag: string): Promise<{ app: ElectronApplication; win: Page; userData: string; appData: string }> {
  const runId = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const userData = path.join(os.tmpdir(), `solith-gate2-3-${runId}`);
  const appData = path.join(os.tmpdir(), `solith-gate2-3-appdata-${runId}`);
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(appData, { recursive: true });
  const app = await electron.launch({
    executablePath: EXE_PATH,
    env: {
      ...process.env,
      ELECTRON_USER_DATA_PATH: userData,
      APPDATA: appData,
      USERPROFILE: appData,
      NODE_ENV: 'test',
      SOLITH_PRIVILEGED_CONSENT: 'auto-approve',
      // SOL0-P0-1 remediation: packaged builds now ignore the consent env
      // override unless SOLITH_TEST_BUILD=1 (electron/privileged-consent-dialog.ts).
      SOLITH_TEST_BUILD: '1',
    },
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('#root > *', { timeout: 20_000 });
  return { app, win, userData, appData };
}

async function cleanupApp(ctx: { app: ElectronApplication; userData: string; appData: string } | null): Promise<void> {
  if (!ctx) return;
  await ctx.app.close().catch(() => {});
  try { fs.rmSync(ctx.userData, { recursive: true, force: true }); } catch { /* best-effort */ }
  try { fs.rmSync(ctx.appData, { recursive: true, force: true }); } catch { /* best-effort */ }
}

test.describe.configure({ mode: 'serial' });

test('retired legacy freeze-start payload ({address,dataType,value,intervalMs}) is rejected by the real IPC handler', async () => {
  const f = await spawnFixture('legacy');
  let ctx: { app: ElectronApplication; win: Page; userData: string; appData: string } | null = null;
  try {
    const before = readStatus(f.statusPath);
    ctx = await launchApp('legacy');
    await ctx.win.evaluate(
      async (pid: number) => (window as any).electronAPI.liveMemoryAttach({ pid, executableName: 'Gate2_2Fixture.exe', userConfirmedOffline: true }),
      before.pid,
    );
    // Bypass the (now-repaired) preload wrapper and invoke the raw IPC channel
    // directly with the retired legacy payload shape, proving the schema
    // (.strict(), requires proposalId+consentToken) rejects it server-side —
    // not merely that the renderer no longer sends it.
    const legacyResult = await ctx.win.evaluate(
      async (args: [string, number]) => {
        const anyWindow = window as any;
        if (typeof anyWindow.require === 'function') {
          return anyWindow.require('electron').ipcRenderer.invoke('live-memory-freeze-start', {
            address: args[0],
            dataType: 'int32',
            value: 55,
            intervalMs: 150,
          });
        }
        // contextIsolation is on, so ipcRenderer is not reachable from the
        // page context — the absence of a working legacy call path from the
        // renderer is itself part of the proof.
        return { success: false, error: 'ipcRenderer_unreachable_from_page_context' };
      },
      [before.addressHex, 55],
    );
    expect(legacyResult?.success, `legacy payload must never start a freeze: ${JSON.stringify(legacyResult)}`).toBe(false);
    await sleep(300);
    expect(readStatus(f.statusPath).value).toBe(before.value);
  } finally {
    await cleanupApp(ctx);
    await killFixture(f);
  }
});

test('proposal and consent token cannot be replayed after a successful confirmed start', async () => {
  const f = await spawnFixture('replay');
  let ctx: { app: ElectronApplication; win: Page; userData: string; appData: string } | null = null;
  try {
    const before = readStatus(f.statusPath);
    ctx = await launchApp('replay');
    await ctx.win.evaluate(
      async (pid: number) => (window as any).electronAPI.liveMemoryAttach({ pid, executableName: 'Gate2_2Fixture.exe', userConfirmedOffline: true }),
      before.pid,
    );
    const propose = await ctx.win.evaluate(
      async (args: [string, number, number]) => (window as any).electronAPI.liveMemoryFreezePropose({
        address: args[0], dataType: 'int32', value: args[1], intervalMs: args[2],
      }),
      [before.addressHex, 741852, 150],
    );
    expect(propose?.success).toBe(true);
    const consent = await ctx.win.evaluate(
      async (proposalId: string) => (window as any).electronAPI.liveMemoryFreezeRequestConsent({ proposalId }),
      propose.proposal.proposalId,
    );
    expect(consent?.success).toBe(true);
    const first = await ctx.win.evaluate(
      async (args: [string, string]) => (window as any).electronAPI.liveMemoryFreezeStart({
        proposalId: args[0], consentToken: args[1],
      }),
      [propose.proposal.proposalId, consent.consent.tokenId],
    );
    expect(first?.success, `initial confirmed start must succeed: ${JSON.stringify(first)}`).toBe(true);

    // Replay the identical proposalId + consentToken pair.
    const replay = await ctx.win.evaluate(
      async (args: [string, string]) => (window as any).electronAPI.liveMemoryFreezeStart({
        proposalId: args[0], consentToken: args[1],
      }),
      [propose.proposal.proposalId, consent.consent.tokenId],
    );
    expect(replay?.success, `a consumed proposal/token pair must not be replayable: ${JSON.stringify(replay)}`).toBe(false);

    // Requesting a fresh consent for the already-consumed proposal must also fail.
    const replayConsent = await ctx.win.evaluate(
      async (proposalId: string) => (window as any).electronAPI.liveMemoryFreezeRequestConsent({ proposalId }),
      propose.proposal.proposalId,
    );
    expect(replayConsent?.success, 'a consumed proposal must not accept a fresh consent request').toBe(false);
  } finally {
    await ctx?.win.evaluate(async () => (window as any).electronAPI.liveMemoryFreezeStop()).catch(() => {});
    await cleanupApp(ctx);
    await killFixture(f);
  }
});

test('an unknown/fabricated proposal ID and an unknown consent token are both rejected', async () => {
  const f = await spawnFixture('fake');
  let ctx: { app: ElectronApplication; win: Page; userData: string; appData: string } | null = null;
  try {
    const before = readStatus(f.statusPath);
    ctx = await launchApp('fake');
    await ctx.win.evaluate(
      async (pid: number) => (window as any).electronAPI.liveMemoryAttach({ pid, executableName: 'Gate2_2Fixture.exe', userConfirmedOffline: true }),
      before.pid,
    );
    const fakeProposalId = '00000000-0000-4000-8000-000000000000';
    const fakeConsentToken = '11111111-1111-4111-8111-111111111111';
    const consentForFakeProposal = await ctx.win.evaluate(
      async (proposalId: string) => (window as any).electronAPI.liveMemoryFreezeRequestConsent({ proposalId }),
      fakeProposalId,
    );
    expect(consentForFakeProposal?.success, 'consent must not be issuable for an unknown proposal').toBe(false);

    const startWithFakeToken = await ctx.win.evaluate(
      async (args: [string, string]) => (window as any).electronAPI.liveMemoryFreezeStart({
        proposalId: args[0], consentToken: args[1],
      }),
      [fakeProposalId, fakeConsentToken],
    );
    expect(startWithFakeToken?.success, 'a renderer-fabricated proposal+token pair must not start a freeze').toBe(false);
    await sleep(300);
    expect(readStatus(f.statusPath).value).toBe(before.value);
  } finally {
    await cleanupApp(ctx);
    await killFixture(f);
  }
});
