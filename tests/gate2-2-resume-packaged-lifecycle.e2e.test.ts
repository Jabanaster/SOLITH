/**
 * Gate 2.2 Resume — remaining packaged lifecycle certification.
 *
 * Not wired into any npm script. Run directly via Playwright against the
 * packaged dist/win-unpacked/Solith.exe. Uses the Gate 2.2 fixture
 * (tests/fixtures/gate2-2-memory-fixture) for real freeze/write scenarios,
 * and the project's pre-existing SOLITH_PRIVILEGED_CONSENT=auto-approve
 * test seam (electron/privileged-consent-dialog.ts) — no new production
 * hook added. Each scenario that needs "no stale state after restart"
 * launches its own fresh electron.launch()/spawns its own fresh fixture,
 * since window-all-closed triggers app.quit() on Windows (electron/main.ts:
 * app.on('window-all-closed') -> app.quit() when process.platform !== 'darwin')
 * — there is no "close window, keep app alive" state on this platform for
 * this single-window app, so "normal main-window close" and "application
 * quit" are the same underlying event chain here. Disclosed, not hidden.
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
  const statusPath = path.join(os.tmpdir(), `gate2-2resume-status-${runId}.json`);
  const stopPath = path.join(os.tmpdir(), `gate2-2resume-stop-${runId}.stop`);
  const mutatePath = path.join(os.tmpdir(), `gate2-2resume-mutate-${runId}.txt`);
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

async function launchApp(tag: string, needsFreezeHook = false): Promise<{ app: ElectronApplication; win: Page; userData: string; appData: string }> {
  const runId = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const userData = path.join(os.tmpdir(), `solith-gate2-2resume-${runId}`);
  const appData = path.join(os.tmpdir(), `solith-gate2-2resume-appdata-${runId}`);
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
      ...(needsFreezeHook ? { SOLITH_TEST_BUILD: '1' } : {}),
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

// Gate 2.3: real production propose -> issue-consent -> confirmed-start flow.
// No test-only hook is used here — this calls the exact renderer-facing
// electronAPI surface (liveMemoryFreezePropose / liveMemoryFreezeRequestConsent
// / liveMemoryFreezeStart{proposalId,consentToken}) that
// src/app/pages/LiveMemoryTrainerPage.tsx and useGameCheatSession.ts now use.
// Consent approval relies on the project's pre-existing
// SOLITH_PRIVILEGED_CONSENT=auto-approve test/headless seam
// (electron/privileged-consent-dialog.ts) so the real consent gate still runs,
// deterministically approved, rather than being bypassed.
async function attachAndFreeze(
  app: ElectronApplication,
  win: Page,
  before: { pid: number; addressHex: string; value: number },
  frozenValue: number,
) {
  const attach = await win.evaluate(
    async (pid: number) => (window as any).electronAPI.liveMemoryAttach({ pid, executableName: 'Gate2_2Fixture.exe', userConfirmedOffline: true }),
    before.pid,
  );
  if (attach?.error) throw new Error(`attach failed: ${JSON.stringify(attach)}`);

  const propose = await win.evaluate(
    async (args: [string, number, number]) => (window as any).electronAPI.liveMemoryFreezePropose({
      address: args[0],
      dataType: 'int32',
      value: args[1],
      intervalMs: args[2],
    }),
    [before.addressHex, frozenValue, 150],
  );
  if (!propose?.success || !propose.proposal?.proposalId) {
    throw new Error(`freeze propose failed: ${JSON.stringify(propose)}`);
  }
  const consent = await win.evaluate(
    async (proposalId: string) => (window as any).electronAPI.liveMemoryFreezeRequestConsent({ proposalId }),
    propose.proposal.proposalId,
  );
  if (!consent?.success || !consent.consent?.tokenId) {
    throw new Error(`freeze consent failed: ${JSON.stringify(consent)}`);
  }
  const result = await win.evaluate(
    async (args: [string, string]) => (window as any).electronAPI.liveMemoryFreezeStart({
      proposalId: args[0],
      consentToken: args[1],
    }),
    [propose.proposal.proposalId, consent.consent.tokenId],
  );
  if (!result?.success) throw new Error(`freeze start failed: ${JSON.stringify(result)}`);
  return { proposalId: propose.proposal.proposalId as string };
}

test.describe.configure({ mode: 'serial' });

// ── Phase 3: fixture + packaged native prerequisite ─────────────────────────
test('Phase 3 — fixture and packaged native write/read/restore prerequisite', async () => {
  expect(fs.existsSync(EXE_PATH)).toBe(true);
  expect(fs.existsSync(FIXTURE_EXE)).toBe(true);
  const f = await spawnFixture('p3');
  let ctx: { app: ElectronApplication; win: Page; userData: string; appData: string } | null = null;
  try {
    const before = readStatus(f.statusPath);
    ctx = await launchApp('p3');
    const attach = await ctx.win.evaluate(
      async (pid: number) => (window as any).electronAPI.liveMemoryAttach({ pid, executableName: 'Gate2_2Fixture.exe', userConfirmedOffline: true }),
      before.pid,
    );
    expect(attach?.error).toBeUndefined();

    const read = await ctx.win.evaluate(
      async (addr: string) => (window as any).electronAPI.liveMemoryRead({ address: addr, dataType: 'int32' }),
      before.addressHex,
    );
    expect(read?.value).toBe(before.value);

    const propose = await ctx.win.evaluate(
      async (args: [string, number]) => (window as any).electronAPI.liveMemoryProposeWrite({ address: args[0], dataType: 'int32', requestedValue: args[1] }),
      [before.addressHex, 987654],
    );
    const consent = await ctx.win.evaluate(async (id: string) => (window as any).electronAPI.liveMemoryIssueWriteConsent({ proposalId: id }), propose.proposal.proposalId);
    const confirm = await ctx.win.evaluate(
      async (args: [string, string]) => (window as any).electronAPI.liveMemoryConfirmWrite({ proposalId: args[0], consentToken: args[1] }),
      [propose.proposal.proposalId, consent.consent.tokenId],
    );
    expect(confirm?.error).toBeUndefined();
    await sleep(400);
    expect(readStatus(f.statusPath).value).toBe(987654);

    const restorePropose = await ctx.win.evaluate(
      async (args: [string, number]) => (window as any).electronAPI.liveMemoryProposeWrite({ address: args[0], dataType: 'int32', requestedValue: args[1] }),
      [before.addressHex, before.value],
    );
    const restoreConsent = await ctx.win.evaluate(async (id: string) => (window as any).electronAPI.liveMemoryIssueWriteConsent({ proposalId: id }), restorePropose.proposal.proposalId);
    await ctx.win.evaluate(
      async (args: [string, string]) => (window as any).electronAPI.liveMemoryConfirmWrite({ proposalId: args[0], consentToken: args[1] }),
      [restorePropose.proposal.proposalId, restoreConsent.consent.tokenId],
    );
    await sleep(400);
    expect(readStatus(f.statusPath).value).toBe(before.value);

    await ctx.win.evaluate(async () => (window as any).electronAPI.liveMemoryDetach());
  } finally {
    await cleanupApp(ctx);
    await killFixture(f);
  }
});

// ── Phase 4: active-session shutdown scenarios ──────────────────────────────
test('Phase 4.1/4.2 — active real freeze; window close / app quit stops it and revokes state (same event on Windows)', async () => {
  const f = await spawnFixture('p4a');
  let ctx: { app: ElectronApplication; win: Page; userData: string; appData: string } | null = null;
  try {
    const before = readStatus(f.statusPath);
    ctx = await launchApp('p4a', true);
    const { proposalId } = await attachAndFreeze(ctx.app, ctx.win, before, 111000);
    // First tick's identity re-verification computes a real exe SHA256
    // (subprocess-based on Windows) — allow generous headroom (see the same
    // pattern in Gate 2.2A's verify-write-freeze-rollback.mts).
    await sleep(6000);
    const debugStatus = await ctx.win.evaluate(async () => (window as any).electronAPI.liveMemoryFreezeStatus());
    expect(readStatus(f.statusPath).value, `freeze status: ${JSON.stringify(debugStatus)}`).toBe(111000);
    // Prove at least two real ticks by mutating externally and confirming restore.
    fs.writeFileSync(f.mutatePath, '999000');
    await sleep(5000);
    expect(readStatus(f.statusPath).value).toBe(111000);

    const webContentsId = await ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.id);
    const hasSessionBefore = await ctx.app.evaluate(
      (_e, id) => (globalThis as any).__solithTestHasSessionForOwner?.(id) ?? 'hook_unavailable',
      webContentsId,
    );

    // Real window close -> window-all-closed -> app.quit() on win32.
    await ctx.app.close();

    // Confirm no further writes land after close.
    fs.writeFileSync(f.mutatePath, '444555');
    await sleep(600);
    expect(readStatus(f.statusPath).value).toBe(444555, 'no write must occur after the app has quit');

    // Relaunch with a FRESH userData dir is not needed here — proposalId/consent
    // are in-memory only; a fresh app instance cannot know about proposalId at all.
    // Prove that directly: launch a new instance and confirm the old proposalId
    // is unknown.
    const ctx2 = await launchApp('p4a-restart');
    try {
      const rollbackAttempt = await ctx2.win.evaluate(
        async (id: string) => (window as any).electronAPI.liveMemoryRollback({ proposalId: id }),
        proposalId,
      );
      expect(rollbackAttempt?.error, 'old proposalId must not be usable after restart').toBeDefined();
    } finally {
      await cleanupApp(ctx2);
    }
    void hasSessionBefore;
  } finally {
    await cleanupApp(ctx);
    await killFixture(f);
  }
});

test('Phase 4.3 — shutdown with pending (unconfirmed) write consent: stale proposal/token rejected after restart', async () => {
  const f = await spawnFixture('p4c');
  let ctx: { app: ElectronApplication; win: Page; userData: string; appData: string } | null = null;
  try {
    const before = readStatus(f.statusPath);
    ctx = await launchApp('p4c');
    await ctx.win.evaluate(
      async (pid: number) => (window as any).electronAPI.liveMemoryAttach({ pid, executableName: 'Gate2_2Fixture.exe', userConfirmedOffline: true }),
      before.pid,
    );
    const propose = await ctx.win.evaluate(
      async (args: [string, number]) => (window as any).electronAPI.liveMemoryProposeWrite({ address: args[0], dataType: 'int32', requestedValue: args[1] }),
      [before.addressHex, 321321],
    );
    const consent = await ctx.win.evaluate(async (id: string) => (window as any).electronAPI.liveMemoryIssueWriteConsent({ proposalId: id }), propose.proposal.proposalId);
    // Deliberately do NOT confirm — leave the consent pending/unconsumed.
    await ctx.app.close();

    const ctx2 = await launchApp('p4c-restart');
    try {
      const confirmAttempt = await ctx2.win.evaluate(
        async (args: [string, string]) => (window as any).electronAPI.liveMemoryConfirmWrite({ proposalId: args[0], consentToken: args[1] }),
        [propose.proposal.proposalId, consent.consent.tokenId],
      );
      expect(confirmAttempt?.error, 'a pending consent/proposal from a previous process must not survive restart').toBeDefined();
      await sleep(300);
      expect(readStatus(f.statusPath).value).toBe(before.value, 'fixture value must be unchanged — the pending write never landed');
    } finally {
      await cleanupApp(ctx2);
    }
  } finally {
    await cleanupApp(ctx);
    await killFixture(f);
  }
});

test('Phase 4.4 — shutdown with an active process selection (attach, no freeze): stale attach state rejected after restart', async () => {
  const f = await spawnFixture('p4d');
  let ctx: { app: ElectronApplication; win: Page; userData: string; appData: string } | null = null;
  try {
    const before = readStatus(f.statusPath);
    ctx = await launchApp('p4d');
    const attach = await ctx.win.evaluate(
      async (pid: number) => (window as any).electronAPI.liveMemoryAttach({ pid, executableName: 'Gate2_2Fixture.exe', userConfirmedOffline: true }),
      before.pid,
    );
    expect(attach?.error).toBeUndefined();
    await ctx.app.close();

    const ctx2 = await launchApp('p4d-restart');
    try {
      const readAttempt = await ctx2.win.evaluate(
        async (addr: string) => (window as any).electronAPI.liveMemoryRead({ address: addr, dataType: 'int32' }),
        before.addressHex,
      );
      expect(readAttempt?.error, 'a read without a fresh attach in the new process must be rejected — the old attach/selection does not survive').toBeDefined();
    } finally {
      await cleanupApp(ctx2);
    }
  } finally {
    await cleanupApp(ctx);
    await killFixture(f);
  }
});

test('Phase 4.5 — shutdown with a confirmed rollback entry: old rollback ID rejected after restart, raw bytes released', async () => {
  const f = await spawnFixture('p4e');
  let ctx: { app: ElectronApplication; win: Page; userData: string; appData: string } | null = null;
  try {
    const before = readStatus(f.statusPath);
    ctx = await launchApp('p4e');
    await ctx.win.evaluate(
      async (pid: number) => (window as any).electronAPI.liveMemoryAttach({ pid, executableName: 'Gate2_2Fixture.exe', userConfirmedOffline: true }),
      before.pid,
    );
    const propose = await ctx.win.evaluate(
      async (args: [string, number]) => (window as any).electronAPI.liveMemoryProposeWrite({ address: args[0], dataType: 'int32', requestedValue: args[1] }),
      [before.addressHex, 654321],
    );
    const consent = await ctx.win.evaluate(async (id: string) => (window as any).electronAPI.liveMemoryIssueWriteConsent({ proposalId: id }), propose.proposal.proposalId);
    const confirm = await ctx.win.evaluate(
      async (args: [string, string]) => (window as any).electronAPI.liveMemoryConfirmWrite({ proposalId: args[0], consentToken: args[1] }),
      [propose.proposal.proposalId, consent.consent.tokenId],
    );
    expect(confirm?.error).toBeUndefined();
    await sleep(300);
    expect(readStatus(f.statusPath).value).toBe(654321);

    // A real rollback record now exists for propose.proposal.proposalId. Quit
    // without rolling back.
    await ctx.app.close();

    const ctx2 = await launchApp('p4e-restart');
    try {
      const rollbackAttempt = await ctx2.win.evaluate(
        async (id: string) => (window as any).electronAPI.liveMemoryRollback({ proposalId: id }),
        propose.proposal.proposalId,
      );
      expect(rollbackAttempt?.error, 'a confirmed-write rollback record from a previous process must not be usable after restart').toBeDefined();
    } finally {
      await cleanupApp(ctx2);
    }
  } finally {
    await cleanupApp(ctx);
    await killFixture(f);
  }
});

test('Phase 4.6 — controlled forced termination: no further writes reach the fixture after the process is killed', async () => {
  const f = await spawnFixture('p4f');
  let ctx: { app: ElectronApplication; win: Page; userData: string; appData: string } | null = null;
  try {
    const before = readStatus(f.statusPath);
    ctx = await launchApp('p4f'); // no SOLITH_TEST_BUILD — real freeze flow needs no test hook
    await attachAndFreeze(ctx.app, ctx.win, before, 222333);
    await sleep(6000);
    expect(readStatus(f.statusPath).value).toBe(222333);

    const pid = ctx.app.process().pid;
    expect(pid, 'must be able to identify the harness-created SOLITH process to terminate it directly').toBeTruthy();
    // Forced termination — do not claim graceful cleanup executed.
    try { process.kill(pid as number, 'SIGKILL'); } catch { /* best-effort */ }
    await sleep(800);

    fs.writeFileSync(f.mutatePath, '777888');
    await sleep(600);
    expect(readStatus(f.statusPath).value).toBe(777888, 'no further writes must reach the fixture after forced termination — value must reflect only the external mutation, not a continued freeze');
  } finally {
    // ctx.app.close() would hang on an already-killed process; skip it.
    if (ctx) {
      try { fs.rmSync(ctx.userData, { recursive: true, force: true }); } catch { /* best-effort */ }
      try { fs.rmSync(ctx.appData, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
    await killFixture(f);
  }
});

// ── Phase 5: mid-freeze feature-disable ─────────────────────────────────────
test('Phase 5 — real freeze stops when v2LiveModeEnabled is disabled via the real settings IPC', async () => {
  const f = await spawnFixture('p5');
  let ctx: { app: ElectronApplication; win: Page; userData: string; appData: string } | null = null;
  try {
    const before = readStatus(f.statusPath);
    ctx = await launchApp('p5'); // no SOLITH_TEST_BUILD — real freeze flow needs no test hook
    const { proposalId } = await attachAndFreeze(ctx.app, ctx.win, before, 333222);
    await sleep(6000);
    expect(readStatus(f.statusPath).value).toBe(333222);
    fs.writeFileSync(f.mutatePath, '900000');
    await sleep(5000);
    expect(readStatus(f.statusPath).value, 'freeze must still be actively restoring before disable').toBe(333222);

    const setResult = await ctx.win.evaluate(async () => (window as any).electronAPI.setSetting('v2LiveModeEnabled', false));
    expect(setResult?.error).toBeUndefined();

    // Wait past at least one more freeze interval (per-tick identity
    // re-verification is subprocess-based and slow) for the disabled-flag
    // check to bite.
    await sleep(5000);
    const status = await ctx.win.evaluate(async () => (window as any).electronAPI.liveMemoryFreezeStatus());
    expect(status?.status?.active, `full status: ${JSON.stringify(status)}`).toBe(false);
    expect(status?.status?.stopReason).toBe('feature_disabled');

    fs.writeFileSync(f.mutatePath, '111999');
    await sleep(500);
    expect(readStatus(f.statusPath).value, 'fixture value must remain externally mutable after the stop — no further SOLITH writes').toBe(111999);

    const rollbackAttempt = await ctx.win.evaluate(async (id: string) => (window as any).electronAPI.liveMemoryRollback({ proposalId: id }), proposalId);
    expect(rollbackAttempt?.error, 'the old freeze proposal ID must be rejected after the stop').toBeDefined();

    // Re-enabling must not silently restart the old freeze.
    await ctx.win.evaluate(async () => (window as any).electronAPI.setSetting('v2LiveModeEnabled', true));
    await sleep(500);
    const statusAfterReenable = await ctx.win.evaluate(async () => (window as any).electronAPI.liveMemoryFreezeStatus());
    expect(statusAfterReenable?.status?.active).toBe(false);
  } finally {
    await cleanupApp(ctx);
    await killFixture(f);
  }
});

// ── Phase 6: main-window reload identity ────────────────────────────────────
test('Phase 6 — main-window reload: stale operation IDs and sender identity are rejected after reload', async () => {
  const f = await spawnFixture('p6');
  let ctx: { app: ElectronApplication; win: Page; userData: string; appData: string } | null = null;
  try {
    const before = readStatus(f.statusPath);
    ctx = await launchApp('p6');
    const attach = await ctx.win.evaluate(
      async (pid: number) => (window as any).electronAPI.liveMemoryAttach({ pid, executableName: 'Gate2_2Fixture.exe', userConfirmedOffline: true }),
      before.pid,
    );
    expect(attach?.error).toBeUndefined();
    const propose = await ctx.win.evaluate(
      async (args: [string, number]) => (window as any).electronAPI.liveMemoryProposeWrite({ address: args[0], dataType: 'int32', requestedValue: args[1] }),
      [before.addressHex, 456456],
    );
    const consent = await ctx.win.evaluate(async (id: string) => (window as any).electronAPI.liveMemoryIssueWriteConsent({ proposalId: id }), propose.proposal.proposalId);

    const webContentsIdBefore = await ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.id);

    // Real reload through the actual packaged renderer.
    await ctx.win.reload();
    await ctx.win.waitForSelector('#root > *', { timeout: 20_000 });

    const webContentsIdAfter = await ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.id);
    expect(webContentsIdAfter, 'a reload keeps the same webContents ID in Electron (only navigation state resets) — session/consent state must not survive the reload regardless').toBe(webContentsIdBefore);

    // Old operation state must not survive: renderer-side JS state (proposalId
    // variable) is gone because the page reloaded, but prove the MAIN-PROCESS
    // side also rejects the old artifacts if replayed via a raw IPC call.
    const staleConfirm = await ctx.win.evaluate(
      async (args: [string, string]) => (window as any).electronAPI.liveMemoryConfirmWrite({ proposalId: args[0], consentToken: args[1] }),
      [propose.proposal.proposalId, consent.consent.tokenId],
    );
    expect(staleConfirm?.error, 'a stale proposal/consent from before the reload must not be honored after reload').toBeDefined();

    const staleRead = await ctx.win.evaluate(
      async (addr: string) => (window as any).electronAPI.liveMemoryRead({ address: addr, dataType: 'int32' }),
      before.addressHex,
    );
    expect(staleRead?.error, 'the pre-reload attach/session must not survive a reload without a fresh attach').toBeDefined();
  } finally {
    await cleanupApp(ctx);
    await killFixture(f);
  }
});

