import { platform } from 'node:os';
import type { ProcessObservationResult, ProcessIdentity } from '../lifecycle/types.js';
import { runCommand } from './command-runner.js';

/**
 * Read-only process observer — async, no shell, no blocking.
 *
 * Executable name is passed via environment variable, never interpolated
 * into a command string. This eliminates shell injection at the construction
 * site regardless of what the name contains.
 *
 * No memory access. No module enumeration. No handle retention.
 *
 * @param signal - Optional AbortSignal. On abort, the spawned child process
 *   receives SIGTERM and the promise rejects with 'aborted'.
 */
export async function observeProcess(
  executableName: string,
  signal?: AbortSignal,
): Promise<ProcessObservationResult> {
  const observedAt = new Date().toISOString();

  if (!executableName || typeof executableName !== 'string') {
    return { availability: 'error', identity: null, error: 'Invalid executable name', observedAt };
  }

  // Allowlist: filename characters only, no metacharacters
  if (!/^[\w\-. ]+$/i.test(executableName) || executableName.length > 100) {
    return { availability: 'error', identity: null, error: 'Executable name failed safety check', observedAt };
  }

  if (signal?.aborted) {
    return { availability: 'error', identity: null, error: 'aborted', observedAt };
  }

  const os = platform();
  if (os === 'win32') {
    return observeProcessWindows(executableName, observedAt, signal);
  }
  return observeProcessUnix(executableName, observedAt, signal);
}

async function observeProcessWindows(
  executableName: string,
  observedAt: string,
  signal?: AbortSignal,
): Promise<ProcessObservationResult> {
  // Pass the process name through an environment variable — the PowerShell
  // command script is a fixed literal with NO user-controlled interpolation.
  const script =
    'Get-CimInstance Win32_Process -Filter "Name=\'$($env:RF_PROC_NAME)\'" |' +
    ' Select-Object -First 1 ProcessId,Name,CreationDate,ExecutablePath |' +
    ' ConvertTo-Json -Compress';

  let raw: string;
  try {
    raw = await runCommand(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { RF_PROC_NAME: executableName },
      6000,
      signal,
    );
  } catch (err) {
    const msg = String(err);
    if (msg.includes('aborted')) {
      return { availability: 'error', identity: null, error: 'aborted', observedAt };
    }
    if (msg.includes('permission_denied')) {
      return { availability: 'permission_denied', identity: null, error: msg.slice(0, 120), observedAt };
    }
    // Treat other errors as process simply not found
    return { availability: 'available', identity: null, observedAt };
  }

  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'null') {
    return { availability: 'available', identity: null, observedAt };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { availability: 'available', identity: null, observedAt };
  }

  if (!parsed || !parsed['ProcessId']) {
    return { availability: 'available', identity: null, observedAt };
  }

  const identity: ProcessIdentity = {
    pid: Number(parsed['ProcessId']),
    name: String(parsed['Name'] ?? executableName),
    startTime: normalizeWmiDate(parsed['CreationDate']),
    executablePath: typeof parsed['ExecutablePath'] === 'string' ? parsed['ExecutablePath'] : undefined,
    observedAt,
  };

  return { availability: 'available', identity, observedAt };
}

async function observeProcessUnix(
  executableName: string,
  observedAt: string,
  signal?: AbortSignal,
): Promise<ProcessObservationResult> {
  const base = executableName.replace(/\.exe$/i, '');
  // Use grep -F (fixed string) to prevent regex injection
  let raw: string;
  try {
    raw = await runCommand(
      'sh',
      ['-c', 'ps -eo pid,lstart,comm | grep -F "$RF_PROC_NAME" | grep -v grep | head -1'],
      { RF_PROC_NAME: base },
      5000,
      signal,
    );
  } catch (err) {
    const msg = String(err);
    if (msg.includes('aborted')) {
      return { availability: 'error', identity: null, error: 'aborted', observedAt };
    }
    return { availability: 'available', identity: null, observedAt };
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return { availability: 'available', identity: null, observedAt };
  }

  const parts = trimmed.split(/\s+/);
  const pid = parseInt(parts[0], 10);
  if (isNaN(pid)) return { availability: 'available', identity: null, observedAt };
  const startTime = parts.slice(1, 6).join(' ');

  return {
    availability: 'available',
    identity: { pid, name: executableName, startTime, observedAt },
    observedAt,
  };
}


function normalizeWmiDate(raw: unknown): string {
  if (!raw) return '';
  if (typeof raw === 'string') {
    const match = raw.match(/\/Date\((\d+)\)\//);
    if (match) return new Date(parseInt(match[1], 10)).toISOString();
    return raw;
  }
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, unknown>;
    if (typeof obj['DateTime'] === 'string') return obj['DateTime'];
    if (typeof obj['value'] === 'string') return obj['value'];
  }
  return String(raw);
}
