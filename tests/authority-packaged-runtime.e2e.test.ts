import { test, expect } from '@playwright/test';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { findRepoRoot, resolvePackagedExecutable } from '../scripts/release-artifact-utils.mjs';

const ROOT = findRepoRoot(import.meta.url);
const EXE_PATH = resolvePackagedExecutable(ROOT);

type Ctx = { app: ElectronApplication; win: Page; userData: string; appData: string };

async function launchPackaged(tag: string, extraEnv: Record<string, string> = {}): Promise<Ctx> {
  const runId = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const userData = path.join(os.tmpdir(), `solith-auth-packaged-${runId}`);
  const appData = path.join(os.tmpdir(), `solith-auth-packaged-appdata-${runId}`);
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
      SOLITH_TEST_BUILD: '1',
      ...extraEnv,
    },
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('#root > *', { timeout: 20_000 });
  return { app, win, userData, appData };
}

async function cleanup(ctx: Ctx | null): Promise<void> {
  if (!ctx) return;
  await ctx.app.close().catch(() => {});
  try { fs.rmSync(ctx.userData, { recursive: true, force: true }); } catch { /* best-effort */ }
  try { fs.rmSync(ctx.appData, { recursive: true, force: true }); } catch { /* best-effort */ }
}

test.beforeAll(() => {
  expect(fs.existsSync(EXE_PATH), `packaged exe not found at ${EXE_PATH} — run npm run build first`).toBe(true);
});

test.describe('SOL-1 Packaged Authority E2E Suite', () => {
  test('A & E — Read-Only Mode IPC toggles state in running packaged app', async () => {
    let ctx: Ctx | null = null;
    try {
      ctx = await launchPackaged('auth-e2e-readonly');
      
      const stateBefore = await ctx.app.evaluate(async () => {
        const bridge = await import('./authority-bridge.js');
        return bridge.getAuthorityReadOnlyMode();
      });
      expect(stateBefore).toBe(false);

      const stateAfterSet = await ctx.app.evaluate(async () => {
        const bridge = await import('./authority-bridge.js');
        bridge.setAuthorityReadOnlyMode(true);
        return bridge.getAuthorityReadOnlyMode();
      });
      expect(stateAfterSet).toBe(true);
    } finally {
      await cleanup(ctx);
    }
  });

  test('B & C — AuthorityService evaluates ALLOW and DENY inside running packaged app', async () => {
    let ctx: Ctx | null = null;
    try {
      ctx = await launchPackaged('auth-e2e-eval');

      const evalResults = await ctx.app.evaluate(async () => {
        const { evaluate } = await import('../src/core/authority/index.js');
        
        const allowRes = evaluate({
          identity: { kind: 'internal_subsystem', subsystem: 'trainer-catalog-sync' },
          capability: 'network.request',
          target: { kind: 'network_destination', identifier: 'https://flingtrainer.com' },
          risk: 'MODERATE',
          context: {
            isPackaged: true,
            isTestBuild: true,
            freezeActive: false,
            emergencyStopActive: false,
            operationOrigin: 'internal',
            readOnlyMode: false,
          },
        });

        const denyRes = evaluate({
          identity: { kind: 'internal_subsystem', subsystem: 'unauthorized-subsystem' },
          capability: 'network.request',
          target: { kind: 'network_destination', identifier: 'https://example.com' },
          risk: 'HIGH',
          context: {
            isPackaged: true,
            isTestBuild: true,
            freezeActive: false,
            emergencyStopActive: false,
            operationOrigin: 'internal',
            readOnlyMode: false,
          },
        });

        return {
          allowOutcome: allowRes.decision.outcome,
          denyOutcome: denyRes.decision.outcome,
          denyPolicyId: denyRes.decision.policyId,
        };
      });

      expect(evalResults.allowOutcome).toBe('ALLOW');
      expect(evalResults.denyOutcome).toBe('DENY');
      expect(evalResults.denyPolicyId).toBe('network.request');
    } finally {
      await cleanup(ctx);
    }
  });

  test('D — Single-use grant issuance and consumption inside running packaged app', async () => {
    let ctx: Ctx | null = null;
    try {
      ctx = await launchPackaged('auth-e2e-grants');

      const grantResults = await ctx.app.evaluate(async () => {
        const { issueGrant, consumeGrant } = await import('../src/core/authority/index.js');
        const binding = {
          capability: 'process.attach' as const,
          targetIdentifier: 'pid:9999',
          sessionKey: 'packaged-e2e-session',
        };

        const grant = issueGrant(binding);
        const firstConsume = consumeGrant(grant.grantId, binding);
        const secondConsume = consumeGrant(grant.grantId, binding);

        return {
          grantIssued: Boolean(grant.grantId),
          firstOk: firstConsume.ok,
          secondOk: secondConsume.ok,
        };
      });

      expect(grantResults.grantIssued).toBe(true);
      expect(grantResults.firstOk).toBe(true);
      expect(grantResults.secondOk).toBe(false);
    } finally {
      await cleanup(ctx);
    }
  });
});
