// scripts/measure-startup.mjs
//
// Purpose: measure Electron process-start -> startup-checkpoint timing for
// the startup-performance investigation (see startup-performance-static /
// startup-visibility-behavior tests and the investigation report for
// context). Spawns the dev Electron bundle directly
// (electron dist-electron/main.js) with SOLITH_STARTUP_TRACE=1, parses
// [startup-timing] marks from stdout, and records per-launch deltas.
//
// Usage:
//   node scripts/measure-startup.mjs <cold|warm> <runCount>
//   node scripts/measure-startup.mjs cold 3
//   node scripts/measure-startup.mjs warm 3
//
// "cold" uses a fresh, unique userData directory per run. "warm" reuses one
// userData directory across all runs in the invocation (each run after the
// first sees an already-initialized DB/settings).
//
// Output: human-readable per-run mark tables to stdout, followed by a
// single machine-readable JSON array (one line, prefixed by a blank line)
// with all raw results — { mode, index, spawnedAt, marks, endedBy }.
//
// Guarantees:
//   - Requires prior `npm run build:electron` (fails fast if the bundle is
//     missing).
//   - Each launch gets its own isolated userData path (cold) or a
//     dedicated warm-mode temp path never shared with real user data.
//   - Process cleanup targets only the exact child PID tree this script
//     spawned (`taskkill /T /PID <pid>` on Windows, `child.kill()`
//     elsewhere) — it never enumerates or kills unrelated Electron
//     processes.
//   - Every run is bounded by a 45s hard timeout in addition to the
//     did-finish-load-triggered early finish.
//   - A 3s delay between runs lets the previous run's single-instance lock
//     file fully release before the next spawn.
//   - Detects single-instance-lock contamination (a run that exits with
//     only the very first mark recorded, before app.whenReady() even
//     fires) and flags it in the per-run summary line and machine-readable
//     output (`lockContaminated: true`) instead of silently reporting a
//     misleadingly "fast" result.
//   - After all runs, verifies no Electron process spawned by this script
//     is still alive by re-checking each recorded child PID; reports any
//     orphan found (should never happen given the taskkill /T cleanup, but
//     this is the explicit validation the harness promotion required).
//
// This is a diagnostic/investigation tool, not a CI gate — it is not wired
// into `npm test`. Wall-clock output from a shared/loaded dev machine will
// vary; treat single invocations as a data point, not a guarantee.
import { spawn, execFileSync, execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const ELECTRON_BIN = path.join('node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
const MAIN_BUNDLE = path.join('dist-electron', 'main.js');
const MODE = process.argv[2] ?? 'cold';
const RUNS = Number(process.argv[3] ?? 3);
const WARM_USER_DATA = path.join(os.tmpdir(), 'solith-perf-warm-userdata');

if (!['cold', 'warm'].includes(MODE)) {
  console.error(`Unknown mode "${MODE}" — expected "cold" or "warm".`);
  process.exit(1);
}
if (!fs.existsSync(MAIN_BUNDLE)) {
  console.error(`${MAIN_BUNDLE} not found. Run "npm run build:electron" first.`);
  process.exit(1);
}
if (MODE === 'warm') {
  fs.mkdirSync(WARM_USER_DATA, { recursive: true });
}

const spawnedPids = [];

function runOnce(index) {
  return new Promise((resolve) => {
    const userData = MODE === 'warm'
      ? WARM_USER_DATA
      : path.join(os.tmpdir(), `solith-perf-cold-${Date.now()}-${index}`);
    if (MODE === 'cold') fs.mkdirSync(userData, { recursive: true });

    const marks = [];
    const spawnedAt = Date.now();
    const child = spawn(ELECTRON_BIN, [MAIN_BUNDLE], {
      env: {
        ...process.env,
        ELECTRON_USER_DATA_PATH: userData,
        NODE_ENV: 'test',
        SOLITH_STARTUP_TRACE: '1',
      },
      windowsHide: false,
      shell: process.platform === 'win32',
    });
    if (child.pid) spawnedPids.push(child.pid);

    let settled = false;
    const finish = (reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      try {
        if (process.platform === 'win32' && child.pid) {
          execFileSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
        } else {
          child.kill();
        }
      } catch {}
      // Single-instance-lock contamination: the app quit itself
      // (electron/main.ts's requestSingleInstanceLock() branch) before
      // app.whenReady() ever ran, almost always because a previous run's
      // process was still holding the lock file. Flag it rather than
      // reporting a misleadingly "fast" launch.
      const lockContaminated = reason === 'process-exit'
        && marks.length <= 1
        && !marks.some((m) => m.event === 'app-ready');
      resolve({ mode: MODE, index, spawnedAt, marks, endedBy: reason, lockContaminated });
    };

    child.stdout.on('data', (buf) => {
      const text = buf.toString('utf8');
      for (const line of text.split(/\r?\n/)) {
        const match = line.match(/\[startup-timing\] event=(\S+) t_ms=([\d.]+)/);
        if (match) {
          marks.push({ event: match[1], t_ms: Number(match[2]), wall_ms: Date.now() - spawnedAt });
          if (match[1] === 'renderer-did-finish-load') {
            // Give it a brief moment in case any trailing marks are still flushing.
            setTimeout(() => finish('did-finish-load'), 250);
          }
        }
      }
    });
    child.stderr.on('data', () => {});
    child.on('exit', () => finish('process-exit'));

    const killTimer = setTimeout(() => finish('timeout-45s'), 45_000);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const results = [];
for (let i = 0; i < RUNS; i++) {
  // eslint-disable-next-line no-await-in-loop
  const result = await runOnce(i);
  results.push(result);
  // Let the single-instance lock file release before spawning the next run.
  // eslint-disable-next-line no-await-in-loop
  await sleep(3000);
  const flag = result.lockContaminated ? '  [SINGLE-INSTANCE-LOCK CONTAMINATION — discard this run]' : '';
  console.log(`\n=== ${MODE} run ${i + 1}/${RUNS} (endedBy=${result.endedBy})${flag} ===`);
  for (const m of result.marks) {
    console.log(`  ${m.event.padEnd(28)} t_ms=${m.t_ms.toFixed(1).padStart(8)}  wall_ms=${m.wall_ms}`);
  }
}

const orphanTopLevel = spawnedPids.filter(isPidAlive);
if (orphanTopLevel.length > 0) {
  console.error(`\nWARNING: ${orphanTopLevel.length} top-level process(es) spawned by this run are still alive after cleanup: ${orphanTopLevel.join(', ')}`);
} else {
  console.log(`\nCleanup validated: 0 of ${spawnedPids.length} spawned top-level processes remain alive.`);
}

// Stronger check: taskkill /T kills the tree under each top-level PID, but
// verify no Electron process pointing at this repo's bundle survived
// regardless — this is what "no permanent orphan processes" actually means
// for a real user, not just the immediate child handle.
if (process.platform === 'win32') {
  try {
    const bundleAbsPath = path.resolve(MAIN_BUNDLE);
    const out = execSync(
      'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'electron.exe\'\\" | Select-Object -ExpandProperty CommandLine"',
      { encoding: 'utf8' }
    );
    const survivors = out.split(/\r?\n/).filter((line) => line.includes(bundleAbsPath) || line.includes('dist-electron\\main.js') || line.includes('dist-electron/main.js'));
    if (survivors.length > 0) {
      console.error(`\nWARNING: ${survivors.length} electron.exe process(es) referencing this bundle are still running after all runs completed:`);
      for (const line of survivors) console.error(`  ${line.trim()}`);
    } else {
      console.log('Cleanup validated: no electron.exe process referencing this bundle remains running.');
    }
  } catch (error) {
    console.log(`(orphan process-tree check skipped: ${error instanceof Error ? error.message : String(error)})`);
  }
}

console.log(`\n${JSON.stringify(results)}`);
