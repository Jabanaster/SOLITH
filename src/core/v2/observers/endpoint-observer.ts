import { execSync } from 'node:child_process';
import { platform } from 'node:os';
import type { EndpointObservationResult, LocalEndpoint } from '../lifecycle/types.js';

/**
 * Read-only localhost TCP endpoint observer.
 *
 * Returns only 127.0.0.1 endpoints (no remote addresses).
 * Does not read network payloads. Does not inspect process memory.
 * Does not intercept traffic.
 */
export function observeLocalEndpoints(): EndpointObservationResult {
  const observedAt = new Date().toISOString();
  const os = platform();

  if (os === 'win32') {
    return observeWindows(observedAt);
  }
  return observeUnix(observedAt);
}

function observeWindows(observedAt: string): EndpointObservationResult {
  try {
    // netstat -ano gives: Proto  LocalAddress  ForeignAddress  State  PID
    // We filter to 127.0.0.1 only in the parse step.
    const raw = execSync('netstat -ano', { encoding: 'utf-8', timeout: 6000, windowsHide: true });
    return parseNetstatWindows(raw, observedAt);
  } catch (err) {
    const msg = String(err);
    if (msg.includes('Access') || msg.includes('access')) {
      return { availability: 'permission_denied', listeners: [], connections: [], error: msg.slice(0, 120), observedAt };
    }
    return { availability: 'error', listeners: [], connections: [], error: msg.slice(0, 120), observedAt };
  }
}

function parseNetstatWindows(raw: string, observedAt: string): EndpointObservationResult {
  const listeners: LocalEndpoint[] = [];
  const connections: LocalEndpoint[] = [];

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('TCP')) continue;

    const parts = trimmed.split(/\s+/);
    if (parts.length < 5) continue;

    // parts: TCP  127.0.0.1:PORT  0.0.0.0:0  LISTENING  PID
    const localAddr = parts[1];
    const state = parts[3];
    const pidStr = parts[4];

    if (!localAddr.startsWith('127.0.0.1:')) continue;

    const portStr = localAddr.split(':')[1];
    const port = parseInt(portStr, 10);
    const ownerPid = parseInt(pidStr, 10);

    if (isNaN(port)) continue;

    const endpoint: LocalEndpoint = {
      port,
      address: '127.0.0.1',
      state: state === 'ESTABLISHED' ? 'ESTABLISHED' : 'LISTENING',
      ownerPid: isNaN(ownerPid) ? undefined : ownerPid,
    };

    if (state === 'LISTENING') {
      listeners.push(endpoint);
    } else if (state === 'ESTABLISHED') {
      connections.push(endpoint);
    }
  }

  return { availability: 'available', listeners, connections, observedAt };
}

function observeUnix(observedAt: string): EndpointObservationResult {
  try {
    const raw = execSync('ss -tlpn "src 127.0.0.1"', { encoding: 'utf-8', timeout: 5000 });
    const listeners = parseSSOutput(raw);
    return { availability: 'available', listeners, connections: [], observedAt };
  } catch {
    return { availability: 'unavailable', listeners: [], connections: [], observedAt };
  }
}

function parseSSOutput(raw: string): LocalEndpoint[] {
  const results: LocalEndpoint[] = [];
  for (const line of raw.split('\n')) {
    if (!line.includes('127.0.0.1:')) continue;
    const match = line.match(/127\.0\.0\.1:(\d+)/);
    if (match) {
      results.push({ port: parseInt(match[1], 10), address: '127.0.0.1', state: 'LISTENING' });
    }
  }
  return results;
}
