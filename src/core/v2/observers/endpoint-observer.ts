import { platform } from 'node:os';
import { runCommand } from './command-runner.js';
import type { EndpointObservationResult, LocalEndpoint } from '../lifecycle/types.js';

/**
 * Read-only localhost TCP endpoint observer — async, no shell, no blocking.
 *
 * Returns only 127.0.0.1 endpoints (no remote addresses, no payloads).
 * Uses spawn (no shell); netstat and ss are called with fixed argument arrays.
 *
 * @param signal - Optional AbortSignal. On abort, the spawned child process
 *   receives SIGTERM and the function returns an 'unavailable' result.
 */
export async function observeLocalEndpoints(signal?: AbortSignal): Promise<EndpointObservationResult> {
  const observedAt = new Date().toISOString();
  const os = platform();

  if (os === 'win32') {
    return observeWindows(observedAt, signal);
  }
  return observeUnix(observedAt, signal);
}

async function observeWindows(observedAt: string, signal?: AbortSignal): Promise<EndpointObservationResult> {
  let raw: string;
  try {
    // Fixed args, no shell, no interpolation
    raw = await runCommand('netstat', ['-ano'], {}, 6000, signal);
  } catch (err) {
    const msg = String(err);
    if (msg.includes('aborted')) {
      return { availability: 'unavailable', listeners: [], connections: [], observedAt };
    }
    if (msg.includes('permission_denied')) {
      return { availability: 'permission_denied', listeners: [], connections: [], error: msg.slice(0, 120), observedAt };
    }
    return { availability: 'error', listeners: [], connections: [], error: msg.slice(0, 120), observedAt };
  }
  return parseNetstatWindows(raw, observedAt);
}

function parseNetstatWindows(raw: string, observedAt: string): EndpointObservationResult {
  const listeners: LocalEndpoint[] = [];
  const connections: LocalEndpoint[] = [];

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('TCP')) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 5) continue;

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

async function observeUnix(observedAt: string, signal?: AbortSignal): Promise<EndpointObservationResult> {
  let raw: string;
  try {
    // Fixed args only — no user input
    raw = await runCommand('ss', ['-tlpn', 'src', '127.0.0.1'], {}, 5000, signal);
  } catch {
    return { availability: 'unavailable', listeners: [], connections: [], observedAt };
  }
  const listeners = parseSSOutput(raw);
  return { availability: 'available', listeners, connections: [], observedAt };
}

function parseSSOutput(raw: string): LocalEndpoint[] {
  const results: LocalEndpoint[] = [];
  for (const line of raw.split('\n')) {
    if (!line.includes('127.0.0.1:')) continue;
    const match = line.match(/127\.0\.0\.1:(\d+)/);
    if (match) {
      const port = parseInt(match[1], 10);
      if (!isNaN(port)) {
        results.push({ port, address: '127.0.0.1', state: 'LISTENING' });
      }
    }
  }
  return results;
}