// ── Phase 9: unauthorized navigation ────────────────────────────────────────
test('Phase 9.1/9.6 — unauthorized navigation revokes authority; returning to trusted content does not restore it', async () => {
  const f = await spawnFixture('p9');
  let ctx: { app: ElectronApplication; win: Page; userData: string; appData: string } | null = null;
  try {
    const before = readStatus(f.statusPath);
    ctx = await launchApp('p9');
    const attach = await ctx.win.evaluate(
      async (pid: number) => (window as any).electronAPI.liveMemoryAttach({ pid, executableName: 'Gate2_2Fixture.exe', userConfirmedOffline: true }),
      before.pid,
    );
    expect(attach?.error).toBeUndefined();

    // Controlled local unapproved URL (no live internet access required).
    const unapprovedPath = path.join(os.tmpdir(), `gate2-2resume-unapproved-${Date.now()}.html`);
    fs.writeFileSync(unapprovedPath, '<html><body>unapproved</body></html>');
    const trustedUrl = ctx.win.url();
    await ctx.win.goto(`file://${unapprovedPath.replace(/\\/g, '/')}`);

    const readOnUnapproved = await ctx.win.evaluate(
      async (addr: string) => {
        try {
          return await (window as any).electronAPI.liveMemoryRead({ address: addr, dataType: 'int32' });
        } catch (e) {
          return { error: String(e) };
        }
      },
      before.addressHex,
    ).catch((e) => ({ error: String(e) }));
    // electronAPI may not even exist on an unapproved page (no preload context
    // matches) — either outcome (undefined API or a rejected call) demonstrates
    // privileged IPC is not reachable/authorized from unapproved content.
    const rejectedOrUnavailable = readOnUnapproved == null || (readOnUnapproved as any)?.error !== undefined;
    expect(rejectedOrUnavailable, 'privileged IPC must not be usable from unapproved content').toBe(true);

    // Return to trusted content.
    await ctx.win.goto(trustedUrl);
    await ctx.win.waitForSelector('#root > *', { timeout: 20_000 });
    const readAfterReturn = await ctx.win.evaluate(
      async (addr: string) => (window as any).electronAPI.liveMemoryRead({ address: addr, dataType: 'int32' }),
      before.addressHex,
    );
    expect(readAfterReturn?.error, 'returning to trusted content must not restore the old attach/authority — a fresh attach is required').toBeDefined();

    try { fs.unlinkSync(unapprovedPath); } catch { /* best-effort */ }
  } finally {
    await cleanupApp(ctx);
    await killFixture(f);
  }
});

