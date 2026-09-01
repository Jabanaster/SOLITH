/**
 * Gate 2.2A.1 Phase 8 — packaged real-process write proof.
 *
 * Not wired into any npm script (ad-hoc Gate 2.2A.1 evidence-gathering, run
 * directly via Playwright against the just-built dist/win-unpacked/Solith.exe).
 * Uses the real packaged nativeMemoryDriver end-to-end through the real IPC
 * propose/issue-consent/confirm flow, with the project's PRE-EXISTING
 * SOLITH_PRIVILEGED_CONSENT=auto-approve test/headless seam (no new hook —
 * see electron/privileged-consent-dialog.ts) so the native consent dialog is
 * bypassed deterministically. Targets only the dedicated Gate 2.2 fixture.
 */
import { test, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { findRepoRoot, resolvePackagedExecutable } from '../scripts/release-artifact-utils.mjs';

const ROOT = findRepoRoot(import.meta.url);
const EXE_PATH = resolvePackagedExecutable(ROOT);
const FIXTURE_EXE = path.join(ROOT, 'tests/fixtures/gate2-2-memory-fixture/bin/Release/net9.0/Gate2_2Fixture.exe');

const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const USER_DATA = path.join(os.tmpdir(), `solith-gate2-2a1-${RUN_ID}`);
const APP_DATA = path.join(os.tmpdir(), `solith-gate2-2a1-appdata-${RUN_ID}`);
const STATUS_PATH = path.join(os.tmpdir(), `gate2-2a1-fixture-status-${RUN_ID}.json`);
const STOP_PATH = path.join(os.tmpdir(), `gate2-2a1-fixture-stop-${RUN_ID}.stop`);

let fixture: ChildProcess;

function readStatus(): { pid: number; addressHex: string; value: number } {
  for (let i = 0; i < 30; i++) {
    try { return JSON.parse(fs.readFileSync(STATUS_PATH, 'utf8')); } catch { /* transient partial write */ }
  }
  throw new Error('could not read fixture status');
}

test('packaged real-process write/read/restore/failure proof against the Gate 2.2 fixture', async () => {
  expect(fs.existsSync(EXE_PATH), `packaged exe not found at ${EXE_PATH}`).toBe(true);
  expect(fs.existsSync(FIXTURE_EXE), `fixture exe not found at ${FIXTURE_EXE}`).toBe(true);

  fs.mkdirSync(USER_DATA, { recursive: true });
  fs.mkdirSync(APP_DATA, { recursive: true });
  fixture = spawn(FIXTURE_EXE, [STATUS_PATH, STOP_PATH], { stdio: 'ignore', windowsHide: true });
  await new Promise((r) => setTimeout(r, 500));
  const before = readStatus();

  const electronApp = await electron.launch({
    executablePath: EXE_PATH,
    env: {
      ...process.env,
      ELECTRON_USER_DATA_PATH: USER_DATA,
      APPDATA: APP_DATA,
      USERPROFILE: APP_DATA,
      NODE_ENV: 'test',
      SOLITH_PRIVILEGED_CONSENT: 'auto-approve',
      // SOL0-P0-1 remediation: packaged builds now ignore the consent env
      // override unless SOLITH_TEST_BUILD=1 (electron/privileged-consent-dialog.ts).
      SOLITH_TEST_BUILD: '1',
    },
  });

  try {
    const win = await electronApp.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForSelector('#root > *', { timeout: 20_000 });

    const attachResult = await win.evaluate(
      async (pid: number) => (window as any).electronAPI.liveMemoryAttach({
        pid, executableName: 'Gate2_2Fixture.exe', userConfirmedOffline: true,
      }),
      before.pid,
    );
    expect(attachResult?.error, `attach failed: ${JSON.stringify(attachResult)}`).toBeUndefined();

    const readResult = await win.evaluate(
      async (args: [string]) => (window as any).electronAPI.liveMemoryRead({ address: args[0], dataType: 'int32' }),
      [before.addressHex],
    );
    expect(readResult?.value, `read failed: ${JSON.stringify(readResult)}`).toBe(before.value);

    // Propose -> issue consent (auto-approved) -> confirm — the real end-to-end write path.
    const proposeResult = await win.evaluate(
      async (args: [string, number]) => (window as any).electronAPI.liveMemoryProposeWrite({
        address: args[0], dataType: 'int32', requestedValue: args[1],
      }),
      [before.addressHex, 555222],
    );
    expect(proposeResult?.error, `propose failed: ${JSON.stringify(proposeResult)}`).toBeUndefined();
    const proposalId = proposeResult.proposal.proposalId;

    const consentResult = await win.evaluate(
      async (id: string) => (window as any).electronAPI.liveMemoryIssueWriteConsent({ proposalId: id }),
      proposalId,
    );
    expect(consentResult?.error, `issue-consent failed: ${JSON.stringify(consentResult)}`).toBeUndefined();
    const consentToken = consentResult.consent.tokenId;

    const confirmResult = await win.evaluate(
      async (args: [string, string]) => (window as any).electronAPI.liveMemoryConfirmWrite({
        proposalId: args[0], consentToken: args[1],
      }),
      [proposalId, consentToken],
    );
    expect(confirmResult?.error, `confirm failed: ${JSON.stringify(confirmResult)}`).toBeUndefined();

    await new Promise((r) => setTimeout(r, 400));
    const afterWrite = readStatus();
    expect(afterWrite.value, 'fixture must independently observe the new value').toBe(555222);

    const readBackResult = await win.evaluate(
      async (args: [string]) => (window as any).electronAPI.liveMemoryRead({ address: args[0], dataType: 'int32' }),
      [before.addressHex],
    );
    expect(readBackResult?.value).toBe(555222);

    // Restore original value through the same real propose/consent/confirm flow.
    const restorePropose = await win.evaluate(
      async (args: [string, number]) => (window as any).electronAPI.liveMemoryProposeWrite({
        address: args[0], dataType: 'int32', requestedValue: args[1],
      }),
      [before.addressHex, before.value],
    );
    const restoreConsent = await win.evaluate(
      async (id: string) => (window as any).electronAPI.liveMemoryIssueWriteConsent({ proposalId: id }),
      restorePropose.proposal.proposalId,
    );
    const restoreConfirm = await win.evaluate(
      async (args: [string, string]) => (window as any).electronAPI.liveMemoryConfirmWrite({
        proposalId: args[0], consentToken: args[1],
      }),
      [restorePropose.proposal.proposalId, restoreConsent.consent.tokenId],
    );
    expect(restoreConfirm?.error).toBeUndefined();
    await new Promise((r) => setTimeout(r, 400));
    const afterRestore = readStatus();
    expect(afterRestore.value, 'fixture must observe the restored original value').toBe(before.value);

    // Failure test: propose a write to an obviously invalid/unmapped address — must surface
    // failure through the packaged path (fails closed as early as propose-time, since
    // proposeWrite reads the current value first), never silent success.
    const badPropose = await win.evaluate(
      async () => (window as any).electronAPI.liveMemoryProposeWrite({ address: '0x1', dataType: 'int32', requestedValue: 42 }),
    );
    expect(
      badPropose?.error,
      'a write to an unmapped address must surface failure (here, at propose time, since read-first fails closed), not silent success',
    ).toBeDefined();

    await win.evaluate(async () => (window as any).electronAPI.liveMemoryDetach());
  } finally {
    await electronApp.close().catch(() => {});
  }
});

test.afterAll(async () => {
  fs.writeFileSync(STOP_PATH, '');
  await new Promise((r) => setTimeout(r, 500));
  if (fixture?.pid && !fixture.killed) {
    try { process.kill(fixture.pid, 'SIGKILL'); } catch { /* already gone */ }
  }
  for (const p of [STATUS_PATH, STOP_PATH]) {
    try { fs.unlinkSync(p); } catch { /* best-effort */ }
  }
  try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch { /* best-effort */ }
  try { fs.rmSync(APP_DATA, { recursive: true, force: true }); } catch { /* best-effort */ }
});
