/**
 * Orphan / drift checks for Solith.
 *
 * Phase 5:
 *  1) schema.v1 boundary + deleted-legacy-catalog drift (always runs)
 *  2) TrainerHost process orphan check (runs when packaged/built host-entry exists)
 *
 * Presentation catalogs (cheat-system ALL_GAMES, game-profiles support matrix)
 * are intentionally retained for UI/seed — they are not flagged as orphans.
 */
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { runSchemaV1BoundaryChecks } from './verify-schema-v1-boundaries.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = path.join(ROOT, 'dist', 'win-unpacked', 'resources', 'app.asar.unpacked', 'dist-electron', 'host-entry.js');
const DEV_HOST = path.join(ROOT, 'dist-electron', 'host-entry.js');

console.log('=== Phase 5: schema.v1 boundary / legacy drift ===');
const boundaries = runSchemaV1BoundaryChecks();
if (!boundaries.ok) {
  process.exit(1);
}

const hostPath = fs.existsSync(HOST) ? HOST : fs.existsSync(DEV_HOST) ? DEV_HOST : null;
if (!hostPath) {
  console.log('SKIP: TrainerHost PID orphan check (host-entry.js not built — boundaries already PASS)');
  console.log('PASS: orphan-check (boundaries only)');
  process.exit(0);
}

console.log('=== TrainerHost PID orphan check ===');
console.log(`Using host: ${path.relative(ROOT, hostPath)}`);

const child = spawn(process.execPath, [hostPath], { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
const spawnedPid = child.pid;
console.log(`Spawned PID: ${spawnedPid}`);

let buf = '';
child.stdout.on('data', (d) => {
  buf += d.toString();
});

setTimeout(() => {
  let alive = false;
  try {
    process.kill(spawnedPid, 0);
    alive = true;
  } catch {
    /* gone */
  }
  console.log(`Before shutdown — alive: ${alive}`);

  child.stdin.write(JSON.stringify({ id: 's1', method: 'shutdown' }) + '\n');

  child.once('close', (code) => {
    console.log(`Process closed with code: ${code}`);
    let gone = false;
    try {
      process.kill(spawnedPid, 0);
    } catch {
      gone = true;
    }
    if (gone) {
      console.log(`PASS: PID ${spawnedPid} is gone — no orphan`);
      console.log('PASS: orphan-check');
    } else {
      console.error(`FAIL: PID ${spawnedPid} still alive`);
      process.exitCode = 1;
    }
  });
}, 500);