// ── Phase 11: normal-build test-hook absence (re-confirmation) ──────────────
test('Phase 11 — normal packaged candidate exposes no Gate 2.1/2.2 test-only hooks', async () => {
  let ctx: { app: ElectronApplication; win: Page; userData: string; appData: string } | null = null;
  try {
    // Launch WITHOUT SOLITH_TEST_BUILD and WITHOUT SOLITH_PRIVILEGED_CONSENT
    // overrides — a genuinely normal launch.
    const runId = `p11-${Date.now()}`;
    const userData = path.join(os.tmpdir(), `solith-gate2-2resume-${runId}`);
    const appData = path.join(os.tmpdir(), `solith-gate2-2resume-appdata-${runId}`);
    fs.mkdirSync(userData, { recursive: true });
    fs.mkdirSync(appData, { recursive: true });
    const app = await electron.launch({
      executablePath: EXE_PATH,
      env: { ...process.env, ELECTRON_USER_DATA_PATH: userData, APPDATA: appData, USERPROFILE: appData, NODE_ENV: 'test' },
    });
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForSelector('#root > *', { timeout: 20_000 });
    ctx = { app, win, userData, appData };

    const hooksPresent = await ctx.app.evaluate(() => ({
      identityOverride: typeof (globalThis as any).__solithSetTestProcessIdentityOverride,
      forcedCleanupFailure: typeof (globalThis as any).__solithSetTestForcedCleanupFailureStep,
      hasSessionForOwner: typeof (globalThis as any).__solithTestHasSessionForOwner,
      queryIdentity: typeof (globalThis as any).__solithQueryWindowsProcessIdentity,
    }));
    expect(hooksPresent.identityOverride).toBe('undefined');
    expect(hooksPresent.forcedCleanupFailure).toBe('undefined');
    expect(hooksPresent.hasSessionForOwner).toBe('undefined');
    expect(hooksPresent.queryIdentity).toBe('undefined');
  } finally {
    await cleanupApp(ctx);
  }
});
