/**
 * TrainerHost E2E — production spawn path.
 *
 * Spawns dist-electron/host-entry.js using process.execPath (no tsx, no shell).
 * This is the same code path the main-process supervisor uses in production.
 *
 * Requires `npm run build:electron` to have been run first.
 * The test fails with a clear message if the bundle is missing.
 *
 * Tests:
 *   1. Read-only workflow: handshake → readSaveField → unknown method → shutdown → PID gone
 *   2. Write workflow: handshake → propose → execute → verify → rollback → verify → shutdown → PID gone
 */

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, '../../demo-game/save/stardew-fixture.xml');
const HOST_ENTRY = path.resolve(__dirname, '../../dist-electron/host-entry.js');
const FIELD = 'SaveGame.player.0.money';
const FIXTURE_VALUE = '5000';
const WRITE_VALUE = '12345';

// ── Temp file for write test ───────────────────────────────────────────────────

let writeTmp: string;

before(() => {
  assert.ok(fs.existsSync(HOST_ENTRY), `host-entry.js not found at ${HOST_ENTRY}\nRun \`npm run build:electron\` before running this test suite.`);
  assert.ok(fs.existsSync(FIXTURE), `Stardew fixture missing at ${FIXTURE}`);
  writeTmp = path.join(os.tmpdir(), `trainer-e2e-write-${Date.now()}.xml`);
  fs.copyFileSync(FIXTURE, writeTmp);
});

after(() => {
  for (const p of [writeTmp, writeTmp + '.trainer-backup', writeTmp + '.trainer-tmp']) {
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch { /* ignore */ }
  }
});

// ── RPC helpers ───────────────────────────────────────────────────────────────

function sendLine(proc: ChildProcess, obj: object): void {
  proc.stdin!.write(JSON.stringify(obj) + '\n');
}

function waitForLine(proc: ChildProcess, timeoutMs = 8000): Promise<any> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('waitForLine timeout')), timeoutMs);

    function onData(chunk: Buffer): void {
      buf += chunk.toString('utf8');
      const nl = buf.indexOf('\n');
      if (nl !== -1) {
        clearTimeout(timer);
        proc.stdout!.off('data', onData);
        try {
          resolve(JSON.parse(buf.slice(0, nl)));
        } catch (e) {
          reject(e);
        }
      }
    }

    proc.stdout!.on('data', onData);
    proc.once('close', () => { clearTimeout(timer); reject(new Error('process closed')); });
  });
}

function waitForClose(proc: ChildProcess, timeoutMs = 5000): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error('waitForClose timeout'));
    }, timeoutMs);
    proc.once('close', (code) => { clearTimeout(timer); resolve(code); });
  });
}

