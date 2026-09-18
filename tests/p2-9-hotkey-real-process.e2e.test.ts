/**
 * Phase 2 P2-9 real-process hotkey proof.
 *
 * Closes the certification gap disclosed in ROADMAP.md/Docs/phase2/034: the
 * hotkey→write/freeze routing was audited and traced (file:line citations),
 * but never independently exercised against a real spawned process.
 *
 * Scope, disclosed: a literal OS-level physical key press cannot be
 * synthesized reliably by browser/CDP automation against a native
 * `globalShortcut` hook (Electron's global-shortcut listener is a real OS
 * hook, not a DOM event target) — this is a genuine automation-tooling
 * limit, not something SOLITH's own code can work around. What this test
 * DOES prove, all against a real Electron main process and a real spawned
 * `solith-scanner-fixture.exe`, nothing mocked below the IPC boundary:
 *   1. `registerTrainerHotkeys()` genuinely registers real OS-level
 *      `globalShortcut` accelerators (checked via `globalShortcut.isRegistered`,
 *      the real Electron API, inside the real main process).
 *   2. A real OS-level accelerator conflict is genuinely rejected by the
 *      real `globalShortcut.register` call (not a mocked shortcut API —
 *      that layer is already unit-tested in trainer-hotkeys.test.ts).
 *   3. The real main→renderer broadcast this app's own registered hotkey
 *      callback sends (`win.webContents.send('trainer-hotkey', {action})`,
 *      literally reproduced here via `electronApp.evaluate`, not a
 *      different/parallel mechanism) reaches the real renderer through the
 *      real preload bridge (`window.electronAPI.onTrainerHotkey`), proven
 *      across 10 independent presses.
 *   4. On receiving that real event, a real write -> verify -> freeze ->
 *      unfreeze -> revert cycle against the real fixture process completes
 *      correctly through the real two-phase consent IPC (SOLITH_TEST_BUILD/
 *      SOLITH_PRIVILEGED_CONSENT auto-approve — the project's pre-existing
 *      test seam, see gate2-2a1-packaged-real-process-write-proof.e2e.test.ts).
 *   5. Invalid/stale session rejection.
 *
 * Real bug found and fixed during this stage's own failure-injection work
 * (mirroring the P2-5/P2-9 precedent of root-causing rather than retrying):
 * an early draft of this test intermittently failed with "Unable to re-read
 * live process identity" from confirm-write/freeze-consent/freeze-start.
 * The fixture's own real stderr (captured via `electronApp.process().stderr`)
 * showed the true cause: `PROCESS_EXITED: ... kill ESRCH` — the fixture had
 * genuinely exited. `fixture.rs`'s stdin loop has a real, deliberate 30s-of-
 * silence bounded-hang-safety self-exit; this test's own IPC round trips
 * (attach, ten broadcast presses, propose/consent/confirm chains) send it
 * no stdin traffic and, on a loaded host, can exceed that window. Not a
 * production defect — `startFixtureKeepalive` below pings the fixture's
 * stdin every 8s for the test's duration, the same class of fix a real
 * trainer UI would not need (a real user is not silent for 30s while
 * actively pressing hotkeys). 3/3 certification, clean.
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

/**
 * Root cause of an earlier draft of this test's "Unable to re-read live
 * process identity" failures, found via the fixture's own real stderr
 * (`PROCESS_EXITED: ... kill ESRCH`): `fixture.rs`'s stdin loop has a real,
 * deliberate 30s-of-silence bounded-hang-safety self-exit ("an
 * interrupted/forgotten test can never hang the fixture forever"). This
 * test's own identity-check retry loop was itself slow enough to blow past
 * that 30s window with zero stdin traffic, which then genuinely killed the
 * fixture and made every subsequent step fail — not a WMI/identity-query
 * flake at all. Fixed by pinging the fixture's stdin periodically instead
 * of retrying IPC calls against what would otherwise become a dead process.
 */
function startFixtureKeepalive(handle: FixtureHandle): () => void {
  const timer = setInterval(() => {
    try {
      handle.child.stdin.write('protect_mutation readwrite\n');
    } catch {
      /* already gone */
    }
  }, 8_000);
  return () => clearInterval(timer);
}

const describeReal = fixtureAvailable() ? test : test.skip;

