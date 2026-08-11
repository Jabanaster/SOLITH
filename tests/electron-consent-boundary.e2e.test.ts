/**
 * Electron IPC consent / injector trust-boundary integration.
 *
 * Production dist-electron entry with privileged-consent doubles
 * (SOLITH_PRIVILEGED_CONSENT=auto-approve|auto-deny). Does not unstash Wisp.
 *
 * Covers: preload surface, privileged deny/approve, token reject/replay/expire,
 * PID identity fail-closed, forced online deny, sealed helper registration,
 * fixture helper launch + audit JSONL + cleanup.
 */
import { test, expect } from '@playwright/test';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname ?? '.', '..');
const MAIN_BUNDLE = path.join(ROOT, 'dist-electron-test', 'main.js');
const TEST_MANIFEST = path.join(ROOT, 'dist-electron-test', 'solith-build-manifest.json');

if (!fs.existsSync(MAIN_BUNDLE)) {
  throw new Error(`[Consent E2E] Required test bundle dist-electron-test/main.js is missing. Run 'npm run build:electron:test' before running this suite.`);
}
if (!fs.existsSync(TEST_MANIFEST)) {
  throw new Error(`[Consent E2E] Required test manifest dist-electron-test/solith-build-manifest.json is missing.`);
}
const manifestData = JSON.parse(fs.readFileSync(TEST_MANIFEST, 'utf8'));
if (manifestData.buildMode !== 'test' || manifestData.consentOverrideEnabled !== true) {
  throw new Error(`[Consent E2E] Invalid test manifest mode '${manifestData.buildMode}'. Expected buildMode 'test' with consentOverrideEnabled true.`);
}

type LaunchCtx = {
  app: ElectronApplication;
  win: Page;
  userDataDir: string;
  runId: string;
};

function buildLongLivedFixture(outPath: string, writeAddrMeta: boolean): void {
  const srcPath = `${outPath}.cs`;
  const source = writeAddrMeta
    ? `
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
class SolithConsentFixture {
  static int Main() {
    IntPtr mem = Marshal.AllocHGlobal(4);
    Marshal.WriteInt32(mem, 100);
    var meta = Path.Combine(Path.GetTempPath(), "solith-consent-fixture-" + Process.GetCurrentProcess().Id + ".meta");
    File.WriteAllText(meta, mem.ToInt64().ToString());
    Thread.Sleep(90000);
    try { Marshal.FreeHGlobal(mem); File.Delete(meta); } catch {}
    return 0;
  }
}
`
    : `
using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
class SolithInjectorFixture {
  static int Main() {
    var nonce = Guid.NewGuid().ToString("N");
    var path = Path.Combine(Path.GetTempPath(), "solith-inj-fixture-" + Process.GetCurrentProcess().Id + ".nonce");
    File.WriteAllText(path, nonce);
    Thread.Sleep(20000);
    try { File.Delete(path); } catch {}
    return 0;
  }
}
`;
  fs.writeFileSync(srcPath, source, 'utf8');
  const frameworks = [
    path.join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
  ];
  const csc = frameworks.find((p) => fs.existsSync(p));
  if (!csc) throw new Error('csc.exe not found');
  execFileSync(csc, ['/nologo', '/target:exe', `/out:${outPath}`, srcPath], {
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  });
}

function killPid(pid: number): void {
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/F', '/T'], { windowsHide: true, stdio: 'ignore' });
  } catch {
    // already exited
  }
}

function waitForFile(filePath: string, timeoutMs = 10_000): string {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf8').trim();
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

function waitForProcessIdentity(pid: number, executableName: string, timeoutMs = 10_000): void {
  const script = [
    `$ErrorActionPreference='Stop'`,
    `$p=Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"`,
    `if(-not $p){exit 1}`,
    `if(-not $p.ExecutablePath){exit 1}`,
    `if(-not $p.CreationDate){exit 1}`,
    `if($p.Name -ne ${JSON.stringify(executableName)}){exit 1}`,
    `exit 0`,
  ].join(';');
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        windowsHide: true,
        stdio: 'ignore',
        timeout: 4_000,
      });
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
  throw new Error(`Process identity not ready for PID ${pid} (${executableName})`);
}

function rmDirSoft(dir: string): void {
  for (let i = 0; i < 8; i += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
    }
  }
}