function spawnHost(): ChildProcess {
  return spawn(process.execPath, [HOST_ENTRY], {
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function assertPidGone(pid: number): void {
  let pidGone = false;
  try { process.kill(pid, 0); } catch { pidGone = true; }
  assert.ok(pidGone, `PID ${pid} is still alive after shutdown — orphan process`);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TrainerHost E2E (production spawn)', () => {

  test('read-only: spawn → handshake → readSaveField → unknown method → shutdown → PID gone', { timeout: 20_000 }, async () => {
    const child = spawnHost();
    assert.equal(typeof child.pid, 'number');
    const pid = child.pid!;

    // 1. Handshake
    const handshake = await waitForLine(child);
    assert.equal(handshake.id, 'handshake');
    assert.equal(handshake.ok, true);
    assert.equal(handshake.result.protocolVersion, 1);
    assert.ok(handshake.result.capabilities.includes('readSaveField'));
    assert.ok(handshake.result.capabilities.includes('proposeWriteField'));
    assert.ok(handshake.result.capabilities.includes('executeWriteField'));
    assert.ok(handshake.result.capabilities.includes('rollbackWriteField'));

    // 2. readSaveField
    sendLine(child, { id: 'r1', method: 'readSaveField', params: { filePath: FIXTURE, field: FIELD } });
    const readReply = await waitForLine(child);
    assert.equal(readReply.id, 'r1');
    assert.equal(readReply.ok, true);
    assert.equal(readReply.result.found, true);
    assert.equal(readReply.result.value, FIXTURE_VALUE);

    // 3. Unknown method
    sendLine(child, { id: 'r2', method: 'injectMemory' });
    const errReply = await waitForLine(child);
    assert.equal(errReply.id, 'r2');
    assert.equal(errReply.ok, false);
    assert.equal(errReply.error, 'unknown_method');

    // 4. Shutdown
    sendLine(child, { id: 's1', method: 'shutdown' });
    const shutdownReply = await waitForLine(child);
    assert.equal(shutdownReply.id, 's1');
    assert.equal(shutdownReply.ok, true);

    await waitForClose(child);
    assertPidGone(pid);
  });

  test('write workflow: spawn → propose → execute → verify read → rollback → verify read → shutdown → PID gone', { timeout: 30_000 }, async () => {
    const child = spawnHost();
    assert.equal(typeof child.pid, 'number');
    const pid = child.pid!;

    // 1. Handshake
    const handshake = await waitForLine(child);
    assert.equal(handshake.ok, true);

    // 2. Propose write (validation only — no file mutation)
    sendLine(child, {
      id: 'p1', method: 'proposeWriteField',
      params: { filePath: writeTmp, field: FIELD, currentValue: FIXTURE_VALUE, newValue: WRITE_VALUE },
    });
    const proposeReply = await waitForLine(child);
    assert.equal(proposeReply.id, 'p1');
    assert.equal(proposeReply.ok, true, `propose failed: ${proposeReply.error}`);
    assert.equal(proposeReply.result.valid, true);

    // Verify file not mutated by propose
    const afterPropose = fs.readFileSync(writeTmp, 'utf-8');
    assert.ok(afterPropose.includes(`<money>${FIXTURE_VALUE}</money>`), 'propose must not mutate file');

    // 3. Execute write (backup + atomic write + verify)
    sendLine(child, {
      id: 'e1', method: 'executeWriteField',
      params: { filePath: writeTmp, field: FIELD, currentValue: FIXTURE_VALUE, newValue: WRITE_VALUE },
    });
    const execReply = await waitForLine(child, 10_000);
    assert.equal(execReply.id, 'e1');
    assert.equal(execReply.ok, true, `execute failed: ${execReply.error}`);
    assert.equal(execReply.result.written, true);
    assert.equal(execReply.result.verifiedValue, WRITE_VALUE);
    const backupPath: string = execReply.result.backupPath;
    assert.ok(backupPath, 'backupPath must be returned');
    assert.ok(fs.existsSync(backupPath), 'backup file must exist on disk');

    // 4. Verify written value by reading back through host
    sendLine(child, { id: 'r2', method: 'readSaveField', params: { filePath: writeTmp, field: FIELD } });
    const readAfterWrite = await waitForLine(child);
    assert.equal(readAfterWrite.ok, true);
    assert.equal(readAfterWrite.result.value, WRITE_VALUE, 'readSaveField should return new value');

    // 5. Rollback
    sendLine(child, {
      id: 'rb1', method: 'rollbackWriteField',
      params: { filePath: writeTmp, backupPath, field: FIELD },
    });
    const rollbackReply = await waitForLine(child, 10_000);
    assert.equal(rollbackReply.id, 'rb1');
    assert.equal(rollbackReply.ok, true, `rollback failed: ${rollbackReply.error}`);
    assert.equal(rollbackReply.result.restored, true);
    assert.equal(rollbackReply.result.verifiedValue, FIXTURE_VALUE, 'rollback must restore original value');

    // 6. Verify rollback by reading back through host
    sendLine(child, { id: 'r3', method: 'readSaveField', params: { filePath: writeTmp, field: FIELD } });
    const readAfterRollback = await waitForLine(child);
    assert.equal(readAfterRollback.ok, true);
    assert.equal(readAfterRollback.result.value, FIXTURE_VALUE, 'value must be restored to original after rollback');

    // 7. Unknown method still rejected
    sendLine(child, { id: 'bad', method: 'injectMemory' });
    const badReply = await waitForLine(child);
    assert.equal(badReply.ok, false);
    assert.equal(badReply.error, 'unknown_method');

    // 8. Shutdown
    sendLine(child, { id: 's1', method: 'shutdown' });
    await waitForLine(child);
    await waitForClose(child);

    // 9. No orphan PID
    assertPidGone(pid);
  });

  test('propose rejects invalid path (file does not exist)', { timeout: 10_000 }, async () => {
    const child = spawnHost();
    await waitForLine(child); // handshake

    sendLine(child, {
      id: 'p1', method: 'proposeWriteField',
      params: { filePath: '/no/such/file.xml', field: FIELD, currentValue: FIXTURE_VALUE, newValue: WRITE_VALUE },
    });
    const reply = await waitForLine(child);
    assert.equal(reply.ok, false);
    assert.match(reply.error, /file_not_found/);

    sendLine(child, { id: 's1', method: 'shutdown' });
    await waitForLine(child);
    await waitForClose(child);
  });

  test('execute rejects invalid XML content', { timeout: 10_000 }, async () => {
    const child = spawnHost();
    await waitForLine(child); // handshake

    const evilTmp = path.join(os.tmpdir(), `evil-${Date.now()}.xml`);
    fs.writeFileSync(evilTmp, '<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><root/>', 'utf-8');

    try {
      sendLine(child, {
        id: 'e1', method: 'executeWriteField',
        params: { filePath: evilTmp, field: 'root', currentValue: 'x', newValue: 'y' },
      });
      const reply = await waitForLine(child);
      assert.equal(reply.ok, false);
      assert.match(reply.error, /xml_safety|value_mismatch|read_error/);
    } finally {
      if (fs.existsSync(evilTmp)) fs.unlinkSync(evilTmp);
    }

    sendLine(child, { id: 's1', method: 'shutdown' });
    await waitForLine(child);
    await waitForClose(child);
  });

});