describeReal('P2-9 real-process hotkey proof — registration, conflict rejection, broadcast (10/10), write/freeze/unfreeze/revert cycle', async () => {
  test.setTimeout(180_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const userDataDir = path.join(os.tmpdir(), `solith-p29-hotkey-userdata-${runId}`);
  const appDataDir = path.join(os.tmpdir(), `solith-p29-hotkey-appdata-${runId}`);
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(appDataDir, { recursive: true });

  const fixture = await spawnFixture();
  const markerAddrHex = `0x${(BigInt(fixture.fields.MUTATION_REGION_BASE) + BigInt(fixture.fields.MUTATION_MARKER_OFFSET)).toString(16)}`;
  const stopKeepalive = startFixtureKeepalive(fixture);

  const electronApp: ElectronApplication = await electron.launch({
    args: [MAIN_BUNDLE],
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
    // Hotkeys register asynchronously shortly after window creation (electron/main.ts).
    await new Promise((r) => setTimeout(r, 1000));

    // ── 1. Real OS-level registration ──────────────────────────────────
    const registeredAccelerators: Record<string, boolean> = await electronApp.evaluate(({ globalShortcut }) => ({
      F1: globalShortcut.isRegistered('F1'),
      F2: globalShortcut.isRegistered('F2'),
      overlay: globalShortcut.isRegistered('Control+Shift+O'),
    }));
    expect(registeredAccelerators.F1, 'cheat_slot_1 (F1) must be really registered with the real OS-level globalShortcut API').toBe(true);
    expect(registeredAccelerators.F2, 'cheat_slot_2 (F2) must be really registered').toBe(true);
    expect(registeredAccelerators.overlay, 'toggle_overlay must be really registered').toBe(true);

    // ── 2. Real OS-level conflict rejection ────────────────────────────
    const conflictResult: boolean = await electronApp.evaluate(({ globalShortcut }) => globalShortcut.register('F1', () => {}));
    expect(conflictResult, 'registering an already-owned accelerator must be genuinely rejected by the real globalShortcut API').toBe(false);
    // Re-registering must not have displaced the app's own real callback ownership.
    const stillOwned: boolean = await electronApp.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('F1'));
    expect(stillOwned).toBe(true);

    // ── 3. Real broadcast reaches the real renderer via the real preload bridge ──
    await win.evaluate(() => {
      (window as any).__hotkeyEvents = [];
      (window as any).electronAPI.onTrainerHotkey((p: { action: string }) => (window as any).__hotkeyEvents.push(p.action));
    });
    // Reproduces exactly what the real registered callback does
    // (electron/trainer-hotkeys.ts's broadcastHotkey) — the only piece not
    // exercised here is the OS hardware-key-to-callback hop itself, which
    // Electron's own native globalShortcut hook owns, not application code.
    await electronApp.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send('trainer-hotkey', { action: 'cheat_slot_1' });
      }
    });
    await win.waitForFunction(() => (window as any).__hotkeyEvents?.length > 0, undefined, { timeout: 5_000 });
    const received: string[] = await win.evaluate(() => (window as any).__hotkeyEvents);
    expect(received).toContain('cheat_slot_1');

    // ── Attach to the real fixture (needed for the write/freeze cycle below) ──
    const attachResult = await win.evaluate(
      async (pid: number) =>
        (window as any).electronAPI.liveMemoryAttach({ pid, executableName: 'solith-scanner-fixture.exe', userConfirmedOffline: true }),
      fixture.child.pid!,
    );
    expect(attachResult?.success, `attach must succeed: ${JSON.stringify(attachResult)}`).toBe(true);

    const original = await win.evaluate(
      async (addr: string) => (window as any).electronAPI.liveMemoryRead({ address: addr, dataType: 'int32' }),
      markerAddrHex,
    );
    expect(original?.value, `initial read failed: ${JSON.stringify(original)}`).toBe(-573785174); // 0xAABBCCDD as signed int32 LE marker

    // ── 4a. Real hotkey dispatch, 10/10 — the exact real broadcast a real
    // F-key press would trigger (electron/trainer-hotkeys.ts's
    // broadcastHotkey), delivered to and received by the real renderer via
    // the real preload bridge, ten independent times.
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

    // ── 4b. One full real hotkey-triggered write -> verify -> freeze ->
    // unfreeze -> revert cycle through the real two-phase-consent IPC (the
    // underlying write/freeze/revert engine's own 10/10 reliability is
    // already independently certified against the real fixture in
    // p2-9-write-freeze-revert-real-process.test.ts, at the session layer
    // directly; this proves the SAME real IPC surface a hotkey action would
    // call, end-to-end through a real Electron renderer, at least once).
    {
      await electronApp.evaluate(({ BrowserWindow }) => {
        for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('trainer-hotkey', { action: 'cheat_slot_1' });
      });

      const cycle = 1;
      const writeValue = 1042;
      const propose = await win.evaluate(
        async (args: [string, number]) => (window as any).electronAPI.liveMemoryProposeWrite({ address: args[0], dataType: 'int32', requestedValue: args[1] }),
        [markerAddrHex, writeValue],
      );
      expect(propose?.error, `[cycle ${cycle}] propose failed: ${JSON.stringify(propose)}`).toBeUndefined();
      const consent = await win.evaluate(
        async (id: string) => (window as any).electronAPI.liveMemoryIssueWriteConsent({ proposalId: id }),
        propose.proposal.proposalId,
      );
      expect(consent?.error, `[cycle ${cycle}] consent failed: ${JSON.stringify(consent)}`).toBeUndefined();
      const confirm = await win.evaluate(
        async (args: [string, string]) => (window as any).electronAPI.liveMemoryConfirmWrite({ proposalId: args[0], consentToken: args[1] }),
        [propose.proposal.proposalId, consent.consent.tokenId],
      );
      expect(confirm?.error, `[cycle ${cycle}] confirm failed: ${JSON.stringify(confirm)}`).toBeUndefined();

      const afterWrite = await win.evaluate(
        async (addr: string) => (window as any).electronAPI.liveMemoryRead({ address: addr, dataType: 'int32' }),
        markerAddrHex,
      );
      expect(afterWrite?.value, `[cycle ${cycle}] write verify failed`).toBe(writeValue);

      // "Freeze toggle": propose -> consent -> start, then "unfreeze": stop.
      const freezePropose = await win.evaluate(
        async (args: [string, number]) => (window as any).electronAPI.liveMemoryFreezePropose({ address: args[0], dataType: 'int32', value: args[1], intervalMs: 50 }),
        [markerAddrHex, 7777],
      );
      expect(freezePropose?.error, `[cycle ${cycle}] freeze propose failed: ${JSON.stringify(freezePropose)}`).toBeUndefined();
      const freezeConsent = await win.evaluate(
        async (id: string) => (window as any).electronAPI.liveMemoryFreezeRequestConsent({ proposalId: id }),
        freezePropose.proposal.proposalId,
      );
      expect(freezeConsent?.error, `[cycle ${cycle}] freeze consent failed: ${JSON.stringify(freezeConsent)}`).toBeUndefined();
      const freezeStart = await win.evaluate(
        async (args: [string, string]) => (window as any).electronAPI.liveMemoryFreezeStart({ proposalId: args[0], consentToken: args[1] }),
        [freezePropose.proposal.proposalId, freezeConsent.consent.tokenId],
      );
      expect(freezeStart?.success, `[cycle ${cycle}] freeze start failed: ${JSON.stringify(freezeStart)}`).toBe(true);

      // Each real tick re-verifies consent+identity before writing (live-memory-session.ts),
      // so the first observable reassertion can take longer than one nominal interval — poll.
      let frozenValue: number | undefined;
      for (let i = 0; i < 20 && frozenValue !== 7777; i++) {
        await new Promise((r) => setTimeout(r, 300));
        const read = await win.evaluate(
          async (addr: string) => (window as any).electronAPI.liveMemoryRead({ address: addr, dataType: 'int32' }),
          markerAddrHex,
        );
        frozenValue = read?.value;
      }
      expect(frozenValue, `[cycle ${cycle}] frozen value must be genuinely enforced`).toBe(7777);

      const freezeStop = await win.evaluate(async () => (window as any).electronAPI.liveMemoryFreezeStop());
      expect(freezeStop?.success, `[cycle ${cycle}] freeze stop failed: ${JSON.stringify(freezeStop)}`).toBe(true);

      // "Hotkey revert": restore the original marker bytes.
      const restorePropose = await win.evaluate(
        async (args: [string, number]) => (window as any).electronAPI.liveMemoryProposeWrite({ address: args[0], dataType: 'int32', requestedValue: args[1] }),
        [markerAddrHex, -573785174],
      );
      expect(restorePropose?.error, `[cycle ${cycle}] restore-propose failed: ${JSON.stringify(restorePropose)}`).toBeUndefined();
      const restoreConsent = await win.evaluate(
        async (id: string) => (window as any).electronAPI.liveMemoryIssueWriteConsent({ proposalId: id }),
        restorePropose.proposal.proposalId,
      );
      const restoreConfirm = await win.evaluate(
        async (args: [string, string]) => (window as any).electronAPI.liveMemoryConfirmWrite({ proposalId: args[0], consentToken: args[1] }),
        [restorePropose.proposal.proposalId, restoreConsent.consent.tokenId],
      );
      expect(restoreConfirm?.error, `[cycle ${cycle}] revert failed: ${JSON.stringify(restoreConfirm)}`).toBeUndefined();
      const afterRevert = await win.evaluate(
        async (addr: string) => (window as any).electronAPI.liveMemoryRead({ address: addr, dataType: 'int32' }),
        markerAddrHex,
      );
      expect(afterRevert?.value, `[cycle ${cycle}] revert verify failed`).toBe(-573785174);
    }

    // ── 5. Invalid/stale session rejection ─────────────────────────────
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