async function launchWithEnv(
  label: string,
  extraEnv: Record<string, string>,
): Promise<LaunchCtx | null> {
  if (!fs.existsSync(MAIN_BUNDLE)) {
    test.skip(true, 'Bundle not built');
    return null;
  }
  const runId = `consent-e2e-${label}-${Date.now()}`;
  const userDataDir = path.join(os.tmpdir(), runId, 'userData');
  fs.mkdirSync(userDataDir, { recursive: true });
  const app = await electron.launch({
    args: [MAIN_BUNDLE],
    env: {
      ...process.env,
      ELECTRON_USER_DATA_PATH: userDataDir,
      NODE_ENV: 'test',
      ...extraEnv,
    },
  });
  const win = await app.firstWindow({ timeout: 60_000 });
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('#root > *', { timeout: 20_000 });
  return { app, win, userDataDir, runId };
}

async function cleanup(ctx: LaunchCtx | null, extraPids: number[] = []): void {
  for (const pid of extraPids) killPid(pid);
  if (!ctx) return;
  try {
    await ctx.win.evaluate(async () => {
      const api = (window as any).electronAPI;
      if (typeof api.liveMemoryDetach === 'function') await api.liveMemoryDetach();
    });
  } catch {
    // best effort
  }
  await ctx.app.close().catch(() => {});
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  for (const pid of extraPids) killPid(pid);
  rmDirSoft(path.join(os.tmpdir(), ctx.runId));
}

