#!/usr/bin/env node
/**
 * scripts/dev.mjs
 *
 * Unified development launcher for Solith.
 *
 * Starts:
 *   1. Vite dev server  (renderer)
 *   2. tsup in watch mode (Electron main + preload)
 *   3. Electron itself — after Vite is accepting connections
 *
 * Process safety:
 *   - Only the Electron child spawned by THIS script is ever killed.
 *   - Never runs taskkill /IM electron.exe — that would kill unrelated Electron apps.
 *   - When the developer presses Ctrl+C the launcher kills its own children and exits.
 *
 * Environment:
 *   - SOLITH_DEV=1 is set for every child so main.ts loads the Vite URL.
 */

import { spawn } from 'child_process';
import { createConnection } from 'net';

const VITE_PORT = 3000;
const VITE_HOST = 'localhost';
const POLL_INTERVAL_MS = 300;
const VITE_READY_TIMEOUT_MS = 60_000;

// ── ANSI helpers ─────────────────────────────────────────────────────────────
const dim   = s => `\x1b[2m${s}\x1b[0m`;
const cyan  = s => `\x1b[36m${s}\x1b[0m`;
const green = s => `\x1b[32m${s}\x1b[0m`;
const red   = s => `\x1b[31m${s}\x1b[0m`;
const bold  = s => `\x1b[1m${s}\x1b[0m`;

function tag(label, color) {
  return color(`[${label}]`);
}

// ── Process registry ──────────────────────────────────────────────────────────
const children = new Map(); // name → ChildProcess

function spawnChild(name, cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, SOLITH_DEV: '1', FORCE_COLOR: '1' },
    shell: process.platform === 'win32',
    ...opts,
  });

  const prefix = tag(name, dim);
  child.stdout?.on('data', chunk =>
    process.stdout.write(prefix + ' ' + chunk.toString())
  );
  child.stderr?.on('data', chunk =>
    process.stderr.write(prefix + ' ' + chunk.toString())
  );

  child.on('error', err => {
    console.error(red(`[dev] ${name} failed to start: ${err.message}`));
  });

  child.on('exit', (code, signal) => {
    children.delete(name);
    if (code !== 0 && signal !== 'SIGTERM' && signal !== 'SIGKILL') {
      console.error(red(`[dev] ${name} exited unexpectedly (code=${code}, signal=${signal})`));
    }
  });

  children.set(name, child);
  return child;
}

function killAll() {
  for (const [name, child] of children) {
    console.log(dim(`[dev] Stopping ${name} (pid=${child.pid})…`));
    try {
      child.kill('SIGTERM');
    } catch { /* already gone */ }
  }
}

// ── Vite readiness check ──────────────────────────────────────────────────────
function pollVite(timeout) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout;

    function attempt() {
      const client = createConnection({ port: VITE_PORT, host: VITE_HOST });
      client.setTimeout(300);
      client.on('connect', () => {
        client.destroy();
        resolve();
      });
      client.on('error', () => {
        client.destroy();
        if (Date.now() >= deadline) {
          reject(new Error(`Vite did not start within ${timeout / 1000}s`));
        } else {
          setTimeout(attempt, POLL_INTERVAL_MS);
        }
      });
      client.on('timeout', () => {
        client.destroy();
        if (Date.now() >= deadline) {
          reject(new Error(`Vite did not start within ${timeout / 1000}s`));
        } else {
          setTimeout(attempt, POLL_INTERVAL_MS);
        }
      });
    }

    attempt();
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(bold(cyan('\n  Solith — Development Mode\n')));

  // 1. Start Vite
  spawnChild('vite', 'npx', ['vite', '--port', String(VITE_PORT)]);
  console.log(dim('[dev] Vite starting…'));

  // 2. Start tsup in watch mode (builds main + preload)
  spawnChild('tsup', 'npx', ['tsup', '--config', 'tsup.config.ts', '--watch']);
  console.log(dim('[dev] tsup watching Electron source…'));

  // 3. Wait for Vite to be ready, then launch Electron
  console.log(dim(`[dev] Waiting for Vite on http://${VITE_HOST}:${VITE_PORT}…`));
  try {
    await pollVite(VITE_READY_TIMEOUT_MS);
  } catch (err) {
    console.error(red('[dev] ' + err.message));
    killAll();
    process.exit(1);
  }

  console.log(green(`[dev] Vite ready — launching Electron…\n`));
  spawnChild('electron', 'npx', ['electron', 'dist-electron/main.js', '--dev']);

  // ── Graceful shutdown ────────────────────────────────────────────────────
  const shutdown = () => {
    console.log(dim('\n[dev] Shutting down Solith dev…'));
    killAll();
    // Give children a moment to exit before the host process does
    setTimeout(() => process.exit(0), 800);
  };

  process.on('SIGINT',  shutdown);
  process.on('SIGTERM', shutdown);

  // If Electron quits normally (dev closed the window), shut everything else down too
  children.get('electron')?.on('exit', () => {
    if (children.size > 0) {
      console.log(dim('[dev] Electron exited — stopping Vite and tsup…'));
      // Remove electron from map first so shutdown doesn't try to kill it again
      children.delete('electron');
      shutdown();
    }
  });
}

main().catch(err => {
  console.error(red('[dev] Fatal: ' + err.message));
  killAll();
  process.exit(1);
});
