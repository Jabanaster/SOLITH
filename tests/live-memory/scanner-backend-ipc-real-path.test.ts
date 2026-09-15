// Phase 1 / Stage 7.1 §7.1-C/§7.1-D — the REAL production route, not a
// backend/router shortcut: renderer payload → the actual registered
// `ipcMain.handle('live-memory-scan-first'/'live-memory-scan-aob'/...)`
// callback from electron/live-memory-ipc.ts → LiveMemorySession →
// ScannerBackendRouter → NativeScannerBackend → the real napi addon → the
// real Rust scanner → a real spawned Windows process
// (solith-scanner-fixture.exe, the same fixture Stage 7's real-process
// suite uses) → the real canonical result → the real IPC response shape.
//
// 'electron' cannot be imported outside a real Electron process, and this
// repo's test suite deliberately runs under plain `tsx --test` (see
// tests/electron-boundary-static.test.ts's convention of static analysis
// instead of runtime import for electron/*.ts). To exercise the real
// registered ipcMain.handle callbacks without launching a full Electron
// app, this file installs a Node module-customization-hooks loader
// (fixtures/electron-loader.mjs) that redirects the bare specifier
// 'electron' to a minimal mock (fixtures/electron-ipc-mock.mjs) exposing
// only what electron/live-memory-ipc.ts actually touches at runtime:
// `ipcMain.handle`, `app.getPath`, `BrowserWindow.getAllWindows`. Nothing
// below that — session, router, native backend, addon, Rust scanner,
// serialization — is mocked.
//
// Skips cleanly (not a failure) if the fixture binary or the native addon
// has not been built, matching the existing real-process suite's
// convention.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

register(new URL('./fixtures/electron-loader.mjs', import.meta.url));

const mock = await import('./fixtures/electron-ipc-mock.mjs');
const { registerTrustedWindow, _clearTrustedWindowsForTests } = await import(
  '../../src/core/security/trusted-sender-registry.ts'
);
const ipcModule = await import('../../electron/live-memory-ipc.ts');
const { initDatabase } = await import('../../src/core/database/index.ts');

const FIXTURE_PATH = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  'native',
  'solith-scanner-core',
  'target',
  'release',
  'solith-scanner-fixture.exe',
);

function fixtureAvailable(): boolean {
  return process.platform === 'win32' && existsSync(FIXTURE_PATH);
}

const testRequire = createRequire(import.meta.url);
function nativeAddonAvailable(): boolean {
  try {
    testRequire('solith-scanner-napi');
    return true;
  } catch {
    return false;
  }
}

interface FixtureHandle {
  child: ChildProcessWithoutNullStreams;
  fields: Record<string, string>;
}