async function spawnNamedFixture(
  runId: string,
  fileName: string,
  withAddrMeta: boolean,
): Promise<{ pid: number; exePath: string }> {
  const gameDir = path.join(os.tmpdir(), runId, 'game');
  fs.mkdirSync(gameDir, { recursive: true });
  const exePath = path.join(gameDir, fileName);
  buildLongLivedFixture(exePath, withAddrMeta);
  const child = spawn(exePath, [], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  if (child.pid == null) throw new Error(`failed to spawn ${fileName}`);
  waitForProcessIdentity(child.pid, fileName);
  return { pid: child.pid, exePath };
}

async function enableInProcess(win: Page): Promise<void> {
  const result = await win.evaluate(async () => {
    const api = (window as any).electronAPI;
    return api.setSetting('inProcessScriptExecutionEnabled', true);
  });
  expect(result?.success ?? result?.error).toBeTruthy();
  if (result?.error) throw new Error(String(result.error));
}

test('preload exposes consent + register methods only as functions', async () => {
  const ctx = await launchWithEnv('preload', { SOLITH_PRIVILEGED_CONSENT: 'auto-deny' });
  if (!ctx) return;
  try {
    const shape = await ctx.win.evaluate(() => {
      const api = (window as any).electronAPI;
      return {
        issueWrite: typeof api.liveMemoryIssueWriteConsent,
        confirmWrite: typeof api.liveMemoryConfirmWrite,
        issueInjector: typeof api.inProcessIssueInjectorConsent,
        confirmInjector: typeof api.inProcessConfirmInjectorLaunch,
        registerHelper: typeof api.inProcessRegisterInjectorHelper,
        // Must not expose a raw mint without going through issue channels.
        mintConsent: typeof api.mintWriteConsent,
      };
    });
    expect(shape.issueWrite).toBe('function');
    expect(shape.confirmWrite).toBe('function');
    expect(shape.issueInjector).toBe('function');
    expect(shape.confirmInjector).toBe('function');
    expect(shape.registerHelper).toBe('function');
    expect(shape.mintConsent).toBe('undefined');
  } finally {
    await cleanup(ctx);
  }
});

test('privileged deny path refuses to mint a write consent token without attach', async () => {
  const ctx = await launchWithEnv('deny-no-attach', { SOLITH_PRIVILEGED_CONSENT: 'auto-deny' });
  if (!ctx) return;
  try {
    const result = await ctx.win.evaluate(async () => {
      return (window as any).electronAPI.liveMemoryIssueWriteConsent({
        proposalId: '00000000-0000-4000-8000-000000000001',
      });
    });
    expect(result.success).toBe(false);
    expect(String(result.error ?? '')).toMatch(/not_attached|No process|Unknown write|incomplete/i);
  } finally {
    await cleanup(ctx);
  }
});

test('confirm write rejects missing and altered consent tokens via IPC', async () => {
  const ctx = await launchWithEnv('confirm-reject', { SOLITH_PRIVILEGED_CONSENT: 'auto-approve' });
  if (!ctx) return;
  try {
    const missing = await ctx.win.evaluate(async () => {
      try {
        return await (window as any).electronAPI.liveMemoryConfirmWrite({ proposalId: 'p1' });
      } catch (err) {
        return { success: false, error: String(err) };
      }
    });
    expect(missing.success).toBe(false);

    const bogus = await ctx.win.evaluate(async () => {
      return (window as any).electronAPI.liveMemoryConfirmWrite({
        proposalId: 'p1',
        consentToken: '00000000-0000-4000-8000-000000000099',
      });
    });
    expect(bogus.success).toBe(false);
  } finally {
    await cleanup(ctx);
  }
});

test('helper registration: deny skips seal; approve writes sealed manifest entry', async () => {
  test.skip(process.platform !== 'win32', 'Windows-only');
  const denyCtx = await launchWithEnv('reg-deny', { SOLITH_PRIVILEGED_CONSENT: 'auto-deny' });
  if (!denyCtx) return;
  const pids: number[] = [];
  try {
    await enableInProcess(denyCtx.win);
    const helpersRoot = path.join(denyCtx.userDataDir, 'injector-helpers');
    fs.mkdirSync(helpersRoot, { recursive: true });
    const helperPath = path.join(helpersRoot, 'deny-helper.exe');
    fs.writeFileSync(helperPath, Buffer.from('MZ-deny-helper'));
    const denied = await denyCtx.win.evaluate(async (exePath) => {
      return (window as any).electronAPI.inProcessRegisterInjectorHelper({ exePath });
    }, helperPath);
    expect(denied.success).toBe(false);
    expect(String(denied.error ?? '')).toMatch(/user_denied|denied/i);
    expect(fs.existsSync(path.join(helpersRoot, 'manifest.json'))).toBe(false);
  } finally {
    await cleanup(denyCtx, pids);
  }

  const approveCtx = await launchWithEnv('reg-approve', { SOLITH_PRIVILEGED_CONSENT: 'auto-approve' });
  if (!approveCtx) return;
  try {
    await enableInProcess(approveCtx.win);
    const helpersRoot = path.join(approveCtx.userDataDir, 'injector-helpers');
    fs.mkdirSync(helpersRoot, { recursive: true });
    const helperPath = path.join(helpersRoot, 'approve-helper.exe');
    fs.writeFileSync(helperPath, Buffer.from('MZ-approve-helper'));
    const sha = createHash('sha256').update(fs.readFileSync(helperPath)).digest('hex');
    const approved = await approveCtx.win.evaluate(async (exePath) => {
      return (window as any).electronAPI.inProcessRegisterInjectorHelper({ exePath });
    }, helperPath);
    expect(approved.success).toBe(true);
    expect(fs.existsSync(path.join(helpersRoot, 'manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(helpersRoot, 'manifest.seal'))).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(path.join(helpersRoot, 'manifest.json'), 'utf8'));
    expect(manifest.entries.some((e: { sha256: string }) => e.sha256 === sha)).toBe(true);
  } finally {
    await cleanup(approveCtx, pids);
  }
});

test('full write path: propose → privileged approve → bind → confirm → replay denied', async () => {
  test.skip(process.platform !== 'win32', 'Windows-only');
  const ctx = await launchWithEnv('write-happy', { SOLITH_PRIVILEGED_CONSENT: 'auto-approve' });
  if (!ctx) return;
  const pids: number[] = [];
  try {
    const game = await spawnNamedFixture(ctx.runId, 'SolithConsentGame.exe', true);
    pids.push(game.pid);
    const addrDec = waitForFile(path.join(os.tmpdir(), `solith-consent-fixture-${game.pid}.meta`));

    const attach = await ctx.win.evaluate(
      async ({ pid, executableName }) => {
        return (window as any).electronAPI.liveMemoryAttach({
          pid,
          executableName,
          userConfirmedOffline: true,
        });
      },
      { pid: game.pid, executableName: 'SolithConsentGame.exe' },
    );
    expect(attach.success, String(attach.error ?? 'attach')).toBe(true);

    const proposed = await ctx.win.evaluate(
      async ({ address }) => {
        return (window as any).electronAPI.liveMemoryProposeWrite({
          address,
          dataType: 'int32',
          requestedValue: 777,
        });
      },
      { address: addrDec },
    );
    expect(proposed.success, String(proposed.error ?? 'propose')).toBe(true);
    const proposalId = proposed.proposal.proposalId as string;

    const consent = await ctx.win.evaluate(async (id) => {
      return (window as any).electronAPI.liveMemoryIssueWriteConsent({ proposalId: id });
    }, proposalId);
    expect(consent.success, String(consent.error ?? 'consent')).toBe(true);
    expect(consent.consent.tokenId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(consent.consent.proposalId).toBe(proposalId);
    expect(consent.consent.bindingHash).toMatch(/^[a-f0-9]{64}$/i);

    const confirmed = await ctx.win.evaluate(
      async ({ proposalId: id, consentToken }) => {
        return (window as any).electronAPI.liveMemoryConfirmWrite({ proposalId: id, consentToken });
      },
      { proposalId, consentToken: consent.consent.tokenId },
    );
    expect(confirmed.success, String(confirmed.error ?? 'confirm')).toBe(true);

    const replay = await ctx.win.evaluate(
      async ({ proposalId: id, consentToken }) => {
        return (window as any).electronAPI.liveMemoryConfirmWrite({ proposalId: id, consentToken });
      },
      { proposalId, consentToken: consent.consent.tokenId },
    );
    expect(replay.success).toBe(false);
    expect(String(replay.error ?? '')).toMatch(/consent|Unknown|already|expired|proposal/i);
  } finally {
    await cleanup(ctx, pids);
  }
});

test('privileged dialog deny refuses consent mint after propose', async () => {
  test.skip(process.platform !== 'win32', 'Windows-only');
  const ctx = await launchWithEnv('write-deny', { SOLITH_PRIVILEGED_CONSENT: 'auto-deny' });
  if (!ctx) return;
  const pids: number[] = [];
  try {
    const game = await spawnNamedFixture(ctx.runId, 'SolithConsentGame.exe', true);
    pids.push(game.pid);
    const addrDec = waitForFile(path.join(os.tmpdir(), `solith-consent-fixture-${game.pid}.meta`));

    const attach = await ctx.win.evaluate(
      async ({ pid, executableName }) =>
        (window as any).electronAPI.liveMemoryAttach({
          pid,
          executableName,
          userConfirmedOffline: true,
        }),
      { pid: game.pid, executableName: 'SolithConsentGame.exe' },
    );
    expect(attach.success).toBe(true);

    const proposed = await ctx.win.evaluate(
      async ({ address }) =>
        (window as any).electronAPI.liveMemoryProposeWrite({
          address,
          dataType: 'int32',
          requestedValue: 42,
        }),
      { address: addrDec },
    );
    expect(proposed.success).toBe(true);

    const consent = await ctx.win.evaluate(
      async (id) => (window as any).electronAPI.liveMemoryIssueWriteConsent({ proposalId: id }),
      proposed.proposal.proposalId,
    );
    expect(consent.success).toBe(false);
    expect(String(consent.error ?? '')).toMatch(/user_denied_privileged_consent/i);
  } finally {
    await cleanup(ctx, pids);
  }
});

test('PID exit after consent invalidates confirm (fail-closed identity)', async () => {
  test.skip(process.platform !== 'win32', 'Windows-only');
  const ctx = await launchWithEnv('pid-reuse', { SOLITH_PRIVILEGED_CONSENT: 'auto-approve' });
  if (!ctx) return;
  const pids: number[] = [];
  try {
    const game = await spawnNamedFixture(ctx.runId, 'SolithConsentGame.exe', true);
    pids.push(game.pid);
    const addrDec = waitForFile(path.join(os.tmpdir(), `solith-consent-fixture-${game.pid}.meta`));

    const attach = await ctx.win.evaluate(
      async ({ pid, executableName }) =>
        (window as any).electronAPI.liveMemoryAttach({
          pid,
          executableName,
          userConfirmedOffline: true,
        }),
      { pid: game.pid, executableName: 'SolithConsentGame.exe' },
    );
    expect(attach.success).toBe(true);

    const proposed = await ctx.win.evaluate(
      async ({ address }) =>
        (window as any).electronAPI.liveMemoryProposeWrite({
          address,
          dataType: 'int32',
          requestedValue: 9,
        }),
      { address: addrDec },
    );
    expect(proposed.success).toBe(true);
    const proposalId = proposed.proposal.proposalId as string;

    const consent = await ctx.win.evaluate(
      async (id) => (window as any).electronAPI.liveMemoryIssueWriteConsent({ proposalId: id }),
      proposalId,
    );
    expect(consent.success).toBe(true);

    killPid(game.pid);
    pids.length = 0;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);

    const confirmed = await ctx.win.evaluate(
      async ({ proposalId: id, consentToken }) =>
        (window as any).electronAPI.liveMemoryConfirmWrite({ proposalId: id, consentToken }),
      { proposalId, consentToken: consent.consent.tokenId },
    );
    expect(confirmed.success).toBe(false);
    expect(String(confirmed.error ?? '')).toMatch(/identity|process|exited|Unable|mismatch|fail/i);
  } finally {
    await cleanup(ctx, pids);
  }
});

test('expired consent token is rejected on confirm', async () => {
  test.skip(process.platform !== 'win32', 'Windows-only');
  const ctx = await launchWithEnv('ttl-expire', {
    SOLITH_PRIVILEGED_CONSENT: 'auto-approve',
    SOLITH_CONSENT_TTL_MS: '30',
  });
  if (!ctx) return;
  const pids: number[] = [];
  try {
    const game = await spawnNamedFixture(ctx.runId, 'SolithConsentGame.exe', true);
    pids.push(game.pid);
    const addrDec = waitForFile(path.join(os.tmpdir(), `solith-consent-fixture-${game.pid}.meta`));

    expect(
      (
        await ctx.win.evaluate(
          async ({ pid, executableName }) =>
            (window as any).electronAPI.liveMemoryAttach({
              pid,
              executableName,
              userConfirmedOffline: true,
            }),
          { pid: game.pid, executableName: 'SolithConsentGame.exe' },
        )
      ).success,
    ).toBe(true);

    const proposed = await ctx.win.evaluate(
      async ({ address }) =>
        (window as any).electronAPI.liveMemoryProposeWrite({
          address,
          dataType: 'int32',
          requestedValue: 3,
        }),
      { address: addrDec },
    );
    expect(proposed.success).toBe(true);
    const consent = await ctx.win.evaluate(
      async (id) => (window as any).electronAPI.liveMemoryIssueWriteConsent({ proposalId: id }),
      proposed.proposal.proposalId,
    );
    expect(consent.success).toBe(true);
    await new Promise((r) => setTimeout(r, 80));
    const confirmed = await ctx.win.evaluate(
      async ({ proposalId, consentToken }) =>
        (window as any).electronAPI.liveMemoryConfirmWrite({ proposalId, consentToken }),
      {
        proposalId: proposed.proposal.proposalId,
        consentToken: consent.consent.tokenId,
      },
    );
    expect(confirmed.success).toBe(false);
    expect(String(confirmed.error ?? '')).toMatch(/expired|consent/i);
  } finally {
    await cleanup(ctx, pids);
  }
});

test('injector IPC: sealed helper launch audits JSONL; forced online blocks confirm', async () => {
  test.skip(process.platform !== 'win32', 'Windows-only');
  const ctx = await launchWithEnv('injector-happy', { SOLITH_PRIVILEGED_CONSENT: 'auto-approve' });
  if (!ctx) return;
  const pids: number[] = [];
  try {
    await enableInProcess(ctx.win);
    const game = await spawnNamedFixture(ctx.runId, 'CrimsonDesert.exe', false);
    pids.push(game.pid);

    const attach = await ctx.win.evaluate(
      async ({ pid }) =>
        (window as any).electronAPI.liveMemoryAttach({
          pid,
          executableName: 'CrimsonDesert.exe',
          userConfirmedOffline: true,
        }),
      { pid: game.pid },
    );
    expect(attach.success, String(attach.error ?? 'attach')).toBe(true);

    const helpersRoot = path.join(ctx.userDataDir, 'injector-helpers');
    fs.mkdirSync(helpersRoot, { recursive: true });
    const helperPath = path.join(helpersRoot, 'solith-injector-fixture.exe');
    buildLongLivedFixture(helperPath, false);
    const registered = await ctx.win.evaluate(
      async (exePath) => (window as any).electronAPI.inProcessRegisterInjectorHelper({ exePath }),
      helperPath,
    );
    expect(registered.success, String(registered.error ?? 'register')).toBe(true);

    const proposed = await ctx.win.evaluate(
      async (exePath) =>
        (window as any).electronAPI.inProcessProposeInjectorLaunch({
          exePath,
          userConfirmedOffline: true,
          userApprovedAction: true,
        }),
      helperPath,
    );
    expect(proposed.success, String(proposed.error ?? 'propose')).toBe(true);
    const proposalId = proposed.proposal.proposalId as string;

    const consent = await ctx.win.evaluate(
      async (id) => (window as any).electronAPI.inProcessIssueInjectorConsent({ proposalId: id }),
      proposalId,
    );
    expect(consent.success, String(consent.error ?? 'injector consent')).toBe(true);

    const launched = await ctx.win.evaluate(
      async ({ proposalId: id, consentToken }) =>
        (window as any).electronAPI.inProcessConfirmInjectorLaunch({
          proposalId: id,
          userApprovedAction: true,
          consentToken,
        }),
      { proposalId, consentToken: consent.consent.tokenId },
    );
    expect(launched.success, String(launched.error ?? 'launch')).toBe(true);
    expect(launched.pid).toBeGreaterThan(0);
    pids.push(launched.pid as number);

    const nonce = waitForFile(path.join(os.tmpdir(), `solith-inj-fixture-${launched.pid}.nonce`));
    expect(nonce).toMatch(/^[a-f0-9]{32}$/i);

    const auditPath = path.join(ctx.userDataDir, 'logs', 'injector-audit.jsonl');
    expect(fs.existsSync(auditPath)).toBe(true);
    const audit = fs.readFileSync(auditPath, 'utf8');
    expect(audit).toMatch(/"op":"propose"/);
    expect(audit).toMatch(/"op":"confirm"/);
    expect(audit).toMatch(/"allowed":true/);
    expect(audit).toMatch(new RegExp(`"spawnedPid":${launched.pid}`));

    killPid(launched.pid as number);
  } finally {
    await cleanup(ctx, pids);
  }

  // Forced online evidence must deny confirm after a fresh privileged mint.
  const onlineCtx = await launchWithEnv('injector-online', {
    SOLITH_PRIVILEGED_CONSENT: 'auto-approve',
    SOLITH_FORCE_REMOTE_CONNECTION_COUNT: '3',
  });
  if (!onlineCtx) return;
  const onlinePids: number[] = [];
  try {
    await enableInProcess(onlineCtx.win);
    const game = await spawnNamedFixture(onlineCtx.runId, 'CrimsonDesert.exe', false);
    onlinePids.push(game.pid);

    expect(
      (
        await onlineCtx.win.evaluate(
          async ({ pid }) =>
            (window as any).electronAPI.liveMemoryAttach({
              pid,
              executableName: 'CrimsonDesert.exe',
              userConfirmedOffline: true,
            }),
          { pid: game.pid },
        )
      ).success,
    ).toBe(true);

    const helpersRoot = path.join(onlineCtx.userDataDir, 'injector-helpers');
    fs.mkdirSync(helpersRoot, { recursive: true });
    const helperPath = path.join(helpersRoot, 'online-helper.exe');
    buildLongLivedFixture(helperPath, false);
    expect(
      (
        await onlineCtx.win.evaluate(
          async (exePath) => (window as any).electronAPI.inProcessRegisterInjectorHelper({ exePath }),
          helperPath,
        )
      ).success,
    ).toBe(true);

    const proposed = await onlineCtx.win.evaluate(
      async (exePath) =>
        (window as any).electronAPI.inProcessProposeInjectorLaunch({
          exePath,
          userConfirmedOffline: true,
          userApprovedAction: true,
        }),
      helperPath,
    );
    expect(proposed.success).toBe(true);
    const consent = await onlineCtx.win.evaluate(
      async (id) => (window as any).electronAPI.inProcessIssueInjectorConsent({ proposalId: id }),
      proposed.proposal.proposalId,
    );
    expect(consent.success).toBe(true);
    const blocked = await onlineCtx.win.evaluate(
      async ({ proposalId, consentToken }) =>
        (window as any).electronAPI.inProcessConfirmInjectorLaunch({
          proposalId,
          userApprovedAction: true,
          consentToken,
        }),
      {
        proposalId: proposed.proposal.proposalId,
        consentToken: consent.consent.tokenId,
      },
    );
    expect(blocked.success).toBe(false);
    expect(String(blocked.error ?? '')).toMatch(/remote connection|online|multiplayer|in_process_confirm_injector_failed|consent_denied/i);
    expect(blocked.pid == null || blocked.pid === undefined).toBe(true);
  } finally {
    await cleanup(onlineCtx, onlinePids);
  }
});
