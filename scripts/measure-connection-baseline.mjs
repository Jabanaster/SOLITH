#!/usr/bin/env node
/**
 * Measure non-loopback TCP connection count for a game process (KI-017 baseline tool).
 *
 * Usage:
 *   node scripts/measure-connection-baseline.mjs --pid 12345
 *   node scripts/measure-connection-baseline.mjs --name "Palworld-Win64-Shipping.exe"
 *
 * Output: JSON { pid, processName, establishedCount, sample[] }
 */
import { execFileSync } from 'node:child_process';

function parseArgs(argv) {
  const args = { pid: null, name: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--pid') args.pid = Number(argv[++i]);
    else if (argv[i] === '--name') args.name = argv[++i];
  }
  return args;
}

function resolvePid(args) {
  if (args.pid && Number.isFinite(args.pid)) return args.pid;
  if (!args.name) throw new Error('Provide --pid or --name');
  const out = execFileSync('powershell', [
    '-NoProfile',
    '-Command',
    `(Get-Process -Name '${args.name.replace(/\.exe$/i, '')}' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Id)`,
  ], { encoding: 'utf-8' }).trim();
  const pid = Number(out);
  if (!Number.isFinite(pid)) throw new Error(`Process not found: ${args.name}`);
  return pid;
}

function measureConnections(pid) {
  const script = `
    $conns = Get-NetTCPConnection -OwningProcess ${pid} -State Established -ErrorAction SilentlyContinue |
      Where-Object { $_.RemoteAddress -notmatch '^(127\\.|::1)' }
    $conns | Select-Object LocalAddress, LocalPort, RemoteAddress, RemotePort, State | ConvertTo-Json -Compress
  `;
  const raw = execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf-8' }).trim();
  if (!raw) return { establishedCount: 0, sample: [] };
  let sample = JSON.parse(raw);
  if (!Array.isArray(sample)) sample = [sample];
  return { establishedCount: sample.length, sample };
}

function main() {
  const args = parseArgs(process.argv);
  const pid = resolvePid(args);
  const procName = execFileSync('powershell', [
    '-NoProfile',
    '-Command',
    `(Get-Process -Id ${pid} -ErrorAction Stop).ProcessName`,
  ], { encoding: 'utf-8' }).trim();

  const { establishedCount, sample } = measureConnections(pid);
  const result = {
    pid,
    processName: procName.endsWith('.exe') ? procName : `${procName}.exe`,
    establishedCount,
    reviewedAt: new Date().toISOString().slice(0, 10),
    sample,
    evidenceTemplate:
      `Measured live against ${procName} (PID ${pid}) during solo play: ${establishedCount} ESTABLISHED non-loopback TCP connections.`,
  };
  console.log(JSON.stringify(result, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