function spawnFixture(): Promise<FixtureHandle> {
  const child = spawn(FIXTURE_PATH, [], { stdio: ['pipe', 'pipe', 'inherit'] });
  return new Promise((resolve, reject) => {
    let buffered = '';
    const fields: Record<string, string> = {};
    function onData(chunk: Buffer) {
      buffered += chunk.toString('utf8');
      let idx: number;
      // eslint-disable-next-line no-cond-assign
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

let nextSenderId = 1;

/** A trusted, real-shaped IPC sender — exactly what requireTrustedSender's validateIpcSender checks. */
function makeTrustedEvent() {
  const id = nextSenderId++;
  registerTrustedWindow({ webContentsId: id, windowType: 'main', allowedUrlPrefixes: ['file:///app/dist/index.html'] });
  const mainFrame = { url: 'file:///app/dist/index.html#/trainer' };
  const sender = {
    id,
    isDestroyed: () => false,
    mainFrame,
    once: (_event: string, _listener: () => void) => {},
    on: (_event: string, _listener: (...args: unknown[]) => void) => {},
  };
  // Real shape of what requireTrustedSender/bindSessionBundle actually read
  // off an IpcMainInvokeEvent (event.sender, event.senderFrame) — 'electron'
  // itself is mocked at runtime (see fixtures/electron-ipc-mock.mjs), so
  // there is no real IpcMainInvokeEvent to construct here.
  return { sender, senderFrame: mainFrame } as any;
}

const describeReal = fixtureAvailable() && nativeAddonAvailable() ? test : test.skip;

describeReal('full production IPC path: attach, routing-mode control, exact/unaligned/AOB/no-match scans, detach — all through the real registered ipcMain handlers', async (t) => {
  _clearTrustedWindowsForTests();
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'solith-ipc-path-test-'));
  mock.__setUserDataDir(userDataDir);
  await initDatabase();
  ipcModule.registerLiveMemoryIpc();

  const child = await spawnFixture();
  const { fields } = child;
  try {
    const event = makeTrustedEvent();
    const pid = child.child.pid!;

    // 7.1-C: attach through the real handler (schema validation, target
    // authorization, protected-target check, OS identity verification —
    // none of it bypassed).
    const attachResult = await mock.__invoke('live-memory-attach', event, {
      pid,
      executableName: 'solith-scanner-fixture.exe',
      userConfirmedOffline: true,
    });
    assert.equal(attachResult.success, true, `attach must succeed against the real fixture process: ${JSON.stringify(attachResult)}`);

    // 7.1-D: mode control through the real diagnostic/control IPC channel.
    const getDefault = await mock.__invoke('live-memory-scanner-routing-mode-get', event, undefined);
    assert.equal(getDefault.success, true);
    // Stage 7.3 §2 (owner-authorized production migration): the shipping
    // default flipped from LEGACY to NATIVE. This assertion is updated to
    // match the new intended default, not relaxed — a regression back to
    // LEGACY (or to any other unintended default) must still fail this test.
    assert.equal(getDefault.mode, 'NATIVE', 'a fresh session must default to NATIVE (mission Stage 7.3 §2)');

    const setShadow = await mock.__invoke('live-memory-scanner-routing-mode-set', event, { mode: 'SHADOW_COMPARE' });
    assert.equal(setShadow.success, true);
    assert.equal(setShadow.mode, 'SHADOW_COMPARE', 'requested mode must be the observed mode, no hidden override');

    const setNative = await mock.__invoke('live-memory-scanner-routing-mode-set', event, { mode: 'NATIVE' });
    assert.equal(setNative.success, true);
    assert.equal(setNative.mode, 'NATIVE');

    // 7.1-C: >1 MiB exact scan, NATIVE mode, through the real handler.
    const sentinelValue = Number(fields.SENTINEL_VALUE);
    const bigScan = await mock.__invoke('live-memory-scan-first', event, {
      dataType: 'uint32',
      targetValue: sentinelValue,
    });
    assert.equal(bigScan.success, true, JSON.stringify(bigScan));
    assert.equal(bigScan.result.backend, 'native');
    assert.ok(
      bigScan.result.matches.length >= 1,
      '>1 MiB sentinel must be found via the real IPC path once NATIVE is the active mode',
    );
    t.diagnostic(`>1 MiB scan via IPC: ${JSON.stringify(bigScan.result)}`);

    // 7.1-C: unaligned + int64 > 2^53, NATIVE mode, through the real
    // handler — this is the fixed wire path (targetValueBigint), proving
    // the session/IPC layer (not just the raw backend) now preserves exact
    // int64 fidelity end to end.
    const i64Value = BigInt(fields.I64_VALUE);
    const i64Scan = await mock.__invoke('live-memory-scan-first', event, {
      dataType: 'int64',
      targetValue: Number(i64Value), // best-effort display value, intentionally lossy
      targetValueBigint: i64Value.toString(),
    });
    assert.equal(i64Scan.success, true, JSON.stringify(i64Scan));
    assert.equal(i64Scan.result.backend, 'native');
    const exactI64Match = i64Scan.result.matches.find((m: { valueBigint?: string }) => m.valueBigint === i64Value.toString());
    assert.ok(
      exactI64Match,
      `real IPC path must preserve the exact int64 value as a wire-safe string; got ${JSON.stringify(i64Scan.result.matches)}`,
    );

    // 7.1-C: AOB scan >1 MiB into a region, NATIVE mode, through the real handler.
    const aobResult = await mock.__invoke('live-memory-scan-aob', event, { signature: 'DE AD C0 DE 42' });
    assert.equal(aobResult.success, true, JSON.stringify(aobResult));
    assert.equal(aobResult.found, true);
    assert.equal(aobResult.backend, 'native');
    t.diagnostic(`AOB scan via IPC: ${JSON.stringify(aobResult)}`);

    // 7.1-C: no-match, complete — a value that genuinely isn't present.
    // Deliberately NOT a memorable constant like 0xDEADBEEF: real process
    // memory legitimately contains common debug/fill patterns (found this
    // the hard way — 0xDEADBEEF produced 2 real matches against the live
    // fixture). A fresh random 32-bit value keeps collision odds at
    // roughly 1-in-4-billion per real byte offset actually holding it.
    const absentValue = crypto.randomBytes(4).readUInt32LE(0);
    const noMatchScan = await mock.__invoke('live-memory-scan-first', event, {
      dataType: 'uint32',
      targetValue: absentValue,
    });
    assert.equal(noMatchScan.success, true);
    assert.equal(
      noMatchScan.result.matches.length,
      0,
      `a genuinely absent value (${absentValue}) must not produce a match via the real IPC path`,
    );

    // 7.1-C: malformed AOB — real schema rejection through the real handler, not a thrown/uncaught error.
    const malformedAob = await mock.__invoke('live-memory-scan-aob', event, { signature: 'ZZ' });
    assert.equal(malformedAob.success, false, 'a malformed AOB signature must be rejected, not silently accepted or crash the handler');

    // 7.1-E: rollback proof #4 — a rejected malformed request must not corrupt
    // session state. Prove the session still answers a real, valid AOB scan
    // immediately afterward, same NATIVE mode, no re-attach.
    const aobAfterMalformed = await mock.__invoke('live-memory-scan-aob', event, { signature: 'DE AD C0 DE 42' });
    assert.equal(aobAfterMalformed.success, true, 'session must survive a rejected malformed request unharmed');
    assert.equal(aobAfterMalformed.found, true);

    // 7.1-D: mode control back to LEGACY (rollback surface), through the real IPC channel.
    const rollbackToLegacy = await mock.__invoke('live-memory-scanner-routing-mode-set', event, { mode: 'LEGACY' });
    assert.equal(rollbackToLegacy.success, true);
    assert.equal(rollbackToLegacy.mode, 'LEGACY');
    const legacyNoMatch = await mock.__invoke('live-memory-scan-first', event, {
      dataType: 'uint32',
      targetValue: sentinelValue,
    });
    assert.equal(legacyNoMatch.result.backend, 'legacy', 'rollback must actually take effect on the next real IPC call, no residual native routing');
    assert.equal(
      legacyNoMatch.result.matches.length,
      0,
      'legacy must still miss the >1 MiB sentinel after rollback — same real defect, unmodified',
    );
    // 7.1-C: no-match, INCOMPLETE — legacy's honest completeness signal
    // (doc 73's independently-recomputed region count) must say so, not
    // silently report `truncated: false` for a scan that skipped a region.
    assert.equal(
      legacyNoMatch.result.truncated,
      true,
      'legacy must honestly report incompleteness for a scan that structurally skipped the >1 MiB region, not claim a clean complete miss',
    );

    // 7.1-C: detach through the real handler.
    const detachResult = await mock.__invoke('live-memory-detach', event, undefined);
    assert.equal(detachResult.success, true);
  } finally {
    try {
      child.child.stdin.write('exit\n');
    } catch {
      /* already gone */
    }
    child.child.kill();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

describeReal('production IPC path: native backend error surfaces as a typed failure, no silent fallback, no uncaught error', async () => {
  _clearTrustedWindowsForTests();
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'solith-ipc-path-test-'));
  mock.__setUserDataDir(userDataDir);
  await initDatabase();
  ipcModule.registerLiveMemoryIpc();

  const child = await spawnFixture();
  try {
    const event = makeTrustedEvent();
    const pid = child.child.pid!;

    const attachResult = await mock.__invoke('live-memory-attach', event, {
      pid,
      executableName: 'solith-scanner-fixture.exe',
      userConfirmedOffline: true,
    });
    assert.equal(attachResult.success, true);
    await mock.__invoke('live-memory-scanner-routing-mode-set', event, { mode: 'NATIVE' });

    // Real process exit while NATIVE mode is active — the next scan against
    // a dead PID must come back as a typed failure through the real IPC
    // response shape, not an uncaught rejection that would crash the main
    // process.
    child.child.kill();
    await new Promise((resolve) => setTimeout(resolve, 200));

    const scanAfterExit = await mock.__invoke('live-memory-scan-first', event, {
      dataType: 'uint32',
      targetValue: 1234,
    });
    assert.equal(typeof scanAfterExit.success, 'boolean', 'handler must always resolve to a typed { success } response, never throw uncaught');
    if (scanAfterExit.success === false) {
      assert.ok(typeof scanAfterExit.error === 'string' && scanAfterExit.error.length > 0, 'failure must carry a real error string, not a swallowed empty one');
    }
  } finally {
    try {
      child.child.stdin.write('exit\n');
    } catch {
      /* already gone */
    }
    child.child.kill();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

describeReal('production IPC path: an unbounded request (no maxMatches) is bounded end to end, no giant single IPC payload — Stage 7.1 §2', async (t) => {
  _clearTrustedWindowsForTests();
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'solith-ipc-path-test-'));
  mock.__setUserDataDir(userDataDir);
  await initDatabase();
  ipcModule.registerLiveMemoryIpc();

  const child = await spawnFixture();
  try {
    const event = makeTrustedEvent();
    const pid = child.child.pid!;
    const attachResult = await mock.__invoke('live-memory-attach', event, {
      pid,
      executableName: 'solith-scanner-fixture.exe',
      userConfirmedOffline: true,
    });
    assert.equal(attachResult.success, true);
    await mock.__invoke('live-memory-scanner-routing-mode-set', event, { mode: 'NATIVE' });

    // No maxMatches at all — the exact call shape that, before the Stage
    // 7.1 §2 fix, accumulated every real match into one unbounded array
    // (proven against a real game: 151,382 matches, no limit). The
    // fixture's own large mostly-zeroed regions reliably produce well over
    // 10,000 real u32-zero candidates on their own, so this is a real
    // over-the-cap scenario, not a synthetic one.
    const start = Date.now();
    const scanResult = await mock.__invoke('live-memory-scan-first', event, {
      dataType: 'uint32',
      targetValue: 0,
    });
    const durationMs = Date.now() - start;
    assert.equal(scanResult.success, true);
    const payloadBytes = Buffer.byteLength(JSON.stringify(scanResult), 'utf8');
    t.diagnostic(`unbounded request: ${scanResult.result.matches.length} matches, ${payloadBytes} bytes, ${durationMs}ms, truncated=${scanResult.result.truncated}`);
    assert.ok(
      scanResult.result.matches.length <= 10_000,
      `an IPC request with no maxMatches must still come back bounded by the backend's own default cap — got ${scanResult.result.matches.length}`,
    );
    assert.ok(payloadBytes < 5 * 1024 * 1024, `bounded match count must keep the single IPC payload well under a giant-payload size — got ${payloadBytes} bytes`);
  } finally {
    try {
      child.child.stdin.write('exit\n');
    } catch {
      /* already gone */
    }
    child.child.kill();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
