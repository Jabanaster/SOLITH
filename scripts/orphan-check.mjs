import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = path.join(ROOT, 'dist', 'win-unpacked', 'resources', 'app.asar.unpacked', 'dist-electron', 'host-entry.js');
if (!fs.existsSync(HOST)) { console.error('host-entry.js not found'); process.exit(1); }

const child = spawn(process.execPath, [HOST], { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
const spawnedPid = child.pid;
console.log(`Spawned PID: ${spawnedPid}`);

let buf = '';
child.stdout.on('data', d => { buf += d.toString(); });

setTimeout(() => {
  // Verify alive before shutdown
  let alive = false;
  try { process.kill(spawnedPid, 0); alive = true; } catch {}
  console.log(`Before shutdown — alive: ${alive}`);

  child.stdin.write(JSON.stringify({ id: 's1', method: 'shutdown' }) + '\n');

  child.once('close', (code) => {
    console.log(`Process closed with code: ${code}`);
    let gone = false;
    try { process.kill(spawnedPid, 0); } catch { gone = true; }
    if (gone) { console.log(`PASS: PID ${spawnedPid} is gone — no orphan`); }
    else { console.error(`FAIL: PID ${spawnedPid} still alive`); process.exitCode = 1; }
  });
}, 500);
