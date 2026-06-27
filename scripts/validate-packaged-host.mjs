/**
 * Packaged-host validation script.
 * Drives the packaged dist\win-unpacked host-entry.js through the full
 * write workflow: propose → execute → verify → rollback → verify → unknown → shutdown → orphan check.
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST_PACKED = path.join(ROOT, 'dist', 'win-unpacked', 'resources', 'app.asar.unpacked', 'dist-electron', 'host-entry.js');
const HOST_DEV    = path.join(ROOT, 'dist-electron', 'host-entry.js');
const FIXTURE     = path.join(ROOT, 'demo-game', 'save', 'stardew-fixture.xml');
const FIELD       = 'SaveGame.player.0.money';
const ORIG        = '5000';
const NEW_VAL     = '12345';

const HOST = fs.existsSync(HOST_PACKED) ? HOST_PACKED : HOST_DEV;
console.log(`Using host-entry: ${HOST}`);
if (!fs.existsSync(HOST)) { console.error('FAIL: host-entry.js not found'); process.exit(1); }
if (!fs.existsSync(FIXTURE)) { console.error('FAIL: fixture not found'); process.exit(1); }

const tmpFile = path.join(os.tmpdir(), `packaged-validate-${Date.now()}.xml`);
fs.copyFileSync(FIXTURE, tmpFile);

const child = spawn(process.execPath, [HOST], { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
const lines = [];
child.stdout.on('data', d => {
  buf += d.toString();
  let nl;
  while ((nl = buf.indexOf('\n')) !== -1) {
    lines.push(JSON.parse(buf.slice(0, nl)));
    buf = buf.slice(nl + 1);
  }
});
child.stderr.on('data', d => process.stderr.write(d));

function send(obj) { child.stdin.write(JSON.stringify(obj) + '\n'); }

function waitLine(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const iv = setInterval(() => {
      if (lines.length > 0) { clearInterval(iv); resolve(lines.shift()); }
      else if (Date.now() - start > timeoutMs) { clearInterval(iv); reject(new Error('timeout waiting for line')); }
    }, 20);
  });
}

const PASS = (label, cond, detail = '') => {
  if (cond) { console.log(`  ✅ PASS  ${label}${detail ? ' — ' + detail : ''}`); }
  else { console.error(`  ❌ FAIL  ${label}${detail ? ' — ' + detail : ''}`); process.exitCode = 1; }
};

async function run() {
  console.log('\n🔍 Packaged TrainerHost — Write Workflow Validation\n');

  const hs = await waitLine();
  PASS('[1] handshake ok', hs.ok === true);
  PASS('[2] protocolVersion=1', hs.result.protocolVersion === 1);
  PASS('[3] capabilities include proposeWriteField', hs.result.capabilities.includes('proposeWriteField'));
  PASS('[4] capabilities include executeWriteField', hs.result.capabilities.includes('executeWriteField'));
  PASS('[5] capabilities include rollbackWriteField', hs.result.capabilities.includes('rollbackWriteField'));

  // propose
  send({ id: 'p1', method: 'proposeWriteField', params: { filePath: tmpFile, field: FIELD, currentValue: ORIG, newValue: NEW_VAL } });
  const p = await waitLine();
  PASS('[6] propose ok', p.ok === true, p.error);
  PASS('[7] propose.valid=true', p.result?.valid === true);
  const notMutated = fs.readFileSync(tmpFile, 'utf-8').includes(`<money>${ORIG}</money>`);
  PASS('[8] propose did not mutate file', notMutated);

  // execute
  send({ id: 'e1', method: 'executeWriteField', params: { filePath: tmpFile, field: FIELD, currentValue: ORIG, newValue: NEW_VAL } });
  const e = await waitLine(15000);
  PASS('[9] execute ok', e.ok === true, e.error);
  PASS('[10] execute.written=true', e.result?.written === true);
  PASS('[11] execute.verifiedValue=12345', e.result?.verifiedValue === NEW_VAL);
  const backupPath = e.result?.backupPath;
  PASS('[12] backupPath returned', !!backupPath);
  PASS('[13] backup file exists on disk', fs.existsSync(backupPath));
  const backupContent = fs.existsSync(backupPath) ? fs.readFileSync(backupPath, 'utf-8') : '';
  PASS('[14] backup contains original value', backupContent.includes(`<money>${ORIG}</money>`));

  // verify via read
  send({ id: 'r1', method: 'readSaveField', params: { filePath: tmpFile, field: FIELD } });
  const r = await waitLine();
  PASS('[15] read after write ok', r.ok === true);
  PASS('[16] read returns new value', r.result?.value === NEW_VAL);

  // rollback
  send({ id: 'rb1', method: 'rollbackWriteField', params: { filePath: tmpFile, backupPath, field: FIELD } });
  const rb = await waitLine(15000);
  PASS('[17] rollback ok', rb.ok === true, rb.error);
  PASS('[18] rollback.restored=true', rb.result?.restored === true);
  PASS('[19] rollback.verifiedValue=5000', rb.result?.verifiedValue === ORIG);

  // verify rollback via read
  send({ id: 'r2', method: 'readSaveField', params: { filePath: tmpFile, field: FIELD } });
  const r2 = await waitLine();
  PASS('[20] read after rollback ok', r2.ok === true);
  PASS('[21] read returns original value', r2.result?.value === ORIG);

  // unknown method
  send({ id: 'bad', method: 'injectMemory' });
  const bad = await waitLine();
  PASS('[22] unknown method rejected', bad.ok === false && bad.error === 'unknown_method');

  // shutdown
  send({ id: 's1', method: 'shutdown' });
  const shut = await waitLine();
  PASS('[23] shutdown ack', shut.ok === true);
  await new Promise(res => child.once('close', res));

  // orphan check
  let gone = false;
  try { process.kill(child.pid, 0); } catch { gone = true; }
  PASS('[24] no orphan PID', gone);

  // cleanup
  for (const p of [tmpFile, backupPath, tmpFile + '.trainer-tmp']) {
    try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch {}
  }

  const total = 24;
  const failed = process.exitCode === 1;
  console.log(`\n── Summary: ${failed ? 'SOME CHECKS FAILED' : `${total}/${total} checks passed`}`);
  if (!failed) console.log('✅ Packaged host write workflow VALIDATED');
}

run().catch(err => { console.error('FAIL:', err.message); process.exit(1); });
